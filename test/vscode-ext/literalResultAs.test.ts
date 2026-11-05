/**
 * Test suite for an 'as' attribute on a literal result element - e.g. <axsl:item-type as="{$type}"/>, written with
 * xsl:namespace-alias by a stylesheet that generates XSLT. It's an attribute value template, not a sequence type as on
 * an XSLT instruction, so the expressions within it are checked as XPath.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:axsl="http://example.com/alias" version="4.0">
	<xsl:namespace-alias stylesheet-prefix="axsl" result-prefix="xsl"/>
	<xsl:variable name="type" select="'xs:string'"/>
	<xsl:template name="t">
		${body}
	</xsl:template>
</xsl:stylesheet>`;
}

const cases: [string, string, string[]][] = [
	['an aliased XSLT element', `<axsl:item-type name="t" as="{replace($type, '\\?$', '')}"/>`, []],
	['a literal result element', `<result as="{$type || '?'}"/>`, []],
	['an unknown variable in the AVT', `<axsl:variable name="v" as="{$typo}"/>`, ['XPath: The variable/parameter $typo cannot be resolved']],
	['an XSLT instruction: still a sequence type', `<xsl:variable name="v" as="xs:string" select="$type"/>`, []],
];

suite('Literal result elements: an "as" attribute is an AVT', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			const xslt = stylesheet(body);
			const xslLexer = new XslLexer(XSLTConfiguration.configuration);
			xslLexer.provideCharLevelState = true;
			const allTokens = xslLexer.analyse(xslt);
			const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
			const languageConfig = { ...XSLTConfiguration.configuration, isVersion4: xslLexer.isXSLT40 };
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(languageConfig, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
			const problems = diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => d.message);
			assert.deepEqual(problems, expected);
		});
	});
});
