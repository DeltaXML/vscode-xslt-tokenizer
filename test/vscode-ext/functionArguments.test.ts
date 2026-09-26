/**
 * Test suite for XPath 4.0 record and enumeration types of parameters: a map constructor argument of a user-defined
 * function call, by position or keyword, and the select of an xsl:with-param without an 'as' in an xsl:call-template,
 * which has the type of the called template's parameter - for completions and linter checks
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
	<xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string))"/>
	<xsl:item-type name="colour" as="enum('red', 'green')"/>
	<xsl:function name="cx:area" as="xs:double"><xsl:param name="shape" as="person"/><xsl:param name="scale" as="xs:double" required="no" select="1"/><xsl:sequence select="1"/></xsl:function>
	<xsl:function name="cx:mix" as="xs:string"><xsl:param name="a" as="xs:string"/><xsl:param name="c" as="cx:complex"/><xsl:sequence select="$a"/></xsl:function>
	<xsl:function name="cx:fill" as="xs:string"><xsl:param name="c" as="colour"/><xsl:sequence select="$c"/></xsl:function>
	<xsl:function name="cx:paint" as="xs:string"><xsl:param name="a" as="xs:string"/><xsl:param name="c" as="colour"/><xsl:sequence select="$a"/></xsl:function>
	<xsl:function name="cx:show" as="xs:string"><xsl:param name="b" as="xs:boolean"/><xsl:sequence select="string($b)"/></xsl:function>
	<xsl:template name="draw"><xsl:param name="shape" as="cx:complex"/><xsl:param name="c" as="colour"/></xsl:template>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:map="http://www.w3.org/2005/xpath-functions/map" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	<xsl:template name="t">${body}</xsl:template>
</xsl:stylesheet>`;
}

async function completions(body: string, kind: vscode.CompletionItemKind) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === kind).sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? '')).map((item) => item.label as string);
}

const sequence = (select: string) => `<xsl:sequence select="${select}"/>`;
const callDraw = (withParam: string) => `<xsl:call-template name="draw">${withParam}</xsl:call-template>`;
const Field = vscode.CompletionItemKind.Field;

const completionCases: [string, string, vscode.CompletionItemKind, string[]][] = [
	['a positional argument', sequence('cx:area({¦})'), Field, ['\'name\'', '\'address\'', '\'age\'']],
	['a keyword argument', sequence('cx:area(shape := {¦})'), Field, ['\'name\'', '\'address\'', '\'age\'']],
	['the second argument', sequence(`cx:mix('x', { 'r': 1,¦ })`), Field, ['\'i\'']],
	['a nested map constructor in an argument', sequence(`cx:area({ 'name': 'a', 'address': {¦} })`), Field, ['\'city\'', '\'zip\'']],
	['an unclosed call', sequence(`cx:area({¦`), Field, ['\'name\'', '\'address\'', '\'age\'']],
	['a built-in function argument', sequence('map:merge({¦})'), Field, []],
	['an xsl:with-param select', callDraw(`<xsl:with-param name="shape" select="{¦}"/>`), Field, ['\'r\'', '\'i\'']],
	['an xsl:with-param with its own as', callDraw(`<xsl:with-param name="shape" as="map(*)" select="{¦}"/>`), Field, []],
	['an xsl:with-param enumeration value', callDraw(`<xsl:with-param name="c" select="¦"/>`), vscode.CompletionItemKind.EnumMember, ['\'red\'', '\'green\'']],
	['an enumeration argument', sequence('cx:fill(¦)'), vscode.CompletionItemKind.EnumMember, ['\'red\'', '\'green\'']],
	['an enumeration argument within quotes', sequence(`cx:fill('¦')`), vscode.CompletionItemKind.EnumMember, ['\'red\'', '\'green\'']],
	['an enumeration argument after another', sequence(`cx:paint('x', ¦)`), vscode.CompletionItemKind.EnumMember, ['\'red\'', '\'green\'']],
	['an enumeration keyword argument', sequence(`cx:paint(c := ¦, a := 'x')`), vscode.CompletionItemKind.EnumMember, ['\'red\'', '\'green\'']],
	['an xs:boolean argument', sequence('cx:show(¦)'), vscode.CompletionItemKind.Value, ['true()', 'false()']],
	['a typed let binding value', sequence('let $c as colour := ¦ return $c'), vscode.CompletionItemKind.EnumMember, ['\'red\'', '\'green\'']],
	['an argument that is not an enumeration type', sequence(`cx:paint(¦)`), vscode.CompletionItemKind.EnumMember, []],
	['a built-in function argument', sequence(`concat(¦)`), vscode.CompletionItemKind.EnumMember, []],
	['an xsl:map in an xsl:with-param', callDraw(`<xsl:with-param name="shape"><¦</xsl:with-param>`), vscode.CompletionItemKind.Snippet, ['xsl:map cx:complex: required fields']],
];

async function lint(body: string) {
	const xslt = stylesheet(body);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
}

const missing = (field: string, recordName: string, at = '{') => [`XPath: Record field '${field}' is missing - it's required by the record type: ${recordName}`, at];
const notAValue = (value: string) => [`XPath: '${value}' is not one of the values of the enumeration type: colour`, `'${value}'`];

const lintCases: [string, string, string[][]][] = [
	['a positional argument', sequence(`cx:area({ 'name': 'a', 'address': { 'city': 'x' } })`), []],
	['a positional argument: a missing field', sequence(`cx:area({ 'name': 'a' })`), [missing('address', 'person')]],
	['a keyword argument: a missing field', sequence(`cx:area(scale := 2, shape := { 'name': 'a' })`), [missing('address', 'person')]],
	['the second argument: a missing field', sequence(`cx:mix('x', map { 'r': 1 })`), [missing('i', 'cx:complex', 'map')]],
	['an argument that is not only a map constructor', sequence(`cx:mix('x', map { 'r': 1 } => map:put('i', 2))`), []],
	['an enumeration value argument', sequence(`cx:fill('green')`), []],
	['an enumeration value argument: not a value', sequence(`cx:fill('blue')`), [notAValue('blue')]],
	['the wrong arity', sequence(`cx:mix({ 'r': 1 })`), [[`XPath: Function: 'cx:mix' with 1 arguments not found`, 'cx:mix']]],
	['a built-in function argument', sequence(`map:merge({ 'r': 1 })`), []],
	['an xsl:with-param select: a missing field', callDraw(`<xsl:with-param name="shape" select="{ 'r': 1 }"/><xsl:with-param name="c" select="'red'"/>`), [missing('i', 'cx:complex')]],
	['an xsl:with-param select: not a value', callDraw(`<xsl:with-param name="shape" select="{ 'r': 1, 'i': 2 }"/><xsl:with-param name="c" select="'blue'"/>`), [notAValue('blue')]],
];

// the text of the select after applying the completion with the label
async function apply(body: string, label: string) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
	const position = document.positionAt(offset);
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	const item = items.find((i) => i.label === label)!;
	const range = (item.range as vscode.Range | undefined) ?? new vscode.Range(position, position);
	const text = document.getText();
	const fixed = text.substring(0, document.offsetAt(range.start)) + (item.insertText as string) + text.substring(document.offsetAt(range.end));
	return { select: /select="(.*?)"/.exec(fixed.substring(fixed.indexOf('<xsl:template name="t">')))![1], others: items.filter((i) => i.kind !== vscode.CompletionItemKind.EnumMember).length };
}

suite('Record and enumeration types of parameters', () => {
	test('completion: an enumeration argument within quotes replaces the string literal, with no other completions', async () => {
		assert.deepEqual(await apply(sequence(`cx:fill('gr¦')`), '\'green\''), { select: `cx:fill('green')`, others: 0 });
	});

	test('completion: an enumeration argument after a comma has a leading space, before the other completions', async () => {
		const result = await apply(sequence(`cx:paint('x',¦)`), '\'red\'');
		assert.equal(result.select, `cx:paint('x', 'red')`);
		assert.isAbove(result.others, 0);
	});

	completionCases.forEach(([label, body, kind, expected]) => {
		test(`completion: ${label}`, async () => {
			assert.deepEqual(await completions(body, kind), expected);
		});
	});
	lintCases.forEach(([label, body, expected]) => {
		test(`linter: ${label}`, async () => {
			assert.deepEqual(await lint(body), expected);
		});
	});
});
