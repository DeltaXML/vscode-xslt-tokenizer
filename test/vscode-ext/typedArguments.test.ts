/**
 * Test suite for XPath 4.0 function call arguments: the operand of an arrow operator, e.g. { ... } => cx:mag(), is the
 * first argument - and an argument that is a variable reference or a user-defined function call with a declared type
 * is checked against the parameter's type, as by Saxon 13: a record type must have the fields the parameter's record
 * type requires, and a record is not an enumeration value (or vice versa) - a value with a different enumeration type
 * is accepted by Saxon 13, so it's not reported
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="person" as="record(name as xs:string)"/>
	<xsl:item-type name="colour" as="enum('red', 'green')"/>
	<xsl:function name="cx:mag" as="xs:double"><xsl:param name="c" as="cx:complex"/><xsl:sequence select="$c?r"/></xsl:function>
	<xsl:function name="cx:scale" as="cx:complex"><xsl:param name="c" as="cx:complex"/><xsl:param name="k" as="xs:double"/><xsl:sequence select="$c"/></xsl:function>
	<xsl:function name="cx:person" as="person"><xsl:sequence select="{ 'name': 'a' }"/></xsl:function>
	<xsl:function name="cx:to-person" as="person"><xsl:param name="c" as="cx:complex"/><xsl:sequence select="{ 'name': string($c?r) }"/></xsl:function>
	<xsl:function name="cx:tone" as="xs:string"><xsl:param name="t" as="enum('x', 'y')"/><xsl:sequence select="$t"/></xsl:function>
	<xsl:variable name="p" as="person" select="{ 'name': 'a' }"/>
	<xsl:variable name="c" as="colour" select="'red'"/>
	<xsl:variable name="z" as="cx:complex" select="{ 'r': 1, 'i': 2 }"/>`;

function stylesheet(select: string, localVariable = '') {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	<xsl:template name="t">${localVariable}<xsl:sequence select="${select}"/></xsl:template>
</xsl:stylesheet>`;
}

async function lint(select: string, localVariable = '') {
	const xslt = stylesheet(select, localVariable);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
}

const missing = (field: string, recordName: string, at = '{') => [`XPath: Record field '${field}' is missing - it's required by the record type: ${recordName}`, at];
const mismatch = (argument: string, argType: string, paramType: string, reason: string) => [`XPath: The type of '${argument}', ${argType}, doesn't match the parameter type ${paramType} - ${reason}`, argument];
const noField = (argument: string, argType = 'person') => mismatch(argument, argType, 'cx:complex', `it has no field 'r'`);

const lintCases: [string, string, string[][], string?][] = [
	['a map constructor arrow operand', `{ 'r': 1 } => cx:mag()`, [missing('i', 'cx:complex')]],
	['a complete map constructor arrow operand', `{ 'r': 1, 'i': 2 } => cx:mag()`, []],
	['a map constructor arrow operand with other arguments', `map { 'r': 1 } => cx:scale(2)`, [missing('i', 'cx:complex', 'map')]],
	['a variable arrow operand', `$p => cx:mag()`, [noField('$p')]],
	['a function call arrow operand', `cx:person() => cx:mag()`, [noField('cx:person')]],
	['a global variable argument', `cx:mag($p)`, [noField('$p')]],
	['a global variable argument with a matching type', `cx:mag($z)`, []],
	['a keyword argument', `cx:mag(c := $p)`, [noField('$p')]],
	['a function call argument', `cx:mag(cx:person())`, [noField('cx:person')]],
	['a local variable argument', `cx:mag($lp)`, [noField('$lp')], `<xsl:variable name="lp" as="person" select="$p"/>`],
	['a typed let binding argument', `let $q as person := $p return cx:mag($q)`, [noField('$q')]],
	['an inline function parameter argument', `function($q as person) { cx:mag($q) }`, [noField('$q')]],
	['a record for an enumeration type', `cx:tone($p)`, [mismatch('$p', 'person', `enum('x', 'y')`, 'a record is not an enumeration value')]],
	['an enumeration value for a record type', `cx:mag($c)`, [mismatch('$c', 'colour', 'cx:complex', 'an enumeration value is not a record')]],
	['a different enumeration type (accepted by Saxon 13)', `cx:tone($c)`, []],
	['an untyped variable', `let $q := $p return cx:mag($q)`, []],
	['a variable in a larger expression', `cx:mag(($p, $z)[2])`, []],
	['a let binding value with an arrow operator', `let $x as person := { 'r': 1, 'i': 2 } => cx:to-person() return $x`, []],
];

async function fields(select: string) {
	const marked = stylesheet(select);
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === vscode.CompletionItemKind.Field).sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? '')).map((item) => item.label as string);
}

const completionCases: [string, string, string[]][] = [
	['a map constructor arrow operand', `{¦} => cx:mag()`, ['\'r\'', '\'i\'']],
	['a map constructor arrow operand with other arguments', `{ 'r': 1,¦ } => cx:scale(2)`, ['\'i\'']],
	['a mapping arrow operand', `{¦} =!> cx:mag()`, ['\'r\'', '\'i\'']],
];

suite('Arrow operands and typed arguments', () => {
	lintCases.forEach(([label, select, expected, localVariable]) => {
		test(`linter: ${label}`, async () => {
			assert.deepEqual(await lint(select, localVariable), expected);
		});
	});
	completionCases.forEach(([label, select, expected]) => {
		test(`completion: ${label}`, async () => {
			assert.deepEqual(await fields(select), expected);
		});
	});
});
