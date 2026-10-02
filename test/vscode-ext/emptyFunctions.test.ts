/**
 * Test suite for an xsl:function with no content - only xsl:param and xsl:note children, whitespace and comments -
 * which so always returns an empty sequence: reported as a warning whatever its 'as', found as the linter reads the
 * function's tokens - but not when the function has content: an instruction, a literal result element, or text, also
 * in a CDATA section.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const stylesheet = (as: string, content: string, version = '3.0') => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f" version="${version}">
  ${version === '4.0' ? '<xsl:item-type name="f:point" as="record(x, y)"/>' : ''}
  <xsl:function name="f:f"${as === '' ? '' : ` as="${as}"`}>
    <xsl:param name="x"/>${content}
  </xsl:function>
  <xsl:template name="xsl:initial-template"><xsl:sequence select="f:f(1)"/></xsl:template>
</xsl:stylesheet>`;

async function lint(xslt: string) {
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const isVersion4 = xslt.includes('version="4.0"');
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range), d.severity]);
}

const reported = [["XSLT: The function 'f:f' has no content, so it always returns an empty sequence - if its 'as' type doesn't allow an empty sequence, this is a type error (XTTE0780)", 'xsl:function', vscode.DiagnosticSeverity.Warning]];

suite('Functions with no content', () => {
	test('reported, whatever the type', async () => {
		for (const as of ['', 'xs:string', 'xs:string?', 'item()*', 'empty-sequence()', 'element()+', 'map(*)']) {
			assert.deepEqual(await lint(stylesheet(as, '')), reported, as);
		}
	});

	test('XSLT 4.0: a named item type, and a function with only a documentation note', async () => {
		assert.deepEqual(await lint(stylesheet('f:point', '', '4.0')), reported);
		assert.deepEqual(await lint(stylesheet('xs:string', '<xsl:note format="xdoc-md">Nothing yet.</xsl:note>', '4.0')), reported);
	});

	test('with only a comment, or a parameter with content', async () => {
		assert.deepEqual(await lint(stylesheet('', '<!-- to do -->')), reported);
		// with two parameters, the call has two arguments
		assert.deepEqual(await lint(stylesheet('', '<xsl:param name="y"><xsl:sequence select="1"/></xsl:param>').replace('f:f(1)', 'f:f(1, 2)')), reported);
	});

	test('an empty element', async () => {
		const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">
  <xsl:function name="f:f"/>
  <xsl:template name="xsl:initial-template"><xsl:sequence select="f:f()"/></xsl:template>
</xsl:stylesheet>`;
		assert.deepEqual(await lint(xslt), reported);
	});

	test('not when the function has content', async () => {
		for (const content of ['<xsl:sequence select="\'a\'"/>', '<r/>', 'text', '<![CDATA[text]]>', '<!-- first --><xsl:value-of select="1"/>']) {
			assert.deepEqual(await lint(stylesheet('xs:string', content)), [], content);
		}
	});
});
