/**
 * Test suite for completions after the XPath 4.0 lookup operator '?' on a value with a record type: the record's fields
 * are listed for a variable or parameter declared with a record type (inline, or a named item type), and for a lookup
 * of a field whose type is a record, e.g. $p?address?
 *
 * The cursor position is marked by '|' in each stylesheet body.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string), 'nick name')"/>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	${body}
</xsl:stylesheet>`;
}

async function fieldCompletions(body: string) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('|');
	const text = marked.substring(0, offset) + marked.substring(offset + 1);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === vscode.CompletionItemKind.Field).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

const cases: [string, string, string[]][] = [
	['local variable', `<xsl:template name="t"><xsl:variable name="c" as="cx:complex" select="map { 'r': 1, 'i': 2 }"/><xsl:sequence select="$c?|"/></xsl:template>`, ['r', 'i']],
	['partly typed field name', `<xsl:template name="t"><xsl:variable name="c" as="cx:complex" select="map { 'r': 1, 'i': 2 }"/><xsl:sequence select="$c?r|"/></xsl:template>`, ['r', 'i']],
	['inline record type', `<xsl:template name="t"><xsl:variable name="a" as="record(x, y)*" select="()"/><xsl:sequence select="$a?|"/></xsl:template>`, ['x', 'y']],
	['nested record lookup', `<xsl:template name="t"><xsl:param name="p" as="person"/><xsl:sequence select="$p?address?|"/></xsl:template>`, ['city', 'zip']],
	['quoted field name', `<xsl:template name="t"><xsl:param name="p" as="person"/><xsl:sequence select="$p?|"/></xsl:template>`, ['name', 'age', 'address', "'nick name'"]],
	['function parameter', `<xsl:function name="cx:real" as="xs:double"><xsl:param name="c" as="cx:complex"/><xsl:sequence select="$c?|"/></xsl:function>`, ['r', 'i']],
	['global variable declared later', `<xsl:template name="t"><xsl:sequence select="$g?|"/></xsl:template>
	<xsl:variable name="g" as="cx:complex" select="map { 'r': 1, 'i': 2 }"/>`, ['r', 'i']],
	['let variable shadows a record variable', `<xsl:template name="t"><xsl:variable name="c" as="cx:complex" select="map { 'r': 1, 'i': 2 }"/><xsl:sequence select="let $c := map { 'x': 1 } return $c?|"/></xsl:template>`, []],
	['not a record type', `<xsl:template name="t"><xsl:variable name="s" as="map(*)" select="map {}"/><xsl:sequence select="$s?|"/></xsl:template>`, []],
];

suite('Record types: completions after the lookup operator', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await fieldCompletions(body), expected);
		});
	});
});
