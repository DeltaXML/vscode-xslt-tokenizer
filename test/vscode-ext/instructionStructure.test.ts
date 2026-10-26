/**
 * Test suite for static errors in the structure of XSLT instructions, which Saxon reports when it compiles: xsl:choose
 * without xsl:when or with xsl:otherwise before an xsl:when, xsl:sort after other content, duplicate xsl:with-param
 * names, select with content, and xsl:template without match
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(body: string) {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
<xsl:template name="t"><xsl:param name="a"/><xsl:param name="b"/><xsl:sequence select="$a, $b"/></xsl:template>
${body}
</xsl:stylesheet>`;
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => [d.message, document.getText(d.range)]);
}

const template = (content: string) => `<xsl:template match="/">${content}</xsl:template>`;
const chooseWithoutWhen = ['XSLT: xsl:choose must contain at least one xsl:when (XTSE0010)', 'xsl:choose'];
const otherwiseNotLast = ['XSLT: xsl:otherwise must come after every xsl:when of xsl:choose (XTSE0010)', 'xsl:otherwise'];
const sortNotFirst = (parent: string) => [`XSLT: xsl:sort must come before any other content of ${parent} (XTSE0010)`, 'xsl:sort'];
const duplicateWithParam = (name: string) => [`XSLT: Duplicate xsl:with-param name: '${name}' (XTSE0670)`, name];
const selectAndContent = (element: string) => [`XSLT: ${element} has a select attribute, so it must be empty (XTSE0620)`, element];

const cases: [string, string, string[][]][] = [
	['xsl:choose with xsl:when and xsl:otherwise', template(`<xsl:choose><xsl:when test="1">a</xsl:when><xsl:otherwise>b</xsl:otherwise></xsl:choose>`), []],
	['xsl:choose without xsl:when', template(`<xsl:choose><xsl:otherwise>b</xsl:otherwise></xsl:choose>`), [chooseWithoutWhen]],
	['empty xsl:choose', template(`<xsl:choose/>`), [chooseWithoutWhen]],
	['xsl:otherwise before xsl:when', template(`<xsl:choose><xsl:otherwise>b</xsl:otherwise><xsl:when test="1">a</xsl:when></xsl:choose>`), [otherwiseNotLast]],

	['xsl:sort first', template(`<xsl:for-each select="*"><xsl:sort select="@a"/><xsl:sort select="@b"/><xsl:value-of select="."/></xsl:for-each>`), []],
	['xsl:sort after an instruction', template(`<xsl:for-each select="*"><xsl:value-of select="."/><xsl:sort select="@a"/></xsl:for-each>`), [sortNotFirst('xsl:for-each')]],
	['xsl:sort after text', template(`<xsl:for-each-group select="*" group-by="@a">text<xsl:sort select="@a"/></xsl:for-each-group>`), [sortNotFirst('xsl:for-each-group')]],
	['xsl:sort and xsl:with-param in any order', template(`<xsl:apply-templates select="*"><xsl:with-param name="a" select="1"/><xsl:sort select="@a"/></xsl:apply-templates>`), []],
	['xsl:sort after a comment', template(`<xsl:perform-sort select="*"><!-- by name --><xsl:sort select="@name"/></xsl:perform-sort>`), []],

	['distinct xsl:with-param names', template(`<xsl:call-template name="t"><xsl:with-param name="a" select="1"/><xsl:with-param name="b" select="2"/></xsl:call-template>`), []],
	['duplicate xsl:with-param names', template(`<xsl:call-template name="t"><xsl:with-param name="a" select="1"/><xsl:with-param name="a" select="2"/></xsl:call-template>`), [duplicateWithParam('a')]],
	['xsl:with-param names excluded by use-when', template(`<xsl:call-template name="t"><xsl:with-param name="a" select="1" use-when="true()"/><xsl:with-param name="a" select="2" use-when="false()"/></xsl:call-template>`), []],

	['xsl:variable with select and content', template(`<xsl:variable name="v" select="1">2</xsl:variable><xsl:sequence select="$v"/>`), [selectAndContent('xsl:variable')]],
	['xsl:with-param with select and an instruction', template(`<xsl:call-template name="t"><xsl:with-param name="a" select="1"><xsl:sequence select="2"/></xsl:with-param></xsl:call-template>`), [selectAndContent('xsl:with-param')]],
	['xsl:variable with select and whitespace', template(`<xsl:variable name="v" select="1">  </xsl:variable><xsl:sequence select="$v"/>`), []],

	['xsl:template with neither name nor match', `<xsl:template><xsl:sequence select="1"/></xsl:template>`,
		[['XSLT: xsl:template must have a match or a name attribute (XTSE0500)', 'xsl:template']]],
	['named xsl:template with a mode', `<xsl:template name="n" mode="m"><xsl:sequence select="1"/></xsl:template>`,
		[['XSLT: xsl:template has a mode attribute, so it must have a match attribute (XTSE0500)', 'xsl:template']]],
];

suite('XSLT instruction structure', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});
});
