/**
 * Test suite for going from the debugger's view of an XML output to where each part of it came from: the adapter sends
 * runs of the output text with their locations (see OutputCapture and Debugger.outputLocation in the debugger) - an
 * instruction's start tag, a node copied from a source document (where its start tag ends) or literal text (where
 * Saxon reports it: where the text starts, in Saxon 12, or ends, in Saxon 13)
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltDebugOutputs, XsltOutputLocation } from '../../src/xsltDebug';

const stylesheet = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="/">
    <report>
      <made><xsl:value-of select="'by'"/></made>
      <literal>first line
second line</literal>
    </report>
  </xsl:template>
</xsl:stylesheet>`;

const output = `<report>
   <made>by</made>
   <literal>first line
second line</literal>
</report>`;

// the runs, as the adapter sends them: each part's offset and location id - a start tag's '>' is written with the next
// event's text
const parts: [string, number][] = [['<report>\n   ', 0], ['<made', 1], ['>by', 2], ['</made>\n   ', 1], ['<literal', 3], ['>first line\nsecond line', 4], ['</literal>\n', 3], ['</report>', 0]];
const runs: number[] = [];
let offset = 0;
parts.forEach(([text, id]) => {
	runs.push(offset, id);
	offset += text.length;
});

function locations(file: string, saxon12 = false): XsltOutputLocation[] {
	return [
		{ id: 0, path: file, line: 3, column: 5, kind: 'instruction' },
		{ id: 1, path: file, line: 4, column: 7, kind: 'instruction' },
		{ id: 2, path: file, line: 4, column: 13, kind: 'instruction' },
		{ id: 3, path: file, line: 5, column: 7, kind: 'instruction' },
		// where Saxon reports the literal text: after <literal> (12), or at </literal> (13)
		saxon12 ? { id: 4, path: file, line: 5, column: 16, kind: 'text' } : { id: 4, path: file, line: 6, column: 12, kind: 'text' }
	];
}

suite('XSLT debugger: from the output to its source', () => {
	const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-output-source-')), 'report.xsl');
	fs.writeFileSync(file, stylesheet);
	const byId = new Map(locations(file).map((l) => [l.id, l]));
	const idAt = (found: string, delta = 0) => XsltDebugOutputs.locationAt(output, runs, byId, output.indexOf(found) + delta)?.location.id;

	test('the run at an offset', () => {
		assert.strictEqual(idAt('<report'), 0);
		assert.strictEqual(idAt('<made'), 1);
		assert.strictEqual(idAt('by'), 2);
		assert.strictEqual(idAt('</made>'), 1);
		assert.strictEqual(idAt('second line'), 4);
	});

	test("a start tag's '>' is the tag's", () => {
		assert.strictEqual(idAt('<made>', 5), 1);
		assert.strictEqual(idAt('<literal>', 8), 3);
	});

	test('no location for a run without one', () => {
		assert.isUndefined(XsltDebugOutputs.locationAt(output, runs, new Map(), output.indexOf('by')));
	});

	// the line and character of the source position for the output text found, as sourceLocation gives it
	async function sourcePosition(found: string, saxon12 = false, delta = 1) {
		const name = `source-${saxon12 ? 12 : 13}.xml`;
		const outputs = XsltDebugOutputs.get();
		outputs.update({ outputs: [{ name, method: 'xml', offset: 0, text: output, runs, locations: locations(file, saxon12) }] });
		const location = await outputs.sourceLocationAt(name, output.indexOf(found) + delta);
		assert.isDefined(location, `a source location for ${found}`);
		assert.strictEqual(location!.uri.fsPath, vscode.Uri.file(file).fsPath);
		return `${location!.range.start.line + 1}:${location!.range.start.character + 1}`;
	}

	test('an instruction: its start tag', async () => {
		assert.strictEqual(await sourcePosition('<made'), '4:7');
		assert.strictEqual(await sourcePosition('by'), '4:13');
		assert.strictEqual(await sourcePosition('</report>'), '3:5');
	});

	test('literal text: the line of the text, where Saxon reports it at its end (13) or start (12)', async () => {
		for (const saxon12 of [false, true]) {
			assert.strictEqual(await sourcePosition('second line', saxon12), '6:1');
			assert.strictEqual(await sourcePosition('first line', saxon12), '5:16');
		}
	});

	test('a node copied from a source document: its start tag', () => {
		const source = '<items>\n  <item n="2">two</item>\n</items>';
		const reported = source.indexOf('two');
		const location: XsltOutputLocation = { id: 0, path: 'in.xml', line: 2, column: 15, kind: 'source' };
		assert.strictEqual(XsltDebugOutputs.sourceOffset(source, location, () => reported, '<item n="2"'), source.indexOf('<item '));
	});

	// go to definition (F12, or cmd/ctrl-click) in the output, in editor group 2: the stylesheet, where it's open in group 1,
	// is shown there at the instruction - not opened again in the output's group
	async function goToDefinition(openStylesheetFirst: boolean) {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		if (openStylesheetFirst) {
			await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(0, 0, 0, 0) });
		}
		const name = `definition-${openStylesheetFirst}.xml`;
		XsltDebugOutputs.get().update({ outputs: [{ name, method: 'xml', offset: 0, text: output, runs, locations: locations(file) }] });
		const outputEditor = await vscode.window.showTextDocument(XsltDebugOutputs.uri(name), { viewColumn: vscode.ViewColumn.Two, preview: false });
		const at = outputEditor.document.positionAt(output.indexOf('by') + 1);
		outputEditor.selection = new vscode.Selection(at, at);
		await vscode.commands.executeCommand('editor.action.revealDefinition');
		const isStylesheet = (uri?: vscode.Uri) => uri?.fsPath === vscode.Uri.file(file).fsPath;
		const tabsInOutputGroup = () => vscode.window.tabGroups.all.find((g) => g.viewColumn === vscode.ViewColumn.Two)?.tabs
			.filter((tab) => tab.input instanceof vscode.TabInputText && isStylesheet(tab.input.uri)).length;
		for (let i = 0; i < 60 && !(isStylesheet(vscode.window.activeTextEditor?.document.uri) && (!openStylesheetFirst || tabsInOutputGroup() === 0)); i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const editor = vscode.window.activeTextEditor!;
		assert.isTrue(isStylesheet(editor.document.uri), 'the stylesheet is shown');
		assert.strictEqual(`${editor.selection.start.line + 1}:${editor.selection.start.character + 1}`, '4:13');
		return { column: editor.viewColumn, tabsInOutputGroup: tabsInOutputGroup() };
	}

	test('go to definition: the stylesheet already open in another group is shown there', async () => {
		assert.deepEqual(await goToDefinition(true), { column: vscode.ViewColumn.One, tabsInOutputGroup: 0 });
	});

	test('go to definition: a stylesheet not open is opened as VS Code does, in the output\'s group', async () => {
		assert.deepEqual(await goToDefinition(false), { column: vscode.ViewColumn.Two, tabsInOutputGroup: 1 });
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('literal text not found: where Saxon reports it', () => {
		const source = '<x>abc</x>';
		const location: XsltOutputLocation = { id: 0, path: 'x.xsl', line: 1, column: 4, kind: 'text' };
		assert.strictEqual(XsltDebugOutputs.sourceOffset(source, location, () => 3, 'something else'), 3);
	});
});
