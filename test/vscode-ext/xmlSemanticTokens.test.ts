/**
 * Test suite for the semantic tokens of an XML file: a CDATA section's '<![CDATA[' and ']]>' as tag punctuation and its
 * content as text - on each line of a multi-line section - and the name of a namespace declaration, e.g. xmlns:xsi, with
 * its own type, as in XSLT. None for anything else, which keeps VS Code's XML grammar's colors. Not for markup within a
 * comment, processing instruction or CDATA section; a CDATA section not yet ended runs to the end.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XmlSemanticTokens } from '../../src/xmlSemanticTokens';
import { revertAndCloseEditorsIn } from './testEditors';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xml-cdata-tokens-'));

// each token as its text and kind
const tokensOf = (text: string) => {
	const lines = text.split(/\r\n|\r|\n/);
	return XmlSemanticTokens.tokens(text).map((t) => [lines[t.line].substring(t.character, t.character + t.length), t.kind]);
};

suite('XML semantic tokens: CDATA sections and namespace declarations', () => {
	suiteTeardown(async () => {
		await revertAndCloseEditorsIn(folder);
	});

	test('the delimiters as punctuation, the content as text', () => {
		assert.deepEqual(tokensOf('<a>x <![CDATA[1 < 2 && y]]> z</a>'), [['<![CDATA[', 'punctuation'], ['1 < 2 && y', 'text'], [']]>', 'punctuation']]);
	});

	test('a multi-line section: a token for each line\'s content, without the line ends - LF or CRLF', () => {
		const expected = [['<![CDATA[', 'punctuation'], ['first', 'text'], ['  second', 'text'], [']]>', 'punctuation']];
		assert.deepEqual(tokensOf('<a><![CDATA[first\n  second]]></a>'), expected);
		assert.deepEqual(tokensOf('<a><![CDATA[first\r\n  second]]></a>'), expected);
	});

	test('an empty section, and several', () => {
		assert.deepEqual(tokensOf('<a><![CDATA[]]><b><![CDATA[x]]></b></a>'),
			[['<![CDATA[', 'punctuation'], [']]>', 'punctuation'], ['<![CDATA[', 'punctuation'], ['x', 'text'], [']]>', 'punctuation']]);
	});

	test('not within a comment or processing instruction - and none without a section', () => {
		assert.deepEqual(tokensOf('<a><!-- <![CDATA[x]]> --><?pi <![CDATA[y]]> ?></a>'), []);
		assert.deepEqual(tokensOf('<a>text</a>'), []);
	});

	test('a section not yet ended runs to the end', () => {
		assert.deepEqual(tokensOf('<a><![CDATA[typing\nmore'), [['<![CDATA[', 'punctuation'], ['typing', 'text'], ['more', 'text']]);
	});

	test('namespace declarations: the name, with or without a prefix - not other attributes, nor in a value', () => {
		assert.deepEqual(tokensOf(`<a xmlns="urn:a" id="xmlns:no" xmlns:xsi = 'http://www.w3.org/2001/XMLSchema-instance'>\n  <b xmlns:p="urn:p" xmlnsx="1"/>\n</a>`),
			[['xmlns', 'xmlns'], ['xmlns:xsi', 'xmlns'], ['xmlns:p', 'xmlns']]);
	});

	test('namespace declarations on several lines, and in order with CDATA sections', () => {
		assert.deepEqual(tokensOf('<a\n  xmlns:p="urn:p"\n  id="1">\n  <![CDATA[<b xmlns:q="urn:q"/>]]>\n  <c xmlns:r="urn:r"/>\n</a>'),
			[['xmlns:p', 'xmlns'], ['<![CDATA[', 'punctuation'], ['<b xmlns:q="urn:q"/>', 'text'], [']]>', 'punctuation'], ['xmlns:r', 'xmlns']]);
	});

	test('not in a comment or processing instruction', () => {
		assert.deepEqual(tokensOf('<!-- <a xmlns:p="urn:p"/> --><?pi <b xmlns:q="urn:q"/> ?><c/>'), []);
	});

	test('semantic highlighting is on for XML by default, as for XSLT - so with any theme', () => {
		assert.isTrue(vscode.workspace.getConfiguration('editor', { languageId: 'xml' }).get<boolean | string>('semanticHighlighting.enabled') === true);
	});

	test('provided for an XML file: the namespace declaration, tag punctuation and text types', async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		const file = path.join(folder, 'data.xml');
		fs.writeFileSync(file, '<a xmlns:p="urn:p">\n  <![CDATA[1 < 2]]>\n</a>\n');
		const document = await vscode.workspace.openTextDocument(file);
		const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>('vscode.provideDocumentSemanticTokensLegend', document.uri);
		const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', document.uri);
		// decoded: [line, character, length, type]
		const decoded: [number, number, number, string][] = [];
		let line = 0;
		let character = 0;
		for (let i = 0; i < tokens.data.length; i += 5) {
			line += tokens.data[i];
			character = tokens.data[i] === 0 ? character + tokens.data[i + 1] : tokens.data[i + 1];
			decoded.push([line, character, tokens.data[i + 2], legend.tokenTypes[tokens.data[i + 3]]]);
		}
		assert.deepEqual(decoded, [[0, 3, 7, 'xmlnsName'], [1, 2, 9, 'xmlPunctuation'], [1, 11, 5, 'xmlText'], [1, 16, 3, 'xmlPunctuation']]);
	});
});
