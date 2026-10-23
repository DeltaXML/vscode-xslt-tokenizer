#!/usr/bin/env node
// Drives the XSLT debug adapter (xslt-resources/xslt-debugger/xslt-debugger.jar) over the Debug Adapter Protocol,
// as VS Code does, against the fixtures in debugger/test - to check it with each supported Saxon version:
//
//   node scripts/test-debugger.js /path/to/saxon-he-12.9.jar [/path/to/saxon-pe-13.1.jar ...]
//
// Saxon-PE/EE jars need their licence file alongside them, as usual. Other jars a Saxon jar depends on (e.g. Saxon-HE
// from Maven Central needs xmlresolver) can be added with the platform's path separator: saxon.jar:xmlresolver.jar
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const adapterJar = path.join(root, 'xslt-resources', 'xslt-debugger', 'xslt-debugger.jar');
const fixtures = path.join(root, 'debugger', 'test');

class DapClient {
    constructor(saxonJar) {
        this.seq = 1;
        this.pending = new Map();
        this.waiters = [];
        this.events = [];
        this.output = '';
        this.buffer = Buffer.alloc(0);
        this.process = spawn('java', ['-cp', [adapterJar, saxonJar].join(path.delimiter), 'com.deltaxml.xslt.debug.XsltDebugAdapter']);
        this.process.stdout.on('data', (data) => this.receive(data));
        this.process.stderr.on('data', (data) => process.stderr.write(data));
        this.exited = new Promise((resolve) => this.process.on('exit', resolve));
    }

    receive(data) {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                return;
            }
            const length = Number(/Content-Length: (\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString())[1]);
            if (this.buffer.length < headerEnd + 4 + length) {
                return;
            }
            const message = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8'));
            this.buffer = this.buffer.subarray(headerEnd + 4 + length);
            if (message.type === 'response') {
                const { resolve, reject } = this.pending.get(message.request_seq);
                this.pending.delete(message.request_seq);
                message.success ? resolve(message.body) : reject(new Error(`${message.command}: ${message.message}`));
            } else if (message.type === 'event') {
                if (message.event === 'output') {
                    this.output += message.body.output;
                }
                this.events.push(message);
                this.waiters = this.waiters.filter((w) => !w(message));
            }
        }
    }

    request(command, args) {
        const seq = this.seq++;
        const json = JSON.stringify({ seq, type: 'request', command, arguments: args });
        this.process.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
        return new Promise((resolve, reject) => this.pending.set(seq, { resolve, reject }));
    }

    // the next event with this name (not one already received)
    event(name, timeout = 20000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timed out waiting for '${name}' event`)), timeout);
            this.waiters.push((message) => {
                if (message.event === name) {
                    clearTimeout(timer);
                    resolve(message.body);
                    return true;
                }
                return false;
            });
        });
    }

    async stopped() {
        const body = await this.event('stopped');
        const { stackFrames } = await this.request('stackTrace', { threadId: 1 });
        return { reason: body.reason, frames: stackFrames };
    }

    async variables(frameId, scopeName) {
        const { scopes } = await this.request('scopes', { frameId });
        const scope = scopes.find((s) => s.name === scopeName);
        const { variables } = await this.request('variables', { variablesReference: scope.variablesReference });
        return variables;
    }

    async start(launchArgs, breakpoints) {
        await this.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
        await this.request('launch', launchArgs);
        for (const [file, lines] of Object.entries(breakpoints)) {
            await this.request('setBreakpoints', { source: { path: path.join(fixtures, file) }, breakpoints: lines });
        }
        await this.request('configurationDone', {});
    }
}

const byName = (variables) => Object.fromEntries(variables.map((v) => [v.name, v]));

async function testBreakpointsAndInspection(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'basic.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
        { 'basic.xsl': [{ line: 12, condition: '$doubled = 4' }] });

    // conditional breakpoint: the second item
    let stop = await stopped;
    assert.strictEqual(stop.reason, 'breakpoint');
    assert.strictEqual(stop.frames[0].line, 12);
    assert.strictEqual(path.basename(stop.frames[0].source.path), 'basic.xsl');
    assert.match(stop.frames[0].name, /xsl:template match="item"/);
    assert.match(stop.frames[1].name, /xsl:template match="\/"/);

    const locals = byName(await dap.variables(0, 'Locals'));
    assert.strictEqual(locals.$doubled.value, '4');
    assert.strictEqual(locals.$doubled.type, 'xs:double');
    const context = byName(await dap.variables(0, 'Context'));
    assert.match(context['.'].value, /^<item n="2">/);
    // its path, as xdm:debug() shows it, and its line
    assert.strictEqual(context['.'].type, 'element() /items/item[2] line 3');
    assert.strictEqual(context['position()'].value, '2');
    assert.strictEqual(context['last()'].value, '3');
    const item = byName((await dap.request('variables', { variablesReference: context['.'].variablesReference })).variables);
    assert.strictEqual(item['@n'].value, 'n="2"');
    // an attribute or text node: its path in the summary; an element's child nodes, without
    let atPath = await dap.request('evaluate', { expression: '@n', frameId: 0, context: 'watch' });
    assert.strictEqual(atPath.result, '/items/item[2]/@n="2"');
    atPath = await dap.request('evaluate', { expression: 'text()', frameId: 0, context: 'watch' });
    assert.strictEqual(atPath.result, '/items/item[2]/text() "two"');
    assert.strictEqual(item['text()[1]'].value, '"two"');

    const globals = byName(await dap.variables(0, 'Globals'));
    assert.strictEqual(globals.$greeting.value, '"hello"');
    assert.strictEqual(globals.$config.value, 'map{2 entries}');
    const config = byName((await dap.request('variables', { variablesReference: globals.$config.variablesReference })).variables);
    assert.strictEqual(config['"b"'].value, 'array{2 members}');

    let result = await dap.request('evaluate', { expression: '$doubled + @n', frameId: 0, context: 'watch' });
    assert.strictEqual(result.result, '6');
    result = await dap.request('evaluate', { expression: 'doubled', frameId: 0, context: 'hover' });
    assert.strictEqual(result.result, '4');
    // stylesheet functions, and current() - the instruction's context item
    result = await dap.request('evaluate', { expression: 'f:square($doubled)', frameId: 0, context: 'repl' });
    assert.strictEqual(result.result, '16');
    result = await dap.request('evaluate', { expression: 'current()/@n = 2', frameId: 0, context: 'watch' });
    assert.strictEqual(result.result, 'true');
    result = await dap.request('evaluate', { expression: 'f:nonexistent(1)', frameId: 0, context: 'repl' }).catch((e) => e);
    assert.ok(result instanceof Error && /nonexistent/.test(result.message), String(result));

    // step into the function call
    stopped = dap.stopped();
    await dap.request('stepIn', { threadId: 1 });
    stop = await stopped;
    while (!/f:square/.test(stop.frames[0].name)) {
        stopped = dap.stopped();
        await dap.request('stepIn', { threadId: 1 });
        stop = await stopped;
    }
    assert.strictEqual(stop.reason, 'step');
    assert.strictEqual(stop.frames[0].name, 'f:square#1');
    const params = byName(await dap.variables(0, 'Locals'));
    assert.strictEqual(params.$x.value, '4');

    // step out, back to the template
    stopped = dap.stopped();
    await dap.request('stepOut', { threadId: 1 });
    stop = await stopped;
    assert.match(stop.frames[0].name, /xsl:template match="item"|xsl:template match="\/"/);

    const terminated = dap.event('terminated');
    await dap.request('continue', { threadId: 1 });
    await terminated;
    assert.match(dap.output, /item 1/);
    assert.match(dap.output, /item 3/);
    assert.match(dap.output, /<result n="36"\/>/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

async function testStepOverAndLogpoint(saxonJar) {
    const dap = new DapClient(saxonJar);
    const stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'basic.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`], stopOnEntry: true },
        { 'basic.xsl': [{ line: 11, logMessage: 'n is {@n}, doubled {$doubled}' }] });
    let stop = await stopped;
    assert.strictEqual(stop.reason, 'entry');

    // step over the apply-templates: logpoints still log, but don't stop
    const lines = [stop.frames[0].line];
    while (lines.length < 10) {
        const next = dap.stopped();
        await dap.request('next', { threadId: 1 });
        stop = await Promise.race([next, dap.event('terminated').then(() => undefined)]);
        if (!stop) {
            break;
        }
        assert.strictEqual(stop.frames.filter((f) => /xsl:template/.test(f.name)).length, 1, 'next stays in the template');
        lines.push(stop.frames[0].line);
    }
    assert.ok(lines.includes(6), `stepped over line 6: ${lines}`);
    assert.match(dap.output, /n is 1, doubled 2/);
    assert.match(dap.output, /n is 3, doubled 6/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

async function testInitialTemplateAndError(saxonJar) {
    const dap = new DapClient(saxonJar);
    const ended = Promise.all([dap.event('exited'), dap.event('terminated')]);
    const stopped = dap.event('stopped');
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'error.xsl')}`, '-it'] }, {});
    // pauses at the error, then ends
    assert.strictEqual((await stopped).reason, 'exception');
    await dap.request('continue', { threadId: 1 });
    const [{ exitCode }] = await ended;
    assert.strictEqual(exitCode, 2);
    assert.match(dap.output, /FOAR0001|divide by zero|Integer division by zero/i);
    // for the extension's notification: the same message as the error (so it's given the error's location)
    const error = dap.events.find((e) => e.event === 'xsltDebugError');
    assert.deepStrictEqual(dap.events.filter((e) => e.event === 'xsltDebugFailure').map((e) => e.body.message), [error.body.message]);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// breakpoints on an instruction's start tag are shown at its first line - though Saxon reports it at the tag's end -
// lines of a multi-line XPath expression are the expression's, and breakpoints are rejected where nothing is traced
// the same with Windows line ends, and a byte order mark (as Windows editors often add) - in UTF-8 or UTF-16
async function testBreakpointVerification(saxonJar) {
    const dap = new DapClient(saxonJar);
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    const requested = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 23, 24, 27, 28, 32, 33, 34];
    const expected = {
        1: 'x', 2: 'x', 3: 'x', 4: 'x', 5: 'x', 6: 'x', 7: 7, 8: 8, 9: 9, 10: 10, 11: 8, 12: 12, 13: 13, 14: 13,
        15: 'x', 16: 'x', 17: 'x', 19: 19, 20: 20, 21: 21, 23: 'x', 24: 24, 27: 27, 28: 28, 32: 32, 33: 'x', 34: 34
    };
    const verify = async (file, variant) => {
        const { breakpoints } = await dap.request('setBreakpoints', { source: { path: file }, breakpoints: requested.map((line) => ({ line })) });
        const actual = Object.fromEntries(requested.map((line, i) => [line, breakpoints[i].verified ? breakpoints[i].line : 'x']));
        assert.deepStrictEqual(actual, expected, variant);
        return breakpoints;
    };
    const breakpoints = await verify(path.join(fixtures, 'breakpoints.xsl'), 'as is');
    const fs = require('fs');
    const text = fs.readFileSync(path.join(fixtures, 'breakpoints.xsl'), 'utf8').replace(/\r?\n/g, '\r\n');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'xslt-debug-'));
    try {
        const variants = {
            'UTF-8 with a byte order mark': Buffer.from('\ufeff' + text, 'utf8'),
            'UTF-16 with a byte order mark': Buffer.from('\ufeff' + text.replace('encoding="UTF-8"', 'encoding="UTF-16"'), 'utf16le')
        };
        for (const [variant, bytes] of Object.entries(variants)) {
            const file = path.join(dir, 'breakpoints.xsl');
            fs.writeFileSync(file, bytes);
            await verify(file, variant);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    const message = (line) => breakpoints[requested.indexOf(line)].message;
    assert.match(message(3), /xsl:output isn't an instruction/);
    assert.match(message(4), /top-level data element/);
    assert.match(message(6), /No XSLT instruction/);
    assert.match(message(17), /isn't executed/);
    // xsl:sort with a select is stopped at as its sort key is computed (see testSort)
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// a breakpoint on the first line of a multi-line start tag stops there, at its instruction - Saxon reports it at the
// tag's end; one on xsl:choose stops once for each item, whether Saxon reports it at its own line (Saxon 12) or its
// first xsl:when (Saxon 13)
async function testMovedBreakpointsStop(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${path.join(fixtures, 'multiline.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: path.join(fixtures, 'multiline.xsl') }, breakpoints: [{ line: 9 }, { line: 13 }] });
    assert.deepStrictEqual(breakpoints.map((b) => b.line), [9, 13]);
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const lines = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        lines.push(stop.frames[0].line);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.strictEqual(lines.length, 6, `stops: ${lines}`);
    for (let i = 0; i < 6; i += 2) {
        assert.strictEqual(lines[i], 9);
        assert.ok(lines[i + 1] === 13 || lines[i + 1] === 14, `stops: ${lines}`);
    }
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// Step Into at an instruction with a multi-line XPath expression steps through the expression - evaluated
// separately, in its own stack frame - and into the stylesheet functions it calls; Step Out returns
async function testStepThroughXPath(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'multiline.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
        { 'multiline.xsl': [{ line: 9 }] });
    let stop = await stopped;
    assert.strictEqual(stop.frames[0].line, 9);

    stopped = dap.stopped();
    await dap.request('stepIn', { threadId: 1 });
    stop = await stopped;
    assert.strictEqual(stop.frames[0].name, 'xsl:variable/@select (XPath)');
    assert.ok([10, 11].includes(stop.frames[0].line), `in the expression: ${stop.frames[0].line}`);
    assert.match(stop.frames[1].name, /xsl:template match="item"/);
    let result = await dap.request('evaluate', { expression: '@n * 10', frameId: 0, context: 'watch' });
    assert.strictEqual(result.result, '10');

    while (stop.frames[0].name !== 'f:twice#1') {
        stopped = dap.stopped();
        await dap.request('stepIn', { threadId: 1 });
        stop = await stopped;
    }
    assert.strictEqual(stop.frames[1].name, 'xsl:variable/@select (XPath)');
    const locals = byName(await dap.variables(0, 'Locals'));
    assert.match(locals.$x.value, /n="1"/);

    // out of the function, then out of the expression - once, with Saxon 12, where the Locals above evaluated the
    // function's lazily evaluated argument (@n, line 11), so the expression isn't stopped in again. The function
    // isn't entered again: the instruction's own evaluation of the expression, just stepped through, is quiet
    for (let i = 0; i < 2 && (stop.frames[0].name === 'f:twice#1' || stop.frames[0].name.endsWith('(XPath)')); i++) {
        stopped = dap.stopped();
        await dap.request('stepOut', { threadId: 1 });
        stop = await stopped;
    }
    assert.match(stop.frames[0].name, /xsl:template match="item"/);
    assert.notStrictEqual(stop.frames[0].name, 'f:twice#1');
    assert.notStrictEqual(stop.frames[0].name, 'xsl:variable/@select (XPath)');

    // the other items stop at the instruction, but - not stepping in - don't go through the expression
    const terminated = dap.event('terminated');
    const lines = [];
    while (true) {
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
        stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        lines.push(stop.frames[0].line);
    }
    assert.deepStrictEqual(lines, [9, 9]);
    // its result, in the Debug Console, marked as the debugger's: the variable, the attribute and its lines
    assert.match(dap.output, /\u25B8 \$total \(xsl:variable\/@select, lines 9-12\) returned 2/);
    assert.match(dap.output, /<other total="4"\/>/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// a breakpoint within a multi-line XPath expression stops there for each item, in the expression's context
async function testBreakpointInXPath(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${path.join(fixtures, 'multiline.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: path.join(fixtures, 'multiline.xsl') }, breakpoints: [{ line: 11 }] });
    assert.deepStrictEqual(breakpoints.map((b) => [b.verified, b.line]), [[true, 11]]);
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const values = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        assert.strictEqual(stop.frames[0].line, 11);
        assert.strictEqual(stop.frames[0].name, 'xsl:variable/@select (XPath)');
        values.push((await dap.request('evaluate', { expression: 'string(@n)', frameId: 0, context: 'watch' })).result);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    if (values.length !== 3) { console.log(dap.output); }
    assert.deepStrictEqual(values, ['"1"', '"2"', '"3"']);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// breakpoints on every line of a stylesheet with many forms of multi-line XPath: each stops within its expression,
// each expression can be evaluated separately, and the result is unchanged
// an inline function's body is stepped through when it's called, e.g. by fold-left() - stepping into it from the
// function's own line, and stopping at a breakpoint in it, with its parameters (and a variable it captures) as locals
async function testInlineFunctions(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    const outDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'xslt-debug-out-'));
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'inline-functions.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`, `-o:${path.join(outDir, 'result.xml')}`] },
        { 'inline-functions.xsl': [{ line: 7 }, { line: 12 }] });
    const terminated = dap.event('terminated');

    let stop = await stopped;
    assert.strictEqual(stop.reason, 'breakpoint');
    assert.strictEqual(stop.frames[0].line, 7);
    assert.strictEqual(stop.frames[0].name, 'xsl:sequence/@select (XPath)');
    // into the body, called by fold-left()
    stopped = dap.stopped();
    await dap.request('stepIn', { threadId: 1 });
    stop = await stopped;
    assert.strictEqual(stop.reason, 'step');
    assert.strictEqual(stop.frames[0].line, 8);
    let locals = byName(await dap.variables(0, 'Locals'));
    assert.strictEqual(locals.$sum.value, '0');
    assert.match(locals.$item.value, /^<item n="1"/);
    // the body is on one line: stepping into it again stops there for a later call - the next, or with Saxon 12,
    // whose fold-left evaluates $sum lazily, the last, within which the one before it is evaluated
    stopped = dap.stopped();
    await dap.request('stepIn', { threadId: 1 });
    stop = await stopped;
    assert.strictEqual(stop.frames[0].line, 8);
    locals = byName(await dap.variables(0, 'Locals'));
    assert.match(locals.$item.value, /^<item n="[23]"/);

    const scaled = [];
    while (true) {
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
        stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        // the function that captures $factor
        assert.strictEqual(stop.frames[0].line, 12);
        locals = byName(await dap.variables(0, 'Locals'));
        scaled.push(`${(await dap.request('evaluate', { expression: 'string($item/@n)', frameId: 0, context: 'watch' })).result}*${locals.$factor ? locals.$factor.value : '?'}`);
    }
    assert.deepStrictEqual(scaled, ['"1"*3', '"2"*3', '"3"*3']);
    assert.match(require('fs').readFileSync(path.join(outDir, 'result.xml'), 'utf8'), /<sum>6<\/sum><scaled>3 6 9<\/scaled>/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// the Context scope: current-group() and current-grouping-key() in xsl:for-each-group, and regex-group() in
// xsl:analyze-string
async function testGroupsInContext(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'groups.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
        { 'groups.xsl': [{ line: 5 }, { line: 9 }] });
    const terminated = dap.event('terminated');
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const context = byName(await dap.variables(0, 'Context'));
        stops.push(Object.fromEntries(Object.entries(context).filter(([name]) => name !== '.').map(([name, v]) => [name, v.value])));
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    // groups for @n mod 2: 1 (items 1 and 3), then 0 (item 2)
    assert.strictEqual(stops[0]['current-grouping-key()'], '1');
    assert.match(stops[0]['current-group()'], /^\(<item n="1"\/>, <item n="3"\/>\)$/);
    assert.strictEqual(stops[1]['current-grouping-key()'], '0');
    assert.match(stops[1]['current-group()'], /^<item n="2">/);
    // matches of ([a-z]+)(\d) in 'item1 item2 item3' - the groups in xsl:for-each-group are no longer current
    assert.deepStrictEqual([2, 3, 4].map((i) => [stops[i]['regex-group(0)'], stops[i]['regex-group(1)'], stops[i]['regex-group(2)']]),
        [['"item1"', '"item"', '"1"'], ['"item2"', '"item"', '"2"'], ['"item3"', '"item"', '"3"']]);
    assert.strictEqual(stops[2]['current-group()'], undefined);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// an XPath 4.0 positional variable, 'for $i at $pos': a local variable in scope where $i is - after it, not shown
async function testPositionalVariable(saxonJar) {
    if (!/saxon-[pe]e-1[3-9]/i.test(saxonJar)) {
        return 'skipped';
    }
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    const xsl = path.join(fixtures, 'positional.xsl');
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, '-it', '--allowSyntaxExtensions:on'] });
    await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: [{ line: 7 }, { line: 9 }] });
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        stops.push(`${stop.frames[0].line}: ${(await dap.variables(0, 'Locals')).map((v) => `${v.name}=${v.value}`).join(' ')}`);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.deepStrictEqual(stops, ['7: $i=5 $pos=1', '7: $i=6 $pos=2', '9: $after=1']);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// paused in a global variable's evaluation: globals still to be evaluated are shown only when they can't use it -
// directly or through a function - as evaluating them would be a circularity, and change the result
async function testGlobalsWhileEvaluatingGlobal(saxonJar) {
    const outDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'xslt-debug-out-'));
    const dap = new DapClient(saxonJar);
    const stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'globals.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`, `-o:${path.join(outDir, 'result.xml')}`] },
        { 'globals.xsl': [{ line: 5 }] });
    const terminated = dap.event('terminated');
    const stop = await stopped;
    assert.strictEqual(stop.frames[0].line, 5);
    const globals = (await dap.variables(0, 'Globals')).map((v) => `${v.name}=${v.value}`).sort();
    assert.deepStrictEqual(globals, ['$a=(not evaluated yet)', '$b=true', '$c=3', '$d=(not evaluated yet)', '$e=(not evaluated yet)']);
    const result = await dap.request('evaluate', { expression: '$d', frameId: 0, context: 'watch' }).catch((e) => e);
    assert.ok(result instanceof Error && /isn't evaluated yet/.test(result.message), String(result.message || result.result));
    assert.strictEqual((await dap.request('evaluate', { expression: '$c + 1', frameId: 0, context: 'watch' })).result, '4');
    await dap.request('continue', { threadId: 1 });
    await terminated;
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    const stderr = dap.events.filter((e) => e.event === 'output' && e.body.category === 'stderr').map((e) => e.body.output).join('');
    assert.ok(!/Exception/.test(stderr), stderr);
    assert.match(require('fs').readFileSync(path.join(outDir, 'result.xml'), 'utf8'), /<out c="3" a="1" b="true" d="1!" e="1"\/>/);
}

