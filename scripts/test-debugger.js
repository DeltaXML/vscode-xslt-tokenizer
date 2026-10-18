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
    result = await dap.request('evaluate', { expression: 'f:square(2)', frameId: 0, context: 'repl' }).catch((e) => e);
    assert.ok(result instanceof Error, 'stylesheet functions are not available');

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
    await dap.start({ saxonArgs: [`-xsl:${path.join(fixtures, 'error.xsl')}`, '-it'] }, {});
    const [{ exitCode }] = await ended;
    assert.strictEqual(exitCode, 2);
    assert.match(dap.output, /FOAR0001|divide by zero|Integer division by zero/i);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// breakpoints are moved to where Saxon reports an instruction - the end of its start tag - or rejected where no
// instruction is traced
async function testBreakpointVerification(saxonJar) {
    const dap = new DapClient(saxonJar);
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    const requested = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 23, 24, 27, 28, 32, 33, 34];
    const { breakpoints } = await dap.request('setBreakpoints', {
        source: { path: path.join(fixtures, 'breakpoints.xsl') }, breakpoints: requested.map((line) => ({ line }))
    });
    const actual = Object.fromEntries(requested.map((line, i) => [line, breakpoints[i].verified ? breakpoints[i].line : 'x']));
    assert.deepStrictEqual(actual, {
        1: 'x', 2: 'x', 3: 'x', 4: 'x', 5: 'x', 6: 'x', 7: 7, 8: 11, 9: 11, 10: 11, 11: 11, 12: 12, 13: 14, 14: 14,
        15: 'x', 16: 'x', 17: 'x', 19: 19, 20: 'x', 21: 21, 23: 'x', 24: 24, 27: 27, 28: 'x', 32: 32, 33: 'x', 34: 34
    });
    const message = (line) => breakpoints[requested.indexOf(line)].message;
    assert.match(message(3), /xsl:output isn't an instruction/);
    assert.match(message(4), /top-level data element/);
    assert.match(message(6), /No XSLT instruction/);
    assert.match(message(17), /isn't executed/);
    assert.match(message(28), /xsl:sort isn't an instruction/);
    await dap.request('disconnect', {}).catch(() => undefined);
    await dap.exited;
}

// a breakpoint within a multi-line XPath expression stops at its instruction; one on xsl:choose stops once for each
// item, whether Saxon reports it at its own line (Saxon 12) or its first xsl:when (Saxon 13)
async function testMovedBreakpointsStop(saxonJar) {
    const dap = new DapClient(saxonJar);
    let stopped = dap.stopped();
    await dap.request('initialize', { adapterID: 'xslt-saxon', linesStartAt1: true, columnsStartAt1: true });
    await dap.request('launch', { saxonArgs: [`-xsl:${path.join(fixtures, 'multiline.xsl')}`, `-s:${path.join(fixtures, 'basic.xml')}`] });
    const { breakpoints } = await dap.request('setBreakpoints', { source: { path: path.join(fixtures, 'multiline.xsl') }, breakpoints: [{ line: 10 }, { line: 13 }] });
    assert.deepStrictEqual(breakpoints.map((b) => b.line), [12, 13]);
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
        assert.strictEqual(lines[i], 12);
        assert.ok(lines[i + 1] === 13 || lines[i + 1] === 14, `stops: ${lines}`);
    }
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
        for (const test of [testBreakpointsAndInspection, testStepOverAndLogpoint, testInitialTemplateAndError, testBreakpointVerification, testMovedBreakpointsStop]) {
            try {
                await test(jar);
                console.log(`ok   ${test.name} - ${path.basename(jar.split(path.delimiter)[0])}`);
            } catch (e) {
                failures++;
                console.log(`FAIL ${test.name} - ${path.basename(jar.split(path.delimiter)[0])}\n${e.stack}`);
            }
        }
    }
    process.exit(failures ? 1 : 0);
}

main();
