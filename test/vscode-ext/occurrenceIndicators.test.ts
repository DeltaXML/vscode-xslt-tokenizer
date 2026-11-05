/**
 * Test suite for occurrence indicators on the types of an inline function's parameters - e.g. function($stack as map(*)*,
 * $item as element()) {...} - and on kind tests elsewhere in a sequence type, e.g. instance of node()*
 *
 * After a kind test's brackets, the lexer labels '*', '+' and '?' as an occurrence indicator in a type, and as an
 * operator otherwise, e.g. text() * 2. The wildcard in function(*) isn't a valid inline function. The expected result is the list of [message, token
 * text] pairs for the diagnostics found.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

function stylesheet(select: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="3.0">
	<xsl:template name="t"><xsl:sequence select="${select}"/></xsl:template>
</xsl:stylesheet>`;
}

const anonFnSyntax = "XPath: Unexpected token '*' - expected syntax: \n'function($v) {expression} or\n'function($v as <TYPE>) as <TYPE> {expression}'";

const cases: [string, string, [string, string][]][] = [
	['map(*)*', 'function($stack as map(*)*, $item as element()) { $stack, $item }', []],
	['map(*)? and map(*)+', 'function($a as map(*)?, $b as map(*)+) { $a, $b }', []],
	['array(*)* and function(*)*', 'function($a as array(*)*, $f as function(*)*) { $a, $f }', []],
	['node()* and element()*', 'function($n as node()*, $e as element()*) { $n, $e }', []],
	['xs:integer*', 'function($i as xs:integer*) { $i }', []],
	['an occurrence indicator after instance of and treat as', 'for $x in . return ($x instance of element()*, $x treat as node()+)', []],
	['the return type', 'function($a) as node()* { $a }', []],
	['the return type, after a typed parameter', 'function($a as xs:integer) as map(*)* { $a }', []],
	['multiplication after a kind test', 'for $x in . return (text() * 2, node() * $x, count(node()*2))', []],
	['an occurrence indicator within a map or function type', 'for $x in . return ($x instance of map(*)*, $x instance of map(xs:string, node()*), $x instance of function(node()*) as item())', []],
	['a wildcard for the parameters', 'function(*) { 1 }', [[anonFnSyntax, '*']]],
];

suite('Occurrence indicators: inline function parameter types, and kind tests', () => {
	cases.forEach(([label, select, expected]) => {
		test(label, async () => {
			const xslt = stylesheet(select);
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
