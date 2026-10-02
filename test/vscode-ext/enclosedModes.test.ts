/**
 * Test suite for XSLT 4.0 enclosed modes: template rules as children of xsl:mode
 *
 * As with Saxon 13: the xsl:mode must have a name (XTSE4005), and each enclosed xsl:template must have a match
 * attribute and no mode or name attribute (XTSE4010)
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(version: string, body: string) {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
	${body}
</xsl:stylesheet>`;
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const is40 = version === '4.0';
	const config = { ...XSLTConfiguration.configuration, isVersion4: is40 };
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(config, is40 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const modeName = 'XSLT: An xsl:mode with enclosed xsl:template elements must have a name attribute';
const notAllowed = (attName: string) => `XSLT: A template rule enclosed within xsl:mode must not have a '${attName}' attribute`;
const needsMatch = 'XSLT: A template rule enclosed within xsl:mode must have a match attribute';

const cases: [string, string, string[][]][] = [
	['template rules with params, variables and #current', `<xsl:mode name="m" on-no-match="shallow-copy">
		<xsl:template match="b" priority="2">
			<xsl:param name="p" select="1"/>
			<xsl:variable name="v" select="$p + 1"/>
			<xsl:copy><xsl:sequence select="$v"/><xsl:apply-templates mode="#current"/></xsl:copy>
		</xsl:template>
		<xsl:template match="c"><xsl:next-match/></xsl:template>
	</xsl:mode>
	<xsl:template name="t"><xsl:apply-templates select="$g" mode="m"/></xsl:template>
	<xsl:variable name="g" select="1"/>`, []],
	['unnamed mode', `<xsl:mode><xsl:template match="b"/><xsl:template match="c"/></xsl:mode>`, [[modeName, 'xsl:mode']]],
	['mode attribute', `<xsl:mode name="m"><xsl:template match="b" mode="m"/></xsl:mode>`, [[notAllowed('mode'), 'xsl:template']]],
	['name attribute', `<xsl:mode name="m"><xsl:template match="b" name="n"/></xsl:mode>`, [[notAllowed('name'), 'xsl:template']]],
	['no match attribute', `<xsl:mode name="m"><xsl:template/></xsl:mode>`, [[needsMatch, 'xsl:template']]],
	['other instructions', `<xsl:mode name="m"><xsl:variable name="v"/></xsl:mode>`, [['variable is unused', '"v"'], ['XSLT: instruction: xsl:variable not valid in this context', 'xsl:variable']]],
	['top-level templates are unaffected', `<xsl:mode name="m"/><xsl:template match="b" mode="m" name="n"/>`, []],
];

suite('XSLT 4.0 enclosed modes', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems('4.0', body), expected);
		});
	});

	test('enclosed template rules are not valid in XSLT 3.0', async () => {
		assert.deepEqual(await problems('3.0', `<xsl:mode name="m"><xsl:template match="b"/></xsl:mode>`), [['XSLT: instruction: xsl:template not valid in this context', 'xsl:template']]);
	});
});
