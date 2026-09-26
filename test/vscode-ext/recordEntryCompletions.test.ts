/**
 * Test suite for completions of the next entry in an XPath 4.0 map constructor with a record type: after '{' or ','
 * the fields of the record that aren't yet entries (before or after the cursor) are listed - for the select of an
 * element declared with a record type, a nested record field, or an xsl:sequence that is an xsl:function's result
 *
 * The cursor position is marked by '|' in each stylesheet body.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string))"/>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	${body}
</xsl:stylesheet>`;
}

async function completions(body: string, isCommaTrigger = false) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('|');
	const text = marked.substring(0, offset) + marked.substring(offset + 1);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	if (isCommaTrigger) {
		(DocumentChangeHandler as unknown as { commaTriggerPending: boolean }).commaTriggerPending = true;
	}
	const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	return Array.isArray(result) ? result : result?.items ?? [];
}

async function entryLabels(body: string, isCommaTrigger = false) {
	const items = await completions(body, isCommaTrigger);
	return items.filter((item) => item.kind === vscode.CompletionItemKind.Field).sort((a, b) => a.sortText!.localeCompare(b.sortText!)).map((item) => item.label as string);
}

const variable = (select: string, as = 'cx:complex') => `<xsl:template name="t"><xsl:variable name="v" as="${as}" select="${select}"/><xsl:sequence select="$v"/></xsl:template>`;

const cases: [string, string, string[]][] = [
	['after the opening brace', variable('{|}'), ['\'r\'', '\'i\'']],
	['after the map keyword and opening brace', variable('map {|}'), ['\'r\'', '\'i\'']],
	['after a comma', variable(`{ 'r': 1,| }`), ['\'i\'']],
	['after a comma and a space', variable(`{ 'r': 1, | }`), ['\'i\'']],
	['an entry after the cursor', variable(`{ | 'i': 2 }`), ['\'r\'']],
	['required fields first', variable('{|}', 'person'), ['\'name\'', '\'address\'', '\'age\'']],
	['a nested record field', variable(`{ 'name': 'a', 'address': { 'city': 'x',| } }`, 'person'), ['\'zip\'']],
	['an xsl:param', `<xsl:template name="t"><xsl:param name="p" as="cx:complex" select="{|}"/><xsl:sequence select="$p"/></xsl:template>`, ['\'r\'', '\'i\'']],
	['an xsl:function result within xsl:if', `<xsl:function name="cx:new" as="cx:complex"><xsl:param name="a"/><xsl:if test="$a"><xsl:sequence select="{ 'i': 0,| }"/></xsl:if></xsl:function>`, ['\'r\'']],
	['an xsl:sequence that is not a function result', `<xsl:function name="cx:new" as="cx:complex"><xsl:variable name="v"><xsl:sequence select="{|}"/></xsl:variable><xsl:sequence select="$v"/></xsl:function>`, []],
	['not a record type', variable('{|}', 'map(*)'), []],
	['a map constructor that is not the whole expression', variable('({|})'), []],
	['a map constructor that is a function argument', variable(`map:merge({|})`), []],
	['after a colon', variable(`{ 'r':| }`), []],
	['all fields present', variable(`{ 'r': 1, 'i': 2,| }`), []],
];

suite('Record types: completions of map constructor entries', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await entryLabels(body), expected);
		});
	});

	test('the inserted text has a leading space after a comma', async () => {
		const items = await completions(variable(`{ 'r': 1,| }`));
		assert.equal((items[0].insertText as vscode.SnippetString).value, ` 'i': $0`);
	});

	test('no leading space after a comma and a space', async () => {
		const items = await completions(variable(`{ 'r': 1, | }`));
		assert.equal((items[0].insertText as vscode.SnippetString).value, `'i': $0`);
	});

	test('typing a comma outside a record map constructor gives no completions', async () => {
		assert.deepEqual(await completions(`<xsl:template name="t"><xsl:sequence select="concat('a',|)"/></xsl:template>`, true), []);
	});

	test('typing a comma in a record map constructor gives its entries', async () => {
		assert.deepEqual(await entryLabels(variable(`{ 'r': 1,| }`), true), ['\'i\'']);
	});
});

suite('Record types: completion of a whole map constructor', () => {
	async function wholeMaps(body: string) {
		const items = await completions(body);
		return items.filter((item) => item.kind === vscode.CompletionItemKind.Snippet).map((item) => [item.label as string, (item.insertText as vscode.SnippetString).value]);
	}

	test('an empty map constructor: the record fields, with placeholder values', async () => {
		assert.deepEqual(await wholeMaps(variable('{|}')), [
			['cx:complex: required fields', ` 'r': \${1:__TODO.r}, 'i': \${2:__TODO.i} `]
		]);
	});

	test('required fields and all fields, with a nested map constructor for a record field', async () => {
		assert.deepEqual(await wholeMaps(variable('map {|}', 'person')), [
			['person: required fields', ` 'name': \${1:__TODO.name}, 'address': { 'city': \${2:__TODO.city} } `],
			['person: all fields', ` 'name': \${1:__TODO.name}, 'age': \${2:__TODO.age}, 'address': { 'city': \${3:__TODO.city}, 'zip': \${4:__TODO.zip} } `]
		]);
	});

	test('not offered when the map constructor has entries', async () => {
		assert.deepEqual(await wholeMaps(variable(`{| 'i': 1 }`)), []);
	});

	[['an xsl:variable', variable(`{ 'r': __TODO.r, 'i': 1 }`)],
		['an xsl:function, with no context item', `<xsl:function name="cx:new" as="cx:complex"><xsl:sequence select="{ 'r': __TODO.r, 'i': 1 }"/></xsl:function>`]].forEach(([label, body]) => {
		test(`a placeholder has a warning: ${label}`, async () => {
			const xslt = stylesheet(body);
			const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
			const xslLexer = new XslLexer(XSLTConfiguration.configuration);
			xslLexer.provideCharLevelState = true;
			const allTokens = xslLexer.analyse(xslt);
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
			assert.deepEqual(diagnostics.map((d) => [d.message, document.getText(d.range), d.severity]), [
				[`XPath: Placeholder '__TODO.r' - replace it with a value for 'r'`, '__TODO.r', vscode.DiagnosticSeverity.Warning]
			]);
		});
	});
});
