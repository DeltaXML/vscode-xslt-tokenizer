/**
 * Test suite for signature help for user-defined functions and named templates, declared in the stylesheet or in an
 * imported module - with the descriptions from their documentation notes, xsl:note with format="xdoc-md"
 * - for a named template, within an xsl:call-template: its start tag, its content, or an xsl:with-param within it -
 *   the active parameter is the one for the xsl:with-param, or otherwise the first that no xsl:with-param sets
 *
 * The files are written to a temporary folder, as the imported module is found from the stylesheet's path. The cursor
 * position is marked by '¦'.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTSignatureHelpProvider } from '../../src/xsltSignatureHelpProvider';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'signature-help-'));
const namespaces = `xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0"`;

fs.writeFileSync(path.join(folder, 'common.xsl'), `<xsl:stylesheet ${namespaces}>
  <xsl:function name="cx:area" as="xs:double">
    <xsl:note format="xdoc-md">
      Returns the area of a shape.

      @param $shape the shape
      @param $scale the scale factor
    </xsl:note>
    <xsl:param name="shape"/>
    <xsl:param name="scale" as="xs:double"/>
    <xsl:sequence select="1"/>
  </xsl:function>
  <xsl:template name="frame">
    <xsl:note format="xdoc-md">
      Draws a frame.

      @param $width the frame width
    </xsl:note>
    <xsl:param name="width"/>
  </xsl:template>
</xsl:stylesheet>`);

let fileCount = 0;

// the signature help for the stylesheet, which imports common.xsl, at the cursor
async function signatureHelp(body: string) {
	const marked = `<xsl:stylesheet ${namespaces}>
  <xsl:import href="common.xsl"/>
  <xsl:template name="draw">
    <xsl:note format="xdoc-md">
      Draws a shape.

      @param $colour the fill colour
      @param $size the size
    </xsl:note>
    <xsl:param name="colour"/>
    <xsl:param name="size" as="xs:integer"/>
  </xsl:template>
  <xsl:template name="t">
    ${body}
  </xsl:template>
</xsl:stylesheet>`;
	const offset = marked.indexOf('¦');
	const file = path.join(folder, `main-${fileCount++}.xsl`);
	fs.writeFileSync(file, marked.replace('¦', ''));
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	const provider = new XSLTSignatureHelpProvider(XSLTConfiguration.configuration, new XsltDefinitionProvider(XSLTConfiguration.configuration));
	const help = await provider.provideSignatureHelp(document, document.positionAt(offset), new vscode.CancellationTokenSource().token);
	if (!help) {
		return undefined;
	}
	const signature = help.signatures[help.activeSignature];
	return {
		label: signature.label,
		documentation: (signature.documentation as vscode.MarkdownString | undefined)?.value,
		activeParameter: help.activeParameter,
		activeParameterDocumentation: (signature.parameters[help.activeParameter]?.documentation as vscode.MarkdownString | undefined)?.value
	};
}

suite('Signature help: user-defined functions and named templates', () => {
	suiteTeardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	test('an imported function', async () => {
		assert.deepEqual(await signatureHelp(`<xsl:sequence select="cx:area(1, ¦)"/>`), {
			label: 'cx:area($shape, $scale as xs:double) as xs:double',
			documentation: 'Returns the area of a shape.',
			activeParameter: 1,
			activeParameterDocumentation: 'the scale factor'
		});
	});

	test('a named template: the content of xsl:call-template', async () => {
		assert.deepEqual(await signatureHelp(`<xsl:call-template name="draw">¦</xsl:call-template>`), {
			label: 'template draw($colour, $size as xs:integer)',
			documentation: 'Draws a shape.',
			activeParameter: 0,
			activeParameterDocumentation: 'the fill colour'
		});
	});

	test('a named template: the first parameter that no xsl:with-param sets', async () => {
		const help = await signatureHelp(`<xsl:call-template name="draw"><xsl:with-param name="colour" select="'red'"/>¦</xsl:call-template>`);
		assert.equal(help?.activeParameter, 1);
		assert.equal(help?.activeParameterDocumentation, 'the size');
	});

	test('a named template: within an xsl:with-param start tag', async () => {
		const help = await signatureHelp(`<xsl:call-template name="draw"><xsl:with-param name="size" select="¦"/></xsl:call-template>`);
		assert.equal(help?.activeParameter, 1);
	});

	test('a named template: within an xsl:with-param content', async () => {
		const help = await signatureHelp(`<xsl:call-template name="draw"><xsl:with-param name="size">¦</xsl:with-param><xsl:with-param name="colour" select="'red'"/></xsl:call-template>`);
		assert.equal(help?.activeParameter, 1);
	});

	test('a named template: within the xsl:call-template start tag', async () => {
		const help = await signatureHelp(`<xsl:call-template name="draw"¦/>`);
		assert.equal(help?.label, 'template draw($colour, $size as xs:integer)');
	});

	test('an imported named template', async () => {
		assert.deepEqual(await signatureHelp(`<xsl:call-template name="frame">¦</xsl:call-template>`), {
			label: 'template frame($width)',
			documentation: 'Draws a frame.',
			activeParameter: 0,
			activeParameterDocumentation: 'the frame width'
		});
	});

	test('not within an xsl:call-template', async () => {
		assert.isUndefined(await signatureHelp(`<xsl:variable name="v"¦ select="1"/>`));
	});
});