// Step Into goes through an expression only when that shows more than its result: not for comparisons joined by
// 'or' (line 5), but for an 'if' with its branches on their own lines - literal (9) or not (13) - stopping at the
// branch taken, a 'let' (17) and a function call (20). A breakpoint inside an expression still stops there
async function testStepIntoOnlyUsefulXPath(saxonJar) {
    const xsl = path.join(fixtures, 'step-worth.xsl');
    const run = async (breakpoints, command) => {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.start({ saxonArgs: [`-xsl:${xsl}`, '-it'] }, { 'step-worth.xsl': breakpoints });
        const terminated = dap.event('terminated');
        const seen = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            const frame = stop.frames[0];
            seen.push(frame.line + (frame.name.endsWith('(XPath)') ? 'x' : frame.name === 'f:twice#1' ? 'f' : ''));
            stopped = dap.stopped();
            stopped.catch(() => undefined);
            await dap.request(command, { threadId: 1 });
        }
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return seen;
    };
    const stepped = await run([{ line: 4 }], 'stepIn');
    assert.deepStrictEqual(stepped.slice(0, 9), ['4', '5', '9', '10x', '11x', '13', '14x', '15x', '17'], stepped.join(' '));
    assert.ok(stepped.includes('18x') && stepped.includes('21x') && stepped.includes('2f'), stepped.join(' '));
    const atBreakpoint = await run([{ line: 7 }], 'continue');
    assert.ok(atBreakpoint.length > 0 && atBreakpoint.every((stop) => stop === '7x'), atBreakpoint.join(' '));
}

