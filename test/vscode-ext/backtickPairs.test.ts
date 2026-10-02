/**
 * Test suite for the backtick in the language configurations of XSLT and XPath: typed, it's closed - as a single quote
 * is - for an XPath 4.0 string template, e.g. `Hello {$name}`, or a Markdown code span in a documentation note - and
 * typing the closing backtick types over it. It's not closed before a word, and a selection typed over is enclosed.
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';

// the text after typing each of the strings at the cursor, with the cursor marked
async function typed(language: string, marked: string, ...texts: string[]) {
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language });
	const editor = await vscode.window.showTextDocument(document);
	const position = document.positionAt(marked.indexOf('¦'));
	editor.selection = new vscode.Selection(position, position);
	for (const text of texts) {
		await vscode.commands.executeCommand('type', { text });
	}
	const offset = document.offsetAt(editor.selection.active);
	const result = document.getText();
	await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	return result.substring(0, offset) + '¦' + result.substring(offset);
}

const stylesheet = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">\n  ${body}\n</xsl:stylesheet>`;

suite('Backtick pairs', () => {
	test('XSLT: a string template in an XPath expression', async () => {
		assert.equal(await typed('xslt', stylesheet('<xsl:sequence select="¦"/>'), '`'), stylesheet('<xsl:sequence select="`¦`"/>'));
		assert.equal(await typed('xslt', stylesheet('<xsl:sequence select="¦"/>'), '`', 'Hi {', '$n', '}', '`'), stylesheet('<xsl:sequence select="`Hi {$n}`¦"/>'));
	});

	test('XSLT: a code span in a documentation note', async () => {
		// at the end of a line - before '<', e.g. of </xsl:note>, no pair is closed (see autoCloseBefore)
		const note = (text: string) => stylesheet(`<xsl:note format="xdoc-md">\n    Uses ${text}\n  </xsl:note>`);
		assert.equal(await typed('xslt', note('¦'), '`'), note('`¦`'));
		assert.equal(await typed('xslt', note('¦'), '`', 'cx:area#2', '`'), note('`cx:area#2`¦'));
	});

	test('XSLT: not closed before a word', async () => {
		assert.equal(await typed('xslt', stylesheet('<xsl:note format="xdoc-md">Uses ¦cx:area</xsl:note>'), '`'), stylesheet('<xsl:note format="xdoc-md">Uses `¦cx:area</xsl:note>'));
	});

	test('XPath: closed, and typed over', async () => {
		assert.equal(await typed('xpath', '¦', '`'), '`¦`');
		assert.equal(await typed('xpath', '¦', '`', 'a', '`'), '`a`¦');
	});

	test('XSLT: a selection is enclosed', async () => {
		const document = await vscode.workspace.openTextDocument({ content: stylesheet('<xsl:note format="xdoc-md">Uses cx:area</xsl:note>'), language: 'xslt' });
		const editor = await vscode.window.showTextDocument(document);
		const start = document.getText().indexOf('cx:area');
		editor.selection = new vscode.Selection(document.positionAt(start), document.positionAt(start + 'cx:area'.length));
		await vscode.commands.executeCommand('type', { text: '`' });
		const text = document.getText();
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		assert.include(text, 'Uses `cx:area`</xsl:note>');
	});
});
