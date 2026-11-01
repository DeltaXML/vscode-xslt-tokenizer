/**
 * Test suite for running XSpec tests from the Test Explorer (see XSpecTestController): the bundled XSpec's steps, run
 * with Saxon, and the outcomes for the scenarios and expectations - needs a Saxon jar, in XSPEC_SAXON_JAR, else skipped
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { XSpecTestController } from '../../src/xspecTestController';
import { XSpecTests } from '../../src/xspecTests';

const saxonJar = process.env.XSPEC_SAXON_JAR;

// a test run that records the outcome of each item, by its label
function recordingRun(outcomes: Map<string, string>, messages: Map<string, vscode.TestMessage[]>): vscode.TestRun {
	const record = (status: string) => (item: vscode.TestItem, message?: vscode.TestMessage | readonly vscode.TestMessage[]) => {
		outcomes.set(item.label, status);
		if (message) {
			messages.set(item.label, Array.isArray(message) ? [...message] : [message as vscode.TestMessage]);
		}
	};
	return {
		name: 'test', token: new vscode.CancellationTokenSource().token, isPersisted: false,
		enqueued: record('enqueued'), started: record('started'), skipped: record('skipped'), passed: record('passed'),
		failed: record('failed'), errored: record('errored'), appendOutput: () => undefined, addCoverage: () => undefined, end: () => undefined,
		onDidDispose: new vscode.EventEmitter<void>().event
	} as unknown as vscode.TestRun;
}

suite('XSpec: running tests', function () {
	this.timeout(120000);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xspec-run-'));
	fs.writeFileSync(path.join(dir, 'sut.xsl'), `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">
  <xsl:function name="f:double"><xsl:param name="n"/><xsl:sequence select="$n * 2"/></xsl:function>
  <xsl:template match="p"><q><xsl:value-of select="."/></q></xsl:template>
</xsl:stylesheet>`);
	const xspecPath = path.join(dir, 'sut.xspec');
	fs.writeFileSync(xspecPath, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="sut.xsl">
  <x:scenario label="doubling">
    <x:call function="f:double"/>
    <x:scenario label="two"><x:call><x:param select="2"/></x:call><x:expect label="is four" select="4"/></x:scenario>
    <x:scenario label="three"><x:call><x:param select="3"/></x:call><x:expect label="is five" select="5"/></x:scenario>
  </x:scenario>
  <x:scenario label="a paragraph"><x:context><p>t</p></x:context><x:expect label="becomes q"><q>t</q></x:expect></x:scenario>
  <x:pending><x:scenario label="later"><x:call function="f:double"><x:param select="1"/></x:call><x:expect label="is two" select="2"/></x:scenario></x:pending>
</x:description>`);

	suiteSetup(async function () {
		if (!saxonJar) {
			this.skip();
		}
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
	});

	const runItems = async (include: (file: vscode.TestItem) => vscode.TestItem[], debug = false) => {
		const xspec = XSpecTestController.instance!;
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(xspecPath));
		assert.strictEqual(document.languageId, 'xspec');
		const fileItem = xspec.testController.items.get(document.uri.toString())!;
		const outcomes = new Map<string, string>();
		const messages = new Map<string, vscode.TestMessage[]>();
		xspec.createRun = () => recordingRun(outcomes, messages);
		const profile = debug ? xspec.debugProfile : xspec.runProfile;
		await profile.runHandler(new vscode.TestRunRequest(include(fileItem)), new vscode.CancellationTokenSource().token);
		xspec.createRun = undefined;
		return { outcomes, messages, fileItem };
	};
	const child = (item: vscode.TestItem, label: string) => {
		let found: vscode.TestItem | undefined;
		item.children.forEach((c) => found = found ?? (c.label === label ? c : undefined));
		return found!;
	};

	test('the test tree: scenarios and expectations, with their labels', async () => {
		const tree = XSpecTests.testTree(fs.readFileSync(xspecPath, 'utf8'));
		assert.deepEqual(tree.map((node) => node.label), ['doubling', 'a paragraph', 'later']);
		assert.deepEqual(tree[0].children.map((node) => node.label), ['two', 'three']);
		assert.isTrue(tree[2].pending);
	});

	test('run a file: each expectation and scenario passed, failed or pending - with the expected and actual results', async () => {
		const { outcomes, messages } = await runItems((file) => [file]);
		assert.strictEqual(outcomes.get('is four'), 'passed');
		assert.strictEqual(outcomes.get('is five'), 'failed');
		assert.strictEqual(outcomes.get('three'), 'failed');
		assert.strictEqual(outcomes.get('becomes q'), 'passed');
		assert.strictEqual(outcomes.get('is two'), 'skipped');
		const diff = messages.get('is five')![0];
		assert.strictEqual(diff.expectedOutput, '5');
		assert.strictEqual(diff.actualOutput, '6');
		const html = path.join(dir, 'xspec', 'sut-result.html');
		assert.isTrue(fs.existsSync(html), 'the HTML report');
	});

	test('run one scenario, with XSpec\'s force-focus: the others aren\'t run', async () => {
		const { outcomes } = await runItems((file) => [child(child(file, 'doubling'), 'two')]);
		assert.strictEqual(outcomes.get('is four'), 'passed');
		// the others' outcomes aren't changed, e.g. to skipped, as XSpec reports them pending
		assert.deepEqual([...outcomes.keys()].sort(), ['is four', 'two'], JSON.stringify([...outcomes]));
	});

	test('debug a scenario: the test runner is run by the XSLT debugger, and the outcomes are shown', async () => {
		const { outcomes, messages } = await runItems((file) => [child(file, 'a paragraph')], true);
		assert.strictEqual(outcomes.get('becomes q'), 'passed', JSON.stringify([...outcomes]) + JSON.stringify([...messages].map(([k, m]) => [k, m.map((x) => x.message)])));
	});

	test('debug a scenario: a breakpoint in the stylesheet under test stops, with the scenario\'s input', async () => {
		const sut = vscode.Uri.file(path.join(dir, 'sut.xsl'));
		// line 2: f:double's xsl:sequence
		const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(sut, new vscode.Position(1, 60)));
		vscode.debug.addBreakpoints([breakpoint]);
		// the line, and the function and its parameters, of each stop
		const stops: number[] = [];
		const inputs: string[] = [];
		const tracker = vscode.debug.registerDebugAdapterTrackerFactory('xslt-saxon', {
			createDebugAdapterTracker: (session) => ({
				onDidSendMessage: async (message: { type: string, event?: string }) => {
					if (message.type === 'event' && message.event === 'stopped') {
						const trace = await session.customRequest('stackTrace', { threadId: 1 });
						stops.push(trace.stackFrames[0].line);
						const scopes = await session.customRequest('scopes', { frameId: trace.stackFrames[0].id });
						const locals = await session.customRequest('variables', { variablesReference: scopes.scopes[0].variablesReference });
						inputs.push(`${trace.stackFrames[0].name} ${locals.variables.map((v: { name: string, value: string }) => `${v.name}=${v.value}`).join(' ')}`);
						await session.customRequest('continue', { threadId: 1 });
					}
				}
			})
		});
		try {
			const { outcomes } = await runItems((file) => [child(child(file, 'doubling'), 'two')], true);
			assert.deepEqual(stops, [2]);
			assert.deepEqual(inputs, ['f:double#1 $n=2']);
			assert.strictEqual(outcomes.get('is four'), 'passed');
		} finally {
			tracker.dispose();
			vscode.debug.removeBreakpoints([breakpoint]);
		}
	});

	test('a Schematron\'s XSpec: compiled with SchXslt2, and its expectations, labelled as XSpec labels them', async () => {
		fs.writeFileSync(path.join(dir, 'doc.sch'), `<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">
  <sch:pattern><sch:rule context="doc"><sch:assert id="has-title" test="title">a doc has a title</sch:assert></sch:rule></sch:pattern>
</sch:schema>`);
		const schXspec = path.join(dir, 'doc.xspec');
		fs.writeFileSync(schXspec, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" schematron="doc.sch">
  <x:scenario label="titled"><x:context><doc><title>t</title></doc></x:context><x:expect-not-assert id="has-title"/><x:expect-valid/></x:scenario>
  <x:scenario label="untitled"><x:context><doc/></x:context><x:expect-not-assert id="has-title"/></x:scenario>
</x:description>`);
		const xspec = XSpecTestController.instance!;
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(schXspec));
		const fileItem = xspec.testController.items.get(document.uri.toString())!;
		const outcomes = new Map<string, string>();
		xspec.createRun = () => recordingRun(outcomes, new Map());
		await xspec.runProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
		xspec.createRun = undefined;
		assert.strictEqual(outcomes.get('titled'), 'passed', JSON.stringify([...outcomes]));
		assert.strictEqual(outcomes.get('valid'), 'passed');
		assert.strictEqual(outcomes.get('untitled'), 'failed');
		assert.isTrue(fs.existsSync(path.join(dir, 'xspec', 'doc-sch-preprocessed.xsl')), 'the Schematron compiled to XSLT');
	});

	test('debug: breakpoints on the XSpec file\'s x:call and x:expect stop there, with $x:result at the expectation', async () => {
		const linesXspec = path.join(dir, 'lines.xspec');
		fs.writeFileSync(linesXspec, [
			'<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="sut.xsl">',
			'  <x:scenario label="doubling two">',
			'    <x:call function="f:double">',
			'      <x:param select="2"/>',
			'    </x:call>',
			'    <x:expect label="is four"',
			'      select="4"/>',
			'  </x:scenario>',
			'</x:description>'].join('\n'));
		const uri = vscode.Uri.file(linesXspec);
		// lines 3 (x:call), 6 (x:expect) and 4 (x:param - not a step)
		const breakpoints = [3, 6, 4].map((line) => new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line - 1, 4))));
		vscode.debug.addBreakpoints(breakpoints);
		const stops: string[] = [];
		const verified: { line: number, verified: boolean }[] = [];
		const tracker = vscode.debug.registerDebugAdapterTrackerFactory('xslt-saxon', {
			createDebugAdapterTracker: (session) => ({
				onDidSendMessage: async (message: { type: string, event?: string, command?: string, body?: { breakpoints?: { line: number, verified: boolean }[] } }) => {
					if (message.type === 'response' && message.command === 'setBreakpoints' && message.body?.breakpoints?.some((b) => b.line === 6)) {
						verified.push(...message.body.breakpoints.map((b) => ({ line: b.line, verified: b.verified })));
					}
					if (message.type === 'event' && message.event === 'stopped') {
						const trace = await session.customRequest('stackTrace', { threadId: 1 });
						const frame = trace.stackFrames[0];
						const scopes = await session.customRequest('scopes', { frameId: frame.id });
						const locals = await session.customRequest('variables', { variablesReference: scopes.scopes[0].variablesReference });
						const hasResult = locals.variables.some((v: { name: string }) => v.name.endsWith('result'));
						stops.push(`${path.basename(frame.source.path)}:${frame.line}${hasResult ? ' $x:result' : ''}`);
						await session.customRequest('continue', { threadId: 1 });
					}
				}
			})
		});
		try {
			const xspec = XSpecTestController.instance!;
			await vscode.workspace.openTextDocument(uri);
			const fileItem = xspec.testController.items.get(uri.toString())!;
			const outcomes = new Map<string, string>();
			xspec.createRun = () => recordingRun(outcomes, new Map());
			await xspec.debugProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
			xspec.createRun = undefined;
			assert.strictEqual(outcomes.get('is four'), 'passed');
			assert.deepEqual([...new Set(stops)], ['lines.xspec:3', 'lines.xspec:6 $x:result'], JSON.stringify(stops));
			assert.deepEqual(verified.sort((a, b) => a.line - b.line), [{ line: 3, verified: true }, { line: 4, verified: false }, { line: 6, verified: true }]);
		} finally {
			tracker.dispose();
			vscode.debug.removeBreakpoints(breakpoints);
		}
	});

	test('run one scenario that XSpec can\'t compile on its own (run-as="external"): the whole file is run instead', async () => {
		fs.writeFileSync(path.join(dir, 'modes.xsl'), `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="p" mode="m"><q/></xsl:template>
</xsl:stylesheet>`);
		const externalXspec = path.join(dir, 'external.xspec');
		fs.writeFileSync(externalXspec, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:myv="urn:myv" run-as="external" stylesheet="modes.xsl">
  <x:scenario label="stored" shared="yes"><x:variable name="myv:v" select="$x:context"/></x:scenario>
  <x:scenario label="with context">
    <x:context><p/></x:context>
    <x:like label="stored"/>
    <x:scenario label="first"><x:context mode="m"/><x:expect label="has a context" test="exists($x:context)"/></x:scenario>
    <x:scenario label="second"><x:context mode="m"/><x:expect label="has a result" test="exists($x:result)"/></x:scenario>
  </x:scenario>
</x:description>`);
		const xspec = XSpecTestController.instance!;
		const uri = vscode.Uri.file(externalXspec);
		await vscode.workspace.openTextDocument(uri);
		const fileItem = xspec.testController.items.get(uri.toString())!;
		const outcomes = new Map<string, string>();
		xspec.createRun = () => recordingRun(outcomes, new Map());
		await xspec.runProfile.runHandler(new vscode.TestRunRequest([child(child(fileItem, 'with context'), 'second')]), new vscode.CancellationTokenSource().token);
		xspec.createRun = undefined;
		assert.strictEqual(outcomes.get('has a result'), 'passed', JSON.stringify([...outcomes]));
		assert.strictEqual(outcomes.get('has a context'), 'passed');
		// and debugged
		const debugOutcomes = new Map<string, string>();
		xspec.createRun = () => recordingRun(debugOutcomes, new Map());
		await xspec.debugProfile.runHandler(new vscode.TestRunRequest([child(child(fileItem, 'with context'), 'second')]), new vscode.CancellationTokenSource().token);
		xspec.createRun = undefined;
		assert.strictEqual(debugOutcomes.get('has a result'), 'passed', JSON.stringify([...debugOutcomes]));
	});
});
