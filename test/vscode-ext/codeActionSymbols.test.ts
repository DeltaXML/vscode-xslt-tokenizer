/**
 * Test suite for the code actions for a selection, e.g. extracting an xsl:variable from an XPath expression: they use
 * the symbols of the document they're requested for - not those of the active editor's document, which may be another
 * one - and without its symbols, e.g. before they're computed, there are no such actions, and no error. The
 * selected expression is checked for errors on its own, e.g. a map constructor, which isn't an instruction's value.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';

const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="/">
    <xsl:variable name="a" select="1"/>
    <xsl:sequence select="count($a) + 1"/>
    <xsl:sequence select="map { 'a': 1, 'b': 2 }"/>
  </xsl:template>
</xsl:stylesheet>`;

// the titles of the code actions for the XPath expression selected, in the select attribute of an xsl:sequence
function titles(document: vscode.TextDocument, expression = 'count($a) + 1') {
	const start = content.indexOf(expression);
	const range = new vscode.Range(document.positionAt(start), document.positionAt(start + expression.length));
	return (new XSLTCodeActions().provideCodeActions(document, range, { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? []).map((a) => a.title);
}

suite('Code actions for a selection: document symbols', () => {
	let errors: string[] = [];
	const consoleError = console.error;
	setup(() => {
		errors = [];
		console.error = (...args: unknown[]) => errors.push(args.join(' '));
	});
	teardown(() => {
		console.error = consoleError;
	});

	test('the symbols of the document, when another document is in the active editor', async () => {
		const other = await vscode.workspace.openTextDocument({ content: '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>', language: 'xslt' });
		await vscode.window.showTextDocument(other);
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		await new XsltSymbolProvider(XSLTConfiguration.configuration, null).getDocumentSymbols(document, false);
		assert.notEqual(vscode.window.activeTextEditor?.document, document);
		assert.include(titles(document), 'xsl:variable');
		assert.deepEqual(errors, []);
	});

	test('a map constructor', async () => {
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		await vscode.window.showTextDocument(document);
		await new XsltSymbolProvider(XSLTConfiguration.configuration, null).getDocumentSymbols(document, false);
		assert.include(titles(document, "map { 'a': 1, 'b': 2 }"), 'xsl:variable');
		assert.deepEqual(errors, []);
	});

	test('no error without the document symbols', async () => {
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		assert.notInclude(titles(document), 'xsl:variable');
		assert.deepEqual(errors, []);
	});
});
