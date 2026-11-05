/**
 * Test suite for a missing quote in an XPath string literal, e.g. 'A1 for 'A1' in map { 'id': 'A1, 'lines': 2 }: the
 * quotes after it are paired the wrong way, so the literal is followed directly by a name. It's reported once, at the
 * literal, with where the quote may be missing - not the problems after it in the expression, which it causes, or the
 * expression's brackets with no match. A literal that isn't terminated is reported without its expression's brackets
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function lint(body: string) {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  ${body}
  <xsl:template match="/"><xsl:sequence select="$m"/></xsl:template>
</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message} [${document.getText(d.range)}]`);
}

const missing = (literal: string, follower: string, after: string) =>
	`XPath: A quote may be missing - the string literal ${literal} is followed directly by '${follower}': e.g. a closing ' after ${after}. Other problems in the expression after it are reported once it's fixed`;

suite('Missing quotes in string literals', () => {
	test('a map entry\'s value', async () => {
		assert.deepEqual(await lint(`<xsl:variable name="m" select="map { 'id': 'A1, 'lines': 2, 'total': 3 }"/>`), [`2:46 ${missing('\'A1, \'', 'lines', '\'A1')} ['A1, ']`]);
	});

	test('a map entry\'s key', async () => {
		assert.deepEqual(await lint(`<xsl:variable name="m" select="map { 'id': 'A1', 'lines: 2, 'total': 3 }"/>`), [`2:52 ${missing('\'lines: 2, \'', 'total', '\'lines')} ['lines: 2, ']`]);
	});

	test('a function argument', async () => {
		assert.deepEqual(await lint(`<xsl:variable name="m" select="concat('a, 'b', 'c')"/>`), [`2:41 ${missing('\'a, \'', 'b', '\'a')} ['a, ']`]);
	});

	test('on more than one line: at the literal\'s first line', async () => {
		assert.deepEqual(await lint(`<xsl:variable name="m" as="map(*)">\n    <xsl:sequence select="map {\n      'id': 'A1,\n      'lines': 2,\n      'total': 3\n    }"/>\n  </xsl:variable>`),
			[`4:13 ${missing('\'A1, \'', 'lines', '\'A1')} ['A1,]`]);
	});

	test('the last literal, not terminated: without the brackets with no match', async () => {
		assert.deepEqual(await lint(`<xsl:variable name="m" select="map { 'id': 'A1', 'lines': 2, 'total: 3 }"/>`), [`2:64 String literal not terminated properly: 'total: 3 } ['total: 3 }]`]);
	});

	test('other expressions\' problems are still reported', async () => {
		const problems = (await lint(`<xsl:variable name="m" select="concat('a, 'b', 'c')"/>\n  <xsl:variable name="n" select="(1, 2"/>`)).filter((p) => !p.includes('is unused'));
		assert.lengthOf(problems, 2, problems.join('\n'));
		assert.isTrue(problems.some((p) => /^3:\d+ '\(' has no matching '\)'/.test(p)), problems.join('\n'));
		assert.isTrue(problems.some((p) => p.startsWith('2:41 XPath: A quote may be missing')), problems.join('\n'));
	});

	test('a literal followed by an operator is not a missing quote', async () => {
		assert.deepEqual(await lint(`<xsl:variable name="m" select="'a'eq'b', 'x'||'y', ('c')"/>`), []);
	});
});
