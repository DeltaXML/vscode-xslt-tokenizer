/**
 * Test suite for XPath keyword completions:
 * - after an operand, only keyword operators - e.g. 'cast as', 'instance of', 'union' - and 'return' or 'satisfies'
 *   where they apply, but not those of 3 characters or fewer, e.g. 'and' or 'eq', which are quicker to type
 * - at the start of an expression, snippets for the expressions with several parts, e.g. 'let $x := … return …'
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

async function completions(content: string, version = '3.0') {
	const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="${version}">
  <xsl:template match="/">
    ${content}
  </xsl:template>
</xsl:stylesheet>`;
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	return Array.isArray(result) ? result : result?.items ?? [];
}

const labels = async (content: string, version?: string) => (await completions(content, version)).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
const select = (expression: string) => `<xsl:sequence select="${expression}"/>`;
const operators = ['cast as', 'castable as', 'instance of', 'treat as', 'idiv', 'union', 'intersect', 'except'];
const snippets = ['for $x in … return …', 'let $x := … return …', 'some $x in … satisfies …', 'every $x in … satisfies …', 'if (…) then … else …', 'map { … }', 'array { … }'];

suite('XPath keyword completions', () => {
	test('after a number, only keyword operators', async () => {
		assert.sameMembers((await labels(select('1 ¦'))).map((l) => l.trim()), operators);
	});

	test('after a closing bracket, with a partly typed keyword', async () => {
		assert.sameMembers((await labels(select('array { 1 } ca¦'))).map((l) => l.trim()), operators);
	});

	test("in XPath 4.0, 'otherwise' too", async () => {
		assert.sameMembers((await labels(select('1 ¦'), '4.0')).map((l) => l.trim()), operators.concat('otherwise'));
	});

	test("after the bound expression of a 'for', 'return' too", async () => {
		assert.includeMembers((await labels(select('for $i in (1, 2) ¦'))).map((l) => l.trim()), ['return', 'cast as']);
	});

	test('at the start of an expression, the snippets and the functions', async () => {
		const items = await labels(select('(1, ¦'));
		assert.includeMembers(items, snippets.concat('count'));
		assert.notInclude(items, 'if (…) { … }');
	});

	test('a partly typed keyword at the start of the attribute value', async () => {
		const items = await completions(select('le¦'));
		const item = items.find((i) => i.label === 'let $x := … return …');
		assert.isDefined(item);
		assert.equal((item!.insertText as vscode.SnippetString).value, 'let $${1:x} := ${2} return ${0}');
		assert.equal(item!.filterText, 'let');
	});

	test("in XPath 4.0, the braced 'if' too", async () => {
		assert.include(await labels(select('(1, ¦'), '4.0'), 'if (…) { … }');
	});

	test('no keywords or snippets in a path step', async () => {
		const items = await labels(select('/¦'));
		assert.notInclude(items, 'let $x := … return …');
		assert.notInclude(items, 'cast as');
	});

	test('after the attribute value, the attribute names', async () => {
		const items = await labels(`<xsl:sequence select="1" ¦/>`);
		assert.notInclude(items, 'cast as');
	});

	test('after an attribute value template, no keyword operators', async () => {
		assert.notInclude(await labels(`<a href="{1} ¦"/>`), 'cast as');
	});

	test('after a text value template, no keyword operators', async () => {
		assert.notInclude(await labels(`<p xsl:expand-text="yes">{1} ¦</p>`), 'cast as');
	});

	test("after 'instance of', the types", async () => {
		assert.include(await labels(select('1 instance of ¦')), 'xs:integer');
	});

	['@id', '$m?a', 'count#1', 'true()', '()', '.'].forEach((operand) => {
		test(`after ${operand}, only keyword operators`, async () => {
			assert.sameMembers((await labels(select(`${operand} ¦`))).map((l) => l.trim()), operators);
		});
	});
});
