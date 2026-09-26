/**
 * Test suite for hover and go to definition on XPath 4.0 record fields: in a lookup, e.g. $p?name, a child step on a
 * JNode, e.g. jtree($p)/address, a map constructor key, and the key of an xsl:map-entry - go to definition finds the
 * field in the record type, declared with xsl:item-type or inline in an 'as' attribute
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const lines = [
	`<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="4.0">`,
	`  <xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string))"/>`,
	`  <xsl:variable name="p" as="person" select="{ 'name': 'Ann', 'address': { 'city': 'Oxford' } }"/>`,
	`  <xsl:variable name="q" as="record(r as xs:double)" select="{ 'r': 1 }"/>`,
	`  <xsl:template name="t"><xsl:sequence select="$p?name, $p?address?city, jtree($p)/address, $q?r, $p?age"/></xsl:template>`,
	`  <xsl:variable name="m" as="person"><xsl:map><xsl:map-entry key="'name'" select="'a'"/><xsl:map-entry key="'address'" select="()"/></xsl:map></xsl:variable>`,
	`</xsl:stylesheet>`,
];

async function open() {
	const xslt = lines.join('\n');
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	// the linter records the field references
	XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
	return document;
}

// the position of the nth occurrence of text on the line, within the text
const at = (line: number, text: string, occurrence = 1) => {
	let index = -1;
	for (let i = 0; i < occurrence; i++) {
		index = lines[line].indexOf(text, index + 1);
	}
	return new vscode.Position(line, index + 1);
};
// the declaration of a field: the text on the line, e.g. 'city as'
const declaration = (line: number, text: string, name: string) => new vscode.Range(line, lines[line].indexOf(text), line, lines[line].indexOf(text) + name.length);

const definitionCases: [string, vscode.Position, vscode.Range][] = [
	['a lookup', at(4, '?name'), declaration(1, 'name as', 'name')],
	['a nested lookup', at(4, '?city'), declaration(1, 'city as', 'city')],
	['a child step on a JNode', at(4, '/address'), declaration(1, 'address as', 'address')],
	['a lookup on an inline record type', at(4, '?r'), declaration(3, 'r as', 'r')],
	['a map constructor key', at(2, `'name'`), declaration(1, 'name as', 'name')],
	['a nested map constructor key', at(2, `'city'`), declaration(1, 'city as', 'city')],
	['a map constructor key for an inline record type', at(3, `'r'`), declaration(3, 'r as', 'r')],
	['an xsl:map-entry key', at(5, `'address'`), declaration(1, 'address as', 'address')],
];

suite('Record fields: go to definition and hover', () => {
	definitionCases.forEach(([label, position, expected]) => {
		test(`go to definition: ${label}`, async () => {
			const document = await open();
			const location = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideDefinition(document, position.translate(0, 1), new vscode.CancellationTokenSource().token);
			assert.isDefined(location, 'definition found');
			assert.deepEqual([location!.range.start.line, location!.range.start.character, location!.range.end.character], [expected.start.line, expected.start.character, expected.end.character]);
		});
	});

	async function hoverText(position: vscode.Position) {
		const document = await open();
		const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position.translate(0, 1), new vscode.CancellationTokenSource().token);
		return (hover?.contents as vscode.MarkdownString[] | undefined)?.map((c) => c.value).join('\n');
	}

	test('hover: a field with a record type', async () => {
		assert.equal(await hoverText(at(4, '/address')), '\n```xpath\naddress as record(city as xs:string, zip? as xs:string)\n```\nField of the record type: `person`');
	});

	test('hover: an optional field', async () => {
		assert.equal(await hoverText(at(4, '?age')), '\n```xpath\nage? as xs:integer\n```\nOptional field of the record type: `person`');
	});

	test('hover: a nested field', async () => {
		assert.equal(await hoverText(at(4, '?city')), '\n```xpath\ncity as xs:string\n```\nField of the record type: `record(city as xs:string, zip? as xs:string)`');
	});
});
