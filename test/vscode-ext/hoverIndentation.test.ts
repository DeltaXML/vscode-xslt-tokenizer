/**
 * Test suite for the hover of a declaration written on more than one line, e.g. a record type with a field on each line:
 * it's shown on one line, without the source's indentation - a line break and the whitespace around it are a space, or
 * nothing after '(' or before ')'. The same applies to a function's parameter and return types, in a hover or signature
 * help.
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XslLexerLight } from '../../src/xslLexerLight';
import { RecordTypes } from '../../src/recordTypes';
import { XSLTSignatureHelpProvider } from '../../src/xsltSignatureHelpProvider';

const declarations = `<xsl:item-type name="address"
                  as="record(
         street as xs:string,
         geo? as record(
            lat as xs:double,
            long as xs:double
         )
      )"/>
   <xsl:function name="f:move" as="record(
         x as xs:double,
         y as xs:double
      )">
      <xsl:param name="point" as="record(
            x as xs:double,
            y as xs:double
         )"/>
      <xsl:sequence select="$point"/>
   </xsl:function>`;

const pointType = 'record(x as xs:double, y as xs:double)';

const addressType = 'record(street as xs:string, geo? as record(lat as xs:double, long as xs:double))';

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" version="4.0">
   ${declarations}
   ${body}
</xsl:stylesheet>`;
}

async function hoverCode(body: string) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('¦');
	const text = marked.replace('¦', '');
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	// the linter's diagnostics give the record field references, for the hover of a field
	XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, xslLexer.analyse(text), xslLexer.globalInstructionData, [], []);
	const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, document.positionAt(offset), new vscode.CancellationTokenSource().token);
	const value = (hover?.contents as vscode.MarkdownString[] | undefined)?.map((c) => c.value).join('\n') ?? '';
	// the first code block
	return /```[\w-]*\n([\s\S]*?)\n```/.exec(value)?.[1];
}

suite('Hover: declarations on more than one line', () => {
	test('a record type, with a record type within a field', async () => {
		assert.equal(await hoverCode(`<xsl:variable name="a" as="addr¦ess" select="{ 'street': 'x' }"/>`), `type address as ${addressType}`);
	});

	test('a field with a record type', async () => {
		assert.equal(await hoverCode(`<xsl:variable name="a" as="address" select="{ 'street': 'x' }"/>
   <xsl:template name="t"><xsl:sequence select="$a?ge¦o"/></xsl:template>`), 'geo? as record(lat as xs:double, long as xs:double)');
	});

	test('a type from an imported or included module, as read by the light lexer', () => {
		// the light lexer keeps the line breaks in an 'as' value - without them, the indentation would be left in the hover
		const globals = new XslLexerLight(XSLTConfiguration.configuration).analyseLight(stylesheet(''));
		assert.equal(globals.find((g) => g.name === 'address')?.declaredType, addressType);
		const move = globals.find((g) => g.name === 'f:move');
		assert.equal(move?.returnType, pointType);
		assert.deepEqual(move?.memberTypes, [pointType]);
	});

	test('a function: the hover of a call', async () => {
		assert.equal(await hoverCode(`<xsl:template name="t"><xsl:sequence select="f:mo¦ve({ 'x': 1, 'y': 2 })"/></xsl:template>`),
			`f:move($point as ${pointType}) as ${pointType}`);
	});

	test('a function: signature help for a call', async () => {
		const marked = stylesheet(`<xsl:template name="t"><xsl:sequence select="f:move(¦)"/></xsl:template>`);
		const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
		const provider = new XSLTSignatureHelpProvider(XSLTConfiguration.configuration, new XsltDefinitionProvider(XSLTConfiguration.configuration));
		const help = await provider.provideSignatureHelp(document, document.positionAt(marked.indexOf('¦')), new vscode.CancellationTokenSource().token);
		const signature = help?.signatures[help.activeSignature];
		assert.equal(signature?.label, `f:move($point as ${pointType}) as ${pointType}`);
		assert.deepEqual(signature?.parameters.map((p) => p.label), [`$point as ${pointType}`]);
	});

	test('whitespace without a line break is unchanged', () => {
		assert.equal(RecordTypes.joinLines("type t as record(a,  b as enum('x  y'))"), "type t as record(a,  b as enum('x  y'))");
		assert.equal(RecordTypes.joinLines('xs:string |\r\n   xs:integer'), 'xs:string | xs:integer');
	});
});
