/**
 * Test suite for the checks made on a start tag's attribute names once the tag ends: unknown attributes on XSLT
 * instructions, undeclared attribute prefixes, and the 'tunnel' attribute on an xsl:with-param for a named template
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(xslt: string) {
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
	${body}
</xsl:stylesheet>`;
}

const cases: [string, string, string[][]][] = [
	['valid attributes', stylesheet(`<xsl:template name="t"><out a="1"><xsl:sequence select="1"/></out></xsl:template>`), []],
	['unknown attribute on an XSLT instruction', stylesheet(`<xsl:template name="t"><xsl:sequence foo="1" select="1"/></xsl:template>`),
		[[`XSLT: Invalid attribute on element 'xsl:sequence': 'foo'`, 'xsl:sequence']]],
	// 'new-value' was a draft XSLT 3.0 name for 'select' (Saxon 13: XTSE0090)
	['draft XSLT 3.0 attribute name', stylesheet(`<xsl:mode use-accumulators="a"/><xsl:accumulator name="a" initial-value="0"><xsl:accumulator-rule match="b" new-value="$value + 1"/></xsl:accumulator>`),
		[[`XSLT: Invalid attribute on element 'xsl:accumulator-rule': 'new-value'`, 'xsl:accumulator-rule']]],
	['undeclared attribute prefix', stylesheet(`<xsl:template name="t"><out a:b="1"/></xsl:template>`),
		[[`XML: Invalid prefix for attribute on element 'out': 'a:b'`, 'out']]],
	['root element without the XSLT namespace is reported once', `<output xsl:expand-text="yes">x</output>`,
		[[`Expected on the root element: xmlns:xsl='http://www.w3.org/1999/XSL/Transform' prefix/namespace-uri binding`, 'output']]],
	['tunnel parameter not declared by the template', stylesheet(`<xsl:template name="t"><xsl:call-template name="u"><xsl:with-param name="p" select="1" tunnel="yes"/></xsl:call-template></xsl:template>
	<xsl:template name="u"/>`), []],
	['parameter not declared by the template', stylesheet(`<xsl:template name="t"><xsl:call-template name="u"><xsl:with-param name="p" select="1"/></xsl:call-template></xsl:template>
	<xsl:template name="u"/>`), [[`XSLT: xsl:param 'p' is not declared for template 'u'`, '"p"']]],
];

suite('Attribute names on start tags', () => {
	cases.forEach(([label, xslt, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(xslt), expected);
		});
	});
});