// stepping into each expression that calls a function: the function is entered, and its xsl:message written, once
// for each call - the instruction's own evaluation of an expression just stepped through is quiet - whether the
// instruction evaluates it lazily (xsl:variable), with a conversion (xsl:value-of), as a test (xsl:when), in the
// template called (xsl:with-param) or as it is (xsl:sequence), and for a sequence (,) and an if, which Saxon compiles
// to instructions. The result is a normal run's
async function testSteppedExpressionsRunOnce(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'stepped-once.xsl')}`, '-it'] }, { 'stepped-once.xsl': [{ line: 4 }] });
    const terminated = dap.event('terminated');
    const calls = [];
    let previous = '';
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const name = stop.frames[0].name;
        if (name === 'f:t#1' && previous !== 'f:t#1') {
            calls.push((await dap.variables(0, 'Locals')).map((v) => `${v.name}=${v.value}`).join(' '));
        }
        previous = name;
        stopped = dap.stopped();
        stopped.catch(() => undefined);
        await dap.request('stepIn', { threadId: 1 });
    }
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.deepStrictEqual(calls, all.map((n) => `$x=${n}`));
    const messages = dap.output.split('\n').filter((line) => /^f:t \d+$/.test(line));
    assert.deepStrictEqual(messages, all.map((n) => `f:t ${n}`));
    assert.match(dap.output, /<out v="2">4 6small<p>10<\/p>12 14 16 20<\/out>/);
}

// an expression stepped through, or evaluated in Watch, has the instruction's static context: here its module's
// xpath-default-namespace and a named xsl:decimal-format
async function testSeparateEvaluationStaticContext(saxonJar) {
    const dap = new DapClient(saxonJar);
    const stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'static-context.xsl')}`, '-it'] }, { 'static-context.xsl': [{ line: 8 }] });
    const terminated = dap.event('terminated');
    const stop = await stopped;
    assert.strictEqual(stop.frames[0].name, 'xsl:variable/@select (XPath)');
    assert.strictEqual((await dap.request('evaluate', { expression: 'count($doc/r/a)', frameId: 0, context: 'watch' })).result, '2');
    await dap.request('continue', { threadId: 1 });
    await terminated;
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    assert.match(dap.output, /\u25B8 \$formatted \(xsl:variable\/@select, lines 7-9\) returned \("1,5", "2,0"\)/);
    assert.match(dap.output, /<out>1,5 2,0<\/out>/);
}

// XPath loops - a simple map (!), a path step (/) and a predicate - evaluate their right-hand side, or predicate,
// for each item: a breakpoint on its line stops for each item, with that item as the context item, its position()
// and last(); a path's steps on lines of their own don't also stop with the instruction's context. Step Into goes
// through a loop only when its body has something to show, here a function call (line 14) - entered once for each
// item, and not again as the instruction evaluates the expression - not just steps and arithmetic (lines 5 and 8).
// A function argument Saxon evaluates lazily, within the function, has no known position() or last()
async function testXPathLoops(saxonJar) {
    const xsl = path.join(fixtures, 'xpath-loops.xsl');
    const run = async (breakpoints, command) => {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.start({ saxonArgs: [`-xsl:${xsl}`, '-it'] }, { 'xpath-loops.xsl': breakpoints.map((line) => ({ line })) });
        const terminated = dap.event('terminated');
        const stops = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            const frame = stop.frames[0];
            let focus = '';
            if (frame.name.endsWith('(XPath)')) {
                const context = byName(await dap.variables(0, 'Context'));
                focus = ' ' + (context['.'].value === '(absent)' ? '(absent)' : context['.'].value.replace(/^.*?(n="\d"|<r>).*$/, '$1')) +
                    (context['position()'] ? ` ${context['position()'].value}/${context['last()'].value}` : '');
            }
            stops.push(`${frame.line}${frame.name === 'f:twice#1' ? 'f' : ''}${focus}`);
            stopped = dap.stopped();
            stopped.catch(() => undefined);
            await dap.request(command, { threadId: 1 });
        }
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        assert.match(dap.output, /<out map="10 20 30" path="1 2 3" call="2 4 6" filter="2"\/>/);
        return stops;
    };
    const items = (line) => [1, 2, 3].map((n) => `${line} n="${n}" ${n}/3`);
    assert.deepStrictEqual(await run([7, 10, 11, 14, 17], 'continue'),
        [...items(7), '10 <r> 1/1', ...items(11), ...items(14), ...items(17)]);
    const stepped = await run([5], 'stepIn');
    assert.deepStrictEqual(stepped.slice(0, 4), ['5', '8', '12', '13 (absent)']);
    const call = stepped.slice(4, stepped.indexOf('15'));
    assert.deepStrictEqual(call.filter((stop) => / \d\/3$/.test(stop)), items(14));
    assert.strictEqual(call.filter((stop) => stop === '2f').length > 0 && call.join(' ').split('14 n="').length - 1, 6, call.join(' | '));
    assert.ok(call.includes('14 n="1" (not known)/(not known)'), call.join(' | '));
    assert.deepStrictEqual(stepped.slice(stepped.indexOf('15')), ['15', '18', '19']);
}

// a function called with the arrow operator (=>) is stopped at on the arrow's line, before it's called - a
// breakpoint there stops - not where the expression before the arrow starts; in a chain, each arrow's line. Its
// parameters are those passed, its messages written once. XPath 4.0's mapping arrow (=!>, Saxon-PE 13) calls it for
// each item
async function testArrowCalls(saxonJar) {
    const run = async (file, breakpoints, command, extraArgs) => {
        const xsl = path.join(fixtures, file);
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.start({ saxonArgs: [`-xsl:${xsl}`, '-it'].concat(extraArgs) }, { [file]: breakpoints.map((line) => ({ line })) });
        const terminated = dap.event('terminated');
        const stops = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            const frame = stop.frames[0];
            const locals = /^f:/.test(frame.name) ? ' ' + (await dap.variables(0, 'Locals')).map((v) => `${v.name}=${v.value}`).join(' ') : '';
            stops.push(`${frame.line}${frame.name.endsWith('(XPath)') ? 'x' : /^f:/.test(frame.name) ? frame.name.replace(/#\d$/, '') : ''}${locals}`);
            stopped = dap.stopped();
            stopped.catch(() => undefined);
            await dap.request(command, { threadId: 1 });
        }
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return { stops, messages: dap.output.split('\n').filter((line) => /^twice \d$/.test(line)), output: dap.output };
    };
    let result = await run('arrow.xsl', [8, 11, 12, 15], 'continue', []);
    assert.deepStrictEqual(result.stops, ['8x', '12x', '11x', '15x']);
    result = await run('arrow.xsl', [5], 'stepIn', []);
    const calls = result.stops.filter((stop, i) => /^\d+f:/.test(stop) && !(i > 0 && result.stops[i - 1].split(' ')[0] === stop.split(' ')[0]));
    assert.deepStrictEqual(result.stops.slice(0, 3), ['5', '6', '8x']);
    assert.deepStrictEqual(calls, ['2f:twice $x=3', '2f:twice $x=3', '3f:add $x=6 $y=100']);
    assert.deepStrictEqual(result.messages, ['twice 3', 'twice 3']);
    assert.match(result.output, /<out one="6" chain="106" builtin="1-2-3"\/>/);
    if (/saxon-pe-1[3-9]/i.test(saxonJar)) {
        result = await run('arrow40.xsl', [18], 'continue', ['--allowSyntaxExtensions:on']);
        assert.deepStrictEqual(result.stops, ['18x']);
        result = await run('arrow40.xsl', [16], 'stepIn', ['--allowSyntaxExtensions:on']);
        assert.ok(result.stops.includes('2f:twice $x=1') && result.stops.some((stop) => /^2f:twice \$x=2$/.test(stop)), result.stops.join(' | '));
        assert.deepStrictEqual(result.messages, ['twice 3', 'twice 3', 'twice 1', 'twice 2']);
        assert.match(result.output, /map="2 4"/);
    }
}

// for with two bindings (nested, as XPath evaluates them), some and every (stopping once the result is known) and a
// for whose return calls a function - entered, and its xsl:message written, once for each item: each stop has the
// range variables bound at that point
async function testForSomeEvery(saxonJar) {
    const xsl = path.join(fixtures, 'for-some-every.xsl');
    const run = async (breakpoints, command) => {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.start({ saxonArgs: [`-xsl:${xsl}`, '-it'] }, { 'for-some-every.xsl': breakpoints.map((line) => ({ line })) });
        const terminated = dap.event('terminated');
        const stops = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            const frame = stop.frames[0];
            const xpath = frame.name.endsWith('(XPath)');
            const locals = xpath || frame.name === 'f:twice#1' ?
                ' ' + (await dap.variables(0, 'Locals')).filter((v) => /^\$(a|b|x)$/.test(v.name)).map((v) => `${v.name}=${v.value}`).join(' ') : '';
            stops.push(`${frame.line}${xpath ? 'x' : frame.name === 'f:twice#1' ? 'f' : ''}${locals}`.trim());
            stopped = dap.stopped();
            stopped.catch(() => undefined);
            await dap.request(command, { threadId: 1 });
        }
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        assert.deepStrictEqual(dap.output.split('\n').filter((line) => /^twice \d$/.test(line)), ['twice 1', 'twice 2']);
        assert.match(dap.output, /<out pairs="11 21 12 22" calls="2 4" some="true" every="false"\/>/);
        return stops;
    };
    assert.deepStrictEqual(await run([4], 'stepIn'), ['4', '5x', '6x $a=1', '7x $a=1 $b=10', '7x $a=1 $b=20', '6x $a=2', '7x $a=2 $b=10',
        '7x $a=2 $b=20', '8', '9x', '10x $x=1', '2f $x=1', '2f $x=1', '10x $x=2', '2f $x=2', '2f $x=2', '11', '12x', '13x $x=1', '13x $x=2',
        '14', '15x', '16x $x=1', '17', '18']);
    assert.deepStrictEqual(await run([7, 10, 13, 16], 'continue'), ['7x $a=1 $b=10', '7x $a=1 $b=20', '7x $a=2 $b=10', '7x $a=2 $b=20',
        '10x $x=1', '10x $x=2', '13x $x=1', '13x $x=2', '16x $x=1']);
}

// a generic run: stops (line, x for an XPath frame, f for a stylesheet function, and the context item where asked
// for), and the xsl:message output
async function runStops(saxonJar, file, breakpoints, command, extraArgs, contextLines) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, file)}`, '-it'].concat(extraArgs || []) }, { [file]: breakpoints.map((line) => ({ line })) });
    const terminated = dap.event('terminated');
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const frame = stop.frames[0];
        const xpath = frame.name.endsWith('(XPath)');
        let focus = '';
        if (xpath && (contextLines || []).includes(frame.line)) {
            focus = ' .=' + byName(await dap.variables(0, 'Context'))['.'].value;
        }
        stops.push(`${frame.line}${xpath ? 'x' : /^f:/.test(frame.name) ? 'f' : ''}${focus}`);
        stopped = dap.stopped();
        stopped.catch(() => undefined);
        await dap.request(command, { threadId: 1 });
    }
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    return { stops, output: dap.output, messages: dap.output.split('\n').filter((line) => /^[a-z]+ -?\d+$/.test(line)) };
}

// a test stepped through is evaluated as its instruction evaluates it: only as far as needed for true or false - so
// only the functions a normal run calls are called, and their messages written (xsl:if stops at the first node that
// matches; xsl:when too); its result is shown as true or false
async function testTestsEvaluatedAsNeeded(saxonJar) {
    const result = await runStops(saxonJar, 'tests-as-needed.xsl', [4], 'stepIn');
    assert.deepStrictEqual(result.messages, ['check 1', 'check 2', 'check 10']);
    assert.match(result.output, /\u25B8 xsl:if\/@test \(lines 6-7\) returned true/);
    assert.match(result.output, /\u25B8 xsl:when\/@test \(lines 9-10\) returned true/);
    assert.match(result.output, /<out>ifwhen<\/out>/);
}

// a lookup (?name, ?*, ?2, ?(...)) on a line of its own: a breakpoint there stops at it - in a chain, the last one
// first, as Saxon evaluates them; a computed key's function call too. Saxon-PE 13: likewise for a method call (=?>);
// and within an XPath 4.0 focus function, the context item is the argument - not stopped at with the function's own
// focus, before it's set
async function testLookupsAndMethodCalls(saxonJar) {
    let result = await runStops(saxonJar, 'lookups.xsl', [7, 10, 11, 14, 17], 'continue');
    assert.deepStrictEqual(result.stops, ['7x', '11x', '10x', '14x', '17x', '17x']);
    assert.match(result.output, /<out name="Ada" all="xslt xpath" second="xpath" computed="Ada"\/>/);
    if (!/saxon-pe-1[3-9]/i.test(saxonJar)) {
        return;
    }
    result = await runStops(saxonJar, 'method-call40.xsl', [7], 'continue', ['--allowSyntaxExtensions:on']);
    assert.deepStrictEqual(result.stops, ['7x']);
    result = await runStops(saxonJar, 'method-call40.xsl', [5], 'stepIn', ['--allowSyntaxExtensions:on']);
    assert.deepStrictEqual(result.stops.slice(0, 4), ['5', '7x', '6x', '2f']);
    assert.deepStrictEqual(result.messages, ['double 3']);
    result = await runStops(saxonJar, 'focus-function40.xsl', [4], 'stepIn', ['--allowSyntaxExtensions:on'], [6]);
    // the function item is created in the caller's context (absent: an initial template), then its body is evaluated
    // for each item - an item's first stop on line 6, before f:twice is called, has it as the context item
    assert.strictEqual(result.stops.filter((stop) => stop === '6x .=(absent)').length, 1, result.stops.join(' | '));
    assert.ok(result.stops.join(' ').includes('6x .=5 2f') && result.stops.join(' ').includes('6x .=9 2f'), result.stops.join(' | '));
    assert.deepStrictEqual(result.messages, ['twice 1', 'twice 5', 'twice 9']);
    assert.match(result.output, /<out focus="5 9"\/>/);
}

// a partial function application (f:add(?, 10)) is shown as written, with the values bound to its arguments - and
// an inline function as function#arity, not by Saxon's own name for it; calling it - directly, or from a higher-order
// function - enters the function with the bound and supplied arguments, its messages written once
async function testPartialApplication(saxonJar) {
    const xsl = path.join(fixtures, 'partial-application.xsl');
    const dap = new DapClient(saxonJar);
    const stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${xsl}`, '-it'] }, { 'partial-application.xsl': [{ line: 5 }] });
    await stopped;
    assert.strictEqual(byName(await dap.variables(0, 'Locals')).$add10.value, 'f:add(?, 10)');
    const watch = async (expression) => (await dap.request('evaluate', { expression, frameId: 0, context: 'watch' })).result;
    assert.strictEqual(await watch('concat(?, "!")'), 'fn:concat(?, "!")');
    assert.strictEqual(await watch('function($a) { $a }'), 'function#1');
    assert.strictEqual(await watch('f:add#2'), 'f:add#2');
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    const result = await runStops(saxonJar, 'partial-application.xsl', [4], 'stepIn');
    const adds = result.output.split('\n').filter((line) => /^add \d+ \d+$/.test(line));
    assert.deepStrictEqual(adds, ['add 5 10', 'add 1 100', 'add 2 100']);
    assert.ok(result.stops.includes('6x') && result.stops.includes('9x') && result.stops.filter((stop) => stop === '2f').length >= 3, result.stops.join(' | '));
    assert.match(result.output, /<out direct="15" mapped="101 102" builtin="a! b!"\/>/);
}

