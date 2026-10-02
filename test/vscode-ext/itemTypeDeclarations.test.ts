/**
 * Test suite for XSLT 4.0 xsl:item-type declarations:
 * - XTSE4030: names must be unique for the same import precedence - in the document, and in modules it includes (a warning,
 *   as Saxon 13 doesn't report it and uses the last declaration); a module it imports has lower precedence, so can be overridden
 * - the name must not be in a reserved namespace (Saxon 13 reports XTSE0080)
 * - XTSE4035: a named item type must not refer to itself, directly or indirectly
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${body}
</xsl:stylesheet>`;
}

const duplicate = (name: string) => `XSLT: Duplicate xsl:item-type name '${name}' - not allowed for declarations with the same import precedence (XTSE4030). Saxon 13 uses the last declaration`;
const reserved = (name: string) => `XSLT: The xsl:item-type name '${name}' is in a reserved namespace`;
const circular = (name: string) => `XSLT: The item type '${name}' refers to itself, directly or through other named item types (XTSE4035)`;

// declarations in a module, as found for an included or imported module - its href is resolved against the document folder
function moduleDeclaration(href: string, name: string, declaredType: string): GlobalInstructionData {
	return { type: GlobalInstructionType.ItemType, name, declaredType, href: path.resolve(href), token: { line: 0, startCharacter: 0, length: name.length + 2, value: name, tokenType: 0 }, idNumber: 0 };
}

async function problems(body: string, imported: GlobalInstructionData[] = []) {
	const xslt = stylesheet(body);
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const languageConfig = { ...XSLTConfiguration.configuration, isVersion4: xslLexer.isXSLT40 };
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(languageConfig, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, imported, []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const cases: [string, string, [string, string][], GlobalInstructionData[]?][] = [
	['unique names', `<xsl:item-type name="point" as="record(x, y)"/><xsl:item-type name="cx:point" as="record(x, y)"/>`, []],
	['duplicate in the document', `<xsl:item-type name="point" as="record(x, y)"/><xsl:item-type name="point" as="record(a)"/>`, [[duplicate('point'), '"point"']]],
	['duplicate in an included module', `<xsl:include href="lib.xsl"/><xsl:item-type name="point" as="record(a)"/>`, [[duplicate('point'), '"point"']],
		[moduleDeclaration('lib.xsl', 'point', 'record(x, y)')]],
	['overrides an imported module', `<xsl:import href="lib.xsl"/><xsl:item-type name="point" as="record(a)"/>`, [],
		[moduleDeclaration('lib.xsl', 'point', 'record(x, y)')]],
	['reserved namespace', `<xsl:item-type name="xs:point" as="record(x, y)"/>`, [[reserved('xs:point'), '"xs:point"']]],
	['refers to itself', `<xsl:item-type name="tree" as="record(value, children as tree*)"/>`, [[circular('tree'), '"tree"']]],
	['indirect circular reference', `<xsl:item-type name="a" as="record(b as b)"/><xsl:item-type name="b" as="(a | xs:string)"/>`, [[circular('a'), '"a"'], [circular('b'), '"b"']]],
	['field name the same as a type name', `<xsl:item-type name="point" as="record(point as xs:string)"/>`, []],
	['reference to another item type', `<xsl:item-type name="text" as="xs:string"/><xsl:item-type name="label" as="record(value as text)"/>`, []],
];

suite('xsl:item-type declarations', () => {
	cases.forEach(([label, body, expected, imported]) => {
		test(label, async () => {
			assert.deepEqual(await problems(body, imported), expected);
		});
	});
});
