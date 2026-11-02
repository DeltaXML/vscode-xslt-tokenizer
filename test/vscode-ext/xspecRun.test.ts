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
import { XsltPackages } from '../../src/xsltPackages';

const saxonJar = process.env.XSPEC_SAXON_JAR;

// a test run that records the outcome of each item, by its label
function recordingRun(outcomes: Map<string, string>, messages: Map<string, vscode.TestMessage[]>, coverages: vscode.FileCoverage[] = []): vscode.TestRun {
	const record = (status: string) => (item: vscode.TestItem, message?: vscode.TestMessage | readonly vscode.TestMessage[]) => {
		outcomes.set(item.label, status);
		if (message) {
			messages.set(item.label, Array.isArray(message) ? [...message] : [message as vscode.TestMessage]);
		}
	};
	return {
		name: 'test', token: new vscode.CancellationTokenSource().token, isPersisted: false,
		enqueued: record('enqueued'), started: record('started'), skipped: record('skipped'), passed: record('passed'),
		failed: record('failed'), errored: record('errored'), appendOutput: () => undefined, addCoverage: (coverage: vscode.FileCoverage) => coverages.push(coverage), end: () => undefined,
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

	test('run a file: each expectation passed, failed or pending - with the expected and actual results', async () => {
		const { outcomes, messages } = await runItems((file) => [file]);
		assert.strictEqual(outcomes.get('is four'), 'passed');
		assert.strictEqual(outcomes.get('is five'), 'failed');
		// only the expectations are tests, as XSpec counts them: a scenario's state comes from those in it
		assert.isUndefined(outcomes.get('three'));
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
		assert.deepEqual([...outcomes.keys()].sort(), ['is four'], JSON.stringify([...outcomes]));
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
		// the expectations, by label: titled's 'not assert has-title' passed, then untitled's failed
		assert.strictEqual(outcomes.get('valid'), 'passed', JSON.stringify([...outcomes]));
		assert.strictEqual(outcomes.get('not assert has-title'), 'failed');
		assert.isUndefined(outcomes.get('untitled'));
		assert.isTrue(fs.existsSync(path.join(dir, 'xspec', 'doc-sch-preprocessed.xsl')), 'the Schematron compiled to XSLT');
	});

	test('a failed expectation: the diff\'s values as XSpec compares them - XML without namespace declarations, attributes sorted, no indentation whitespace; a map in the expected order; XSpec\'s \'...\'', async () => {
		fs.writeFileSync(path.join(dir, 'invoice.xsl'), `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="order"><invoice id="{@id}"><line sku="a" qty="2"/><line sku="b" qty="1"/></invoice></xsl:template>
  <xsl:function name="f:summary" xmlns:f="urn:f"><xsl:sequence select="map { 'id': 'A1', 'lines': 2 }"/></xsl:function>
  <xsl:template name="paras"><para>1</para><para>2</para><para>3</para></xsl:template>
  <xsl:template name="section"><section id="A1" created="07:30" class="order"><h2>Order A1</h2><table><tr/></table><p>at 07:30</p></section></xsl:template>
</xsl:stylesheet>`);
		const invoiceXspec = path.join(dir, 'invoice.xspec');
		fs.writeFileSync(invoiceXspec, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" xmlns:xs="http://www.w3.org/2001/XMLSchema" stylesheet="invoice.xsl">
  <x:scenario label="an order">
    <x:context><order id="7"/></x:context>
    <x:expect label="its invoice">
      <invoice id="7">
        <line qty="2" sku="a"/>
        <line qty="3" sku="b"/>
      </invoice>
    </x:expect>
  </x:scenario>
  <x:scenario label="a summary">
    <x:call function="f:summary"/>
    <x:expect label="its map" select="map { 'lines': 3, 'id': 'A1' }"/>
  </x:scenario>
  <x:scenario label="a section">
    <x:call template="section"/>
    <x:expect label="its heading">
      <section id="A1" created="..." x:attrs="...">
        <h2>Order A2</h2>
        <table>...</table>
        <p>...</p>
      </section>
    </x:expect>
  </x:scenario>
  <x:scenario label="some paragraphs">
    <x:call template="paras"/>
    <x:expect label="its paragraphs">
      <para>1</para>
      <para>4</para>
      <para>3</para>
    </x:expect>
  </x:scenario>
</x:description>`);
		const xspec = XSpecTestController.instance!;
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(invoiceXspec));
		const fileItem = xspec.testController.items.get(document.uri.toString())!;
		const outcomes = new Map<string, string>();
		const messages = new Map<string, vscode.TestMessage[]>();
		xspec.createRun = () => recordingRun(outcomes, messages);
		await xspec.runProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
		xspec.createRun = undefined;
		assert.strictEqual(outcomes.get('its invoice'), 'failed', JSON.stringify([...outcomes]));
		const diff = messages.get('its invoice')![0];
		// only the second line differs
		assert.strictEqual(diff.expectedOutput, '<invoice id="7">\n   <line qty="2" sku="a"/>\n   <line qty="3" sku="b"/>\n</invoice>');
		assert.strictEqual(diff.actualOutput, '<invoice id="7">\n   <line qty="2" sku="a"/>\n   <line qty="1" sku="b"/>\n</invoice>');
		// a map: without the pseudo element XSpec reports it in, an entry on each line - and, as XSpec ignores the order of
		// its entries, in the expected map's order
		const mapDiff = messages.get('its map')![0];
		assert.strictEqual(mapDiff.expectedOutput, 'map{\n  "lines": 3,\n  "id": "A1"\n}');
		assert.strictEqual(mapDiff.actualOutput, 'map{\n  "lines": 2,\n  "id": "A1"\n}');
		// what XSpec's '...' matches is shown as '...' in the actual result - an attribute's value, an element's content and
		// a text node - and the attributes x:attrs="..." allows aren't shown: only the heading differs
		const sectionDiff = messages.get('its heading')![0];
		assert.strictEqual(sectionDiff.expectedOutput, '<section created="..." id="A1">\n   <h2>Order A2</h2>\n   <table>...</table>\n   <p>...</p>\n</section>');
		assert.strictEqual(sectionDiff.actualOutput, '<section created="..." id="A1">\n   <h2>Order A1</h2>\n   <table>...</table>\n   <p>...</p>\n</section>');
		// elements without a wrapper: one on each line, without blank lines between them
		const parasDiff = messages.get('its paragraphs')![0];
		assert.strictEqual(parasDiff.expectedOutput, '<para>1</para>\n<para>4</para>\n<para>3</para>');
		assert.strictEqual(parasDiff.actualOutput, '<para>1</para>\n<para>2</para>\n<para>3</para>');
		assert.isTrue(fs.existsSync(path.join(dir, 'xspec', 'invoice-result.html')), 'the HTML report');
	});

	test('Saxon\'s syntax extensions: a stylesheet before XSLT 4.0 with a record type is run - imported, or with run-as="external"', async () => {
		fs.writeFileSync(path.join(dir, 'points.xsl'), `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f" version="3.0">
  <xsl:item-type name="f:point" as="record(x as xs:double, y as xs:double)"/>
  <xsl:function name="f:sum" as="xs:double" visibility="public"><xsl:param name="p" as="f:point"/><xsl:sequence select="$p?x + $p?y"/></xsl:function>
</xsl:stylesheet>`);
		for (const runAs of ['import', 'external']) {
			const pointsXspec = path.join(dir, `points-${runAs}.xspec`);
			fs.writeFileSync(pointsXspec, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="points.xsl" run-as="${runAs}">
  <x:scenario label="sum"><x:call function="f:sum"><x:param select="map { 'x': 1e0, 'y': 2e0 }"/></x:call><x:expect label="is three" select="3e0"/></x:scenario>
</x:description>`);
			const xspec = XSpecTestController.instance!;
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(pointsXspec));
			const fileItem = xspec.testController.items.get(document.uri.toString())!;
			const outcomes = new Map<string, string>();
			const messages = new Map<string, vscode.TestMessage[]>();
			xspec.createRun = () => recordingRun(outcomes, messages);
			await xspec.runProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
			xspec.createRun = undefined;
			assert.strictEqual(outcomes.get('is three'), 'passed', `${runAs}: ${JSON.stringify([...outcomes])} ${JSON.stringify([...messages].map(([k, m]) => [k, m.map((x) => x.message)]))}`);
		}
		// with the XSLT.xspec.allowSyntaxExtensions setting off, the record type is an error
		const settings = vscode.workspace.getConfiguration('XSLT.xspec');
		await settings.update('allowSyntaxExtensions', 'off', vscode.ConfigurationTarget.Global);
		try {
			const xspec = XSpecTestController.instance!;
			const fileItem = xspec.testController.items.get(vscode.Uri.file(path.join(dir, 'points-import.xspec')).toString())!;
			const outcomes = new Map<string, string>();
			xspec.createRun = () => recordingRun(outcomes, new Map());
			await xspec.runProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
			xspec.createRun = undefined;
			assert.strictEqual(outcomes.get('is three'), 'errored', JSON.stringify([...outcomes]));
		} finally {
			await settings.update('allowSyntaxExtensions', undefined, vscode.ConfigurationTarget.Global);
		}
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

	test('a package\'s tests: used with x:helper - and passed to Saxon with -lib, as the runner uses it', async () => {
		const packagePath = path.join(dir, 'shapes.xsl');
		fs.writeFileSync(packagePath, `<xsl:package name="urn:shapes" package-version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="urn:s" version="3.0">
  <xsl:function name="s:area" visibility="public"><xsl:param name="w"/><xsl:sequence select="$w * $w"/></xsl:function>
</xsl:package>`);
		fs.writeFileSync(path.join(dir, 'shapes-xspec-harness.xsl'), '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>');
		const packageXspec = path.join(dir, 'shapes.xspec');
		fs.writeFileSync(packageXspec, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:s="urn:s" stylesheet="shapes-xspec-harness.xsl">
  <x:helper package-name="urn:shapes" package-version="1.0"/>
  <x:scenario label="area"><x:call function="s:area"><x:param select="3"/></x:call><x:expect label="is nine" select="9"/></x:scenario>
</x:description>`);
		XsltPackages.additional = [{ name: 'urn:shapes', version: '1.0', path: packagePath }];
		try {
			const xspec = XSpecTestController.instance!;
			const uri = vscode.Uri.file(packageXspec);
			await vscode.workspace.openTextDocument(uri);
			const fileItem = xspec.testController.items.get(uri.toString())!;
			const outcomes = new Map<string, string>();
			xspec.createRun = () => recordingRun(outcomes, new Map());
			await xspec.runProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
			xspec.createRun = undefined;
			assert.strictEqual(outcomes.get('is nine'), 'passed', JSON.stringify([...outcomes]));
		} finally {
			XsltPackages.additional = [];
		}
	});

	test('a package tested externally: run-as="external", with the package as the stylesheet tested', async () => {
		const packagePath = path.join(dir, 'external-shapes.xsl');
		fs.writeFileSync(packagePath, `<xsl:package name="urn:external-shapes" package-version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="urn:s" version="3.0">
  <xsl:function name="s:area" visibility="public"><xsl:param name="w"/><xsl:sequence select="$w * $w"/></xsl:function>
  <xsl:template name="s:box" visibility="public"><box/></xsl:template>
</xsl:package>`);
		const packageXspec = path.join(dir, 'external-shapes.xspec');
		fs.writeFileSync(packageXspec, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:s="urn:s" run-as="external" stylesheet="external-shapes.xsl">
  <x:scenario label="area"><x:call function="s:area"><x:param select="3"/></x:call><x:expect label="is nine" select="9"/></x:scenario>
  <x:scenario label="box"><x:call template="s:box"/><x:expect label="a box"><box/></x:expect></x:scenario>
</x:description>`);
		const xspec = XSpecTestController.instance!;
		const uri = vscode.Uri.file(packageXspec);
		await vscode.workspace.openTextDocument(uri);
		const fileItem = xspec.testController.items.get(uri.toString())!;
		const outcomes = new Map<string, string>();
		xspec.createRun = () => recordingRun(outcomes, new Map());
		await xspec.runProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
		xspec.createRun = undefined;
		assert.strictEqual(outcomes.get('is nine'), 'passed', JSON.stringify([...outcomes]));
		assert.strictEqual(outcomes.get('a box'), 'passed');
	});

	test('coverage: the lines of the stylesheet tested that the tests ran, and its functions and templates', async () => {
		const tested = path.join(dir, 'covered.xsl');
		fs.writeFileSync(tested, [
			'<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">',
			'  <xsl:function name="f:used">',
			'    <xsl:param name="n"/>',
			'    <xsl:sequence select="$n + 1"/>',
			'  </xsl:function>',
			'  <xsl:function name="f:unused">',
			'    <xsl:sequence select="0"/>',
			'  </xsl:function>',
			'  <xsl:function name="f:chain">',
			'    <xsl:param name="items"/>',
			'    <xsl:sequence select="$items',
			'      [. gt 1]',
			'      [. lt 9]',
			'      ! (. * 2)"/>',
			'  </xsl:function>',
			'  <xsl:function name="f:tag">',
			'    <xsl:sequence',
			'        select="1"/>',
			'  </xsl:function>',
			'</xsl:stylesheet>'].join('\n'));
		const coveredXspec = path.join(dir, 'covered.xspec');
		fs.writeFileSync(coveredXspec, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="covered.xsl">
  <x:scenario label="used"><x:call function="f:used"><x:param select="1"/></x:call><x:expect label="is two" select="2"/></x:scenario>
  <x:scenario label="chain"><x:call function="f:chain"><x:param select="1 to 10"/></x:call><x:expect label="filtered" select="(4, 6, 8, 10, 12, 14, 16)"/></x:scenario>
  <x:scenario label="tag"><x:call function="f:tag"/><x:expect label="is one" select="1"/></x:scenario>
</x:description>`);
		const xspec = XSpecTestController.instance!;
		const uri = vscode.Uri.file(coveredXspec);
		await vscode.workspace.openTextDocument(uri);
		const fileItem = xspec.testController.items.get(uri.toString())!;
		const outcomes = new Map<string, string>();
		const coverages: vscode.FileCoverage[] = [];
		xspec.createRun = () => recordingRun(outcomes, new Map(), coverages);
		await xspec.coverageProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
		xspec.createRun = undefined;
		assert.strictEqual(outcomes.get('is two'), 'passed', JSON.stringify([...outcomes]));
		const coverage = coverages.find((c) => path.basename(c.uri.fsPath) === 'covered.xsl');
		assert.isDefined(coverage, coverages.map((c) => c.uri.fsPath).join(', '));
		const details = await xspec.coverageProfile.loadDetailedCoverage!({} as vscode.TestRun, coverage!, new vscode.CancellationTokenSource().token);
		const declarations = details.filter((d): d is vscode.DeclarationCoverage => d instanceof vscode.DeclarationCoverage).map((d) => `${d.name} ${d.executed ? 'run' : 'not run'}`);
		assert.deepEqual(declarations, ['function f:used run', 'function f:unused not run', 'function f:chain run', 'function f:tag run']);
		// the line of f:unused's xsl:sequence isn't run
		const statements = details.filter((d): d is vscode.StatementCoverage => d instanceof vscode.StatementCoverage);
		const firstLine = (d: vscode.StatementCoverage) => d.location instanceof vscode.Range ? d.location.start.line : d.location.line;
		const at = (line: number) => statements.find((d) => firstLine(d) === line - 1)?.executed;
		assert.isOk(at(4));
		assert.strictEqual(at(7), 0);
		// f:used's xsl:param can't be run, so isn't a statement: all of f:used's are run
		assert.isUndefined(at(3));
		const used = statements.filter((d) => { const line = firstLine(d) + 1; return line >= 2 && line <= 5; });
		assert.isNotEmpty(used);
		assert.isTrue(used.every((d) => !!d.executed), JSON.stringify(statements.map((d) => [firstLine(d) + 1, d.executed])));
		// a multi-line expression is one statement, at its instruction: the lines of f:chain's predicates aren't others,
		// nor shown with it, as their parts aren't traced, so may not have been run
		assert.isOk(at(11));
		[12, 13, 14].forEach((line) => assert.isUndefined(at(line), `line ${line}`));
		assert.instanceOf(statements.find((d) => firstLine(d) === 10)!.location, vscode.Position);
		// but all of a multi-line start tag is
		const tag = statements.find((d) => firstLine(d) === 16)!;
		assert.isOk(tag.executed);
		assert.instanceOf(tag.location, vscode.Range);
		assert.strictEqual((tag.location as vscode.Range).end.line, 17);
	});
});

