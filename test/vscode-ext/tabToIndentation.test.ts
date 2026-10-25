/**
 * Test suite for Tab in XSLT and XML editors: on an empty or whitespace-only line - e.g. one clicked on, with the cursor at
 * its start - the line is indented for its context, as after Enter, with the cursor at its end. Otherwise it's VS Code's
 * Tab: on a line with text, on a line indented that far already, and where whitespace is kept as it is (xsl:text, a CDATA
 * section, a comment). The cursor position is marked by '|'.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { assert } from 'chai';

const head = '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">';

// presses Tab (the command its keybinding runs) at the '|', returning the cursor's line and its column afterwards
async function tab(lines: string[], language = 'xslt', tabSize = 2) {
	await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	const line = lines.findIndex((l) => l.includes('|'));
	const character = lines[line].indexOf('|');
	const content = lines.map((l) => l.replace('|', '')).join('\n');
	const document = await vscode.workspace.openTextDocument({ content, language });
	const editor = await vscode.window.showTextDocument(document);
	editor.options = { tabSize, insertSpaces: true };
	editor.selection = new vscode.Selection(line, character, line, character);
	await vscode.commands.executeCommand('xslt-xpath.tabToIndentation');
	const cursor = editor.selection.active;
	const result = { line: JSON.stringify(document.lineAt(line).text), cursor: cursor.character };
	await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	return result;
}

suite('Tab: an empty line indented for its context', () => {
	const cases: [string, string[], string, number][] = [
		['an empty line in a template', [head, '  <xsl:template match="/">', '|', '  </xsl:template>', '</xsl:stylesheet>'], '"    "', 4],
		['an empty line in a literal result element', [head, '  <xsl:template match="/">', '    <out>', '      <a/>', '|', '    </out>', '  </xsl:template>', '</xsl:stylesheet>'], '"      "', 6],
		['a line indented too little', [head, '  <xsl:template match="/">', '  |', '  </xsl:template>', '</xsl:stylesheet>'], '"    "', 4],
		['the cursor at the start of a line indented too little', [head, '  <xsl:template match="/">', '| ', '  </xsl:template>', '</xsl:stylesheet>'], '"    "', 4],
		// VS Code's Tab
		['a line indented that far already: Tab', [head, '  <xsl:template match="/">', '    |', '  </xsl:template>', '</xsl:stylesheet>'], '"      "', 6],
		['a line with text: Tab', [head, '  <xsl:template match="/">', '    |<a/>', '  </xsl:template>', '</xsl:stylesheet>'], '"      <a/>"', 6],
		['within xsl:text: Tab', [head, '  <xsl:template match="/">', '    <xsl:text>a', '|', '</xsl:text>', '  </xsl:template>', '</xsl:stylesheet>'], '"  "', 2],
		['within a CDATA section: Tab', [head, '  <xsl:template match="/">', '    <out><![CDATA[a', '|', ']]></out>', '  </xsl:template>', '</xsl:stylesheet>'], '"  "', 2],
		['within a comment: Tab', [head, '  <xsl:template match="/">', '    <!-- a', '|', '    -->', '  </xsl:template>', '</xsl:stylesheet>'], '"  "', 2],
	];
	cases.forEach(([label, lines, expected, cursor]) => {
		test(label, async () => {
			assert.deepEqual(await tab(lines), { line: expected, cursor });
		});
	});

	test('XML: an empty line in an element', async () => {
		assert.deepEqual(await tab(['<items>', '    <item n="1">', '        <name/>', '|', '    </item>', '</items>'], 'xml', 4), { line: '"        "', cursor: 8 });
	});

	test('one undo step', async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		const document = await vscode.workspace.openTextDocument({ content: [head, '  <xsl:template match="/">', '', '  </xsl:template>', '</xsl:stylesheet>'].join('\n'), language: 'xslt' });
		const editor = await vscode.window.showTextDocument(document);
		editor.options = { tabSize: 2, insertSpaces: true };
		editor.selection = new vscode.Selection(2, 0, 2, 0);
		await vscode.commands.executeCommand('xslt-xpath.tabToIndentation');
		assert.strictEqual(document.lineAt(2).text, '    ');
		await vscode.commands.executeCommand('undo');
		assert.strictEqual(document.lineAt(2).text, '');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	// the keybinding: Tab, except when it accepts a suggestion, moves within a snippet or between controls, and so on
	test('the keybinding', () => {
		const contributes = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')).contributes;
		const binding = contributes.keybindings.find((k: { command: string }) => k.command === 'xslt-xpath.tabToIndentation');
		assert.strictEqual(binding?.key, 'tab');
		['!suggestWidgetVisible', '!inSnippetMode', '!inlineSuggestionVisible', '!editorHasSelection', '!editorTabMovesFocus', '!editorReadonly', 'editorLangId =~ /^(xslt|xml|bpmn)$/']
			.forEach((condition) => assert.include(binding.when, condition));
	});
});