// XSLT 4.0 fixed-namespaces (Saxon-PE 13.1 or later - 13.0 ignores it in an included module): Watch, conditions,
// logpoints and expressions stepped through use the prefixes of the module they're in - #standard ones, ones bound
// there (prefix=uri) and a document's (./fixed-ns.xml) - and not another module's
async function testFixedNamespaces(saxonJar) {
    if (!/saxon-pe-13\.[1-9]|saxon-pe-1[4-9]/i.test(saxonJar)) {
        return 'skipped';
    }
    const main = path.join(fixtures, 'fixed-ns40.xsl');
    const lib = path.join(fixtures, 'fixed-ns-lib.xsl');
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${main}`, '-it', '--allowSyntaxExtensions:on'] });
    await dap.request('setBreakpoints', { source: { path: main }, breakpoints: [{ line: 6, condition: 'map:size($m) = 2 and f:twice(1) = 2' },
        { line: 10, logMessage: 'v={$v} twice={f:twice(4)} three={g:three()} d={d:name()}' }] });
    await dap.request('setBreakpoints', { source: { path: lib }, breakpoints: [{ line: 5, condition: 'array:size([0]) = 1' }] });
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const watch = async (expression) => dap.request('evaluate', { expression, frameId: 0, context: 'watch' }).then((r) => r.result, (e) => 'error: ' + e.message);
    let stop = await stopped;
    assert.strictEqual(stop.frames[0].line, 6);
    for (const [expression, value] of [['f:twice(2)', '4'], ['map:size($m)', '2'], ['xs:integer("4")', '4'], ['math:pi() gt 3', 'true'], ['g:three()', '3'], ['d:name()', '"d"']]) {
        assert.strictEqual(await watch(expression), value, expression);
    }
    stopped = dap.stopped();
    await dap.request('continue', { threadId: 1 });
    stop = await stopped;
    assert.strictEqual(stop.frames[0].name, 'xsl:sequence/@select (XPath)');
    assert.ok(stop.frames[0].source.path.endsWith('fixed-ns-lib.xsl'));
    assert.strictEqual(await watch('h:three()'), '3');
    assert.strictEqual(await watch('d:name()'), '"d"');
    assert.match(await watch('f:twice(1)'), /Namespace prefix 'f' has not been declared/);
    await dap.request('continue', { threadId: 1 });
    await terminated;
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    assert.match(dap.output, /^v=10 twice=8 three=3 d=d$/m);
    assert.match(dap.output, /<out v="10" d="d"\/>/);
}

// XSLT 4.0 instructions and attributes (Saxon-PE 13): xsl:when's and xsl:otherwise's select, and xsl:if's then and
// else, are stopped at and stepped through only when the branch is taken - so only the functions a normal run calls
// are called - and breakpoints in them are verified, including xsl:otherwise's; separator on xsl:for-each and
// xsl:apply-templates; optional parameters (their default) and keyword arguments, and function breakpoints with an
// arity the function accepts; xsl:array and xsl:array-member; xsl:record's fields, as expressions; and xsl:note, which
// isn't executed
async function testXslt40Instructions(saxonJar) {
    if (!/saxon-pe-1[3-9]/i.test(saxonJar)) {
        return 'skipped';
    }
    const ext = ['--allowSyntaxExtensions:on'];
    const tMessages = (result) => result.output.split('\n').filter((line) => /^t /.test(line));
    const verified = async (file, lines) => {
        const xsl = path.join(fixtures, file);
        const dap = new DapClient(saxonJar);
        await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
        await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, '-it'].concat(ext) });
        const result = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: lines.map((line) => ({ line })) });
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return result.breakpoints.map((b) => `${b.line}${b.verified ? '' : ' unverified'}`);
    };

    // branches
    assert.deepStrictEqual(await verified('x40-branches.xsl', [9, 11, 13, 16, 17]), ['9', '11', '13', '16', '17']);
    let result = await runStops(saxonJar, 'x40-branches.xsl', [9, 11, 13, 16, 17, 20, 27], 'continue', ext);
    assert.deepStrictEqual(result.stops, ['11x', '17x', '13x', '16x', '20', '20', '20', '27', '27']);
    assert.deepStrictEqual(tMessages(result), ['t two', 't small', 't other', 't big']);
    assert.match(result.output, /<out>two small other big1, 2, 3a\|b<end\/><\/out>/);
    result = await runStops(saxonJar, 'x40-branches.xsl', [4], 'stepIn', ext);
    assert.deepStrictEqual(tMessages(result), ['t two', 't small', 't other', 't big']);
    assert.ok(!result.stops.includes('9x'), result.stops.join(' | '));

    // optional parameters and keyword arguments
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${path.join(fixtures, 'x40-params.xsl')}`, '-it'].concat(ext) });
    await dap.request('setFunctionBreakpoints', { breakpoints: [{ name: 'f:g#1' }, { name: 'f:g#3' }] });
    const changed = dap.event('breakpoint');
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const locals = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        locals.push((await dap.variables(0, 'Locals')).map((v) => `${v.name}=${v.value}`).join(' '));
        stopped = dap.stopped();
        stopped.catch(() => undefined);
        await dap.request('continue', { threadId: 1 });
    }
    const unverified = await changed;
    assert.ok(!unverified.breakpoint.verified && /no version of f:g with 3 arguments/.test(unverified.breakpoint.message), JSON.stringify(unverified));
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    assert.deepStrictEqual(locals, ['$x=1 $y=10', '$x=1 $y=2', '$x=1 $y=5']);
    assert.match(dap.output, /<out a="11" b="3" c="6"\/>/);

    // xsl:array, xsl:array-member and xsl:record
    result = await runStops(saxonJar, 'x40-array-record.xsl', [5], 'continue', ext);
    assert.deepStrictEqual(result.stops, ['6']);
    result = await runStops(saxonJar, 'x40-array-record.xsl', [7, 13, 14, 15], 'continue', ext);
    assert.deepStrictEqual(result.stops, ['7x', '13', '14x', '15x']);
    result = await runStops(saxonJar, 'x40-array-record.xsl', [4], 'stepIn', ext);
    assert.deepStrictEqual(tMessages(result), ['t 1', 't 2', 't 3', 't Ada', 't xslt']);
    assert.match(result.output, /\u25B8 xsl:record\/@name \(lines 13-14\) returned "Ada"/);
    assert.match(result.output, /<out size="3" name="Ada" langs="xslt xpath"\/>/);

    // xsl:note
    assert.deepStrictEqual(await verified('x40-note.xsl', [2, 5, 6, 7, 9, 12]), ['2 unverified', '5 unverified', '6 unverified', '7 unverified', '9 unverified', '12']);
    result = await runStops(saxonJar, 'x40-note.xsl', [4], 'stepIn', ext);
    assert.deepStrictEqual(result.stops, ['4', '11', '12']);
}

// an xsl:for-each on one line: a breakpoint there stops at the instruction, then for each item, as stepping over does
async function testOneLineLoop(saxonJar) {
    for (const command of ['continue', 'next']) {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'one-line-loop.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
            { 'one-line-loop.xsl': [{ line: 4 }] });
        const terminated = dap.event('terminated');
        const stops = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            const n = (await dap.request('evaluate', { expression: 'string(@n)', frameId: 0, context: 'watch' })).result;
            stops.push(`${stop.frames[0].line}:${stop.frames[0].column} ${n}`);
            stopped = dap.stopped();
            await dap.request(command, { threadId: 1 });
        }
        // the instruction, at its start tag's '<', then its body - at the body's first instruction - for each item;
        // stepping over, then on to the next line
        const expected = ['4:7 ""', '4:41 "1"', '4:41 "2"', '4:41 "3"'].concat(command === 'next' ? ['5:7 ""'] : []);
        assert.deepStrictEqual(stops, expected, command);
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
    }
}

