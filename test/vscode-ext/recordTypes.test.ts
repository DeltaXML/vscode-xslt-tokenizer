/**
 * Test suite for XPath 4.0 record types: map constructors checked against the declared record type, and lookups
 * checked against the record's fields
 *
 * Each stylesheet is linted as a whole, with the global instruction data from the lexer (as for the symbol provider),
 * so that named item types declared with xsl:item-type can be resolved. The expected result is the list of
 * [message, token text] pairs for the diagnostics found - 'variable is unused' warnings are ignored.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string))"/>`;

function stylesheet(version: string, body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.complex" version="${version}">
	${version === '4.0' ? declarations : ''}
	${body}
</xsl:stylesheet>`;
}

function inTemplate(body: string) {
	return `<xsl:template name="t">${body}</xsl:template>`;
}

const missing = (field: string, type: string) => `XPath: Record field '${field}' is missing - it's required by the record type: ${type}`;
const unknown = (field: string, type: string) => `XPath: '${field}' is not a field of the record type: ${type}`;
const valueType = (field: string, type: string) => `XPath: The value for record field '${field}' must be of type: ${type}`;
const lookup = (field: string, type: string) => `XPath: Lookup of '${field}' - this is not a field of the record type: ${type}`;

const cases: [string, string, string, [string, string][]][] = [
	// map constructors:
	['exact fields', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': 1.0, 'i': 2.0 }"/>`), []],
	['missing field', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': 1.0 }"/>`), [[missing('i', 'cx:complex'), 'map']]],
	['misspelt key', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="{ 'r': 1.0, 'j': 2.0 }"/>`), [[missing('i', 'cx:complex'), '{'], [unknown('j', 'cx:complex'), "'j'"]]],
	['optional field omitted', '4.0', inTemplate(`<xsl:variable name="p" as="person" select="{ 'name': 'Ann', 'address': { 'city': 'Oxford' } }"/>`), []],
	['nested record missing field', '4.0', inTemplate(`<xsl:variable name="p" as="person" select="{ 'name': 'Ann', 'address': { 'town': 'Oxford' } }"/>`),
		[[missing('city', 'record(city as xs:string, zip? as xs:string)'), '{'], [unknown('town', 'record(city as xs:string, zip? as xs:string)'), "'town'"]]],
	['inline record type', '4.0', inTemplate(`<xsl:variable name="a" as="record(a as xs:string, b? as xs:integer)*" select="{ 'b': 1 }"/>`), [[missing('a', 'record(a as xs:string, b? as xs:integer)'), '{']]],
	['string for double', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': '1.0', 'i': 2 }"/>`), [[valueType('r', 'xs:double'), "'1.0'"]]],
	['number for string', '4.0', inTemplate(`<xsl:variable name="p" as="person" select="{ 'name': 42, 'address': { 'city': 'Oxford' } }"/>`), [[valueType('name', 'xs:string'), '42']]],
	['decimal for integer', '4.0', inTemplate(`<xsl:variable name="p" as="person" select="{ 'name': 'Ann', 'age': 1.5, 'address': { 'city': 'Oxford' } }"/>`), [[valueType('age', 'xs:integer'), '1.5']]],
	['empty for required', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': (), 'i': 1 }"/>`), [[valueType('r', 'xs:double'), '()']]],
	['computed values not checked', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': 1 + 1, 'i': number('2') }"/>`), []],
	['computed key not checked', '4.0', inTemplate(`<xsl:variable name="k" select="'r'"/><xsl:variable name="c" as="cx:complex" select="map { $k: 1.0 }"/>`), []],
	['not a map constructor', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="if (true()) then map { 'r': 1 } else ()"/>`), []],
	['xsl:param default', '4.0', inTemplate(`<xsl:param name="c" as="cx:complex" select="map { 'r': 1.0 }"/>`), [[missing('i', 'cx:complex'), 'map']]],
	['function result', '4.0', `<xsl:function name="cx:new" as="cx:complex">
		<xsl:param name="r" as="xs:double"/>
		<xsl:sequence select="map { 'r': $r }"/>
	</xsl:function>`, [[missing('i', 'cx:complex'), 'map']]],
	['function result not last', '4.0', `<xsl:function name="cx:new" as="cx:complex*">
		<xsl:sequence select="map { 'r': 1 }"/>
		<xsl:sequence select="map { 'r': 1, 'i': 2 }"/>
	</xsl:function>`, []],
	// lookups:
	['lookup of a field', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': 1.0, 'i': 2.0 }"/><xsl:sequence select="$c?r + $c?i"/>`), []],
	['lookup of an unknown field', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': 1.0, 'i': 2.0 }"/><xsl:sequence select="$c?imag"/>`), [[lookup('imag', 'cx:complex'), 'imag']]],
	['nested lookup', '4.0', `<xsl:function name="cx:city" as="xs:string">
		<xsl:param name="p" as="person"/>
		<xsl:sequence select="$p?address?city || $p?address?town"/>
	</xsl:function>`, [[lookup('town', 'record(city as xs:string, zip? as xs:string)'), 'town']]],
	['lookup on a global variable declared later', '4.0', `<xsl:template name="t"><xsl:sequence select="$g?x"/></xsl:template>
	<xsl:variable name="g" as="cx:complex" select="map { 'r': 1, 'i': 2 }"/>`, [[lookup('x', 'cx:complex'), 'x']]],
	['let variable shadows a record variable', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': 1.0, 'i': 2.0 }"/><xsl:sequence select="let $c := map { 'x': 1 } return $c?x"/>`), []],
	['wildcard and integer lookups', '4.0', inTemplate(`<xsl:variable name="c" as="cx:complex" select="map { 'r': 1.0, 'i': 2.0 }"/><xsl:sequence select="$c?*, $c?1"/>`), []],
	// XSLT 3.0: record types are reported as XPath 4.0 only, and not checked further
	['XSLT 3.0', '3.0', inTemplate(`<xsl:variable name="c" as="record(r as xs:double)" select="map { 'x': 1.0 }"/>`), [["XPath: The 'record(...)' item type requires XPath 4.0", 'record']]],
];

suite('Record types: map constructors and lookups', () => {
	cases.forEach(([label, version, body, expected]) => {
		test(`${version}: ${label}`, async () => {
			const xslt = stylesheet(version, body);
			const xslLexer = new XslLexer(XSLTConfiguration.configuration);
			xslLexer.provideCharLevelState = true;
			const allTokens = xslLexer.analyse(xslt);
			const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'text' });
			const languageConfig = { ...XSLTConfiguration.configuration, isVersion4: xslLexer.isXSLT40 };
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(languageConfig, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
			const problems = diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
			assert.deepEqual(problems, expected);
		});
	});
});
