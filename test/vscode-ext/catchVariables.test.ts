/**
 * Test suite for the variables in scope within xsl:catch: the XSLT 3.0 err:* variables, and err:stack-trace,
 * err:additional and err:map, new in XSLT 4.0 - which Saxon 13 also allows in XSLT 3.0 - but not outside xsl:catch
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(content: string, version: string) {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:err="http://www.w3.org/2005/xqt-errors" version="${version}">
  <xsl:template name="t">${content}</xsl:template>
</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const isVersion4 = version === '4.0';
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => document.getText(d.range));
}

const select = `$err:code, $err:description, $err:value, $err:module, $err:line-number, $err:column-number, $err:stack-trace, $err:additional, $err:map?code`;

suite('xsl:catch variables', () => {
	['3.0', '4.0'].forEach((version) => {
		test(`all in scope within xsl:catch - XSLT ${version}`, async () => {
			assert.deepEqual(await problems(`<xsl:try><xsl:sequence select="1"/><xsl:catch><xsl:sequence select="${select}"/></xsl:catch></xsl:try>`, version), []);
		});
	});

	test('not in scope outside xsl:catch', async () => {
		assert.deepEqual(await problems(`<xsl:sequence select="$err:stack-trace, $err:map"/>`, '4.0'), ['$err:stack-trace', '$err:map']);
	});
});
