/**
 * Test suite for XPath 4.0 named item types declared with xsl:item-type
 *
 * Each stylesheet is linted as a whole, with the global instruction data from the lexer (as for the symbol provider),
 * so that references to xsl:item-type names can be resolved. The expected result is the list of
 * [message, token text] pairs for the diagnostics found.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const itemTypeDeclarations = `<xsl:item-type name="complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>`;

function stylesheet(version: string, body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.complex" version="${version}">
	${version === '4.0' ? itemTypeDeclarations : ''}
	${body}
</xsl:stylesheet>`;
}

const cases: [string, string, [string, string][]][] = [
	['4.0', `<xsl:variable name="a" as="complex" select="map { 'r': 1.0, 'i': 2.0 }"/>`, []],
	['4.0', `<xsl:variable name="a" as="complex*" select="()"/>`, []],
	['4.0', `<xsl:variable name="a" as="(complex | xs:string)?" select="()"/>`, []],
	['4.0', `<xsl:variable name="a" as="cx:complex" select="map { 'r': 1.0, 'i': 2.0 }"/>`, []],
	['4.0', `<xsl:variable name="a" select="map { 'r': 1.0, 'i': 2.0 } instance of complex"/>`, []],
	['4.0', `<xsl:variable name="a" as="undeclared" select="()"/>`, [["XPath: Invalid type: 'undeclared'", 'undeclared']]],
	// prefixed names must also be declared with xsl:item-type in XSLT 4.0:
	['4.0', `<xsl:variable name="a" as="cx:complx" select="()"/>`, [["XPath: The item type 'cx:complx' is not declared - expected an xsl:item-type declaration with this name", 'cx:complx']]],
	['4.0', `<xsl:variable name="a" as="(cx:complex | cx:point)*" select="()"/>`, [["XPath: The item type 'cx:point' is not declared - expected an xsl:item-type declaration with this name", 'cx:point']]],
	['4.0', `<xsl:variable name="a" select="map { 'r': 1.0 } instance of cx:point"/>`, [["XPath: The item type 'cx:point' is not declared - expected an xsl:item-type declaration with this name", 'cx:point']]],
	['4.0', `<xsl:variable name="a" as="element(*, cx:schemaType)" select="()"/>`, []],
	['4.0', `<xsl:variable name="a" as="xs:string" select="()"/>`, []],
	// before XSLT 4.0 a prefixed type can only be an imported schema type, so it's not checked:
	['3.0', `<xsl:variable name="a" as="cx:schemaType" select="()"/>`, []],
];

suite('Named item types: xsl:item-type', () => {
	cases.forEach(([version, body, expected]) => {
		test(`${version}: ${body}`, async () => {
			const xslt = stylesheet(version, body);
			const xslLexer = new XslLexer(XSLTConfiguration.configuration);
			xslLexer.provideCharLevelState = true;
			const allTokens = xslLexer.analyse(xslt);
			const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'text' });
			const languageConfig = { ...XSLTConfiguration.configuration, isVersion4: xslLexer.isXSLT40 };
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(languageConfig, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
			// the test variables are never referenced
			const problems = diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
			assert.deepEqual(problems, expected);
		});
	});
});
