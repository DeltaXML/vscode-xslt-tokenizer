/**
 * Test suite for the links in the hover of a built-in function to its definition in the specification for the
 * version: the W3C recommendations for XPath 3.1 and XSLT 3.0, or the drafts for 4.0.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';

async function hoverText(expression: string, name: string, isVersion4 = false) {
	const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:math="http://www.w3.org/2005/xpath-functions/math" version="${isVersion4 ? '4.0' : '3.0'}">
  <xsl:template match="/"><xsl:sequence select="${expression}"/></xsl:template>
</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
	const offset = content.indexOf(name, content.indexOf('select=')) + 1;
	const hover = await new XSLTHoverProvider(undefined, { ...XSLTConfiguration.configuration, isVersion4 }).provideHover(document, document.positionAt(offset), new vscode.CancellationTokenSource().token);
	return hover?.contents.map((c) => (c as vscode.MarkdownString).value).join('') ?? '';
}

const link = (title: string, url: string) => `[${title} specification](${url})`;
const fn31 = 'https://www.w3.org/TR/xpath-functions-31/';
const fn40 = 'https://qt4cg.org/specifications/xpath-functions-40/Overview.html';

suite('Function hover specification links', () => {
	const cases: [string, string, string, boolean][] = [
		['upper-case(.)', 'upper-case', link('XPath Functions 3.1', `${fn31}#func-upper-case`), false],
		['fn:upper-case(.)', 'upper-case', link('XPath Functions 3.1', `${fn31}#func-upper-case`), false],
		['math:pi()', 'math:pi', link('XPath Functions 3.1', `${fn31}#func-math-pi`), false],
		['current-group()', 'current-group', link('XSLT 3.0', 'https://www.w3.org/TR/xslt-30/#func-current-group'), false],
		['upper-case(.)', 'upper-case', link('XPath Functions 4.0', `${fn40}#func-upper-case`), true],
		['current-group()', 'current-group', link('XSLT 4.0', 'https://qt4cg.org/specifications/xslt-40/Overview.html#func-current-group'), true],
		['current()', 'current', link('XPath Functions 4.0', `${fn40}#func-current`), true]
	];
	cases.forEach(([expression, name, expected, isVersion4]) => {
		test(`${expression} in ${isVersion4 ? '4.0' : '3.0'}`, async () => {
			assert.include(await hoverText(expression, name, isVersion4), expected);
		});
	});

	test('no link for a function in neither 4.0 specification', async () => {
		const text = await hoverText('function-identity(.)', 'function-identity', true);
		assert.isNotEmpty(text);
		assert.notInclude(text, 'specification](');
	});
});
