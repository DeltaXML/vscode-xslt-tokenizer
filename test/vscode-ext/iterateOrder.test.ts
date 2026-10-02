/**
 * Test suite for the order of the children of xsl:iterate: any xsl:param elements, then an optional xsl:on-completion,
 * then the other content - as reported by Saxon 13 (XTSE0010) - comments are ignored
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(content: string, version = '3.0') {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
  <xsl:template name="t"><xsl:iterate select="1 to 2">${content}</xsl:iterate></xsl:template>
</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const isVersion4 = version === '4.0';
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
}

const paramOrder = ['XSLT: xsl:param must come before any other content of xsl:iterate', 'xsl:param'];
const onCompletionOrder = ['XSLT: xsl:on-completion must come after any xsl:param and before any other content of xsl:iterate', 'xsl:on-completion'];
const param = `<xsl:param name="a" select="0"/>`;
const onCompletion = `<xsl:on-completion select="$a"/>`;
const sequence = `<xsl:sequence select="."/>`;

const cases: [string, string, string[][], string?][] = [
	['params, then xsl:on-completion, then other content', `${param}<xsl:param name="b" select="0"/>${onCompletion}${sequence}<xsl:next-iteration><xsl:with-param name="b" select="$b"/></xsl:next-iteration>`, []],
	['a comment first', `<!-- c -->${param}${onCompletion}${sequence}`, []],
	['whitespace between the children', `\n    ${param}\n    ${onCompletion}\n    ${sequence}\n  `, []],
	['xsl:param after xsl:on-completion', `<xsl:on-completion select="1"/>${param}`, [paramOrder]],
	['xsl:param after an instruction', `${sequence}${param}${onCompletion}`, [paramOrder, onCompletionOrder]],
	['xsl:param after text', `x${param}${onCompletion}`, [paramOrder, onCompletionOrder]],
	['xsl:on-completion after an instruction', `${param}${sequence}${onCompletion}`, [onCompletionOrder]],
	['a second xsl:on-completion', `${param}${onCompletion}${onCompletion}${sequence}`, [onCompletionOrder]],
	['an xsl:param in nested content is not a child', `${param}${onCompletion}<xsl:if test="true()"><xsl:sequence select="$a"/></xsl:if>`, []],
	['an instruction with use-when first, which may be excluded', `<xsl:message use-when="false()">m</xsl:message>${param}${onCompletion}${sequence}`, []],
	['XSLT 4.0', `${sequence}${param}${onCompletion}`, [paramOrder, onCompletionOrder], '4.0'],
];

suite('xsl:iterate: the order of xsl:param and xsl:on-completion', () => {
	cases.forEach(([label, content, expected, version]) => {
		test(label, async () => {
			assert.deepEqual(await problems(content, version), expected);
		});
	});
});

suite('xsl:iterate: xsl:next-iteration and xsl:break in a tail position', () => {
	const next = `<xsl:next-iteration><xsl:with-param name="a" select="$a + 1"/></xsl:next-iteration>`;
	const notLast = (name: string) => [`XSLT: ${name} must be the last instruction of xsl:iterate - or of an xsl:if, xsl:when, xsl:otherwise, xsl:try or xsl:catch in that position`, name];
	const body = (content: string) => `${param}${content}`;

	const tailCases: [string, string, string[][]][] = [
		['the last instruction', body(`${sequence}${next}`), []],
		['followed by a comment, whitespace and xsl:fallback', body(`${next}\n  <!-- c -->\n  <xsl:fallback/>`), []],
		['in xsl:choose branches', body(`<xsl:choose><xsl:when test="true()">${next}</xsl:when><xsl:otherwise><xsl:break/></xsl:otherwise></xsl:choose>`), []],
		['in xsl:try and xsl:catch', body(`<xsl:try>${next}<xsl:catch><xsl:break/></xsl:catch></xsl:try>`), []],
		['in xsl:if within xsl:choose', body(`<xsl:choose><xsl:when test="true()"><xsl:if test="true()">${next}</xsl:if></xsl:when></xsl:choose>`), []],
		['followed by an instruction', body(`${next}${sequence}`), [notLast('xsl:next-iteration')]],
		['followed by text', body(`${next} x`), [notLast('xsl:next-iteration')]],
		['in xsl:if followed by an instruction', body(`<xsl:if test="true()">${next}</xsl:if>${sequence}`), [notLast('xsl:next-iteration')]],
		['followed by an instruction within xsl:if', body(`<xsl:if test="true()">${next}${sequence}</xsl:if>`), [notLast('xsl:next-iteration')]],
		['xsl:break followed by an instruction', body(`<xsl:break/>${sequence}`), [notLast('xsl:break')]],
		['in xsl:variable', body(`<xsl:variable name="v">${next}</xsl:variable>`), [notLast('xsl:next-iteration'), ['variable is unused', '"v"']]],
		['in a nested xsl:iterate', body(`<xsl:iterate select="1"><xsl:break/></xsl:iterate>${next}`), []],
	];
	tailCases.forEach(([label, content, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(content), expected.filter((e) => e[0] !== 'variable is unused'));
		});
	});

	test('XSLT 4.0: in xsl:switch branches', async () => {
		assert.deepEqual(await problems(body(`<xsl:switch select="1"><xsl:when test="1">${next}</xsl:when><xsl:otherwise><xsl:break/></xsl:otherwise></xsl:switch>`), '4.0'), []);
	});
});
