/**
 * Test suite for completions of xsl:map-entry within an xsl:map whose result has an XPath 4.0 record type: the element
 * completions after '<' include an xsl:map-entry for each field that isn't yet an entry, and the key attribute of an
 * xsl:map-entry lists those fields as string literals
 *
 * The cursor position is marked by '|' in each stylesheet body.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string))"/>`;

async function completions(body: string) {
	const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	${body}
</xsl:stylesheet>`;
	const offset = marked.indexOf('|');
	const text = marked.substring(0, offset) + marked.substring(offset + 1);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === vscode.CompletionItemKind.Field).sort((a, b) => a.sortText!.localeCompare(b.sortText!));
}

const labels = async (body: string) => (await completions(body)).map((item) => item.label as string);
const variableMap = (content: string, as = 'cx:complex') => `<xsl:template name="t"><xsl:variable name="v" as="${as}"><xsl:map>${content}</xsl:map></xsl:variable><xsl:sequence select="$v"/></xsl:template>`;

const elementCases: [string, string, string[]][] = [
	['an empty xsl:map in an xsl:variable', variableMap('<|'), ['xsl:map-entry \'r\'', 'xsl:map-entry \'i\'']],
	['a partly typed element name', variableMap('<xsl:ma|'), ['xsl:map-entry \'r\'', 'xsl:map-entry \'i\'']],
	['entries before and after the cursor', variableMap(`<xsl:map-entry key="'r'" select="1"/><|<xsl:map-entry key="'x'" select="1"/>`, 'person'), ['xsl:map-entry \'name\'', 'xsl:map-entry \'address\'', 'xsl:map-entry \'age\'']],
	['an entry after the cursor', variableMap(`<|<xsl:map-entry key='"i"' select="1"/>`), ['xsl:map-entry \'r\'']],
	['a nested record field', variableMap(`<xsl:map-entry key="'address'"><xsl:map><xsl:map-entry key="'city'" select="'x'"/><|</xsl:map></xsl:map-entry>`, 'person'), ['xsl:map-entry \'zip\'']],
	['an xsl:function result within xsl:choose', `<xsl:function name="cx:new" as="cx:complex"><xsl:choose><xsl:when test="true()"><xsl:map><|</xsl:map></xsl:when></xsl:choose></xsl:function>`, ['xsl:map-entry \'r\'', 'xsl:map-entry \'i\'']],
	['not a record type', variableMap('<|', 'map(*)'), []],
	['an xsl:map within an xsl:sequence', `<xsl:template name="t"><xsl:variable name="v" as="cx:complex"><xsl:sequence><xsl:map><|</xsl:map></xsl:sequence></xsl:variable></xsl:template>`, ['xsl:map-entry \'r\'', 'xsl:map-entry \'i\'']],
	['an xsl:map within another instruction', `<xsl:template name="t"><xsl:variable name="v" as="cx:complex"><xsl:for-each select="1"><xsl:map><|</xsl:map></xsl:for-each></xsl:variable></xsl:template>`, []],
	['within an xsl:map-entry', variableMap(`<xsl:map-entry key="'r'"><|</xsl:map-entry>`), []],
];

const keyCases: [string, string, string[]][] = [
	['an empty key', variableMap(`<xsl:map-entry key="|"/>`), ['\'r\'', '\'i\'']],
	['a partly typed string literal', variableMap(`<xsl:map-entry key="'|"/>`), ['\'r\'', '\'i\'']],
	['a key in apostrophes', variableMap(`<xsl:map-entry key='|'/>`), ['"r"', '"i"']],
	['other entries', variableMap(`<xsl:map-entry key="'r'" select="1"/><xsl:map-entry key="|"/>`), ['\'i\'']],
	['the current entry is not excluded', variableMap(`<xsl:map-entry key="'r|'" select="1"/>`), ['\'r\'', '\'i\'']],
];

suite('Record types: xsl:map-entry completions', () => {
	elementCases.forEach(([label, body, expected]) => {
		test(`element: ${label}`, async () => {
			assert.deepEqual(await labels(body), expected);
		});
	});
	keyCases.forEach(([label, body, expected]) => {
		test(`key: ${label}`, async () => {
			assert.deepEqual(await labels(body), expected);
		});
	});

	test('the xsl:map-entry snippets', async () => {
		const items = await completions(variableMap(`<xsl:map-entry key="'name'" select="'a'"/><|`, 'person'));
		const snippets = items.map((item) => (item.insertText as vscode.SnippetString).value);
		assert.deepEqual(snippets, [
			`xsl:map-entry key="'address'">\n\t<xsl:map>\n\t\t$0\n\t</xsl:map>\n</xsl:map-entry>`,
			`xsl:map-entry key="'age'" select="$1"/>$0`
		]);
	});

	test('the other element completions are still offered', async () => {
		const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	${variableMap('<|')}
</xsl:stylesheet>`;
		const offset = marked.indexOf('|');
		const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: '<' });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		assert.isTrue(items.some((item) => item.kind !== vscode.CompletionItemKind.Field), 'other element completions');
	});
});

suite('Record types: xsl:map completions', () => {
	async function snippets(body: string) {
		const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	${body}
</xsl:stylesheet>`;
		const offset = marked.indexOf('|');
		const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		return items.filter((item) => item.kind === vscode.CompletionItemKind.Snippet && (item.label as string).startsWith('xsl:map ')).map((item) => [item.label as string, (item.insertText as vscode.SnippetString).value]);
	}

	test('an xsl:variable with a record type', async () => {
		assert.deepEqual(await snippets(`<xsl:template name="t"><xsl:variable name="v" as="cx:complex"><|</xsl:variable></xsl:template>`), [
			['xsl:map cx:complex: required fields', `xsl:map>\n\t<xsl:map-entry key="'r'" select="\${1:__TODO.r}"/>\n\t<xsl:map-entry key="'i'" select="\${2:__TODO.i}"/>\n</xsl:map>$0`]
		]);
	});

	test('required fields and all fields, with a nested xsl:map for a record field', async () => {
		const result = await snippets(`<xsl:template name="t"><xsl:variable name="v" as="person"><|</xsl:variable></xsl:template>`);
		assert.deepEqual(result.map(([label]) => label), ['xsl:map person: required fields', 'xsl:map person: all fields']);
		assert.equal(result[0][1], [
			`xsl:map>`,
			`\t<xsl:map-entry key="'name'" select="\${1:__TODO.name}"/>`,
			`\t<xsl:map-entry key="'address'">`,
			`\t\t<xsl:map>`,
			`\t\t\t<xsl:map-entry key="'city'" select="\${2:__TODO.city}"/>`,
			`\t\t</xsl:map>`,
			`\t</xsl:map-entry>`,
			`</xsl:map>$0`].join('\n'));
	});

	test('an xsl:function result within xsl:if', async () => {
		const result = await snippets(`<xsl:function name="cx:new" as="cx:complex"><xsl:if test="true()"><|</xsl:if></xsl:function>`);
		assert.deepEqual(result.map(([label]) => label), ['xsl:map cx:complex: required fields']);
	});

	test('an xsl:map-entry for a record field', async () => {
		const result = await snippets(variableMap(`<xsl:map-entry key="'address'"><|</xsl:map-entry>`, 'person'));
		assert.deepEqual(result.map(([label]) => label), ['xsl:map record(city as xs:string, zip? as xs:string): required fields', 'xsl:map record(city as xs:string, zip? as xs:string): all fields']);
	});

	test('not a record type', async () => {
		assert.deepEqual(await snippets(`<xsl:template name="t"><xsl:variable name="v" as="map(*)"><|</xsl:variable></xsl:template>`), []);
	});

	test('within an xsl:map', async () => {
		assert.deepEqual(await snippets(variableMap('<|')), []);
	});
});
