/**
 * Test suite for lexical problems that otherwise show only when Saxon parses or runs the stylesheet: '--' inside a
 * comment (reported where it is, without the rest of the file being taken as the comment); a character reference to a
 * character XML doesn't allow, e.g. &#x1;; char() or codepoints-to-string() with an integer literal that isn't an XML
 * character, e.g. char(0x1F); and, with expand-text off, text that looks like a text value template, e.g. {$name}
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(body: string, { version = '4.0', prolog = '', topLevel = '' } = {}) {
	const xslt = `${prolog}<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">${topLevel}
	<xsl:template name="t">${body}</xsl:template>
</xsl:stylesheet>`;
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const docType = xslLexer.isXSLT40 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT;
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, docType, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => [d.message, document.getText(d.range)]);
}

const doubleHyphen = ["XML: '--' is not allowed inside a comment", '--'];
const charRef = (ref: string) => [`XML: Character reference '&${ref};' is to a character that isn't allowed in XML`, `&${ref};`];
const codepoint = (call: string, literal: string) => [`XPath: ${call} fails at run time (FOCH0001): the codepoint isn't an XML 1.0 character - unless the processor is set up for XML 1.1`, literal];
const tvt = (text: string) => [`XSLT: '${text}' is output as written: expand-text is off here - for a text value template, add expand-text="yes" to an xsl: element, or xsl:expand-text="yes" to a literal result element`, '{'];

suite('Lexical problems Saxon would otherwise report', () => {
	suite('comments', () => {
		test("'--' in a comment: reported where it is, and the rest of the file is still checked", async () => {
			assert.deepEqual(await problems('<out/>', { topLevel: '\n<!-- a -- b -->' }), [doubleHyphen]);
		});
		test("'--' in a multi-line comment", async () => {
			assert.deepEqual(await problems('<out/>', { topLevel: '\n<!-- a\n b -- c\n d -->' }), [doubleHyphen]);
		});
		test("'--->' ends the comment, but isn't allowed", async () => {
			assert.deepEqual(await problems('<out/>', { topLevel: '\n<!-- a --->' }), [["XML: '--' is not allowed inside a comment", '-'.repeat(2)]]);
		});
		test('valid comments', async () => {
			assert.deepEqual(await problems('<!-- a - b --><!----><out/>', { topLevel: '\n<!-- a -\n- b -->' }), []);
		});
	});

	suite('character references', () => {
		test('a control character: in text, an attribute value and XPath', async () => {
			assert.deepEqual(await problems(`<out a="&#x1;">&#1;</out><xsl:sequence select="'&#x1F;'"/>`),
				[charRef('#x1'), charRef('#1'), charRef('#x1F')]);
		});
		test('#0 and surrogates', async () => {
			assert.deepEqual(await problems('<out>&#0;&#xD800;&#xFFFE;</out>'), [charRef('#0'), charRef('#xD800'), charRef('#xFFFE')]);
		});
		test('allowed characters', async () => {
			assert.deepEqual(await problems('<out>&#9;&#xA;&#13;&#x20;&#xFFFD;&#x10000;&#x1F600;</out>'), []);
		});
		test('XML 1.1 allows control characters, but not #0', async () => {
			assert.deepEqual(await problems('<out>&#x1;&#0;</out>', { prolog: '<?xml version="1.1"?>\n' }), [charRef('#0')]);
		});
	});

	suite('char() and codepoints-to-string()', () => {
		test('an integer literal that is not an XML character', async () => {
			assert.deepEqual(await problems(`<xsl:sequence xmlns:fn="http://www.w3.org/2005/xpath-functions" select="char(0x1F), fn:char(0b1), codepoints-to-string(31), char(0xD800)"/>`), [
				codepoint('char(0x1F)', '0x1F'), codepoint('char(0b1)', '0b1'), codepoint('codepoints-to-string(31)', '31'), codepoint('char(0xD800)', '0xD800')]);
		});
		test('allowed codepoints, and arguments that are not a single literal', async () => {
			assert.deepEqual(await problems(`<xsl:sequence select="char(9), char(0x1F600), codepoints-to-string((65, 66)), codepoints-to-string(1 + 1), char('tab'), abs(1)"/>`), []);
		});
	});

	suite('text value templates with expand-text off', () => {
		test('a variable reference or lookup in text', async () => {
			assert.deepEqual(await problems('<out>{$name}</out><v>{ ?value }</v>'), [tvt('{$name}'), tvt('{ ?value }')]);
		});
		test('expand-text on: a text value template', async () => {
			assert.deepEqual(await problems('<xsl:variable name="name" select="1"/><out xsl:expand-text="yes">{$name}</out>'), []);
		});
		test('other braces in text, and escaped braces', async () => {
			assert.deepEqual(await problems('<style>p { color: red }</style><out>{{$name}} {name} { } {$}</out>'), []);
		});
	});
});
