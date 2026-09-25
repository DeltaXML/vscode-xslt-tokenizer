/**
 * Test suite for completions within XPath string literals: only key and accumulator names are completed there.
 *
 * The cursor position is marked by '|' in each stylesheet body.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
	<xsl:key name="book-key" match="book" use="@id"/>
	<xsl:variable name="v" select="1"/>
	<xsl:template name="t">${body}</xsl:template>
</xsl:stylesheet>`;
}

async function completionLabels(body: string) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('|');
	const text = marked.substring(0, offset) + marked.substring(offset + 1);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

suite('Completions within string literals', () => {
	const noCompletions: [string, string][] = [
		['within a string', `<xsl:sequence select="'ab|c'"/>`],
		['after a slash in a string', `<xsl:sequence select="'a/|'"/>`],
		['after a $ in a string', `<xsl:sequence select="concat('$|', 1)"/>`],
		['before the closing quote', `<xsl:sequence select="'abc|'"/>`],
		['after the opening quote', `<xsl:sequence select="'|abc'"/>`],
		['within an entity-quoted string', `<xsl:sequence select="&quot;ab|c&quot;"/>`],
		['within an unclosed string', `<xsl:sequence select="'ab|"/>`],
	];
	noCompletions.forEach(([label, body]) => {
		test(label, async () => {
			assert.deepEqual(await completionLabels(body), []);
		});
	});

	test('key names within the first argument of key()', async () => {
		assert.include(await completionLabels(`<xsl:sequence select="key('|', 'x')"/>`), "'book-key'");
	});

	test('XPath completions still offered outside a string', async () => {
		assert.include(await completionLabels(`<xsl:sequence select="'abc', |"/>`), '$v');
	});
});
