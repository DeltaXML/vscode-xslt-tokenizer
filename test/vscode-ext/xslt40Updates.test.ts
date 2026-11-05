/**
 * Test suite for XSLT 4.0 changes checked against Saxon 13: the functions apply-templates, character-map and
 * current-merge-key-array (XSLT 4.0 only - Saxon 13 has them only with syntax extensions), a global variable that refers
 * to itself within an inline function, the wording for a duplicate xsl:map-entry key in an xsl:map with a duplicates
 * attribute, and the attributes that Saxon 13 doesn't implement: xsl:evaluate/@trusted and xsl:stylesheet/@main-module
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

// the diagnostics, as [message, text of the range], for the declarations and the content of a named template
async function problems(declarations: string, content: string, version = '4.0', rootAttributes = '') {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:my="urn:my" version="${version}"${rootAttributes}>
  ${declarations}
  <xsl:template name="t">${content}</xsl:template>
</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const isVersion4 = version === '4.0';
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.filter((d) => !/unused/.test(d.message)).map((d) => [d.message, document.getText(d.range)]);
}

const characterMap = `<xsl:character-map name="my:c"><xsl:output-character character="a" string="b"/></xsl:character-map>`;
const functions = `<xsl:sequence select="apply-templates(1), apply-templates(1, {'mode': #my:m}), character-map(#my:c)"/>
  <xsl:merge><xsl:merge-source select="1 to 2"><xsl:merge-key select="."/></xsl:merge-source><xsl:merge-action><xsl:sequence select="current-merge-key-array()"/></xsl:merge-action></xsl:merge>`;

suite('XSLT 4.0 functions', () => {
	test('apply-templates, character-map and current-merge-key-array in XSLT 4.0', async () => {
		assert.deepEqual(await problems(characterMap, functions), []);
	});

	test('not in XSLT 3.0', async () => {
		const found = (await problems(characterMap, `<xsl:sequence select="apply-templates(1), character-map(xs:QName('my:c'))"/>`, '3.0')).map(([, text]) => text);
		assert.deepEqual(found, ['apply-templates', 'character-map']);
	});
});

suite('A global variable that refers to itself', () => {
	test('within an inline function', async () => {
		assert.deepEqual(await problems(`<xsl:variable name="fact" select="fn($n) { if ($n le 1) then 1 else $n * $fact($n - 1) }"/>`, `<xsl:sequence select="$fact(5)"/>`), []);
	});

	test('within an inline function written with the function keyword', async () => {
		assert.deepEqual(await problems(`<xsl:variable name="f" select="function($n) { if ($n le 0) then 0 else $f($n - 1) }"/>`, `<xsl:sequence select="$f(5)"/>`), []);
	});

	test('outside an inline function, it is circular', async () => {
		const found = (await problems(`<xsl:variable name="x" select="(fn() { 1 }, $x + 1)"/>`, `<xsl:sequence select="$x"/>`)).map(([, text]) => text);
		assert.deepEqual(found, ['$x']);
	});
});

suite('xsl:map: a duplicate xsl:map-entry key', () => {
	const entries = `<xsl:map-entry key="'a'" select="1"/><xsl:map-entry key="'a'" select="2"/>`;

	test('in an xsl:map with a duplicates attribute, handled by it', async () => {
		const found = await problems('', `<xsl:map duplicates="fn($a, $b) { $a + $b }">${entries}</xsl:map>`);
		assert.deepEqual(found, [[`XSLT: Duplicate key in the xsl:map, handled by its duplicates attribute - an xsl:map-entry has the same key: 'a'`, `'a'`]]);
	});

	test('in an xsl:map without one', async () => {
		const found = await problems('', `<xsl:map>${entries}</xsl:map>`);
		assert.deepEqual(found, [[`XSLT: Duplicate key in the xsl:map - an xsl:map-entry has the same key: 'a'`, `'a'`]]);
	});
});

suite('XSLT 4.0 attributes not implemented by Saxon 13', () => {
	test('xsl:evaluate/@trusted', async () => {
		const found = await problems('', `<xsl:evaluate xpath="'1 + 1'" trusted="no"/>`);
		assert.deepEqual(found, [[`XSLT: Invalid attribute on element 'xsl:evaluate': 'trusted'`, 'xsl:evaluate']]);
	});

	test('xsl:stylesheet/@main-module', async () => {
		const found = await problems('', '', '4.0', ' main-module="main.xsl"');
		assert.deepEqual(found, [[`XSLT: Invalid attribute on element 'xsl:stylesheet': 'main-module'`, 'xsl:stylesheet']]);
	});
});
