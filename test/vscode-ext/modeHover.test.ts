/**
 * Test suite for the hover of a mode's name: where the mode is applied from - the other modes of the template rules,
 * the named templates and the functions with an xsl:apply-templates for it, across the stylesheet's modules, with the
 * number of each - not the mode itself, which its own template rules commonly apply
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const main = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:import href="lib.xsl"/>
  <xsl:mode name="summary"/>
  <xsl:template match="/">
    <xsl:apply-templates mode="summary"/>
    <xsl:apply-templates select="*" mode="summary"/>
  </xsl:template>
  <xsl:template match="item" mode="summary">
    <xsl:apply-templates mode="#current"/>
  </xsl:template>
  <xsl:template match="item" mode="detail other">
    <xsl:apply-templates select="x" mode="summary"/>
  </xsl:template>
  <xsl:template name="t">
    <xsl:apply-templates mode="summary"/>
  </xsl:template>
  <xsl:template match="z" mode="unused"/>
  <xsl:template match="z" mode="recursive">
    <xsl:apply-templates select="*" mode="recursive"/>
  </xsl:template>
</xsl:stylesheet>`;

const lib = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="f" version="3.0">
  <xsl:function name="f:g">
    <xsl:apply-templates mode="summary"/>
  </xsl:function>
</xsl:stylesheet>`;

suite('Mode hover', () => {
	let document: vscode.TextDocument;
	let folder: string;

	const hoverAt = async (text: string, offset = 2) => {
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, document.positionAt(main.indexOf(text) + offset)) ?? [];
		return hovers.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n');
	};

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-mode-hover-'));
		fs.writeFileSync(path.join(folder, 'main.xsl'), main);
		fs.writeFileSync(path.join(folder, 'lib.xsl'), lib);
		document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(folder, 'main.xsl')));
	});

	suiteTeardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	test('where a mode is applied from: template rules by mode, named templates and functions - in all modules', async function () {
		this.timeout(10000);
		const hover = await hoverAt('summary">\n    <xsl:apply-templates mode="#current"');
		const items = hover.split('\n').filter((line) => line.startsWith('- ')).sort();
		assert.deepEqual(items, [
			'- function `f:g`',
			'- mode `#default` (2)',
			'- mode `detail`, mode `other`',
			'- named template `t`',
		]);
	});

	test('a mode only applied by its own template rules: maybe the initial mode', async () => {
		const hover = await hoverAt('recursive">');
		assert.include(hover, 'Only applied by its own template rules - it may be the initial mode');
		assert.notInclude(hover, 'Applied from');
	});

	test('the same, from the xsl:mode declaration or an xsl:apply-templates', async function () {
		this.timeout(10000);
		const fromTemplate = await hoverAt('summary">\n    <xsl:apply-templates mode="#current"');
		assert.equal(await hoverAt('name="summary"', 7), fromTemplate);
		assert.equal(await hoverAt('mode="summary"/>\n    <xsl:apply-templates select', 7), fromTemplate);
	});

	test('a mode not applied: maybe the initial mode', async () => {
		assert.include(await hoverAt('unused'), 'Not applied by an `xsl:apply-templates`');
	});

	test('no mode hover for #current', async () => {
		assert.notInclude(await hoverAt('#current', 3), '**mode**');
	});
});