// function breakpoints: stylesheet functions (with an optional arity) and named templates, by name - in any module;
// names not in the stylesheet are reported once it has compiled; conditions and hit counts as for line breakpoints
async function testFunctionBreakpoints(saxonJar) {
    const run = async (breakpoints) => {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        const initialized = await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
        assert.strictEqual(initialized.supportsFunctionBreakpoints, true);
        await dap.request('launch', { saxonArgs: [`-xsl:${path.join(fixtures, 'function-breakpoints.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
        const set = await dap.request('setFunctionBreakpoints', { breakpoints });
        await dap.request('configurationDone', {});
        const terminated = dap.event('terminated');
        const stops = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            assert.strictEqual(stop.reason, 'function breakpoint');
            const locals = (await dap.variables(0, 'Locals')).map((v) => `${v.name}=${v.value}`).join(' ');
            stops.push(`${stop.frames[0].name} ${path.basename(stop.frames[0].source.path)}:${stop.frames[0].line} ${locals}`);
            stopped = dap.stopped();
            await dap.request('continue', { threadId: 1 });
        }
        const changed = dap.events.filter((e) => e.event === 'breakpoint').map((e) => e.body.breakpoint);
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return { set: set.breakpoints, changed, stops };
    };

    let { set, changed, stops } = await run([{ name: 'cell' }, { name: 'f:total#2' }, { name: 'f:nope' }, { name: 'f:total#3' }, { name: '1bad' }]);
    assert.deepStrictEqual(set.map((b) => b.verified), [true, true, true, true, false]);
    assert.match(set[4].message, /isn't the name of a function/);
    // checked against the compiled stylesheet
    assert.deepStrictEqual(changed.map((b) => [b.id, b.verified, b.message]), [
        [set[2].id, false, 'The stylesheet has no function or named template named f:nope'],
        [set[3].id, false, 'The stylesheet has no version of f:total with 3 arguments']]);
    // a named template's parameters: the values passed to it, before its xsl:param runs; f:total#2 in an imported
    // module, called directly and by f:total#1 - not f:total#1 itself
    assert.deepStrictEqual(stops, [
        'xsl:template name="cell" function-breakpoints.xsl:14 $n=1',
        'xsl:template name="cell" function-breakpoints.xsl:14 $n=2',
        'xsl:template name="cell" function-breakpoints.xsl:14 $n=3',
        'f:total#2 function-breakpoints-lib.xsl:11 $values=(n="1", n="2", n="3") $extra=0',
        'f:total#2 function-breakpoints-lib.xsl:11 $values=(n="1", n="2", n="3") $extra=10']);

    // a condition, a hit count, '()' after the name, and an EQName
    ({ stops } = await run([{ name: 'cell', condition: '$n = 2' }, { name: 'f:square()', hitCondition: '3' }, { name: 'Q{urn:f}total#1' }]));
    assert.deepStrictEqual(stops, [
        'xsl:template name="cell" function-breakpoints.xsl:14 $n=2',
        'f:square#1 function-breakpoints-lib.xsl:3 $x=3',
        'f:total#1 function-breakpoints-lib.xsl:7 $values=(n="1", n="2", n="3")']);
}

// within a multi-line XPath expression being stepped through: Locals has the instruction's local variables and the
// expression's range variables - not a global variable it references, which is in Globals; position() and last()
// are the instruction's
async function testXPathFrameScopes(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'xpath-frame.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
        { 'xpath-frame.xsl': [{ line: 12 }] });
    const terminated = dap.event('terminated');
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const scope = async (name) => (await dap.variables(0, name)).filter((v) => v.name !== '.').map((v) => `${v.name}=${v.value}`).join(' ');
        stops.push(`${await scope('Locals')} | ${await scope('Context')} | ${await scope('Globals')}`);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.deepStrictEqual(stops.slice(0, 3), [
        '$n=1 $i=1 | position()=1 last()=3 | $factor=10',
        '$n=2 $i=1 | position()=2 last()=3 | $factor=10',
        '$n=2 $i=2 | position()=2 last()=3 | $factor=10']);
    assert.strictEqual(stops.length, 6);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// xsl:message output as it is, as for an 'xslt' task: ANSI color codes, e.g. from xdm:debug-color(), are kept for the
// Debug Console - not written as character references - and a message with elements is still written as XML; with
// "messageEscaping": "on", Saxon's own output
async function testMessageOutput(saxonJar) {
    const messages = async (launchArgs) => {
        const dap = new DapClient(saxonJar);
        await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'messages.xsl')}`, '-it'], ...launchArgs }, {});
        const terminated = dap.event('terminated');
        await terminated;
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return dap.events.filter((e) => e.event === 'output' && e.body.category === 'stderr').map((e) => e.body.output).join('');
    };
    let text = await messages({});
    assert.ok(text.includes('\u001b[0;32mgreen\u001b[0m <text> &'), JSON.stringify(text));
    assert.match(text, /<item n="1">with markup<\/item>/);
    text = await messages({ messageEscaping: 'on' });
    assert.match(text, /&#x1b;\[0;32mgreen/i);
}

// XSLT 4.0 structures: xsl:switch (a branch is stopped in, and stepped into, as for xsl:choose - an xsl:when is
// stopped at where its value is compared, xsl:otherwise isn't stopped at); xsl:select, whose content is a multi-line XPath expression (stopped at, and
// stepped through, as an attribute's is); and JNodes, from jtree(), as local and global variables
async function testXslt40Structures(saxonJar) {
    if (!/saxon-[pe]e-1[3-9]/i.test(saxonJar)) {
        return 'skipped';
    }
    const xsl = path.join(fixtures, 'xslt40-structures.xsl');
    const run = async (lines, command, onStop) => {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
        await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, '-it', '--allowSyntaxExtensions:on'] });
        const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: lines.map((line) => ({ line })) });
        const terminated = dap.event('terminated');
        await dap.request('configurationDone', {});
        const stops = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            stops.push(`${stop.frames[0].line} ${stop.frames[0].name}`);
            if (onStop) {
                await onStop(dap, stops.length);
            }
            // enough of them - no stop is then waited for
            if (stops.length === 12) {
                break;
            }
            stopped = dap.stopped();
            await dap.request(command, { threadId: 1 });
        }
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return { breakpoints, stops, output: dap.output };
    };
    const loop = 'xsl:for-each select="$tree/orders/*"';

    // breakpoints: xsl:switch and the instructions in its branches; xsl:select and the lines of its expression
    // that start a part of it - not xsl:otherwise, or a line with only a literal
    let { breakpoints, stops, output } = await run([10, 11, 12, 14, 15, 19, 20, 21], 'continue', async (dap, n) => {
        if (n === 1) {
            const locals = byName(await dap.variables(0, 'Locals'));
            // its path, as xdm:debug() shows it, and its value
            assert.strictEqual(locals.$order.value, '/orders/*[1] map{2 entries}');
            assert.strictEqual(locals.$order.type, 'jnode()');
            const order = byName((await dap.request('variables', { variablesReference: locals.$order.variablesReference })).variables);
            assert.strictEqual(order['"id"'].value, '"A-100"');
            assert.strictEqual(order['"total"'].value, '33.3');
            const globals = byName(await dap.variables(0, 'Globals'));
            assert.strictEqual(globals.$tree.value, '/ map{1 entry}');
            const tree = byName((await dap.request('variables', { variablesReference: globals.$tree.variablesReference })).variables);
            assert.strictEqual(tree['"orders"'].value, 'array{2 members}');
        }
    });
    assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]), [[10, true], [11, true], [12, true], [14, false], [15, true], [19, true], [20, true], [21, false]]);
    assert.match(breakpoints[3].message, /xsl:otherwise isn't an instruction Saxon can stop at/);
    // A-100 takes the xsl:when branch, B-200 the xsl:otherwise
    assert.deepStrictEqual(stops, [`10 ${loop}`, `11 ${loop}`, `12 ${loop}`, `19 ${loop}`, '20 xsl:select (XPath)',
        `10 ${loop}`, `11 ${loop}`, `15 ${loop}`, `19 ${loop}`, '20 xsl:select (XPath)']);
    // the xsl:select's result, for the variable it's the value of
    assert.match(output, /\u25B8 \$band \(xsl:select, lines 20-22\) returned "high"/);

    // stepping into: xsl:switch's branch, and xsl:select's expression
    ({ stops } = await run([10], 'stepIn'));
    assert.deepStrictEqual(stops.slice(0, 5), [`10 ${loop}`, `11 ${loop}`, `12 ${loop}`, `18 ${loop}`, `19 ${loop}`]);
    assert.strictEqual(stops[5], '20 xsl:select (XPath)');
}

// accumulators: a rule is stopped at, with $value, when Saxon computes the accumulator's values - for the whole
// document, the first time one is needed - and a multi-line select is stepped through; xsl:accumulator itself isn't
// stopped at. accumulator-before() and accumulator-after() can be used in Watch and conditions: within the transform
async function testAccumulators(saxonJar) {
    const xsl = path.join(fixtures, 'accumulators.xsl');
    const run = async (breakpoints, watch) => {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
        await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
        const set = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints });
        const terminated = dap.event('terminated');
        await dap.request('configurationDone', {});
        const stops = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            const locals = (await dap.variables(0, 'Locals')).map((v) => `${v.name}=${v.value}`).join(' ');
            const watched = watch ? ' | ' + (await dap.request('evaluate', { expression: watch, frameId: 0, context: 'watch' })).result : '';
            stops.push([stop.frames[0].line, stop.frames[0].name, locals].filter((part) => part !== '').join(' ') + watched);
            stopped = dap.stopped();
            await dap.request('continue', { threadId: 1 });
        }
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return { breakpoints: set.breakpoints, stops, output: dap.output };
    };

    let { breakpoints, stops, output } = await run([4, 5, 7, 11].map((line) => ({ line })));
    if (/saxon-[hpe]e-12\.[0-7]\b/i.test(saxonJar)) {
        // Saxon 12.7 and earlier don't report accumulator rules: their breakpoints are unverified, and say why
        assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]), [[4, false], [5, false], [7, false], [11, false]]);
        assert.match(breakpoints[1].message, /Saxon 12\.8 or later reports accumulator rules/);
        assert.deepStrictEqual(stops, []);
    } else {
        assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]), [[4, false], [5, true], [7, true], [11, true]]);
        assert.match(breakpoints[0].message, /xsl:accumulator isn't an instruction Saxon can stop at/);
        // the values for all the items, at the first accumulator-before() - then at the first accumulator-after()
        assert.deepStrictEqual(stops, [
            '5 xsl:accumulator-rule $value=0', '7 xsl:accumulator-rule/@select (XPath) $value=0',
            '5 xsl:accumulator-rule $value=1', '7 xsl:accumulator-rule/@select (XPath) $value=1',
            '5 xsl:accumulator-rule $value=3', '7 xsl:accumulator-rule/@select (XPath) $value=3',
            '11 xsl:accumulator-rule $value=0', '11 xsl:accumulator-rule $value=1', '11 xsl:accumulator-rule $value=2']);
    }
    assert.match(output, /<item n="1" total="1" count="1"\/><item n="2" total="3" count="2"\/><item n="3" total="6" count="3"\/>/);

    // in a condition, and in Watch
    ({ stops } = await run([{ line: 18, condition: "accumulator-before('running-total') ge 3" }], "accumulator-before('running-total'), accumulator-after('count')"));
    assert.deepStrictEqual(stops, ['18 xsl:template match="item" | (3, 2)', '18 xsl:template match="item" | (6, 3)']);
}

// multi-line XPath in xsl:iterate's select, xsl:on-completion's select, xsl:with-param's select (evaluated by the
// instruction it's in, here xsl:next-iteration) and xsl:evaluate's xpath: each stopped at and stepped through; an
// xsl:iterate's parameters are in scope only within it
async function testIterateAndEvaluate(saxonJar) {
    const xsl = path.join(fixtures, 'iterate-evaluate.xsl');
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: [7, 9, 10, 11, 14, 15, 16, 19, 21, 22].map((line) => ({ line })) });
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const locals = (await dap.variables(0, 'Locals')).map((v) => `${v.name}=${v.value}`).join(' ');
        stops.push([stop.frames[0].line, stop.frames[0].name, locals].filter((part) => part !== '').join(' '));
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    // not xsl:with-param itself, nor a line with only a literal
    assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]),
        [[7, true], [9, true], [10, false], [11, true], [14, false], [15, true], [16, true], [19, true], [21, true], [22, false]]);
    const withParam = (total) => [`15 xsl:with-param/@select (XPath) $total=${total}`, `16 xsl:with-param/@select (XPath) $total=${total}`];
    assert.deepStrictEqual(stops, [
        '7 xsl:iterate/@select (XPath)', '7 xsl:iterate/@select (XPath)', '7 xsl:iterate/@select (XPath)',
        ...withParam(0), ...withParam(1), ...withParam(3),
        // the frame's name - with Saxon 12, which reports xsl:iterate at its start tag, with its select on one line
        /^9 xsl:iterate/.test(stops[9]) ? stops[9] : '9 xsl:iterate', '11 xsl:on-completion/@select (XPath) $total=6',
        // after the xsl:iterate: not its parameter
        '19 xsl:template match="/"',
        '21 xsl:evaluate/@xpath (XPath) $use-sum=true']);
    assert.match(stops[9], /^9 xsl:iterate( select="items\/item \[@n ne '0'\]")? \$total=6$/);
    assert.match(dap.output, /\u25B8 \$total \(xsl:with-param\/@select, lines 14-16\) returned 6/);
    assert.match(dap.output, /\u25B8 xsl:on-completion\/@select \(lines 9-11\) returned "total: 6"/);
    assert.match(dap.output, /total: 6 60<\/out>/);
}

// xsl:sort, in xsl:for-each, xsl:perform-sort and xsl:apply-templates: its select is stopped at for each item, as
// its sort key is computed - with the item as the context item - and a multi-line select is stepped through; an
// xsl:variable whose content is an xsl:perform-sort is stopped at (Saxon 13 reports it at the xsl:perform-sort)
async function testSort(saxonJar) {
    const xsl = path.join(fixtures, 'sort.xsl');
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: [6, 7, 11, 12, 14, 19].map((line) => ({ line })) });
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const n = (await dap.request('evaluate', { expression: 'string(@n)', frameId: 0, context: 'watch' })).result;
        stops.push(`${stop.frames[0].line} ${stop.frames[0].name.replace(/ (select|match)=.*/, '')} ${n}`);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    // not xsl:perform-sort itself
    assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]), [[6, true], [7, true], [11, true], [12, false], [14, true], [19, true]]);
    const keys = (line, frame, keyLine) => ['1', '2', '3'].flatMap((n) => [`${line} ${frame} "${n}"`].concat(keyLine ? [`${keyLine} xsl:sort/@select (XPath) "${n}"`] : []));
    assert.deepStrictEqual(stops, [
        // the items in their original order, as their keys are computed
        ...keys(6, 'xsl:for-each', 7),
        '11 xsl:template ""',
        ...keys(12, 'xsl:template', 14).filter((s) => !s.startsWith('12 ')),
        ...keys(19, 'xsl:template')]);
    assert.match(dap.output, /<for-each n="3"\/><for-each n="2"\/><for-each n="1"\/><perform-sort>1 2 3<\/perform-sort><applied n="3"\/><applied n="2"\/><applied n="1"\/>/);
}

