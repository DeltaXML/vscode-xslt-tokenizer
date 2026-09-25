/**
 * Test suite for diagnostics in XPath documents (e.g. .xpath files), which use XPath 4.0
 *
 * Each XPath expression is linted as the whole document, as for the extension's provideXPathProblems.
 * The expected result is the list of [message, token text] pairs for the diagnostics found.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XPathConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes } from '../../src/xslLexer';
import { ExitCondition, LexPosition, XPathLexer } from '../../src/xpLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const cases: [string, [string, string][]][] = [
	// XPath 4.0 map constructors without the 'map' keyword:
	["{ 'a': 1, 'b': 2 }", []],
	["{}", []],
	["{ map { 'a': 1 }, map { 'b': 2 } }", []],
	// XPath 4.0 functions:
	["characters('abc')", []],
	["{ 'a': 1 } => map:keys()", []],
	["array:build(1 to 3)", []],
	["math:pi()", []],
	// XPath 4.0 operators:
	["(1, 2) -> sum(.)", []],
	["(-1, -2) =!> abs()", []],
	// still reported:
	["unknown-function(1)", [["XPath: Function: 'unknown-function' with 1 arguments not found", 'unknown-function']]],
	["{ 'a': 1, }", [['XPath: Expression context - unexpected token here: } ', '}']]],
];

suite('XPath documents: XPath 4.0 diagnostics', () => {
	cases.forEach(([xpath, expected]) => {
		test(xpath, async () => {
			const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
			const allTokens = new XPathLexer().analyse(xpath, ExitCondition.None, lexPosition);
			const document = await vscode.workspace.openTextDocument({ content: xpath, language: 'text' });
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XPathConfiguration.configuration, DocumentTypes.XPath, document, allTokens, [], [], []);
			const problems = diagnostics.map((d) => [d.message, document.getText(d.range)]);
			assert.deepEqual(problems, expected);
		});
	});
});
