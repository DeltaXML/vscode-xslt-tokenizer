/**
 * Test suite for 'or', 'and', 'eq' and ',' in patterns. A pattern is a union of paths, so, as in Saxon 13 (XTSE0340), these are only
 * allowed within a predicate, the arguments of a function call or the parentheses of a type - not at the top level or
 * within other parentheses. The same applies in XSLT 3.0 and 4.0.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(body: string, version: string) {
	const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="${version}">
  <xsl:key name="k" match="a" use="."/>
  ${body}
</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(document.getText());
	const isVersion4 = version === '4.0';
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused')
		.map((d) => [d.message, document.getText(d.range)]);
}

const notAllowed = (operator: string) => [`XSLT: '${operator}' is not allowed in a pattern, except within a predicate or function call - for either of two patterns, use '|'`, operator];
const template = (match: string) => `<xsl:template match="${match}"/>`;

const cases: [string, string, string[][], string[]?][] = [
	['or', template('a or b'), [notAllowed('or')]],
	['a comma', template('a, b'), [notAllowed(',')]],
	['a comma within parentheses', template('(a, b)'), [notAllowed(',')]],
	['or within parentheses', template('x/(a or b)'), [notAllowed('or')]],
	['a union', template('a | b union c'), []],
	['or in a predicate', template('a[b or c]'), []],
	['a comma in a predicate', template('a[b, c]'), []],
	['a comma in a function call', template(`key('k', 'x')`), []],
	['a comma in a predicate within parentheses', template('(a[b, c] | d)'), []],
	['a comma in a predicate pattern', template('.[. = (1, 2)]'), []],
	['or in the match of an xsl:key', `<xsl:key name="k2" match="a or b" use="."/>`, [notAllowed('or')]],
	['a comma in the count of an xsl:number', `<xsl:template match="/"><xsl:number count="a, b"/></xsl:template>`, [notAllowed(',')]],
	['or in a group-starting-with', `<xsl:template match="/"><xsl:for-each-group select="*" group-starting-with="h1 or h2"><xsl:sequence select="."/></xsl:for-each-group></xsl:template>`, [notAllowed('or')]],
	['and', template('node-name() and node-name()'), [notAllowed('and')]],
	['eq', template('a eq b'), [notAllowed('eq')]],
	['and and eq in a predicate', template('a[b and c eq 1]'), []],
	['element names that are operator names', template('and/eq | x/and | @eq | child::or | and[eq]'), []],
	['an element name and the operator', template('eq and and'), [notAllowed('and')]],
	['a comma in a select', `<xsl:template match="/"><xsl:sequence select="a, b"/></xsl:template>`, []],
	['a comma in a type pattern', template('~record(x, y)'), [], ['4.0']],
	['a comma in an element type pattern', template('~element(a, xs:string)'), [], ['4.0']],
];

suite('Operators in patterns', () => {
	cases.forEach(([name, body, expected, versions]) => {
		(versions ?? ['3.0', '4.0']).forEach((version) => {
			test(`${name} (XSLT ${version})`, async () => {
				assert.deepEqual(await problems(body, version), expected);
			});
		});
	});
});
