/**
 * Test suite for a lexical '<' in XPath within XSLT: it's not allowed in an attribute value (it must be written as
 * '&lt;'), and in element content it starts a tag, so it ends a text value template - except within a CDATA section
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(body: string) {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0" expand-text="yes">
	<xsl:template name="t"><xsl:variable name="a" select="1"/>${body}</xsl:template>
</xsl:stylesheet>`;
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const inAttribute = (value: string) => [`XML: A '<' character is not allowed in an attribute value - use '&lt;' instead: '${value}'`, value];
const tvtNotClosed = `XPath: Expected '}' to end the text value template before '<' - use '&lt;' for the less-than operator`;

const cases: [string, string, string[][]][] = [
	['operator in an attribute', `<xsl:sequence select="$a < 3"/>`, [inAttribute('<')]],
	['operator and string in an attribute', `<xsl:sequence select='$a <= 3, "x<y"'/>`, [inAttribute('"x<y"'), inAttribute('<=')]],
	['entity reference in an attribute', `<xsl:sequence select="$a &lt; 3, 'x&lt;y'"/>`, []],
	['attribute value template', `<out a="{$a < 3}"/>`, [inAttribute('<')]],
	['entity reference in a text value template', `<out>{$a &lt; 3}</out>`, []],
	['text value template in a CDATA section', `<out><![CDATA[{$a < 3}]]></out>`, []],
	['unclosed text value template', `<out>{$a</out>`, [[tvtNotClosed, '$a']]],
	['element after a text value template', `<out>{$a}<b/></out>`, []],
];

suite('Lexical < in XPath within XSLT', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});

	test('a text value template ends at a tag start', async () => {
		const result = await problems(`<out>{$a < 3}</out>`);
		assert.deepInclude(result, [tvtNotClosed, '$a']);
	});
});
