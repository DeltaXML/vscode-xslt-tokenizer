/**
 * Test suite for completions of XSLT 4.0 named item types, declared with xsl:item-type: in an 'as' attribute and after
 * 'instance of' or 'treat as' - and after 'cast as' or 'castable as' only the item types that may be atomic
 *
 * The cursor position is marked by '¦' in each stylesheet body ('|' is used in a choice item type).
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="person" as="record(name as xs:string)"/>
	<xsl:item-type name="colour" as="enum('red', 'green')"/>
	<xsl:item-type name="numbers" as="(xs:integer | xs:double)"/>`;

async function typeItems(body: string, version = '4.0') {
	const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="${version}">
	${declarations}
	${body}
</xsl:stylesheet>`;
	const offset = marked.indexOf('¦');
	const text = marked.substring(0, offset) + marked.substring(offset + 1);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === vscode.CompletionItemKind.TypeParameter);
}

async function typeLabels(body: string, version = '4.0') {
	return (await typeItems(body, version)).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

async function snippetFor(body: string, label: string) {
	const item = (await typeItems(body)).find((i) => i.label === label);
	return (item?.insertText as vscode.SnippetString | undefined)?.value;
}

const allItemTypes = ['cx:complex', 'person', 'colour', 'numbers'];

suite('Named item types: completions', () => {
	test('an empty as attribute', async () => {
		const labels = await typeLabels(`<xsl:variable name="v" as="¦" select="()"/>`);
		assert.includeMembers(labels, allItemTypes.concat(['xs:string']));
	});

	test('a partly typed type name in an as attribute', async () => {
		assert.includeMembers(await typeLabels(`<xsl:variable name="v" as="pe¦" select="()"/>`), allItemTypes);
	});

	test('instance of', async () => {
		assert.includeMembers(await typeLabels(`<xsl:variable name="v" select="1 instance of ¦"/>`), allItemTypes);
	});

	test('treat as', async () => {
		assert.includeMembers(await typeLabels(`<xsl:variable name="v" select="1 treat as ¦"/>`), allItemTypes);
	});

	['castable as', 'cast as'].forEach((operator) => {
		test(`${operator}: only item types that may be atomic`, async () => {
			const labels = await typeLabels(`<xsl:variable name="v" select="'red' ${operator} ¦"/>`);
			assert.includeMembers(labels, ['colour', 'numbers', 'xs:string']);
			assert.notInclude(labels, 'person');
			assert.notInclude(labels, 'cx:complex');
		});
	});

	test('record() and enum() snippets in an as attribute', async () => {
		const body = `<xsl:variable name="v" as="¦" select="()"/>`;
		assert.equal(await snippetFor(body, 'record()'), 'record(${1:field1} as ${2:xs:string}, ${3:field2} as ${4:xs:string})');
		assert.equal(await snippetFor(body, 'enum()'), `enum('\${1:value1}', '\${2:value2}')`);
	});

	test('an enum() snippet after instance of, in an attribute in apostrophes', async () => {
		assert.equal(await snippetFor(`<xsl:variable name="v" select='1 instance of ¦'/>`, 'enum()'), `enum("\${1:value1}", "\${2:value2}")`);
	});

	test('enum() but not record() after castable as', async () => {
		const labels = await typeLabels(`<xsl:variable name="v" select="'a' castable as ¦"/>`);
		assert.include(labels, 'enum()');
		assert.notInclude(labels, 'record()');
	});

	test('no record() or enum() in XSLT 3.0', async () => {
		const labels = await typeLabels(`<xsl:variable name="v" as="¦" select="()"/>`, '3.0');
		assert.notInclude(labels, 'record()');
		assert.notInclude(labels, 'enum()');
	});

	test('no item types in XSLT 3.0', async () => {
		const labels = await typeLabels(`<xsl:variable name="v" as="¦" select="()"/>`, '3.0');
		assert.include(labels, 'xs:string');
		allItemTypes.forEach((name) => assert.notInclude(labels, name));
	});
});
