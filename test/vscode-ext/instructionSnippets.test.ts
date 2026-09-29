/**
 * Test suite for the snippets offered by XSLT instruction (element name) completions, after '<'
 *
 * The cursor position is marked by '|' in each stylesheet body.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

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

	test('xsl:sequence has a select attribute but no as attribute', async () => {
		const result = await snippets('4.0', '<xsl:template name="t"><|</xsl:template>');
		assert.equal(result.get('xsl:sequence'), 'xsl:sequence select="$1"/>$0');
	});

	test('xsl:select is offered within an element without a select attribute, with no as attribute', async () => {
		const result = await snippets('4.0', '<xsl:template name="t"><xsl:variable name="v"><|</xsl:variable></xsl:template>');
		assert.equal(result.get('xsl:select'), 'xsl:select>$1</xsl:select>$0');
	});

	test('xsl:select is not offered within an element with a select attribute', async () => {
		assert.isFalse((await snippets('4.0', '<xsl:template name="t"><xsl:variable name="v" select="1"><|</xsl:variable></xsl:template>')).has('xsl:select'));
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
	const noteSnippet = 'xsl:note>$1</xsl:note>$0';
	const docNoteSnippet = 'xsl:note format="xdoc-md">\n\t$0\n</xsl:note>';
	// a documentation note is offered only where it's used, and where there isn't one yet - a note is offered anywhere
	const notePlaces: [string, string, boolean][] = [
		['xsl:item-type', '<xsl:item-type name="t" as="xs:string"><|</xsl:item-type>', true],
		['the top level, for the module note', '<|', true],
		['xsl:function', '<xsl:function name="f:f" xmlns:f="f"><|</xsl:function>', true],
		['a named xsl:template', '<xsl:template name="t"><|</xsl:template>', true],
		['a global xsl:param', '<xsl:param name="p"><|</xsl:param>', true],
		['a global xsl:variable', '<xsl:variable name="v"><|</xsl:variable>', true],
		['a template rule', '<xsl:template match="/"><|</xsl:template>', false],
		['a local xsl:variable', '<xsl:template name="t"><xsl:variable name="v"><|</xsl:variable></xsl:template>', false],
		['xsl:value-of, which is otherwise empty', '<xsl:template name="t"><xsl:value-of select="1"><|</xsl:value-of></xsl:template>', false],
		['a literal result element', '<xsl:template name="t"><out><|</out></xsl:template>', false],
		['an xsl:function that has a documentation note', '<xsl:function name="f:f" xmlns:f="f"><xsl:note format="xdoc-md">x</xsl:note><|</xsl:function>', false],
	];
	notePlaces.forEach(([label, body, isDocumented]) => {
		test(`xsl:note ${isDocumented ? 'and xsl:note xdoc-md are' : 'but not xsl:note xdoc-md is'} offered within ${label}`, async () => {
			const result = await snippets('4.0', body);
			assert.equal(result.get('xsl:note'), noteSnippet);
			assert.equal(result.get('xsl:note xdoc-md'), isDocumented ? docNoteSnippet : undefined);
		});
	});

	test('xsl:note xdoc-md is preselected, and before xsl:note, where it is offered', async () => {
		const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">\n  <xsl:function name="f:f" xmlns:f="f"><|</xsl:function>\n</xsl:stylesheet>`;
		const offset = marked.indexOf('|');
		const document = await vscode.workspace.openTextDocument({ content: marked.replace('|', ''), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: '<' });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		const docItem = items.find((item) => item.label === 'xsl:note xdoc-md')!;
		const noteItem = items.find((item) => item.label === 'xsl:note')!;
		assert.isTrue(docItem.preselect);
		assert.isTrue((docItem.sortText ?? '') < (noteItem.sortText ?? ''));
	});

	test('the attributes of an xsl:note: format', async () => {
		const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">\n  <xsl:function name="f:f" xmlns:f="f"><xsl:note |>x</xsl:note></xsl:function>\n</xsl:stylesheet>`;
		const offset = marked.indexOf('|');
		const document = await vscode.workspace.openTextDocument({ content: marked.replace('|', ''), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		assert.include(items.map((item) => typeof item.label === 'string' ? item.label : item.label.label), 'format');
	});

	test('the format of an xsl:note: xdoc-md', async () => {
		const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">\n  <xsl:function name="f:f" xmlns:f="f"><xsl:note format="|"/></xsl:function>\n</xsl:stylesheet>`;
		const offset = marked.indexOf('|');
		const document = await vscode.workspace.openTextDocument({ content: marked.replace('|', ''), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		assert.include(items.map((item) => typeof item.label === 'string' ? item.label : item.label.label), 'xdoc-md');
	});

	test('the format of an xsl:note: another format is not reported', async () => {
		const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">\n  <xsl:function name="f:f" xmlns:f="f"><xsl:note format="other">x</xsl:note><xsl:sequence select="1"/></xsl:function>\n</xsl:stylesheet>`;
		const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
		const lexer = new XslLexer(XSLTConfiguration.configuration);
		lexer.provideCharLevelState = true;
		const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, lexer.analyse(xslt), lexer.globalInstructionData, [], []);
		assert.deepEqual(diagnostics.map((d) => d.message), []);
	});

	test('XSLT 3.0: xsl:note and xsl:note xdoc-md are offered excluded with use-when', async () => {
		const result = await snippets('3.0', '<xsl:function name="f:f" xmlns:f="f"><|</xsl:function>');
		assert.equal(result.get('xsl:note'), 'xsl:note use-when="false()">$1</xsl:note>$0');
		assert.equal(result.get('xsl:note xdoc-md'), 'xsl:note use-when="false()" format="xdoc-md">\n\t$0\n</xsl:note>');
	});

	test('xsl:note is not offered within an xsl:note', async () => {
		const result = await snippets('4.0', '<xsl:template name="t"><xsl:note><|</xsl:note></xsl:template>');
		assert.isFalse(result.has('xsl:note'));
	});
});
