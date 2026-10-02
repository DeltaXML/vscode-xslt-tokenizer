/**
 * Test suite for predicates on literals: a predicate may follow any primary expression, including a string literal,
 * e.g. 'a'[$show] - but not other operators, such as '(' or '?', which are reported
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(body: string) {
	const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="/">
    <xsl:param name="p" select="1"/>
    ${body}
  </xsl:template>
</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	return XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, xslLexer.analyse(content), xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused')
		.map((d) => [d.message, document.getText(d.range)]);
}

suite('Predicates on literals', () => {
	const cases: [string, string, string[][]][] = [
		['a string literal', `<xsl:sequence select="'a'[$p gt 0]"/>`, []],
		['a double-quoted string literal', `<xsl:sequence select="&quot;a&quot;[$p]"/>`, []],
		['a string literal in an attribute value template', `<a b="x {'( ^ for moves )'[$p gt 0]}"/>`, []],
		['a numeric literal', `<xsl:sequence select="1[$p gt 0]"/>`, []],
		['a parenthesized expression', `<xsl:sequence select="('a', 'b')[$p]"/>`, []],
		['a bracket after a string literal', `<xsl:sequence select="'a'($p)"/>`, [['XPath: Expression context - unexpected token here: ( ', '(']]]
	];
	cases.forEach(([name, body, expected]) => {
		test(name, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});
});
