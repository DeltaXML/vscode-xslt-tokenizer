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

	['3.0', '4.0'].forEach((version) => {
		test(`an xsl:with-param element for each parameter (XSLT ${version})`, async () => {
			const items = await labels(`<xsl:call-template name="draw">\n      <¦\n    </xsl:call-template>`, version);
			assert.deepEqual(items.slice(0, 2), ['xsl:with-param colour', 'xsl:with-param size']);
			assert.include(items, 'xsl:with-param');
		});
	});

	test('an xsl:with-param element only for the parameters not passed', async () => {
		const items = await labels(`<xsl:call-template name="draw">\n      <xsl:with-param name="colour" select="'red'"/>\n      <¦\n    </xsl:call-template>`, '4.0');
		assert.include(items, 'xsl:with-param size');
		assert.notInclude(items, 'xsl:with-param colour');
	});

	test('no xsl:with-param elements for another parent', async () => {
		const items = await labels(`<xsl:call-template name="draw">\n      <xsl:with-param name="colour">\n        <¦\n      </xsl:with-param>\n    </xsl:call-template>`, '4.0');
		assert.notInclude(items, 'xsl:with-param size');
	});

	const iterate = (content: string) => `<xsl:iterate select="1 to 5">
      <xsl:param name="total" as="xs:integer" select="0"/>
      <xsl:param name="count" select="0"/>
      <xsl:next-iteration>
        ${content}
      </xsl:next-iteration>
    </xsl:iterate>`;

	test('an xsl:with-param element for each xsl:iterate parameter in xsl:next-iteration', async () => {
		const items = await labels(iterate('<¦'), '3.0');
		assert.deepEqual(items.slice(0, 2), ['xsl:with-param total', 'xsl:with-param count']);
	});

	test('an xsl:with-param element only for the xsl:iterate parameters not passed', async () => {
		const items = await labels(iterate(`<xsl:with-param name="total" select="$total + ."/>\n        <¦`), '4.0');
		assert.include(items, 'xsl:with-param count');
		assert.notInclude(items, 'xsl:with-param total');
	});

	test("the xsl:iterate parameter's type", async () => {
		const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template name="t">
    ${iterate('<¦')}
  </xsl:template>
</xsl:stylesheet>`;
		const offset = marked.indexOf('¦');
		const doc = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(doc, doc.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		assert.deepEqual(items.slice(0, 2).map((item) => item.detail), ['xs:integer', 'item()*']);
		assert.equal((items[0].insertText as vscode.SnippetString).value, 'xsl:with-param name="total" select="$1"/>$0');
	});
});
