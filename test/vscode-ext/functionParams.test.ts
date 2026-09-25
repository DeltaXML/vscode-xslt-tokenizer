/**
 * Test suite for XSLT 4.0 optional function parameters and XPath 4.0 keyword arguments in calls to user-defined functions
 *
 * Each stylesheet is linted as a whole, with the global instruction data from the lexer (as for the symbol provider),
 * so that calls can be checked against the xsl:function declarations. The expected result is the list of
 * [message, token text] pairs for the diagnostics found.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

// f:add has one required and one optional parameter
const addFunction = `<xsl:function name="f:add" as="xs:integer">
		<xsl:param name="a" as="xs:integer"/>
		<xsl:param name="b" as="xs:integer" required="no" select="10"/>
		<xsl:sequence select="$a + $b"/>
	</xsl:function>`;

function stylesheet(version: string, body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="com.example.f" version="${version}">
	${body}
</xsl:stylesheet>`;
}

function call(select: string) {
	return `${addFunction}
	<xsl:template name="t"><xsl:sequence select="${select}"/></xsl:template>`;
}

const cases: [string, string, string, [string, string][]][] = [
	// calls to a function with an optional parameter:
	['optional param omitted', '4.0', call('f:add(1)'), []],
	['optional param supplied', '4.0', call('f:add(1, 2)'), []],
	['too many arguments', '4.0', call('f:add(1, 2, 3)'), [["XPath: Function: 'f:add' with 3 arguments not found", 'f:add']]],
	['keyword arguments', '4.0', call('f:add(a := 1, b := 5)'), []],
	['positional then keyword', '4.0', call('f:add(1, b := 5)'), []],
	['unknown keyword', '4.0', call('f:add(1, c := 3)'), [["XPath: The function 'f:add' has no parameter named 'c'", 'c']]],
	['function reference with optional arity', '4.0', call('f:add#1'), []],
	// declarations:
	['required after optional', '4.0', `<xsl:function name="f:g">
		<xsl:param name="a" required="no" select="1"/>
		<xsl:param name="b"/>
		<xsl:sequence select="$a, $b"/>
	</xsl:function>`, [["XSLT: A required function parameter cannot follow an optional parameter: 'b'", '"b"']]],
	['overlapping arity ranges', '4.0', `${addFunction}
	<xsl:function name="f:add">
		<xsl:param name="x"/>
		<xsl:sequence select="$x"/>
	</xsl:function>`, [["XSLT: Duplicate function name and arity: 'f:add#1'", '"f:add"']]],
	['optional param in XSLT 3.0', '3.0', `<xsl:function name="f:h">
		<xsl:param name="a" required="no" select="1"/>
		<xsl:sequence select="$a"/>
	</xsl:function>`, [["XSLT: Optional function parameters, with required=\"no\", require XSLT 4.0: 'a'", '"a"']]],
];

suite('Function parameters: optional parameters and keyword arguments', () => {
	cases.forEach(([label, version, body, expected]) => {
		test(`${version}: ${label}`, async () => {
			const xslt = stylesheet(version, body);
			const xslLexer = new XslLexer(XSLTConfiguration.configuration);
			xslLexer.provideCharLevelState = true;
			const allTokens = xslLexer.analyse(xslt);
			const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'text' });
			const languageConfig = { ...XSLTConfiguration.configuration, isVersion4: xslLexer.isXSLT40 };
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(languageConfig, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
			const problems = diagnostics.map((d) => [d.message, document.getText(d.range)]);
			assert.deepEqual(problems, expected);
		});
	});
});
