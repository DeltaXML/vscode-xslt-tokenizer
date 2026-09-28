/**
 * Test suite for XPath completions within empty braces: the enclosed expression of a string template, e.g. `a {|}`,
 * and attribute and text value templates, e.g. b="{|}" and <p>{|}</p> - which have no tokens when empty - with the
 * functions, variables and expression snippets, as at the start of any expression. Escaped braces, attributes that
 * aren't attribute value templates, and text without expand-text have none.
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

async function labels(body: string, version = '4.0') {
	const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
  <xsl:template match="/">
    <xsl:param name="a" select="1"/>
    ${body}
  </xsl:template>
</xsl:stylesheet>`;
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	return (Array.isArray(result) ? result : result?.items ?? []).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

const expressionStart = ['$a', 'count', 'let $x := … return …'];

suite('Completions within empty braces', () => {
	const cases: [string, string, string?][] = [
		['a string template', '<xsl:sequence select="`Hello {¦}`"/>'],
		['a string template, with spaces', '<xsl:sequence select="`Hello { ¦ }`"/>'],
		['a string template, after another enclosed expression', '<xsl:sequence select="`a {$a} b {¦}`"/>'],
		['an attribute value template', '<a b="{¦}"/>'],
		['an attribute value template, after text', '<a b="x {¦}"/>'],
		['an attribute value template in XSLT 3.0', '<a b="{¦}"/>', '3.0'],
		['an attribute value template attribute of an XSLT instruction', '<xsl:element name="{¦}"/>'],
		['a text value template', '<p xsl:expand-text="yes">{¦}</p>'],
		['a text value template, with expand-text on an ancestor', '<xsl:copy expand-text="yes"><p>{¦}</p></xsl:copy>']
	];
	cases.forEach(([name, body, version]) => {
		test(name, async () => {
			assert.includeMembers(await labels(body, version), expressionStart);
		});
	});

	const noneCases: [string, string][] = [
		['escaped braces in an attribute value template', '<a b="{{¦}}"/>'],
		['an attribute of an XSLT instruction that is not an attribute value template', '<xsl:apply-templates mode="{¦}"/>'],
		['text without expand-text', '<p>{¦}</p>']
	];
	noneCases.forEach(([name, body]) => {
		test(`none for ${name}`, async () => {
			assert.notIncludeMembers(await labels(body), ['count']);
		});
	});

	test('only variables after $', async () => {
		assert.deepEqual(await labels('<xsl:sequence select="`Hello {$¦}`"/>'), ['$a']);
	});
});
