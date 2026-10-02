/**
 * Test suite for duplicate literal keys in maps. As in Saxon 13, a duplicate key in a map constructor is a static error
 * XQDY0137, and in the xsl:map-entry children of an xsl:map, a dynamic error XTDE3365. Keys are the same for 'a' and "a",
 * and for 1 and 1.0, but not for 1 and '1'. Keys that aren't literals, e.g. $k, can't be checked.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

function stylesheet(body: string, version: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="${version}">
  <xsl:template match="/">
    <xsl:param name="k" select="'a'"/>
    ${body}
  </xsl:template>
</xsl:stylesheet>`;
}

async function problems(body: string, version = '4.0') {
	const document = await vscode.workspace.openTextDocument({ content: stylesheet(body, version), language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(document.getText());
	const isVersion4 = version === '4.0';
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused')
		.map((d) => [d.message, document.getText(d.range), vscode.DiagnosticSeverity[d.severity]]);
}

const key = (text: string) => [`XPath: Duplicate key in the map constructor: ${text}`, text, 'Error'];
const entryKey = (text: string) => [`XSLT: Duplicate key in the xsl:map - an xsl:map-entry has the same key: ${text}`, text, 'Error'];
const select = (expression: string) => `<xsl:sequence select="${expression}"/>`;
const entries = (...keys: string[]) => `<xsl:map>${keys.map((k) => `<xsl:map-entry key="${k}" select="1"/>`).join('')}</xsl:map>`;

const lintCases: [string, string, string[][]][] = [
	['distinct keys', select(`map { 'a': 1, 'b': 2 }`), []],
	['a duplicate key', select(`map { 'a': 1, 'b': 2, 'a': 3 }`), [key(`'a'`)]],
	['a duplicate key in a bare map constructor', select(`{ 'a': 1, 'a': 2 }`), [key(`'a'`)]],
	['a duplicate key with other quotes', select(`map { 'a': 1, &quot;a&quot;: 2 }`), [key('&quot;a&quot;')]],
	['a duplicate numeric key', select(`map { 1: 'x', 1.0: 'y' }`), [key('1.0')]],
	['a numeric key and a string key', select(`map { 1: 'x', '1': 'y' }`), []],
	['a variable key', select(`map { $k: 1, 'a': 2 }`), []],
	['the same key in a nested map', select(`map { 'a': map { 'a': 1 }, 'b': { 'a': 2 } }`), []],
	['a duplicate key in a nested map', select(`map { 'a': map { 'b': 1, 'b': 2 } }`), [key(`'b'`)]],
	['a map entry value with braces', select(`{ 'a': fn($x) { $x }, 'b': if ($k) { 1 }, 'a': 2 }`), [key(`'a'`)]],
	['distinct xsl:map-entry keys', entries(`'a'`, `'b'`), []],
	['a duplicate xsl:map-entry key', entries(`'a'`, `'b'`, `'a'`), [entryKey(`'a'`)]],
	['a duplicate numeric xsl:map-entry key', entries('1', '1.0'), [entryKey('1.0')]],
	['a variable xsl:map-entry key', entries('$k', `'a'`), []],
	['a conditional xsl:map-entry', `<xsl:map><xsl:map-entry key="'a'" select="1"/><xsl:if test="$k"><xsl:map-entry key="'a'" select="2"/></xsl:if></xsl:map>`, []],
];

suite('Duplicate map keys', () => {
	lintCases.forEach(([name, body, expected]) => {
		test(`linter: ${name}`, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});

	test('linter: a duplicate key in XSLT 3.0', async () => {
		assert.deepEqual(await problems(select(`map { 'a': 1, 'a': 2 }`), '3.0'), [key(`'a'`)]);
	});
});
