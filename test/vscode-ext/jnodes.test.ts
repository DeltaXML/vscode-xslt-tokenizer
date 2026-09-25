/**
 * Test suite for XPath 4.0 JNodes, as supported by Saxon 13: path expressions on trees of maps and arrays
 * - supported: name steps and axes, get(...) node tests, jtree/jkey/jvalue, and jnode(...) item types
 * - not supported by Saxon 13 (though shown in its JNodes documentation): type node tests such as ~record(...) in a step
 * - a child step on a variable declared with a record type is checked against the record's fields, as for a '?' lookup
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

function stylesheet(version: string, select: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="${version}">
	${version === '4.0' ? `<xsl:item-type name="person" as="record(name as xs:string, address as record(city as xs:string))"/>` : ''}
	<xsl:variable name="tree" select="parse-json('{}')"/>
	<xsl:template name="t">
		${version === '4.0' ? `<xsl:param name="p" as="person"/>` : ''}
		<xsl:sequence select="${select}"/>
	</xsl:template>
</xsl:stylesheet>`;
}

const notSupported = (name: string) => `XPath: Type node tests, e.g. ~record(...) or ~xs:string, are not supported by Saxon 13: '${name}'`;
const stepUnknown = (field: string, type: string) => `XPath: Child step '${field}' - this is not a field of the record type: ${type}`;

const cases: [string, string, string, [string, string][]][] = [
	['name steps', '4.0', "$tree/type/jvalue(), $tree//name[../type = 'class']/jvalue(), $tree//name/../jkey()", []],
	['axes and wildcards', '4.0', 'jtree($tree)/descendant-or-self::*/child::name/jvalue(), $tree/content/*[1]', []],
	['get node tests', '4.0', "$tree/get('a b')/jvalue(), $tree/content/get(1)/name, $tree/child::get(2)", []],
	['jnode item types', '4.0', 'jtree($tree) instance of jnode(), $tree/type instance of jnode(type)', []],
	['get as a function call', '4.0', "get('a')", [["XPath: Function: 'get' with 1 arguments not found", 'get']]],
	['type node test on a record', '4.0', 'count($tree//~record(type, name))', [[notSupported('~record'), '~record']]],
	['type node test on an atomic type', '4.0', 'count($tree/child::~xs:string)', [[notSupported('~xs:string'), '~xs:string']]],
	['type node test on an array', '4.0', 'count($tree/child::~array())', [[notSupported('~array'), '~array']]],
	['child steps on a record', '4.0', '$p/name, $p/address/city', []],
	['child step not a field', '4.0', '$p/nam, $p/address/town', [[stepUnknown('nam', 'person'), 'nam'], [stepUnknown('town', 'record(city as xs:string)'), 'town']]],
	['child step after a lookup', '4.0', '$p?address/town', [[stepUnknown('town', 'record(city as xs:string)'), 'town']]],
	['XSLT 3.0', '3.0', "$tree/get('a'), . instance of jnode()", [["XPath: The 'get(...)' node test requires XPath 4.0", 'get'], ["XPath: The 'jnode(...)' item type requires XPath 4.0", 'jnode']]],
];

suite('JNodes', () => {
	cases.forEach(([label, version, select, expected]) => {
		test(`${version}: ${label}`, async () => {
			const xslt = stylesheet(version, select);
			const xslLexer = new XslLexer(XSLTConfiguration.configuration);
			xslLexer.provideCharLevelState = true;
			const allTokens = xslLexer.analyse(xslt);
			const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
			const languageConfig = { ...XSLTConfiguration.configuration, isVersion4: xslLexer.isXSLT40 };
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(languageConfig, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
			const problems = diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
			assert.deepEqual(problems, expected);
		});
	});
});
