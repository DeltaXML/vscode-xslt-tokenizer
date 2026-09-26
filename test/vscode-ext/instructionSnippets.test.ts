/**
 * Test suite for the snippets offered by XSLT instruction (element name) completions, after '<'
 *
 * The cursor position is marked by '|' in each stylesheet body.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

async function snippets(version: string, body: string) {
	const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
	${body}
</xsl:stylesheet>`;
	const offset = marked.indexOf('|');
	const text = marked.substring(0, offset) + marked.substring(offset + 1);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: '<' });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	const snippetMap = new Map<string, string>();
	items.forEach((item) => {
		const label = typeof item.label === 'string' ? item.label : item.label.label;
		const insertText = item.insertText instanceof vscode.SnippetString ? item.insertText.value : item.insertText;
		snippetMap.set(label, insertText ?? '');
	});
	return snippetMap;
}

suite('Instruction snippets', () => {
	test('xsl:key has name, match and use attributes', async () => {
		const result = await snippets('3.0', '<|');
		assert.equal(result.get('xsl:key'), 'xsl:key name="${1:name}" match="${2:pattern}" use="${3:xpath}"/>$0');
	});

	test('xsl:switch has a select attribute and an xsl:when', async () => {
		const result = await snippets('4.0', '<xsl:template name="t"><|</xsl:template>');
		assert.equal(result.get('xsl:switch'), 'xsl:switch select="${1:$expr}">\n\t<xsl:when test="\'$2\'">\n\t\t$3\n\t</xsl:when>\n</xsl:switch>');
	});

	test('xsl:template within xsl:mode has only a match attribute', async () => {
		const result = await snippets('4.0', '<xsl:mode name="m"><|</xsl:mode>');
		assert.equal(result.get('xsl:template match'), 'xsl:template match="$1">\n\t$0\n</xsl:template>');
		assert.isFalse(result.has('xsl:template name'));
	});

	test('xsl:map-entry has key before select', async () => {
		const result = await snippets('4.0', '<xsl:template name="t"><xsl:map><|</xsl:map></xsl:template>');
		assert.equal(result.get('xsl:map-entry'), 'xsl:map-entry key="$1" select="$2"/>$0');
	});

	test('xsl:map has no select attribute', async () => {
		const result = await snippets('4.0', '<xsl:template name="t"><|</xsl:template>');
		assert.equal(result.get('xsl:map'), 'xsl:map>\n\t$0\n</xsl:map>');
	});

	test('xsl:array with select, or with xsl:array-member children', async () => {
		const result = await snippets('4.0', '<xsl:template name="t"><|</xsl:template>');
		assert.equal(result.get('xsl:array select'), 'xsl:array select="${1:$expr}"/>$0');
		assert.equal(result.get('xsl:array members'), 'xsl:array>\n\t<xsl:array-member select="${1:$expr}"/>$0\n</xsl:array>');
	});
});
