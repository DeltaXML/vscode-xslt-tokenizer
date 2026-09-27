/**
 * Test suite for the semantic tokens of documentation notes - an xsl:note with format="xdoc-md": tags such as @param,
 * parameter names, headings, bold and italic text, code spans, links and CDATA markers each have a token type, and the
 * rest of the text is xdocText - they replace the lexer's tokens within the note, with no overlaps
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XslLexer } from '../../src/xslLexer';
import { XdocNotes } from '../../src/xdocNote';
import { XsltSemanticTokensProvider } from '../../src/extension';

const legend = XslLexer.getTextmateTypeLegend().concat(XdocNotes.tokenTypes);

// the tokens as [line, character, text, type]
async function semanticTokens(xslt: string) {
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const result = await new XsltSemanticTokensProvider(XSLTConfiguration.configuration).provideDocumentSemanticTokens(document, new vscode.CancellationTokenSource().token);
	const tokens: [number, number, string, string][] = [];
	let line = 0;
	let character = 0;
	for (let i = 0; i < result.data.length; i += 5) {
		line += result.data[i];
		character = result.data[i] === 0 ? character + result.data[i + 1] : result.data[i + 1];
		const text = document.lineAt(line).text.substring(character, character + result.data[i + 2]);
		tokens.push([line, character, text, legend[result.data[i + 3]]]);
	}
	return tokens;
}

function stylesheet(note: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="f" version="4.0">
  <xsl:function name="f:f">
    ${note}
    <xsl:param name="a"/>
  </xsl:function>
</xsl:stylesheet>`;
}

const xdocTokens = async (note: string) => (await semanticTokens(stylesheet(note))).filter((t) => t[3].startsWith('xdoc')).map((t) => [t[2], t[3]]);

suite('Documentation notes: semantic tokens', () => {
	test('tags, a parameter name and inline Markdown', async () => {
		assert.deepEqual(await xdocTokens(`<xsl:note format="xdoc-md">
      # Area
      Returns the **area**, *scaled*, see [docs](http://example.com) and \`$a * 2\`.

      @param $a the _first_
    </xsl:note>`), [
			['# Area', 'xdocHeading'],
			['Returns the ', 'xdocText'], ['**area**', 'xdocBold'], [', ', 'xdocText'], ['*scaled*', 'xdocItalic'], [', see ', 'xdocText'],
			['[docs](http://example.com)', 'xdocLink'], [' and ', 'xdocText'], ['`$a * 2`', 'xdocCode'], ['.', 'xdocText'],
			['@param', 'xdocTag'], [' ', 'xdocText'], ['$a', 'xdocParam'], [' the ', 'xdocText'], ['_first_', 'xdocItalic']
		]);
	});

	test('CDATA markers, with the text within classified', async () => {
		assert.deepEqual(await xdocTokens(`<xsl:note format="xdoc-md"><![CDATA[Uses <b> & more.
      @param $a the first]]></xsl:note>`), [
			['<![CDATA[', 'xdocCdata'], ['Uses <b> & more.', 'xdocText'],
			['@param', 'xdocTag'], [' ', 'xdocText'], ['$a', 'xdocParam'], [' the first', 'xdocText'], [']]>', 'xdocCdata']
		]);
	});

	test('no overlapping tokens', async () => {
		const tokens = await semanticTokens(stylesheet(`<xsl:note format="xdoc-md">Some &amp; text.\n      @return the **result**</xsl:note>`));
		for (let i = 1; i < tokens.length; i++) {
			const [line, character] = tokens[i];
			const [previousLine, previousCharacter, previousText] = tokens[i - 1];
			assert.isTrue(line > previousLine || character >= previousCharacter + previousText.length, `token ${i}: ${JSON.stringify(tokens[i])} after ${JSON.stringify(tokens[i - 1])}`);
		}
	});

	test('a note without format="xdoc-md" keeps the lexer tokens', async () => {
		assert.deepEqual(await xdocTokens(`<xsl:note>@param $a **not** highlighted</xsl:note>`), []);
	});

	test('a note with child elements keeps the lexer tokens', async () => {
		assert.deepEqual(await xdocTokens(`<xsl:note format="xdoc-md">Uses <b>bold</b> markup</xsl:note>`), []);
	});
});