// xsl:when's test: stopped at where it's evaluated - only those reached, in order - and a multi-line test stepped
// through, then on to the branch taken; xsl:map-entry's key and select: stopped at for each entry, in its context;
// an xsl:variable whose content starts with an xsl:for-each is stopped at its own line (Saxon 13 reports it at the
// xsl:for-each's select), as is an xsl:map in Saxon 12 (a call of map:merge())
async function testWhenAndMapEntry(saxonJar) {
    const xsl = path.join(fixtures, 'when-map-entry.xsl');
    const run = async (lines, command, max = 40) => {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
        await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
        const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: lines.map((line) => ({ line })) });
        const terminated = dap.event('terminated');
        await dap.request('configurationDone', {});
        const stops = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            const n = (await dap.request('evaluate', { expression: 'string(@n)', frameId: 0, context: 'watch' })).result;
            stops.push(`${stop.frames[0].line} ${stop.frames[0].name.replace(/ (select|match)=.*/, '')} ${n}`);
            if (stops.length === max) {
                break;
            }
            stopped = dap.stopped();
            await dap.request(command, { threadId: 1 });
        }
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return { breakpoints, stops, output: dap.output };
    };

    let { breakpoints, stops, output } = await run([7, 8, 9, 12, 22, 25, 26, 27, 28], 'continue');
    // the xsl:when's test lines that start a part of it - not one with only a literal
    assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]),
        [[7, true], [8, true], [7, true], [12, true], [22, true], [25, true], [26, false], [27, true], [28, true]]);
    const when = (n, test, xpath) => [`${test} xsl:for-each "${n}"`].concat(xpath ? [`${xpath} xsl:when/@test (XPath) "${n}"`] : []);
    const entry = (n) => [`25 xsl:template "${n}"`, `27 xsl:map-entry/@key (XPath) "${n}"`, `28 xsl:map-entry/@select (XPath) "${n}"`];
    assert.deepStrictEqual(stops, [
        // item 1: its first test is true, so the second isn't evaluated
        ...when(1, 7, 8),
        ...when(2, 7, 8), ...when(2, 12),
        ...when(3, 7, 8), ...when(3, 12),
        '22 xsl:template ""',
        ...entry(1), ...entry(2), ...entry(3)]);
    assert.match(output, /<one\/><two\/><other\/><totals>10 20 30<\/totals><show v="6"\/>/);
    assert.match(output, /\u25B8 xsl:map-entry\/@select \(lines 27-29\) returned 10/);

    // stepping into a test: then to the branch taken, not back to the test
    ({ stops } = await run([7], 'stepIn', 8));
    assert.deepStrictEqual(stops.slice(0, 3), ['7 xsl:for-each "1"', '8 xsl:when/@test (XPath) "1"', '10 xsl:for-each "1"']);
}

// multi-line XPath in xsl:number's value, xsl:try's select (whose error is its result, not a failure to evaluate it),
// xsl:catch's select (with the $err: variables, also for Watch), xsl:assert's test (only with assertions enabled -
// otherwise its breakpoints are unverified) and xsl:break's select
async function testInstructions(saxonJar) {
    const xsl = path.join(fixtures, 'instructions.xsl');
    const run = async (lines, enableAssertions) => {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
        await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`].concat(enableAssertions ? ['-ea:on'] : []) });
        const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: lines.map((line) => ({ line })) });
        const terminated = dap.event('terminated');
        await dap.request('configurationDone', {});
        const stops = [];
        let watched;
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            stops.push(`${stop.frames[0].line} ${stop.frames[0].name.replace(/ (select|match)=.*/, '')}`);
            if (stop.frames[0].name === 'xsl:catch/@select (XPath)') {
                watched = (await dap.request('evaluate', { expression: '$err:code, $err:description', frameId: 0, context: 'watch' })).result;
            }
            stopped = dap.stopped();
            await dap.request('continue', { threadId: 1 });
        }
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return { breakpoints, stops, watched, output: dap.output };
    };

    let { breakpoints, stops, watched, output } = await run([8, 14, 16, 18, 21, 28], false);
    assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]), [[8, true], [14, true], [16, true], [18, true], [21, false], [28, true]]);
    assert.match(breakpoints[4].message, /assertions aren't enabled - set "enableAssertions": "on"/);
    assert.deepStrictEqual(stops, [
        '8 xsl:number/@value (XPath)', '8 xsl:number/@value (XPath)', '8 xsl:number/@value (XPath)',
        '14 xsl:try/@select (XPath)', '16 xsl:template', '18 xsl:catch/@select (XPath)', '28 xsl:break/@select (XPath)']);
    assert.strictEqual(watched, '(err:FOAR0001, "Integer division by zero")');
    // the error xsl:try catches: the result of its select, stepped through
    assert.match(output, /\u25B8 xsl:try\/@select \(lines 13-15\) raised FOAR0001: Integer division by zero/);
    assert.doesNotMatch(output, /couldn't be evaluated separately/);
    assert.match(output, /\u25B8 xsl:catch\/@select \(lines 16-18\) returned "caught: err:FOAR0001"/);
    assert.match(output, /<num>2<\/num><pos>1<\/pos>.*caught: err:FOAR0001<i n="1"\/>broke at 2<\/out>/);

    // with assertions enabled
    ({ breakpoints, stops } = await run([20, 21], true));
    assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]), [[20, true], [21, true]]);
    assert.deepStrictEqual(stops, ['20 xsl:template', '21 xsl:assert/@test (XPath)']);
}

// xsl:key: its use is stopped at for each node indexed - when the index is built, on the first call of key() - with
// the node as the context item, and a multi-line use is stepped through; key() can be used in Watch and conditions
async function testKeys(saxonJar) {
    const xsl = path.join(fixtures, 'keys.xsl');
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: [
        { line: 3 }, { line: 4 }, { line: 5 }, { line: 10, condition: "count(key('by-parity', 'odd')) eq 2" }] });
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const stops = [];
    let watched;
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const n = (await dap.request('evaluate', { expression: 'string(@n)', frameId: 0, context: 'watch' })).result;
        stops.push(`${stop.frames[0].line} ${stop.frames[0].name.replace(/ match=.*/, '')} ${n}`);
        if (stop.frames[0].line === 10) {
            watched = (await dap.request('evaluate', { expression: "key('by-parity', 'odd')/@n/string()", frameId: 0, context: 'watch' })).result;
        }
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    // not a line with only a literal
    assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]), [[3, true], [4, true], [5, false], [10, true]]);
    assert.deepStrictEqual(stops, ['1', '2', '3'].flatMap((n) => [`3 xsl:template "${n}"`, `4 xsl:key/@use (XPath) "${n}"`]).concat(['10 xsl:template ""']));
    assert.strictEqual(watched, '("1", "3")');
    assert.match(dap.output, /<odd>1 3<\/odd><even>2<\/even>/);
}

// xsl:analyze-string: a frame of its own, as for xsl:for-each; a multi-line select stepped through; its
// xsl:matching-substring and xsl:non-matching-substring content stopped at for each substring, with the substring as
// the context item - and in xsl:matching-substring, each of the regex's groups (from regex-group(0), the match)
async function testAnalyzeString(saxonJar) {
    const xsl = path.join(fixtures, 'analyze-string.xsl');
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: [6, 8, 9, 11, 12, 18].map((line) => ({ line })) });
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const context = (await dap.variables(0, 'Context')).filter((v) => v.name !== '.' || !v.value.startsWith('document')).map((v) => `${v.name}=${v.value}`).join(' ');
        stops.push(`${stop.frames[0].line} ${stop.frames[0].name.replace(/ select=.*/, '')} ${context}`);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
    // not xsl:matching-substring or xsl:non-matching-substring themselves
    assert.deepStrictEqual(breakpoints.map((b) => [b.line, b.verified]), [[6, true], [8, false], [9, true], [11, false], [12, true], [18, true]]);
    const match = (n, position) => `9 xsl:analyze-string .="${n}" position()=${position} last()=6 regex-group(0)="${n}" regex-group(1)="${n}"`;
    const other = (text, position) => `12 xsl:analyze-string .="${text}" position()=${position} last()=6`;
    assert.deepStrictEqual(stops, [
        '6 xsl:analyze-string/@select (XPath) position()=1 last()=1',
        match(1, 1), other('-', 2), match(2, 3), other('-', 4), match(3, 5), other('-x', 6),
        // a regex with no groups, from an attribute value template
        '18 xsl:analyze-string .="two" position()=1 last()=1 regex-group(0)="two"']);
    assert.match(dap.output, /\u25B8 xsl:analyze-string\/@select \(lines 5-7\) returned "1-2-3-x"/);
    assert.match(dap.output, /<d>1<\/d><s>-<\/s><d>2<\/d><s>-<\/s><d>3<\/d><s>-x<\/s><w>two<\/w>/);
}

// a logpoint's {$*}: the local variables in scope, one per line, names aligned - as the Locals scope shows them,
// including an XPath expression's range variables; after other text, on the lines below it
async function testLogpointLocals(saxonJar) {
    const log = async (file, line, logMessage) => {
        const dap = new DapClient(saxonJar);
        await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, file)}`, `-s:${path.join(fixtures, 'basic.xml')}`] }, { [file]: [{ line, logMessage }] });
        const terminated = dap.event('terminated');
        await terminated;
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
        return dap.events.filter((e) => e.event === 'output' && e.body.category === 'console' && e.body.line === line).map((e) => e.body.output);
    };
    // the nearer $x hides the outer one
    let logged = await log('scopes.xsl', 13, 'item {@n}: {$*}');
    assert.deepStrictEqual(logged, ['1', '2', '3'].map((n) => `item ${n}:\n  $p     = "param"\n  $later = "later-${n}"\n  $x     = "inner-${n}"\n`));
    // within a multi-line XPath expression being stepped through
    logged = await log('xpath-frame.xsl', 12, '{$*}');
    assert.deepStrictEqual(logged.slice(0, 3), ['$n = 1\n$i = 1\n', '$n = 2\n$i = 1\n', '$n = 2\n$i = 2\n']);
    // none in scope
    logged = await log('scopes.xsl', 4, '{$*}');
    assert.deepStrictEqual(logged, ['$p = "param"\n']);
    logged = await log('basic.xsl', 5, 'start {$*}');
    assert.strictEqual(logged[0], 'start\n  (no local variables)\n');
    // {*} is XPath, as any other {xpath}: the context item's child elements - here, the document's, <items>
    logged = await log('basic.xsl', 5, 'children: {*}');
    assert.match(logged[0], /^children:\s*two\s*$/);
}

