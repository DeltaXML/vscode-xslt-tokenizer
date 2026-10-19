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
    assert.match(context['.'].type, /^element\(\) line 3/);
    assert.strictEqual(context['position()'].value, '2');
    assert.strictEqual(context['last()'].value, '3');
    const item = byName((await dap.request('variables', { variablesReference: context['.'].variablesReference })).variables);
    assert.strictEqual(item['@n'].value, 'n="2"');
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
        15: 'x', 16: 'x', 17: 'x', 19: 19, 20: 'x', 21: 21, 23: 'x', 24: 24, 27: 27, 28: 'x', 32: 32, 33: 'x', 34: 34
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
    assert.match(message(28), /xsl:sort isn't an instruction/);
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

    // out of the function, then out of the expression
    for (let i = 0; i < 2; i++) {
        stopped = dap.stopped();
        await dap.request('stepOut', { threadId: 1 });
        stop = await stopped;
    }
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
    assert.match(dap.output, /xsl:variable\/@select on line 9 = 2/);
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
    assert.deepStrictEqual([info.exceptionId, info.breakMode, info.description], ['FOAR0001', 'always', 'Error caught by xsl:try']);
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
    assert.deepStrictEqual(dap.events.filter((e) => e.event === 'xsltDebugError').map((e) => [e.body.code, e.body.line]), [['XPST0008', 3]]);
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
        '19: $x=1 | watch $x=1',
        '19: $x=2 | watch $x=2',
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
        stops.push({ line: stop.frames[0].line, writingTo: output['writing to'].value, result: text.get('result.xml') ?? '', side: text.get('side.json') });
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
    // at the end, both complete
    assert.match(text.get('result.xml'), /<row n="3">text<\/row>\n {3}<end\/>\n<\/report>/);
    assert.match(text.get('side.json'), /"count":3/);
    // the real result is as the stylesheet says: not indented
    assert.match(require('fs').readFileSync(path.join(outDir, 'result.xml'), 'utf8'), /<report><row n="1">text<\/row>/);
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
        for (const test of [testBreakpointsAndInspection, testStepOverAndLogpoint, testInitialTemplateAndError, testBreakpointVerification, testMovedBreakpointsStop, testStepThroughXPath, testBreakpointInXPath, testInlineFunctions, testGroupsInContext, testPositionalVariable, testXPathForms, testXPath40, testStepThroughXPathWithExtensions, testHitCounts, testConditionErrorsAndXPathConditions, testXPathLoopArrivals, testPauseOnError, testPauseOnCaughtError, testMessageTerminateAndStaticError, testVariableScopes, testEveryXslSequence, testOutputSoFar]) {
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
