/**
 * Test suite for the template rules each input node was processed by, in the last run of the XSLT debugger: a hover on
 * an input element, Go to Definition to its templates, and above each template rule, the nodes it processed - found
 * again in the input file as it is now, by their position among its elements.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltDebug, XsltDebugOutputs } from '../../src/xsltDebug';
import { XsltNodeRules } from '../../src/xsltNodeRules';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';

const fixtures = path.resolve(__dirname, '..', '..', '..', 'debugger', 'test');

// the hover's text, as shown: without the escapes of Markdown characters
const hoverText = async (uri: vscode.Uri, position: vscode.Position) => {
	const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position);
	return hovers.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n').replace(/\\([\\`*_{}[\]()#+\-.!<>|~])/g, '$1');
};

suite('XSLT debugger: the template rules each input node was processed by', function () {
	this.timeout(60000);
	let folder = '';
	const file = (name: string) => path.join(folder, name);

	// the XML context file: the input files these tests open, in a folder deleted after each, aren't left as it
	let context: { uri: vscode.Uri | null, isNone: boolean } | undefined;
	suiteSetup(async () => {
		context = await DocumentChangeHandler.contextFor(undefined);
	});
	suiteTeardown(() => {
		DocumentChangeHandler.setLastPicked(context!.uri, context!.isNone);
	});

	setup(() => {
		folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'node-rules-')));
		['node-rules.xsl', 'node-rules-focus.xsl', 'node-rules.xml', 'node-rules-products.xml'].forEach((name) => fs.copyFileSync(path.join(fixtures, name), file(name)));
		XsltNodeRules.clear();
	});
	teardown(async () => {
		const ours = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.startsWith(folder));
		await vscode.window.tabGroups.close(ours);
		XsltNodeRules.clear();
		fs.rmSync(folder, { recursive: true, force: true });
	});

	test('a run: the hover on an input element, Go to Definition, and above each template rule, the nodes it processed', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR ?? process.env.XSPEC_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const received = new Promise<void>((resolve) => {
			const listener = vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
				if (event.event === 'xsltNodeRules') {
					listener.dispose();
					// after the extension's own listener has stored it
					setTimeout(resolve, 100);
				}
			});
		});
		const started = await vscode.debug.startDebugging(undefined, {
			type: XsltDebug.type, request: 'launch', name: 'node rules', noDebug: true, saxonJar, xsltFile: file('node-rules.xsl'), xmlSource: file('node-rules.xml')
		}, { noDebug: true });
		assert.isTrue(started);
		await received;

		const input = await vscode.workspace.openTextDocument(vscode.Uri.file(file('node-rules.xml')));
		const at = (text: string, after = '') => input.positionAt(input.getText().indexOf(text, input.getText().indexOf(after)) + 1);
		// the line: its two templates - the second by xsl:next-match - its attribute in a mode, and its text
		const line = await hoverText(input.uri, at('<line'));
		assert.include(line, '`line`: `match="line" priority="2"`');
		assert.match(line, /`line`: .*node-rules\.xsl:6.*`match="line"` \[node-rules\.xsl:11\]/);
		assert.include(line, '`@product`: `match="@product" mode="attr"`');
		assert.include(line, '`text()`: `match="text()[normalize-space()]"`');
		// an element no template matched, and its attributes
		const order = await hoverText(input.uri, at('<order '));
		// not the whitespace between its elements, which the built-in rules processed
		assert.notInclude(order, 'whitespace');
		assert.include(order, '`order`: `match="order"`');
		assert.match(order, /`@id`: _built-in rule \(shallow-skip\) - no template matched_/);
		assert.match(await hoverText(input.uri, at('<note')), /`note`: _built-in rule \(shallow-skip\)/);

		// Go to Definition: the templates
		const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', input.uri, at('<line'));
		const lines = definitions.map((d) => 'uri' in d ? `${path.basename(d.uri.fsPath)}:${d.range.start.line + 1}` : `${path.basename(d.targetUri.fsPath)}:${d.targetRange.start.line + 1}`);
		for (const expected of ['node-rules.xsl:6', 'node-rules.xsl:11', 'node-rules.xsl:14', 'node-rules.xsl:15']) {
			assert.include(lines, expected);
		}

		// above each template rule: the nodes it processed - a document doc() read too - and where they are
		const stylesheet = await vscode.workspace.openTextDocument(vscode.Uri.file(file('node-rules.xsl')));
		const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', stylesheet.uri);
		const titles = lenses.filter((l) => l.command?.command === 'xslt-xpath.showProcessedNodes').map((l) => `${l.range.start.line + 1}: ${l.command!.title}`).sort();
		assert.includeMembers(titles, ['3: processed 2 nodes in node-rules.xml', '6: processed 2 nodes in node-rules.xml', '16: processed 1 node (2 times) in node-rules-products.xml']);
		const orders = XsltNodeRules.processedLocations(stylesheet.uri, 2).map((l) => `${path.basename(l.uri.fsPath)}:${l.range.start.line + 1}`);
		assert.deepStrictEqual(orders, ['node-rules.xml:3', 'node-rules.xml:8']);

		// and from the output: the input each part was written for - <l> for the first line
		const outputs = XsltDebugOutputs.get();
		const name = outputs.names()[0];
		const lOffset = outputs.text(name)!.indexOf('<l>');
		const written = await outputs.inputLocationAt(name, lOffset + 1);
		assert.strictEqual(written?.node, 'element:line');
		assert.strictEqual(`${path.basename(written!.location.uri.fsPath)}:${written!.location.range.start.line + 1}`, 'node-rules.xml:5');
	});

	test('with XSLT.debug.mapInputNodes off: not recorded', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR ?? process.env.XSPEC_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const settings = vscode.workspace.getConfiguration('XSLT.debug');
		await settings.update('mapInputNodes', false, vscode.ConfigurationTarget.Global);
		try {
			let received = false;
			const listener = vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
				received ||= event.event === 'xsltNodeRules';
			});
			const ended = new Promise<void>((resolve) => {
				const done = vscode.debug.onDidTerminateDebugSession(() => {
					done.dispose();
					resolve();
				});
			});
			assert.isTrue(await vscode.debug.startDebugging(undefined, {
				type: XsltDebug.type, request: 'launch', name: 'node rules off', noDebug: true, saxonJar, xsltFile: file('node-rules.xsl'), xmlSource: file('node-rules.xml')
			}, { noDebug: true }));
			await ended;
			listener.dispose();
			assert.isFalse(received);
			const outputs = XsltDebugOutputs.get();
			const name = outputs.names()[0];
			assert.isUndefined(await outputs.inputLocationAt(name, outputs.text(name)!.indexOf('<l>') + 1));
		} finally {
			await settings.update('mapInputNodes', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('the input file edited or formatted since: an element found by its position among the elements - not if its name differs', async () => {
		const xml = file('node-rules.xml');
		// as the debug adapter sends it: the line element (where its start tag ends: line 5, column 38) by the second template
		XsltNodeRules.update({
			rules: [{ path: file('node-rules.xsl'), line: 11, column: 3, label: 'xsl:template match="line"' }],
			names: ['element:line'],
			files: { [xml]: [5, 38, 1, 0, 0, 3] }
		});
		// formatted differently: the same elements
		fs.writeFileSync(xml, fs.readFileSync(xml, 'utf8').replace(/\n\s*/g, ' ').replace('<orders>', '<orders>\n'));
		const formatted = await vscode.workspace.openTextDocument(vscode.Uri.file(xml));
		const lineAt = formatted.positionAt(formatted.getText().indexOf('<line') + 1);
		assert.match(await hoverText(formatted.uri, lineAt), /`line`: `match="line"` \[node-rules\.xsl:11\]\([^)]*#L11\) ×3/);
		// an element added before it: not the same element any more
		const edit = new vscode.WorkspaceEdit();
		edit.insert(formatted.uri, formatted.positionAt(formatted.getText().indexOf('<order')), '<extra/>');
		await vscode.workspace.applyEdit(edit);
		const moved = formatted.positionAt(formatted.getText().indexOf('<line') + 1);
		assert.notInclude(await hoverText(formatted.uri, moved), 'Processed by');
		await vscode.commands.executeCommand('workbench.action.files.revert', formatted.uri);
	});

	test('xsl:for-each, xsl:for-each-group and xsl:iterate: in the hover, Go to Definition and above the instruction - not where the stylesheet has none', async () => {
		const xml = file('node-rules.xml');
		const xsl = file('node-rules-focus.xsl');
		// as the debug adapter sends it: each line in two groups; the attribute by xsl:iterate; and an xsl:for-each Saxon 13
		// reports at the xsl:value-of within the one it rewrote
		XsltNodeRules.update({
			rules: [
				{ path: xsl, line: 7, column: 7, label: 'xsl:for-each-group select="//line"', instruction: true },
				{ path: xsl, line: 12, column: 7, label: 'xsl:iterate select="//line/@product"', instruction: true },
				{ path: xsl, line: 9, column: 11, label: 'xsl:for-each select="@product"', instruction: true },
				{ path: xsl, line: 4, column: 7, label: 'xsl:for-each select="orders/order"', instruction: true }
			],
			names: ['element:line', 'attribute:product', 'element:order'],
			files: { [xml]: [5, 38, 3, 0, 0, 2, 1, 1, 1, 0, 2, 2, 8, 39, 1, 0, 0, 2, 4, 28, 1, 2, 3, 1] }
		});
		const input = await vscode.workspace.openTextDocument(vscode.Uri.file(xml));
		const at = (text: string) => input.positionAt(input.getText().indexOf(text) + 1);
		const line = await hoverText(input.uri, at('<line'));
		assert.match(line, /`line`: `for-each-group select="\/\/line" group-by="@product, 'all'"` \[node-rules-focus\.xsl:7\]\([^)]*#L7\) ×2/);
		assert.match(line, /`@product`: `iterate select="\/\/line\/@product"` \[node-rules-focus\.xsl:12\]/);
		assert.notInclude(line, 'node-rules-focus.xsl:9');
		assert.match(await hoverText(input.uri, at('<order ')), /`order`: `for-each select="orders\/order"` \[node-rules-focus\.xsl:4\]/);

		const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', input.uri, at('<line'));
		const lines = definitions.map((d) => 'uri' in d ? d.range.start.line + 1 : d.targetRange.start.line + 1).sort((a, b) => a - b);
		assert.deepStrictEqual(lines, [7, 12]);

		const stylesheet = await vscode.workspace.openTextDocument(vscode.Uri.file(xsl));
		const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', stylesheet.uri);
		const titles = lenses.filter((l) => l.command?.command === 'xslt-xpath.showProcessedNodes').map((l) => `${l.range.start.line + 1}: ${l.command!.title}`).sort();
		assert.deepStrictEqual(titles, ['12: processed 1 node in node-rules.xml', '4: processed 1 node in node-rules.xml', '7: processed 2 nodes (4 times) in node-rules.xml']);
	});

	test('markers in the input file: elements processed by a template or instruction, or only by built-in rules - one a line', async () => {
		const xml = file('node-rules.xml');
		const xsl = file('node-rules.xsl');
		// order A1 (its start tag on lines 3-4) by a template; the line by built-in rules only; the note only its
		// whitespace (not shown); order B2 by a template and its line on the same line by built-in rules
		XsltNodeRules.update({
			rules: [{ path: xsl, line: 3, column: 3, label: 'xsl:template match="order"' }, { builtIn: 'shallow-skip', mode: '#default' }],
			names: ['element:order', 'element:line', 'whitespace', 'element:note'],
			files: { [xml]: [4, 28, 1, 0, 0, 1, 5, 38, 1, 1, 1, 1, 6, 12, 1, 2, 1, 1, 8, 18, 1, 0, 0, 1, 8, 39, 1, 1, 1, 1] }
		});
		const input = await vscode.workspace.openTextDocument(vscode.Uri.file(xml));
		const lines = (ranges: vscode.Range[]) => ranges.map((r) => `${r.start.line + 1}-${r.end.line + 1}`);
		const markers = XsltNodeRules.markers(input);
		assert.deepStrictEqual(lines(markers.processed).sort(), ['3-4', '8-8']);
		assert.deepStrictEqual(lines(markers.builtIn), ['5-5']);
		// the note: no hover either
		assert.notInclude(await hoverText(input.uri, input.positionAt(input.getText().indexOf('<note') + 1)), 'Processed by');
		// cleared: none
		await vscode.commands.executeCommand('xslt-xpath.clearInputMapping');
		assert.deepStrictEqual(XsltNodeRules.markers(input), { processed: [], builtIn: [] });
	});

	test('line starts: lines end with \\n, \\r\\n or \\r', () => {
		assert.deepStrictEqual(XsltNodeRules.lineStarts('a\nb\r\nc\rd'), [0, 2, 5, 7]);
	});
});
