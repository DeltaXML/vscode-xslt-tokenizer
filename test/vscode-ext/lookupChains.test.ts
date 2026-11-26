/**
 * Test suite for chained lookups: a lookup after one with an integer key, e.g. $data?1?courses for JSON - an array of
 * maps - and, in XPath 4.0, after one with a string literal key, e.g. $m?'a b'?c. Each was reported as an unexpected
 * '?' (found with the W3C XSLT test suite: record-013, analyze-string-408). A '?' after a literal that isn't a lookup key
 * is still reported.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(select: string, version = '3.0') {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
	<xsl:template name="t"><xsl:param name="data"/><xsl:sequence select="${select}"/></xsl:template>
</xsl:stylesheet>`;
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const docType = xslLexer.isXSLT40 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT;
	return XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, docType, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).map((d) => d.message);
}

suite('Chained lookups', () => {
	test('after an integer key: $data?1?courses, with whitespace, and more steps', async () => {
		assert.deepEqual(await problems('$data?1?courses, $data?1 ?courses, $data?1?courses?2?name, $data?(1)?courses, $data?*?courses'), []);
	});

	test('after a string literal key, in XPath 4.0', async () => {
		assert.deepEqual(await problems(`$data?'a b'?c`, '4.0'), []);
	});

	test('a lookup after a literal that is not a key is still reported', async () => {
		assert.deepEqual(await problems('1?a'), ["XPath: Expression context - unexpected token here: ? "]);
	});
});
