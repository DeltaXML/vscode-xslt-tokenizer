/**
 * Test suite for go to definition and find references on XSLT 4.0 named item types, declared with xsl:item-type
 *
 * The named item type is referenced in each kind of type position: an 'as' attribute, a choice item type, a record
 * field type, another xsl:item-type, a function parameter, and 'instance of' in an XPath expression.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { GlobalInstructionType, XslLexer } from '../../src/xslLexer';
import { XsltTokenDefinitions } from '../../src/xsltTokenDefintions';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';

const lines = [
	`<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">`,
	`  <xsl:item-type name="cx:point" as="record(x as xs:double, y as xs:double)"/>`,
	`  <xsl:item-type name="shape" as="record(centre as cx:point, name as xs:string)"/>`,
	`  <xsl:variable name="origin" as="cx:point" select="{ 'x': 0, 'y': 0 }"/>`,
	`  <xsl:variable name="either" as="(cx:point | xs:string)*" select="()"/>`,
	`  <xsl:function name="cx:is-point" as="xs:boolean">`,
	`    <xsl:param name="p" as="cx:point?"/>`,
	`    <xsl:sequence select="$p instance of cx:point"/>`,
	`  </xsl:function>`,
	`</xsl:stylesheet>`,
];
const xslt = lines.join('\n');

// [line, character] of each use of cx:point
const uses: [number, number][] = [
	[2, lines[2].indexOf('cx:point')],
	[3, lines[3].indexOf('cx:point')],
	[4, lines[4].indexOf('cx:point')],
	[6, lines[6].indexOf('cx:point')],
	[7, lines[7].indexOf('cx:point')],
];
// the name within the declaration's quotes
const declarationRange = new vscode.Range(1, lines[1].indexOf('cx:point'), 1, lines[1].indexOf('cx:point') + 'cx:point'.length);

async function analyse() {
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	return { allTokens, document, globals: xslLexer.globalInstructionData };
}

suite('Named item types: go to definition and find references', () => {
	uses.forEach(([line, character]) => {
		test(`go to definition from line ${line}: ${lines[line].trim()}`, async () => {
			const { allTokens, document, globals } = await analyse();
			// a position within the name, not at its start
			const position = new vscode.Position(line, character + 3);
			const definition = XsltTokenDefinitions.findDefinition(true, document, allTokens, globals, [], position).definitionLocation;
			assert.isDefined(definition, 'definition found');
			assert.isTrue(definition!.range.isEqual(declarationRange), `range: ${JSON.stringify(definition!.range)}`);
			assert.equal(definition!.instruction?.type, GlobalInstructionType.ItemType);
		});
	});

	test('no definition for a built-in type', async () => {
		const { allTokens, document, globals } = await analyse();
		const position = new vscode.Position(6, lines[6].indexOf('xs:boolean') + 3);
		const definition = XsltTokenDefinitions.findDefinition(true, document, allTokens, globals, [], position).definitionLocation;
		assert.isUndefined(definition);
	});

	test('find references from the declaration', async () => {
		const { allTokens, document, globals } = await analyse();
		const declaration = globals.find((g) => g.type === GlobalInstructionType.ItemType && g.name === 'cx:point');
		assert.isDefined(declaration);
		const references = XSLTReferenceProvider.calculateReferences(declaration!, XSLTConfiguration.configuration, XSLTConfiguration.configuration.docType, document, allTokens, globals, []);
		assert.deepEqual(references.map((t) => [t.line, t.startCharacter, t.length]), uses.map(([line, character]) => [line, character, 'cx:point'.length]));
	});

	test('references of one named item type do not include another', async () => {
		const { allTokens, document, globals } = await analyse();
		const declaration = globals.find((g) => g.type === GlobalInstructionType.ItemType && g.name === 'shape');
		const references = XSLTReferenceProvider.calculateReferences(declaration!, XSLTConfiguration.configuration, XSLTConfiguration.configuration.docType, document, allTokens, globals, []);
		assert.deepEqual(references, []);
	});
});
