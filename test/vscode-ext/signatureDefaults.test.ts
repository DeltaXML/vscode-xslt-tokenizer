/**
 * Test suite for the defaults of optional parameters in the signatures of user-defined functions and named templates,
 * in hover and signature help, in the XPath 4.0 notation used for built-in functions, e.g. $scale as xs:double := 1
 * - a function parameter is optional with required="no": its default is its select, '…' for a sequence constructor,
 *   or () if it has neither
 * - a template parameter is optional unless required="yes": its default is shown only for a select or a sequence
 *   constructor, as the default otherwise depends on its type
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
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'signature-defaults-'));
const namespaces = `xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:ex="ex" version="4.0"`;

fs.writeFileSync(path.join(folder, 'common.xsl'), `<xsl:stylesheet ${namespaces}>
  <xsl:function name="ex:label" as="xs:string">
    <xsl:param name="text" as="xs:string"/>
    <xsl:param name="prefix" as="xs:string" required="no" select="'Note: '"/>
    <xsl:sequence select="$prefix || $text"/>
  </xsl:function>
</xsl:stylesheet>`);

let fileCount = 0;

async function open(body: string) {
	const marked = `<xsl:stylesheet ${namespaces}>
  <xsl:import href="common.xsl"/>
  <xsl:function name="ex:area" as="xs:double">
    <xsl:param name="width" as="xs:double"/>
    <xsl:param name="height" as="xs:double"/>
    <xsl:param name="scale" as="xs:double" required="no" select="1"/>
  </xsl:function>
  <xsl:function name="ex:options">
    <xsl:param name="none" required="no"/>
    <xsl:param name="content" required="no">
      <xsl:sequence select="1"/>
    </xsl:param>
    <xsl:param name="long" required="no" select="string-join(('first', 'second', 'third', 'fourth'), ', ')"/>
    <xsl:param name="entity" required="no" select="5 &lt; 6"/>
  </xsl:function>
  <xsl:template name="frame">
    <xsl:param name="width" select="1"/>
    <xsl:param name="colour" required="yes"/>
    <xsl:param name="style"/>
    <xsl:param name="border">
      <xsl:sequence select="'thin'"/>
    </xsl:param>
  </xsl:template>
  <xsl:template name="t">
    ${body}
  </xsl:template>
</xsl:stylesheet>`;
	const offset = marked.indexOf('¦');
	const file = path.join(folder, `main-${fileCount++}.xsl`);
	fs.writeFileSync(file, marked.replace('¦', ''));
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	return { document, position: document.positionAt(offset) };
}

async function signatureHelp(body: string) {
	const { document, position } = await open(body);
	const provider = new XSLTSignatureHelpProvider(XSLTConfiguration.configuration, new XsltDefinitionProvider(XSLTConfiguration.configuration));
	const help = await provider.provideSignatureHelp(document, position, new vscode.CancellationTokenSource().token);
	const signature = help!.signatures[help!.activeSignature];
	return { label: signature.label, activeParameter: signature.parameters[help!.activeParameter]?.label };
}

async function hover(body: string) {
	const { document, position } = await open(body);
	const provider = new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), { ...XSLTConfiguration.configuration, isVersion4: true });
	const result = await provider.provideHover(document, position, new vscode.CancellationTokenSource().token);
	return (result?.contents[0] as vscode.MarkdownString).value;
}

suite('Signatures: the defaults of optional parameters', () => {
	suiteTeardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	test('signature help for a function, with the active parameter', async () => {
		assert.deepEqual(await signatureHelp('<xsl:sequence select="ex:area(2, 3, ¦)"/>'), {
			label: 'ex:area($width as xs:double, $height as xs:double, $scale as xs:double := 1) as xs:double',
			activeParameter: '$scale as xs:double := 1'
		});
	});

	test('a default of (), a sequence constructor, a long select and an entity', async () => {
		assert.equal((await signatureHelp('<xsl:sequence select="ex:options(¦)"/>')).label,
			`ex:options($none := (), $content := …, $long := string-join(('first', 'second', 'third'…, $entity := 5 < 6)`);
	});

	test('hover for a function', async () => {
		assert.include(await hover('<xsl:sequence select="ex:a¦rea(2, 3)"/>'), 'ex:area($width as xs:double, $height as xs:double, $scale as xs:double := 1) as xs:double');
	});

	test('a function in an imported module', async () => {
		assert.equal((await signatureHelp('<xsl:sequence select="ex:label(¦)"/>')).label, `ex:label($text as xs:string, $prefix as xs:string := 'Note: ') as xs:string`);
	});

	test('signature help for a named template', async () => {
		assert.equal((await signatureHelp('<xsl:call-template name="frame">¦</xsl:call-template>')).label,
			'template frame($width := 1, $colour, $style, $border := …)');
	});

	test('hover for a template parameter', async () => {
		assert.include(await hover('<xsl:call-template name="frame"><xsl:with-param name="wid¦th" select="2"/></xsl:call-template>'), '$width := 1');
	});
});
