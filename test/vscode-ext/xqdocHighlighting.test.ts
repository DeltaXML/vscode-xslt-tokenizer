/**
 * Test suite for the semantic tokens of documentation notes - an xsl:note with format="xqdoc": tags such as @param,
 * parameter names, headings, bold and italic text, code spans, links and CDATA markers each have a token type, and the
 * rest of the text is xqdocText - they replace the lexer's tokens within the note, with no overlaps
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XslLexer } from '../../src/xslLexer';
import { XqdocNotes } from '../../src/xqdocNote';
import { XsltSemanticTokensProvider } from '../../src/extension';

const legend = XslLexer.getTextmateTypeLegend().concat(XqdocNotes.tokenTypes);

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

const xqdocTokens = async (note: string) => (await semanticTokens(stylesheet(note))).filter((t) => t[3].startsWith('xqdoc')).map((t) => [t[2], t[3]]);

suite('Documentation notes: semantic tokens', () => {
	test('tags, a parameter name and inline Markdown', async () => {
		assert.deepEqual(await xqdocTokens(`<xsl:note format="xqdoc">
      # Area
      Returns the **area**, *scaled*, see [docs](http://example.com) and \`$a * 2\`.

      @param $a the _first_
    </xsl:note>`), [
			['# Area', 'xqdocHeading'],
			['Returns the ', 'xqdocText'], ['**area**', 'xqdocBold'], [', ', 'xqdocText'], ['*scaled*', 'xqdocItalic'], [', see ', 'xqdocText'],
			['[docs](http://example.com)', 'xqdocLink'], [' and ', 'xqdocText'], ['`$a * 2`', 'xqdocCode'], ['.', 'xqdocText'],
			['@param', 'xqdocTag'], [' ', 'xqdocText'], ['$a', 'xqdocParam'], [' the ', 'xqdocText'], ['_first_', 'xqdocItalic']
		]);
	});

	test('CDATA markers, with the text within classified', async () => {
		assert.deepEqual(await xqdocTokens(`<xsl:note format="xqdoc"><![CDATA[Uses <b> & more.
      @param $a the first]]></xsl:note>`), [
			['<![CDATA[', 'xqdocCdata'], ['Uses <b> & more.', 'xqdocText'],
			['@param', 'xqdocTag'], [' ', 'xqdocText'], ['$a', 'xqdocParam'], [' the first', 'xqdocText'], [']]>', 'xqdocCdata']
		]);
	});

	test('no overlapping tokens', async () => {
		const tokens = await semanticTokens(stylesheet(`<xsl:note format="xqdoc">Some &amp; text.\n      @return the **result**</xsl:note>`));
		for (let i = 1; i < tokens.length; i++) {
			const [line, character] = tokens[i];
			const [previousLine, previousCharacter, previousText] = tokens[i - 1];
			assert.isTrue(line > previousLine || character >= previousCharacter + previousText.length, `token ${i}: ${JSON.stringify(tokens[i])} after ${JSON.stringify(tokens[i - 1])}`);
		}
	});

	test('a note without format="xqdoc" keeps the lexer tokens', async () => {
		assert.deepEqual(await xqdocTokens(`<xsl:note>@param $a **not** highlighted</xsl:note>`), []);
	});

	test('a note with child elements keeps the lexer tokens', async () => {
		assert.deepEqual(await xqdocTokens(`<xsl:note format="xqdoc">Uses <b>bold</b> markup</xsl:note>`), []);
	});
});
