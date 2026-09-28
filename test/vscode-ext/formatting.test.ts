/**
 * Test suite for the XML/XSLT formatting provider:
 * - elements are indented by nesting level, and blank lines are left empty - except the new line for on-type
 *   formatting, after Enter, which is indented
 * - the content of an xsl:note is indented as a block, keeping each line's indentation relative to the least indented
 *   line, as indentation is significant in Markdown - the content of xsl:text is kept as it is
 * - the continuation lines of a multi-line string literal or string template are kept as they are, as their
 *   indentation is part of the string's value - in an attribute, each whitespace character becomes a space
 * - no edits for lines already indented, and none for a cancelled request
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XMLDocumentFormattingProvider } from '../../src/xmlDocumentFormattingProvider';

const spaces: vscode.FormattingOptions = { tabSize: 2, insertSpaces: true };
const tabs: vscode.FormattingOptions = { tabSize: 2, insertSpaces: false };
const token = () => new vscode.CancellationTokenSource().token;

async function format(lines: string[], options = spaces) {
	const document = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'xslt' });
	const edits = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration).provideDocumentFormattingEdits(document, options, token());
	const edit = new vscode.WorkspaceEdit();
	edit.set(document.uri, edits);
	await vscode.workspace.applyEdit(edit);
	return { edits, lines: document.getText().split('\n') };
}

const stylesheet = (body: string[]) => ['<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">', ...body, '</xsl:stylesheet>'];

suite('Formatting', () => {
	test('elements are indented by nesting level', async () => {
		const { lines } = await format(stylesheet(['<xsl:template match="/">', '<a>', '<b/>', '</a>', '</xsl:template>']));
		assert.deepEqual(lines, stylesheet(['  <xsl:template match="/">', '    <a>', '      <b/>', '    </a>', '  </xsl:template>']));
	});

	test('blank lines are left empty, and whitespace-only lines are emptied', async () => {
		const { lines } = await format(stylesheet(['', '  <xsl:template match="/">', '      ', '    <a/>', '  </xsl:template>']));
		assert.deepEqual(lines, stylesheet(['', '  <xsl:template match="/">', '', '    <a/>', '  </xsl:template>']));
	});

	test('no edits for a document that is already formatted', async () => {
		const { edits } = await format(stylesheet(['', '  <xsl:template match="/">', '    <a/>', '  </xsl:template>']));
		assert.deepEqual(edits, []);
	});

	test('no edits for a cancelled request', async () => {
		const document = await vscode.workspace.openTextDocument({ content: stylesheet(['<xsl:template match="/"/>']).join('\n'), language: 'xslt' });
		const cancelled = new vscode.CancellationTokenSource();
		cancelled.cancel();
		const provider = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration);
		assert.deepEqual(provider.provideDocumentFormattingEdits(document, spaces, cancelled.token), []);
		assert.deepEqual(provider.provideOnTypeFormattingEdits(document, new vscode.Position(1, 0), '\n', spaces, cancelled.token), []);
		// the provider isn't left in an on-type state
		assert.isNotEmpty(provider.provideDocumentFormattingEdits(document, spaces, token()));
	});

	test('on-type formatting indents the new empty line after Enter', async () => {
		const content = stylesheet(['  <xsl:template match="/">', '', '  </xsl:template>']).join('\n');
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		const edits = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration).provideOnTypeFormattingEdits(document, new vscode.Position(2, 0), '\n', spaces, token());
		assert.deepEqual(edits.map((e) => [e.range.start.line, e.newText]), [[2, '    ']]);
	});

	test('xsl:text content is kept as it is', async () => {
		const { lines } = await format(stylesheet(['  <xsl:template match="/">', '<xsl:text>', '   a', ' b</xsl:text>', '  </xsl:template>']));
		assert.deepEqual(lines.slice(3, 5), ['   a', ' b</xsl:text>']);
	});

	suite('xsl:note', () => {
		const note = (content: string[], indent: string) => stylesheet([
			'  <xsl:function name="f:x" xmlns:f="f">',
			'    <xsl:note format="xdoc-md">',
			...content.map((line) => line ? indent + line : line),
			'    </xsl:note>',
			'    <xsl:param name="a"/>',
			'  </xsl:function>'
		]);
		const markdown = ['- item one', '  - nested item', '', '    code block', '@param $a the first', '  continued'];

		test('relative indentation within a note is kept', async () => {
			const { lines } = await format(note(markdown, '      '));
			assert.deepEqual(lines, note(markdown, '      '));
		});

		test('a note is indented as a block', async () => {
			const { lines } = await format(note(markdown, ''));
			assert.deepEqual(lines, note(markdown, '      '));
		});

		test('a note is indented as a block, with tabs', async () => {
			const { lines } = await format(note(markdown, '  '), tabs);
			assert.deepEqual(lines.slice(3, 9), ['\t\t\t- item one', '\t\t\t  - nested item', '', '\t\t\t    code block', '\t\t\t@param $a the first', '\t\t\t  continued']);
			assert.deepEqual(lines.slice(9, 11), ['\t\t</xsl:note>', '\t\t<xsl:param name="a"/>']);
		});

		test("the note's end tag is indented", async () => {
			const lines = note(['text'], '      ');
			lines[4] = '</xsl:note>';
			assert.deepEqual((await format(lines)).lines[4], '    </xsl:note>');
		});

		test('a CDATA section within a note is indented with the block', async () => {
			const { lines } = await format(note(['<![CDATA[', '  <a> & b', ']]>'], ''));
			assert.deepEqual(lines.slice(3, 6), ['      <![CDATA[', '        <a> & b', '      ]]>']);
		});
	});

	suite('multi-line strings', () => {
		const template = (body: string[]) => stylesheet(['  <xsl:template match="/">', '    <xsl:param name="a" select="1"/>', ...body, '  </xsl:template>']);
		const cases: [string, string[]][] = [
			['a string literal', [`<xsl:sequence select="'first line`, `        second line'"/>`]],
			['a closing quote at the start of a line', [`<xsl:sequence select="'first line`, `'"/>`]],
			['a whitespace-only line within a string', [`<xsl:sequence select="'first line`, `      `, `  last line'"/>`]],
			['a string template', ['<xsl:sequence select="`Hello {$a},', '        next line {$a}', '        last`"/>']],
			['a string template, after an enclosed expression', ['<xsl:sequence select="`x {$a}', 'y', '`"/>']],
			['a string delimited by entities', ['<xsl:sequence select="&quot;first', '        second&quot;"/>']]
		];
		cases.forEach(([name, body]) => {
			test(`the continuation lines of ${name} are kept`, async () => {
				// the first line of the body is mis-indented, and is indented as usual
				const { lines } = await format(template(body));
				assert.equal(lines[3], '    ' + body[0]);
				assert.deepEqual(lines.slice(4, 3 + body.length), body.slice(1));
			});
		});

		test('the continuation lines of a string template in xsl:select are kept', async () => {
			// the template's first line is indented, as its indentation isn't part of the string
			const { lines } = await format(template(['<xsl:select>', '`Hello {$a},', '        next line`', '</xsl:select>']));
			assert.deepEqual(lines.slice(3, 7), ['    <xsl:select>', '      `Hello {$a},', '        next line`', '    </xsl:select>']);
		});

		test('lines after a multi-line string are indented as usual', async () => {
			const { lines } = await format(template([`<xsl:sequence select="'a`, `        b'"/>`, `<a/>`]));
			assert.deepEqual(lines.slice(3, 6), [`    <xsl:sequence select="'a`, `        b'"/>`, `    <a/>`]);
		});
	});
});
