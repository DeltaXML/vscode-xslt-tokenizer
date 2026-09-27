/**
 * Test suite for completions of XSLT instruction names in XSLT 3.0 and 4.0 - e.g. the name of an xsl:with-param in an
 * xsl:call-template: the called template's parameter names - including after the completion trigger for a typed ',',
 * '{', ':' or quote was set for another position, e.g. when a further character was typed before the triggered request
 * (it's only for its own position)
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';

async function labels(body: string, version: string, triggerOffsetDelta?: number) {
	const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
  <xsl:template name="draw"><xsl:param name="colour"/><xsl:param name="size"/></xsl:template>
  <xsl:template match="a" mode="m"/>
  <xsl:template name="t">
    ${body}
  </xsl:template>
</xsl:stylesheet>`;
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	if (triggerOffsetDelta !== undefined) {
		DocumentChangeHandler.setCommaTrigger(document, offset + triggerOffsetDelta);
	}
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.map((item) => item.label as string);
}

suite('xsl:with-param name completions', () => {
	['3.0', '4.0'].forEach((version) => {
		test(`the called template's name (XSLT ${version})`, async () => {
			assert.includeMembers(await labels(`<xsl:call-template name="¦"/>`, version), ['draw', 't']);
		});
		test(`a mode name (XSLT ${version})`, async () => {
			assert.include(await labels(`<xsl:apply-templates mode="¦"/>`, version), 'm');
		});
		test(`the called template's parameters (XSLT ${version})`, async () => {
			assert.deepEqual(await labels(`<xsl:call-template name="draw"><xsl:with-param name="¦"/></xsl:call-template>`, version), ['colour', 'size']);
		});
	});

	test('a trigger for the previous position is not used, e.g. the quote before a typed character', async () => {
		assert.deepEqual(await labels(`<xsl:call-template name="draw"><xsl:with-param name="c¦"/></xsl:call-template>`, '4.0', -1), ['colour', 'size']);
	});

	test('a trigger is only used once', async () => {
		const body = `<xsl:call-template name="draw"><xsl:with-param name="¦"/></xsl:call-template>`;
		// the trigger for this position gives only record and enumeration values - none here
		assert.deepEqual(await labels(body, '4.0', 0), []);
		assert.deepEqual(await labels(body, '4.0'), ['colour', 'size']);
	});
});