async function testXPathForms(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    const xsl = path.join(fixtures, 'xpath-forms.xsl');
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const lineCount = require('fs').readFileSync(xsl, 'utf8').split('\n').length;
    const requested = Array.from({ length: lineCount }, (_, i) => ({ line: i + 1 }));
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: requested });
    const verified = new Set(breakpoints.filter((b) => b.verified).map((b) => b.line));
    // lines with only keywords like 'return' and 'then', literals, or an operator's second operand aren't stopped at
    // (a start tag's last line, e.g. 19, is the instruction's)
    for (const line of [7, 9, 16, 17, 18, 40, 43, 44, 50, 52]) {
        assert.ok(!verified.has(line), `line ${line} isn't breakable: ${[...verified]}`);
    }
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const expressionLines = { 'flwor': [6, 13], 'choice': [15, 20], 'path': [22, 25], 'm': [27, 31], 'q': [33, 36], 's': [38, 46], 'g': [49, 54] };
    const stops = [];
    let groupCounts = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const frame = stop.frames[0];
        stops.push(frame.line);
        if (frame.name.endsWith('(XPath)')) {
            const range = Object.values(expressionLines).find(([first, last]) => frame.line >= first && frame.line <= last);
            assert.ok(range, `XPath stop outside any expression: line ${frame.line}`);
            if (frame.line >= 49 && frame.line <= 54) {
                groupCounts.push((await dap.request('evaluate', { expression: 'count(current-group())', frameId: 0, context: 'watch' })).result);
            }
        }
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.doesNotMatch(dap.output, /couldn't be evaluated/, dap.output);
    assert.match(dap.output, /<out><flwor>20 30<\/flwor><choice>many<\/choice><path>1 3<\/path><map>a,b<\/map><q>true<\/q><s>A&lt;x-y<\/s><g>1:2:item<\/g><g>0:1:item<\/g><\/out>/);
    // every breakable line within an expression is stopped at
    const interior = Object.values(expressionLines).flatMap(([first, last]) => Array.from({ length: last - first - 1 }, (_, i) => first + 1 + i));
    for (const line of interior.filter((l) => verified.has(l))) {
        assert.ok(stops.includes(line), `stopped at breakable line ${line}: ${stops}`);
    }
    for (const line of [6, 8, 10, 11, 15, 22, 23, 24, 27, 28, 29, 33, 35, 38, 39, 41, 42, 49, 51, 53]) {
        assert.ok(verified.has(line), `line ${line} is breakable`);
    }
    assert.ok(groupCounts.length > 0 && groupCounts.every((c) => c === '2' || c === '1'), String(groupCounts));
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// XPath 4.0 syntax (Saxon-PE/EE 13 with syntax extensions) is stepped through too
async function testXPath40(saxonJar) {
    if (!/saxon-[pe]e-1[3-9]/i.test(saxonJar)) {
        return 'skipped';
    }
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    const xsl = path.join(fixtures, 'xpath40.xsl');
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, '-it', '--allowSyntaxExtensions:on'] });
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: [{ line: 5 }, { line: 7 }] });
    assert.deepStrictEqual(breakpoints.map((b) => [b.verified, b.line]), [[true, 5], [true, 7]]);
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const lines = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        lines.push(stop.frames[0].line);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.doesNotMatch(dap.output, /couldn't be evaluated/, dap.output);
    assert.match(dap.output, /<out>600<\/out>/);
    assert.deepStrictEqual(lines, [5, 7]);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// with Saxon-PE/EE 13's syntax extensions on (as Quick Run tasks have, by default, for PE/EE), an XSLT 3.0
// stylesheet's expression is still XPath 3.1 - as XPath 4.0, a call to a stylesheet function wasn't found
async function testStepThroughXPathWithExtensions(saxonJar) {
    if (!/saxon-[pe]e-1[3-9]/i.test(saxonJar)) {
        return 'skipped';
    }
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'multiline.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`, '--allowSyntaxExtensions:on'] },
        { 'multiline.xsl': [{ line: 11 }] });
    const terminated = dap.event('terminated');
    let stops = 0;
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        assert.strictEqual(stop.frames[0].name, 'xsl:variable/@select (XPath)');
        stops++;
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.doesNotMatch(dap.output, /couldn't be evaluated/, dap.output);
    assert.strictEqual(stops, 3);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// hit counts (n, ==n, >n, >=n, <n, <=n, %n) - counted when the condition, if any, is true - with conditions and
// logpoints; an invalid hit count is rejected
async function testHitCounts(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${path.join(fixtures, 'basic.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const { breakpoints } = await dap.request('setBreakpoints', {
        source: { path: path.join(fixtures, 'basic.xsl') }, breakpoints: [
            { line: 10, hitCondition: '2' },
            { line: 11, condition: '@n != 2', hitCondition: '>=2' },
            { line: 12, logMessage: 'hit at {@n}', hitCondition: '%2' },
            { line: 16, hitCondition: 'often' },
        ]
    });
    assert.deepStrictEqual(breakpoints.map((b) => b.verified), [true, true, true, false]);
    assert.match(breakpoints[3].message, /isn't a number/);
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const n = (await dap.request('evaluate', { expression: 'string(@n)', frameId: 0, context: 'watch' })).result;
        stops.push(`${stop.frames[0].line}:${n}`);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    // line 10's 2nd hit; line 11's 2nd hit where @n != 2 - item 3
    assert.deepStrictEqual(stops, ['10:"2"', '11:"3"']);
    // the logpoint logs on every 2nd hit
    assert.deepStrictEqual(dap.output.match(/hit at \d/g), ['hit at 2']);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// a condition that can't be evaluated stops, as for an error, and is reported once; a condition within a multi-line
// XPath expression is evaluated in the expression's context
async function testConditionErrorsAndXPathConditions(saxonJar) {
    let dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'basic.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
        { 'basic.xsl': [{ line: 12, condition: '$undeclared = 1' }] });
    let terminated = dap.event('terminated');
    let stops = 0;
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        stops++;
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.strictEqual(stops, 3);
    assert.strictEqual(dap.output.match(/The condition '\$undeclared = 1' of the breakpoint at line 12 failed/g).length, 1);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;

    dap = new DapClient(saxonJar);
    stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'multiline.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
        { 'multiline.xsl': [{ line: 11, condition: '@n = 2' }] });
    terminated = dap.event('terminated');
    const lines = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        lines.push(`${stop.frames[0].line} ${stop.frames[0].name}`);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.deepStrictEqual(lines, ['11 xsl:variable/@select (XPath)']);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// within an XPath loop, a line is arrived at once each iteration - not again for a function argument evaluated
// lazily, within the function - so a logpoint logs, and a breakpoint stops, once each iteration
async function testXPathLoopArrivals(saxonJar) {
    for (const breakpoint of [{ line: 7, logMessage: 'item {$item/@n}' }, { line: 7 }]) {
        const dap = new DapClient(saxonJar);
        let stopped = dap.stopped();
        await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'loop-call.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
            { 'loop-call.xsl': [breakpoint] });
        const terminated = dap.event('terminated');
        const items = [];
        while (true) {
            const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
            if (!stop) {
                break;
            }
            items.push((await dap.request('evaluate', { expression: 'string($item/@n)', frameId: 0, context: 'watch' })).result);
            stopped = dap.stopped();
            await dap.request('continue', { threadId: 1 });
        }
        if (breakpoint.logMessage) {
            assert.deepStrictEqual(dap.output.match(/item \d/g), ['item 1', 'item 2', 'item 3']);
        } else {
            assert.deepStrictEqual(items, ['"1"', '"2"', '"3"']);
        }
        assert.match(dap.output, /<out>2 4 6<\/out>/);
        await dap.request('disconnect', {}).catch(() => undefined);
        await dap.exited;
    }
}

// a dynamic error that ends the transform pauses where it's raised, with its code and message and the variables
// there; an error caught by xsl:try doesn't, by default - and leaves the stack as it was; Saxon's error report is
// linked to the error's location, and given to the extension for the Problems view
async function testPauseOnError(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    const xsl = path.join(fixtures, 'errors.xsl');
    await dap.start({ saxonArgs: [`-xsl:${xsl}`, '-it'] }, { 'errors.xsl': [{ line: 10 }] });
    let stop = await stopped;
    // after the caught error: just the template - not f:fail, which the error was raised in
    assert.strictEqual(stop.reason, 'breakpoint');
    assert.deepStrictEqual(stop.frames.map((f) => f.name), ['xsl:template name="xsl:initial-template"']);

    stopped = dap.stopped();
    await dap.request('continue', { threadId: 1 });
    stop = await stopped;
    assert.strictEqual(stop.reason, 'exception');
    assert.strictEqual(stop.frames[0].line, 11);
    const info = await dap.request('exceptionInfo', { threadId: 1 });
    assert.strictEqual(info.exceptionId, 'FORG0001');
    assert.strictEqual(info.breakMode, 'unhandled');
    assert.match(info.details.message, /Cannot convert string "abc" to xs:decimal/);
    // shown below the code in VS Code's exception widget
    assert.strictEqual(info.description, info.details.message);
    const locals = byName(await dap.variables(0, 'Locals'));
    assert.strictEqual(locals.$input.value, '"abc"');

    const terminated = dap.event('terminated');
    const exited = dap.event('exited');
    await dap.request('continue', { threadId: 1 });
    assert.strictEqual((await exited).exitCode, 2);
    await terminated;
    const linked = dap.events.filter((e) => e.event === 'output' && e.body.source && e.body.source.path.endsWith('errors.xsl'));
    assert.ok(linked.some((e) => e.body.line === 11 && /FORG0001/.test(e.body.output)), JSON.stringify(linked));
    const problems = dap.events.filter((e) => e.event === 'xsltDebugError');
    assert.deepStrictEqual(problems.map((e) => [e.body.code, e.body.line, e.body.severity]), [['FORG0001', 11, 'error']]);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// with the 'caught' filter, an error caught by xsl:try pauses where it was raised; without the 'errors' filter, an
// uncaught error doesn't pause
async function testPauseOnCaughtError(saxonJar) {
    if (/saxon-[hpe]e-12\.[0-4]\b/i.test(saxonJar)) {
        // Saxon 12.4 and earlier don't report a caught error to the TraceListener
        return 'skipped';
    }
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${path.join(fixtures, 'errors.xsl')}`, '-it'] });
    await dap.request('setExceptionBreakpoints', { filters: ['caught'] });
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const stop = await stopped;
    assert.strictEqual(stop.reason, 'exception');
    assert.strictEqual(stop.frames[0].name, 'f:fail#1');
    const info = await dap.request('exceptionInfo', { threadId: 1 });
    assert.deepStrictEqual([info.exceptionId, info.breakMode], ['FOAR0001', 'always']);
    // the exception widget's description: Saxon's message
    assert.match(info.description, /^Caught by xsl:try: Integer division by zero/);
    stopped = dap.stopped();
    await dap.request('continue', { threadId: 1 });
    assert.strictEqual(await Promise.race([stopped.then(() => 'stopped'), terminated.then(() => 'terminated')]), 'terminated');
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// xsl:message with terminate="yes" pauses, as an error; a static error is reported, linked, but doesn't pause
async function testMessageTerminateAndStaticError(saxonJar) {
    let dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'message-terminate.xsl')}`, '-it'] }, {});
    const stop = await stopped;
    assert.strictEqual(stop.reason, 'exception');
    assert.strictEqual(stop.frames[0].line, 4);
    assert.strictEqual((await dap.request('exceptionInfo', { threadId: 1 })).exceptionId, 'XTMM9000');
    assert.match(dap.output, /Stopping: no orders/);
    let terminated = dap.event('terminated');
    await dap.request('continue', { threadId: 1 });
    await terminated;
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;

    dap = new DapClient(saxonJar);
    stopped = dap.stopped();
    terminated = dap.event('terminated');
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'static-error.xsl')}`, '-it'] }, {});
    assert.strictEqual(await Promise.race([stopped.then(() => 'stopped'), terminated.then(() => 'terminated')]), 'terminated');
    const linked = dap.events.filter((e) => e.event === 'output' && e.body.source && e.body.source.path.endsWith('static-error.xsl'));
    assert.ok(linked.some((e) => e.body.line === 3 && /XPST0008/.test(e.body.output)), JSON.stringify(dap.events.filter((e) => e.event === 'output')));
    // found when compiling: the extension's notification says so
    assert.deepStrictEqual(dap.events.filter((e) => e.event === 'xsltDebugError').map((e) => [e.body.code, e.body.line, e.body.compiling]), [['XPST0008', 3, true]]);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;

    // a failure before the transform runs (e.g. a task's xmlSource since deleted): the extension's notification says why
    dap = new DapClient(saxonJar);
    terminated = dap.event('terminated');
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'basic.xsl')}`, `-s:${path.join(fixtures, 'no-such-file.xml')}`] }, {});
    await terminated;
    const failures = dap.events.filter((e) => e.event === 'xsltDebugFailure').map((e) => e.body.message);
    assert.strictEqual(failures.length, 1);
    assert.match(failures[0], /Source file .*no-such-file\.xml does not exist/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// only the local variables in scope are shown - and used by Watch: not one from an xsl:if that has finished, one
// declared later, or the previous iteration's; the nearest declaration of a name hides any further out - including
// an XPath range variable, within its expression; parameters first, then variables as declared
async function testVariableScopes(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    const xsl = path.join(fixtures, 'scopes.xsl');
    await dap.start({ saxonArgs: [`-xsl:${xsl}`, `-s:${path.join(fixtures, 'basic.xml')}`] },
        { 'scopes.xsl': [10, 13, 15, 19].map((line) => ({ line })) });
    const terminated = dap.event('terminated');
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        const locals = (await dap.variables(0, 'Locals')).map((v) => `${v.name}=${v.value}`).join(' ');
        const x = (await dap.request('evaluate', { expression: '$x', frameId: 0, context: 'watch' })).result;
        stops.push(`${stop.frames[0].line}: ${locals} | watch $x=${x}`);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    assert.deepStrictEqual(stops, [
        '10: $p="param" $x="outer" | watch $x="outer"',
        '13: $p="param" $later="later-1" $x="inner-1" | watch $x="inner-1"',
        '10: $p="param" $x="outer" | watch $x="outer"',
        '13: $p="param" $later="later-2" $x="inner-2" | watch $x="inner-2"',
        '10: $p="param" $x="outer" | watch $x="outer"',
        '13: $p="param" $later="later-3" $x="inner-3" | watch $x="inner-3"',
        '15: $p="param" $x="outer" | watch $x="outer"',
        '19: $p="param" $x=1 | watch $x=1',
        '19: $p="param" $x=2 | watch $x=2',
    ]);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// every xsl:sequence can be stopped at - Saxon itself only traces an xsl:sequence in some places, e.g. not as one of
// a template's instructions - whatever its select, and a multi-line select stepped through
async function testEveryXslSequence(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    const xsl = path.join(fixtures, 'sequences.xsl');
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${xsl}`, '-it'] });
    const lines = require('fs').readFileSync(xsl, 'utf8').split('\n');
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: xsl }, breakpoints: lines.map((_, i) => ({ line: i + 1 })) });
    const terminated = dap.event('terminated');
    await dap.request('configurationDone', {});
    const hits = new Map();
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        if (!stop) {
            break;
        }
        hits.set(stop.frames[0].line, (hits.get(stop.frames[0].line) ?? 0) + 1);
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    // each breakpoint where it was asked for (not moved) is stopped at
    const unhit = breakpoints.map((b, i) => b.verified && b.line === i + 1 && !hits.has(i + 1) ? `${i + 1}: ${lines[i].trim()}` : undefined).filter(Boolean);
    assert.deepStrictEqual(unhit, []);
    const sequenceLines = lines.map((l, i) => /<xsl:sequence/.test(l) ? i + 1 : 0).filter(Boolean);
    assert.ok(sequenceLines.length >= 15 && sequenceLines.every((line) => hits.has(line)), `xsl:sequence lines: ${sequenceLines}`);
    // 'return $x * 100' in a multi-line select: once each iteration
    assert.strictEqual(hits.get(20), 2);
    assert.match(dap.output, /10 20 3 true a 2 3 2 6 8 literal 1 2 10 20 3 a 100 200 2 6 3 61 21 2/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// a copy of each result - the principal one and each xsl:result-document - as written so far, indented, is sent
// before each pause; the Output scope shows which is being written to, and the end of each
async function testOutputSoFar(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    const outDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'xslt-debug-out-'));
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'outputs.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`, `-o:${path.join(outDir, 'result.xml')}`] },
        { 'outputs.xsl': [{ line: 9 }, { line: 12 }] });
    const terminated = dap.event('terminated');
    const text = new Map();
    const apply = () => {
        for (const e of dap.events.splice(0).filter((e) => e.event === 'xsltOutputs')) {
            for (const o of e.body.outputs) {
                text.set(o.name, (text.get(o.name) ?? '').substring(0, o.offset) + o.text);
            }
            dap.current = e.body.current;
        }
    };
    const stops = [];
    while (true) {
        const stop = await Promise.race([stopped, terminated.then(() => undefined)]);
        apply();
        if (!stop) {
            break;
        }
        const output = byName(await dap.variables(0, 'Output'));
        stops.push({ line: stop.frames[0].line, writingTo: output['writing to'].value, result: text.get('result.xml') ?? '', side: text.get('side.json'),
            menus: Object.fromEntries(Object.entries(output).map(([name, v]) => [name, v.__vscodeVariableMenuContext])) });
        stopped = dap.stopped();
        await dap.request('continue', { threadId: 1 });
    }
    // the 3rd row's pause: the first two rows so far, indented - the stylesheet says indent="no"
    assert.strictEqual(stops[2].line, 9);
    assert.match(stops[2].result, /<report>\n {3}<row n="1">text<\/row>\n {3}<row n="2">text<\/row>$/);
    // the xsl:result-document's pause: being written to
    assert.strictEqual(stops[3].line, 12);
    assert.strictEqual(stops[3].writingTo, 'side.json');
    assert.strictEqual(stops[3].side, '');
    // each output, and 'writing to' one, has the context for the Variables view's 'Show Output' menu item
    assert.deepStrictEqual(stops[3].menus, { 'writing to': 'xsltOutput', 'result.xml': 'xsltOutput', 'side.json': 'xsltOutput' });
    // at the end, both complete
    assert.match(text.get('result.xml'), /<row n="3">text<\/row>\n {3}<end\/>\n<\/report>/);
    assert.match(text.get('side.json'), /"count":3/);
    // the real result is as the stylesheet says: not indented
    assert.match(require('fs').readFileSync(path.join(outDir, 'result.xml'), 'utf8'), /<report><row n="1">text<\/row>/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// a principal result with method="json", whose xsl:output properties Saxon gives the serializer as defaults: the copy
// for the output view is JSON too, so the map is written (before, the copy had no method and the transform failed with
// SENR0001) - indented, while the result itself is as the stylesheet says
async function testPrincipalJsonOutput(saxonJar) {
    const dap = new DapClient(saxonJar);
    const outDir = require('fs').mkdtempSync(path.join(require('os').tmpdir(), 'xslt-debug-out-'));
    const terminated = dap.event('terminated');
    // an error would pause the session
    const stopped = dap.stopped().then((stop) => { throw new Error(`stopped: ${stop.reason}`); });
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'json-output.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`, `-o:${path.join(outDir, 'result.json')}`] }, {});
    try {
        await Promise.race([terminated, stopped]);
    } catch (e) {
        await dap.request('disconnect', {}).catch(() => undefined);
        throw e;
    }
    const errors = dap.events.filter((e) => e.event === 'output' && /SENR0001|Cannot serialize/.test(e.body.output));
    assert.deepStrictEqual(errors, []);
    let text = '';
    for (const e of dap.events.filter((e) => e.event === 'xsltOutputs')) {
        for (const o of e.body.outputs.filter((o) => o.name === 'result.json')) {
            assert.strictEqual(o.method, 'json');
            text = text.substring(0, o.offset) + o.text;
        }
    }
    // the entries' order differs in Saxon 12 and 13
    assert.match(text, /^\{\n {2}"/);
    assert.match(text, /\n {2}"count": 3/);
    assert.match(text, /\n {2}"values": \[/);
    const result = require('fs').readFileSync(path.join(outDir, 'result.json'), 'utf8');
    assert.match(result, /^\{"/);
    assert.match(result, /"count":3/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// an XML output's parts, with where each came from: the start tag of the instruction that wrote it (a literal result
// element, xsl:element, xsl:value-of, xsl:attribute - for a temporary tree, the literal result element that made it, in its module -
// and for a node copied from the source document, the instruction that copied it); or literal text, as Saxon reports it
// (where the text starts or ends)
async function testOutputMap(saxonJar) {
    const dap = new DapClient(saxonJar);
    const terminated = dap.event('terminated');
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'output-map.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] }, {});
    await terminated;
    let text = '';
    const runs = [];
    const locations = new Map();
    for (const e of dap.events.filter((e) => e.event === 'xsltOutputs')) {
        for (const o of e.body.outputs) {
            text = text.substring(0, o.offset) + o.text;
            (o.locations ?? []).forEach((l) => locations.set(l.id, l));
            runs.push(...(o.runs ?? []));
        }
    }
    // where the text found came from
    const at = (found) => {
        const offset = text.indexOf(found);
        assert.ok(offset > -1, `${found} in ${text}`);
        let location;
        for (let i = 0; i < runs.length && runs[i] <= offset; i += 2) {
            location = locations.get(runs[i + 1]);
        }
        assert.ok(location, `a location for ${found}`);
        return `${location.kind} ${path.basename(location.path)}:${location.line}:${location.column}`;
    };
    assert.strictEqual(at('<report'), 'instruction output-map.xsl:9:5');
    assert.strictEqual(at('<made'), 'instruction output-map.xsl:10:7');
    assert.strictEqual(at('by value-of'), 'instruction output-map.xsl:11:9');
    assert.strictEqual(at('</made>'), 'instruction output-map.xsl:10:7');
    assert.strictEqual(at('<literal'), 'instruction output-map.xsl:13:7');
    // where the text starts (Saxon 12) or ends (13)
    assert.match(at('first literal line'), /^text output-map\.xsl:(13:16|14:20)$/);
    // copied from the source document: the xsl:sequence that copied it
    assert.strictEqual(at('<item n="2"'), 'instruction output-map.xsl:15:7');
    assert.strictEqual(at('two'), 'instruction output-map.xsl:15:7');
    // a global variable's temporary tree
    assert.strictEqual(at('<built-in-variable'), 'instruction output-map.xsl:6:5');
    // an included module's - copied by xsl:copy-of, which is reported for the nodes it copies
    assert.strictEqual(at('<from-lib'), 'instruction output-map-lib.xsl:7:5');
    // an attribute: a literal one is its element's, one made by xsl:attribute that instruction's
    assert.strictEqual(at('kind="literal"'), 'instruction output-map-lib.xsl:7:5');
    assert.strictEqual(at('made-by='), 'instruction output-map-lib.xsl:8:7');
    assert.strictEqual(at('<lib-variable'), 'instruction output-map-lib.xsl:9:7');
    // copied by a built-in template rule: the xsl:apply-templates
    assert.strictEqual(at('<item n="3"'), 'instruction output-map-lib.xsl:10:7');
    assert.strictEqual(at('</report>'), 'instruction output-map.xsl:9:5');
    // text: of a temporary tree with no element, the instruction writing it; within an element, the element's location,
    // as Saxon copies it - the extension goes from there to the instruction after the start tag
    assert.strictEqual(at('text only'), 'instruction output-map.xsl:19:18');
    assert.strictEqual(at('wrapped text'), 'text output-map.xsl:21:18');
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// with no xsl:output, Saxon decides the output method from the first element (an 'uncommitted' serializer): the copy's
// XML emitter is made then, and records where the output came from too
async function testOutputMapWithoutXslOutput(saxonJar) {
    const dap = new DapClient(saxonJar);
    const terminated = dap.event('terminated');
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'output-map-default.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] }, {});
    await terminated;
    const outputs = dap.events.filter((e) => e.event === 'xsltOutputs').flatMap((e) => e.body.outputs);
    const locations = outputs.flatMap((o) => o.locations ?? []);
    assert.ok(outputs.some((o) => (o.runs ?? []).length > 0), 'runs');
    assert.deepStrictEqual(locations.map((l) => `${l.kind} ${path.basename(l.path)}:${l.line}:${l.column}`).sort(),
        ['instruction output-map-default.xsl:4:5', 'instruction output-map-default.xsl:5:7']);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

async function main() {
    const jars = process.argv.slice(2);
    if (jars.length === 0) {
        console.error('usage: node scripts/test-debugger.js <saxon jar>...');
        process.exit(1);
    }
    let failures = 0;
    for (const jar of jars) {
        for (const test of [testBreakpointsAndInspection, testStepOverAndLogpoint, testInitialTemplateAndError, testBreakpointVerification, testMovedBreakpointsStop, testStepThroughXPath, testBreakpointInXPath, testInlineFunctions, testGroupsInContext, testPositionalVariable, testGlobalsWhileEvaluatingGlobal, testStepIntoOnlyUsefulXPath, testSteppedExpressionsRunOnce, testSeparateEvaluationStaticContext, testXPathLoops, testArrowCalls, testForSomeEvery, testTestsEvaluatedAsNeeded, testLookupsAndMethodCalls, testPartialApplication, testFixedNamespaces, testXslt40Instructions, testOneLineLoop, testFunctionBreakpoints, testXPathFrameScopes, testMessageOutput, testXslt40Structures, testAccumulators, testIterateAndEvaluate, testSort, testWhenAndMapEntry, testInstructions, testKeys, testAnalyzeString, testLogpointLocals, testXPathForms, testXPath40, testStepThroughXPathWithExtensions, testHitCounts, testConditionErrorsAndXPathConditions, testXPathLoopArrivals, testPauseOnError, testPauseOnCaughtError, testMessageTerminateAndStaticError, testVariableScopes, testEveryXslSequence, testOutputSoFar, testPrincipalJsonOutput, testOutputMap, testOutputMapWithoutXslOutput]) {
            try {
                const outcome = await test(jar);
                console.log(`${outcome === 'skipped' ? 'skip' : 'ok  '} ${test.name} - ${path.basename(jar.split(path.delimiter)[0])}`);
            } catch (e) {
                failures++;
                console.log(`FAIL ${test.name} - ${path.basename(jar.split(path.delimiter)[0])}\n${e.stack}`);
            }
        }
    }
    process.exit(failures ? 1 : 0);
}

main();
