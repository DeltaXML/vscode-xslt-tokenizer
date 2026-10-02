/**
 * Test suite for XPath 4.0 numeric literals (hexadecimal, binary and '_' digit separators), QName literals,
 * 'for key/value' map bindings and typed variable bindings - valid in XSLT 4.0 and reported as errors in XSLT 3.0
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(version: string, expression: string) {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="${version}">
	<xsl:template name="t"><xsl:sequence select="${expression}"/></xsl:template>
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

const numberRequires40 = (value: string) => `XPath: Hexadecimal and binary numeric literals, and '_' digit separators, require XPath 4.0: '${value}'`;
const invalidNumber = (value: string) => `XPath: Invalid numeric literal: '${value}'`;
const typedBinding = `XPath: A type declaration with 'as' for a variable binding requires XPath 4.0`;

// [label, expression, XSLT 4.0 problems, XSLT 3.0 problems]
const cases: [string, string, [string, string][], [string, string][]][] = [
	['hexadecimal and binary literals', '0x1F + 0b101', [], [[numberRequires40('0x1F'), '0x1F'], [numberRequires40('0b101'), '0b101']]],
	['digit separators', '1_000_000 + 1__0.5_5 + 1.5e1_0 + 0xAb_E', [], [[numberRequires40('1_000_000'), '1_000_000'], [numberRequires40('1__0.5_5'), '1__0.5_5'], [numberRequires40('1.5e1_0'), '1.5e1_0'], [numberRequires40('0xAb_E'), '0xAb_E']]],
	['invalid hexadecimal digit', '0xFG', [[invalidNumber('0xFG'), '0xFG']], [[numberRequires40('0xFG'), '0xFG']]],
	['invalid binary digit', '0b12', [[invalidNumber('0b12'), '0b12']], [[numberRequires40('0b12'), '0b12']]],
	['digit separator at the start of a hexadecimal literal', '0x_1F', [[invalidNumber('0x_1F'), '0x_1F']], [[numberRequires40('0x_1F'), '0x_1F']]],
	['digit separator before an exponent', '1_e3', [[invalidNumber('1_e3'), '1_e3']], [[numberRequires40('1_e3'), '1_e3']]],
	['QName literals', '#xml:lang, #lang, #xs:integer', [], [
		[`XPath: The QName literal '#xml:lang' requires XPath 4.0`, '#xml:lang'], [`XPath: The QName literal '#lang' requires XPath 4.0`, '#lang'], [`XPath: The QName literal '#xs:integer' requires XPath 4.0`, '#xs:integer']]],
	['QName literal with an undeclared prefix', '#foo:bar', [[`XPath: Undeclared prefix in name: '#foo:bar'`, '#foo:bar']], [[`XPath: The QName literal '#foo:bar' requires XPath 4.0`, '#foo:bar']]],
	['for key and value', 'for key $k value $v in map { 1: 2 }, $x in 3 return $k + $v + $x', [], [[`XPath: 'for key' map bindings require XPath 4.0`, 'key']]],
	['for value', 'for value $v in map { 1: 2 } return $v', [], [[`XPath: 'for value' map bindings require XPath 4.0`, 'value']]],
	['for key: variables are in scope', 'for key $k in map { 1: 2 } return $w', [
		['variable is unused', '$k'], ['XPath: The variable/parameter $w cannot be resolved', '$w']], [
		['variable is unused', '$k'], ['XPath: The variable/parameter $w cannot be resolved', '$w'], [`XPath: 'for key' map bindings require XPath 4.0`, 'key']]],
	['typed let bindings', 'let $x as xs:integer := 3, $y as map(*)? := map {} return ($x, $y)', [], [[typedBinding, 'as']]],
	['typed for and some bindings', '(for $x as xs:integer in 1 return $x), (some $y as xs:integer in 1 satisfies $y)', [], [[typedBinding, 'as'], [typedBinding, 'as']]],
	['typed binding with the wrong operator', 'let $x as xs:integer in 3 return $x', [[`XPath: 'in' is invalid here, expected  ':='`, 'in']], [[typedBinding, 'as']]],
];

suite('XPath 4.0 literals and bindings', () => {
	cases.forEach(([label, expression, expected40, expected30]) => {
		test(`${label} (XSLT 4.0)`, async () => {
			assert.deepEqual(await problems('4.0', expression), expected40);
		});
		test(`${label} (XSLT 3.0)`, async () => {
			assert.deepEqual(await problems('3.0', expression), expected30);
		});
	});
});
