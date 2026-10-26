/**
 * Test suite for EQNames - Q{uri}local - as the names of variables, parameters, functions and templates, in XSLT
 * name attributes and in XPath variable references and bindings
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(body: string) {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
${body}
</xsl:stylesheet>`;
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const unresolved = (name: string) => [`XPath: The variable/parameter ${name} cannot be resolved`, name];

const cases: [string, string, string[][]][] = [
	['global parameter', `<xsl:param name="Q{}x" as="Q{http://www.w3.org/2001/XMLSchema}integer" select="1"/>
<xsl:template match="/"><xsl:sequence select="$Q{}x"/></xsl:template>`, []],
	['function and its parameter', `<xsl:function name="Q{urn:f}double" as="Q{http://www.w3.org/2001/XMLSchema}integer">
	<xsl:param name="Q{}n"/>
	<xsl:sequence select="$Q{}n * 2"/>
</xsl:function>
<xsl:template match="/"><xsl:sequence select="Q{urn:f}double(1)"/></xsl:template>`, []],
	['local variable', `<xsl:template match="/" name="Q{urn:f}main" mode="Q{urn:f}start">
	<xsl:variable name="Q{urn:v}y" select="1"/>
	<xsl:sequence select="$Q{urn:v}y"/>
</xsl:template>`, []],
	['XPath bindings', `<xsl:template match="/">
	<xsl:sequence select="for $Q{urn:my}deep in 1 return $Q{urn:my}deep, let $Q{}n := 2 return $Q{}n"/>
</xsl:template>`, []],
	['undeclared variable', `<xsl:template match="/"><xsl:sequence select="$Q{urn:my}missing"/></xsl:template>`,
		[unresolved('$Q{urn:my}missing')]],
	['a different namespace URI', `<xsl:template match="/">
	<xsl:variable name="Q{urn:a}v" select="1"/>
	<xsl:sequence select="$Q{urn:a}v, $Q{urn:b}v"/>
</xsl:template>`, [unresolved('$Q{urn:b}v')]],
	['a stylesheet function called with the wrong arity', `<xsl:function name="Q{urn:f}one"><xsl:sequence select="1"/></xsl:function>
<xsl:template match="/"><xsl:sequence select="Q{urn:f}one(2)"/></xsl:template>`,
		[[`XPath: Function: 'Q{urn:f}one' with 1 arguments not found`, 'one']]],
	['EQName types after a global parameter', `<xsl:param name="Q{}x" as="Q{http://www.w3.org/2001/XMLSchema}integer" select="1"/>
<xsl:function name="Q{urn:f}double" as="Q{http://www.w3.org/2001/XMLSchema}integer">
	<xsl:param name="Q{}n"/>
	<xsl:sequence select="$Q{}n * 2"/>
</xsl:function>
<xsl:template match="/"><xsl:sequence select="$Q{}x, Q{urn:f}double(1)"/></xsl:template>`, []],
	['a built-in function', `<xsl:template match="/"><xsl:sequence select="Q{http://www.w3.org/2005/xpath-functions}count(.)"/></xsl:template>`, []],
	['the name of xsl:element is still an AVT', `<xsl:template match="/"><xsl:element name="{$undeclared}"/></xsl:template>`,
		[unresolved('$undeclared')]],
];

suite('EQNames', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});
});
