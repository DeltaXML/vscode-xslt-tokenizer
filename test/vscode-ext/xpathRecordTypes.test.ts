/**
 * Test suite for XPath 4.0 record types declared in XPath: a typed let or for binding, e.g. let $p as person := ...,
 * an inline function parameter, e.g. function($c as cx:complex), and the result of a user-defined function with a
 * record type, e.g. cx:new(1, 2) - for lookup completions such as $p?, map constructor completions for a let binding's
 * value, and lookups of unknown fields reported by the linter
 *
 * The cursor position is marked by '¦' in each select attribute.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string))"/>
	<xsl:function name="cx:new" as="cx:complex"><xsl:param name="r"/><xsl:param name="i"/><xsl:sequence select="{ 'r': $r, 'i': $i }"/></xsl:function>
	<xsl:function name="cx:person" as="person"><xsl:sequence select="()"/></xsl:function>
	<xsl:item-type name="colour" as="enum('red', 'green')"/>`;

function stylesheet(select: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	<xsl:template name="t"><xsl:sequence select="${select}"/></xsl:template>
</xsl:stylesheet>`;
}

async function fields(select: string) {
	const marked = stylesheet(select);
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === vscode.CompletionItemKind.Field).sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? '')).map((item) => item.label as string);
}

const completionCases: [string, string, string[]][] = [
	['a typed let binding', `let $c as cx:complex := () return $c?¦`, ['r', 'i']],
	['a typed let binding with an occurrence indicator', `let $c as cx:complex* := () return $c?¦`, ['r', 'i']],
	['a typed for binding', `for $c as cx:complex in () return $c?¦`, ['r', 'i']],
	['a nested lookup on a typed let binding', `let $p as person := () return $p?address?¦`, ['city', 'zip']],
	['an inline function parameter', `function($c as cx:complex) { $c?¦ }`, ['r', 'i']],
	['an inline function parameter after another', `function($a as xs:string, $p as person) as xs:string { $p?¦ }`, ['name', 'age', 'address']],
	['a user-defined function result', `cx:new(1, 2)?¦`, ['r', 'i']],
	['a user-defined function result with no arguments', `cx:person()?address?¦`, ['city', 'zip']],
	['a user-defined function with the wrong arity', `cx:new(1)?¦`, []],
	['an untyped let binding', `let $c := () return $c?¦`, []],
	['an untyped binding that shadows a typed one', `let $c as cx:complex := () return let $c := 1 return $c?¦`, []],
	['the value of a typed let binding', `let $p as person := {¦} return $p`, ['\'name\'', '\'address\'', '\'age\'']],
	['after a comma in the value of a typed let binding', `let $c as cx:complex := { 'r': 1,¦ } return $c`, ['\'i\'']],
];

async function lint(select: string) {
	const xslt = stylesheet(select);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const unknown = (field: string, recordName: string) => [`XPath: Lookup of '${field}' - this is not a field of the record type: ${recordName}`, field];

const missing = (field: string, recordName: string, at = '{') => [`XPath: Record field '${field}' is missing - it's required by the record type: ${recordName}`, at];

const lintCases: [string, string, string[][]][] = [
	['the map constructor of a typed let binding', `let $c as cx:complex := { 'r': 1, 'i': 2 } return $c`, []],
	['the map constructor of a typed let binding: a missing field', `let $c as cx:complex := { 'r': 1 } return $c`, [missing('i', 'cx:complex')]],
	['the map constructor of a typed let binding: map keyword', `let $c as cx:complex := map { 'i': 1 } return $c`, [missing('r', 'cx:complex', 'map')]],
	['the map constructor of a typed let binding: an unknown field', `let $c as cx:complex := { 'r': 1, 'i': 2, 'x': 3 } return $c`, [[`XPath: 'x' is not a field of the record type: cx:complex`, `'x'`]]],
	['the map constructor of a typed let binding: a nested record', `let $p as person := { 'name': 'a', 'address': {} } return $p`, [missing('city', 'record(city as xs:string, zip? as xs:string)', '{}')]],
	['the second binding of a let', `let $a := 1, $c as cx:complex := { 'r': $a } return $c`, [missing('i', 'cx:complex')]],
	['an untyped let binding with a map constructor', `let $c := { 'r': 1 } return $c`, []],
	['a keyword argument', `cx:new(r := { 'x': 1 }, i := 2)`, []],
	['an enumeration value of a typed let binding', `let $c as colour := 'green' return $c`, []],
	['an enumeration value of a typed let binding: not a value', `let $c as colour := 'blue' return $c`, [[`XPath: 'blue' is not one of the values of the enumeration type: colour`, `'blue'`]]],
	['a typed let binding', `let $c as cx:complex := () return $c?r`, []],
	['a typed let binding: unknown field', `let $c as cx:complex := () return $c?x`, [unknown('x', 'cx:complex')]],
	['an inline function parameter: unknown field', `function($c as cx:complex) { $c?x }`, [unknown('x', 'cx:complex')]],
	['a user-defined function result: unknown field', `cx:new(1, 2)?x`, [unknown('x', 'cx:complex')]],
	['a nested lookup on a function result: unknown field', `cx:person()?address?x`, [unknown('x', 'record(city as xs:string, zip? as xs:string)')]],
	['an untyped let binding', `let $c := () return $c?x`, []],
];

suite('Record types declared in XPath', () => {
	completionCases.forEach(([label, select, expected]) => {
		test(`completion: ${label}`, async () => {
			assert.deepEqual(await fields(select), expected);
		});
	});
	lintCases.forEach(([label, select, expected]) => {
		test(`linter: ${label}`, async () => {
			assert.deepEqual(await lint(select), expected);
		});
	});
});
