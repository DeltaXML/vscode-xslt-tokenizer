/**
 * Test suite for EQNames - Q{uri}local - as the names of variables, parameters, functions and templates, in XSLT
 * name attributes and in XPath variable references and bindings
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XslLexerLight } from '../../src/xslLexerLight';

const stylesheet = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
${body}
</xsl:stylesheet>`;

// the problems in a stylesheet with the body - and the globals of an imported module with the body, as XslLexerLight
// reads them for globalsProvider
async function problems(body: string, importedBody?: string) {
	const xslt = stylesheet(body);
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const imported = importedBody ? new XslLexerLight(XSLTConfiguration.configuration).analyseLight(stylesheet(importedBody)) : [];
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, imported, []);
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
	// a URI with '/' - the name was cut at the last '/', as a package name is, e.g. to 'xspec}main' (an XSpec compiled stylesheet)
	['a template and its parameter, with a URI with \'/\'', `<xsl:template name="Q{http://example.com/ns}main">
	<xsl:param name="Q{http://example.com/ns}p"/>
	<xsl:sequence select="$Q{http://example.com/ns}p"/>
</xsl:template>
<xsl:template match="/"><xsl:call-template name="Q{http://example.com/ns}main"><xsl:with-param name="Q{http://example.com/ns}p" select="1"/></xsl:call-template></xsl:template>`, []],
	['a template not declared, with a URI with \'/\'', `<xsl:template match="/"><xsl:call-template name="Q{http://example.com/ns}missing"/></xsl:template>`,
		[[`XSLT: xsl:template with name 'Q{http://example.com/ns}missing' not found`, '"Q{http://example.com/ns}missing"']]],
	['a function with a URI with \'/\'', `<xsl:function name="Q{http://example.com/f}double"><xsl:param name="n"/><xsl:sequence select="$n * 2"/></xsl:function>
<xsl:template match="/"><xsl:sequence select="Q{http://example.com/f}double(1)"/></xsl:template>`, []],
];

suite('EQNames', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});

	test('globals of an imported module', async () => {
		const imported = `<xsl:param name="Q{}x" select="1"/>
<xsl:variable name="Q{urn:v}y" select="2"/>
<xsl:function name="Q{urn:f}double"><xsl:param name="n"/><xsl:sequence select="$n * 2"/></xsl:function>`;
		const result = await problems(`<xsl:template match="/"><xsl:sequence select="$Q{}x, $Q{urn:v}y, Q{urn:f}double(1)"/></xsl:template>`, imported);
		assert.deepEqual(result, []);
	});

	test('go to definition and find references: a template with a URI with \'/\'', async () => {
		const xslt = stylesheet(`<xsl:template name="Q{http://example.com/ns}main"/>
<xsl:template match="/"><xsl:call-template name="Q{http://example.com/ns}main"/></xsl:template>`);
		const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
		const call = document.positionAt(xslt.indexOf('call-template name="Q{') + 'call-template name="Q{http://ex'.length);
		const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, call);
		const range = (d: vscode.Location | vscode.LocationLink) => 'targetRange' in d ? d.targetRange : d.range;
		assert.lengthOf(definitions, 1);
		assert.equal(range(definitions[0]).start.line, 1);
		const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, call);
		assert.deepEqual(references.map((r) => r.range.start.line).sort(), [1, 2]);
	});
});
