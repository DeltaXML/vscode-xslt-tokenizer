/**
 * Test suite for XPath 4.0 JNodes, as supported by Saxon 13: path expressions on trees of maps and arrays
 * - supported: name steps and axes, get(...) node tests, jtree/jkey/jvalue, and jnode(...) item types
 * - not supported by Saxon 13 (though shown in its JNodes documentation): type node tests such as ~record(...) in a step
 * - a value with a record type needs jtree() before '/' (Saxon 13 reports XPTY0019 for $c/r); a child step on jtree($c) is
 *   checked against the record's fields, as for a '?' lookup
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

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
const needsJtree = (type: string) => `XPath: A value with the record type ${type} must be converted with jtree() before '/', e.g. jtree($value)/field (Saxon 13 reports XPTY0019)`;
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
	['child steps on a record need jtree()', '4.0', '$p/name', [[needsJtree('person'), '/']]],
	['child steps via jtree()', '4.0', 'jtree($p)/name, jtree($p)/address/city', []],
	['child step not a field', '4.0', 'jtree($p)/nam, jtree($p)/address/town', [[stepUnknown('nam', 'person'), 'nam'], [stepUnknown('town', 'record(city as xs:string)'), 'town']]],
	['child step after a lookup needs jtree()', '4.0', '$p?address/city', [[needsJtree('record(city as xs:string)'), '/']]],
	['lookup after a path step', '4.0', "jtree($p)/address?city, (jtree($p)/address)?city", [['XPath: Expression context - unexpected token here: ? ', '?']]],
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

suite('JNodes: type completions', () => {
	['4.0', '3.0'].forEach((version) => {
		test(`${version}: jnode() is only offered for XPath 4.0`, async () => {
			const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
	<xsl:variable name="v" as="|" select="()"/>
</xsl:stylesheet>`;
			const offset = marked.indexOf('|');
			const document = await vscode.workspace.openTextDocument({ content: marked.replace('|', ''), language: 'xslt' });
			const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
			const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
			const labels = (Array.isArray(result) ? result : result?.items ?? []).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
			assert.include(labels, 'element()');
			if (version === '4.0') {
				assert.include(labels, 'jnode()');
			} else {
				assert.notInclude(labels, 'jnode()');
			}
		});
	});
});
