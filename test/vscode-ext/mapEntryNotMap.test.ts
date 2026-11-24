/**
 * Test suite for map constructor entries without ':'. In XPath 4.0 (and in Saxon 13 with syntax extensions) such an
 * entry is a map to merge, e.g. map { $m1, $m2 } - so one that's only a string or number literal is a type error,
 * XPTY0004 in Saxon: usually a ',' typed for ':', as in map { 'a', 'one' }. Other entries, e.g. $m, can't be checked.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="4.0">
  <xsl:template match="/">
    <xsl:param name="m" select="map { 'k': 1 }"/>
    ${body}
  </xsl:template>
</xsl:stylesheet>`;
}

async function problems(body: string) {
	const document = await vscode.workspace.openTextDocument({ content: stylesheet(body), language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(document.getText());
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused')
		.map((d) => [d.message, document.getText(d.range), vscode.DiagnosticSeverity[d.severity]]);
}

const notMap = (text: string) => [`XPath: Expected ':' after the map key ${text} - a map constructor entry without ':' must be a map, to merge`, text, 'Error'];
const select = (expression: string) => `<xsl:sequence select="${expression}"/>`;

const lintCases: [string, string, string[][]][] = [
	['a comma for a colon', select(`map { 'a', 'one' }`), [notMap(`'a'`), notMap(`'one'`)]],
	['a comma for a colon in a bare map constructor', select(`{ 'a', 1 }`), [notMap(`'a'`), notMap('1')]],
	['a literal entry after a key and value', select(`map { 'a': 1, 'b' }`), [notMap(`'b'`)]],
	['a literal entry after a comment', select(`map { 'a': 1, (: next :) 'b' }`), [notMap(`'b'`)]],
	['keys and values', select(`map { 'a': 1, 'b': 'x' }`), []],
	['maps to merge', select(`map { $m, map { 'j': 2 } }`), []],
	['a value that is a sequence', select(`map { 'a': ('x', 'y'), 'b': [1, 2] }`), []],
	['an empty map', select(`map { }`), []],
	['a function body', select(`fn($x) { 'a', 'b' }`), []],
	['a braced if', select(`if ($m?k) { 'a', 'b' }`), []],
	// XSLT 4.0 type patterns, as in the W3C tests record-010, next-match-420 and array-024
	['a record test in a pattern', `<xsl:apply-templates select="$m"/></xsl:template><xsl:template match="{'id', 'name'}"><xsl:next-match/>`, []],
	['a map test in a pattern', `</xsl:template><xsl:template match="map{'red', 'green'}"><xsl:next-match/>`, []],
	['a record test in an array pattern', `</xsl:template><xsl:template match="array({'first', 'last'})"><xsl:next-match/>`, []],
	['a map constructor in a predicate of a pattern', `</xsl:template><xsl:template match="item[. = map { 'a': 1 }?a]"><xsl:next-match/>`, []],
];

suite('Map constructor entries without a colon', () => {
	lintCases.forEach(([name, body, expected]) => {
		test(`linter: ${name}`, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});
});
