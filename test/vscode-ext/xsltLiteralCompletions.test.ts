/**
 * Test suite for completion of literal result elements in XSLT: the names, attributes and values the stylesheet's
 * literal result elements have - with XSLT elements as if they weren't there, so a td in an xsl:for-each in a tr is a
 * child of tr. Not top-level data, nor an xsl:note's content; not XSLT attributes, nor attribute value templates.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { revertAndCloseEditorsIn } from './testEditors';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-literal-completions-'));
let fileCount = 0;

const stylesheet = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="urn:my" version="3.0">
  <my:data>
    <my:entry key="a"/>
  </my:data>
  <xsl:attribute-set name="s"/>
  <xsl:template match="/">
    <table class="grid">
      <xsl:for-each select="row">
        <tr class="row">
          <xsl:if test="@x">
            <xsl:attribute name="data-x" select="@x"/>
          </xsl:if>
          <td class="cell">a</td>
          <td class="cell" title="{@t}">b</td>
        </tr>
      </xsl:for-each>
    </table>
  </xsl:template>
  <xsl:template match="row">
    <tr class="row" xsl:use-attribute-sets="s">MARK</tr>
  </xsl:template>
  <xsl:template match="cell">
    OTHER
  </xsl:template>
</xsl:stylesheet>
`;

// the items at '|' in the text
async function completions(text: string, trigger?: string) {
	const file = path.join(folder, `${++fileCount}.xsl`);
	fs.writeFileSync(file, text.replace('|', ''));
	const document = await vscode.workspace.openTextDocument(file);
	assert.strictEqual(document.languageId, 'xslt');
	const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(text.indexOf('|')), trigger);
	return list.items.filter((item) => item.kind !== vscode.CompletionItemKind.Text);
}

const labelOf = (item: vscode.CompletionItem) => typeof item.label === 'string' ? item.label : item.label.label;
const labels = (items: vscode.CompletionItem[]) => items.map(labelOf);
const find = (items: vscode.CompletionItem[], label: string) => items.find((i) => labelOf(i) === label);
const insert = (items: vscode.CompletionItem[], label: string) => {
	const item = find(items, label);
	return item?.insertText instanceof vscode.SnippetString ? item.insertText.value : item?.insertText;
};
// the learned names, in the order VS Code shows them
const learned = (items: vscode.CompletionItem[]) => items.filter((i) => /^(literal result element|attribute) - /.test(i.detail ?? ''))
	.sort((a, b) => {
		// as VS Code compares them: not localeCompare, which ignores '~'
		const [x, y] = [a.sortText ?? labelOf(a), b.sortText ?? labelOf(b)];
		return x < y ? -1 : x > y ? 1 : 0;
	}).map(labelOf);

suite('XSLT completion of literal result elements: the names the stylesheet uses', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	suiteTeardown(async () => {
		await revertAndCloseEditorsIn(folder);
	});

	test('after <: the children of other literal result elements with the parent\'s name, past XSLT elements - with the instructions', async () => {
		const items = await completions(stylesheet.replace('MARK', '<|'), '<');
		assert.strictEqual(learned(items)[0], 'td');
		assert.match(find(items, 'td')!.detail ?? '', /^literal result element - in tr: 2 of 2/);
		assert.include(labels(items), 'xsl:apply-templates');
		// not top-level data
		assert.notInclude(labels(items), 'my:entry');
		assert.notInclude(labels(items), 'my:data');
	});

	test('inserted with an end tag, and the attributes it always has on its start tag', async () => {
		const items = await completions(stylesheet.replace('MARK', '<|'), '<');
		assert.strictEqual(insert(items, 'td'), 'td class="${1}">$0</td>');
	});

	test('directly in a template: every name, the most used first, after the instructions', async () => {
		const items = await completions(stylesheet.replace('OTHER', '<|'), '<');
		assert.deepEqual(learned(items), ['tr', 'td', 'table']);
		assert.match(find(items, 'table')!.sortText ?? '', /^~/);
		assert.include(labels(items), 'xsl:apply-templates');
	});

	test('a start tag: the attributes of others with its name - and those xsl:attribute adds - not XSLT attributes', async () => {
		const items = await completions(stylesheet.replace('<td class="cell">a</td>', '<td class="cell">a</td><tr |/>'));
		assert.deepEqual(learned(items), ['class', 'data-x']);
		assert.match(find(items, 'data-x')!.detail ?? '', /added by xsl:attribute 1 time/);
		assert.notInclude(learned(items), 'xsl:use-attribute-sets');
		const td = await completions(stylesheet.replace('MARK', '<td |/>'));
		assert.deepEqual(learned(td), ['class', 'title']);
	});

	test('a value: those the attribute has elsewhere - not an attribute value template\'s', async () => {
		const items = await completions(stylesheet.replace('MARK', '<td class="|"/>'), '"');
		assert.include(labels(items), 'cell');
		const title = await completions(stylesheet.replace('MARK', '<td title="|"/>'), '"');
		assert.notInclude(labels(title), '{@t}');
		// not within an attribute value template's expression
		const avt = await completions(stylesheet.replace('MARK', '<td class="{|}"/>'));
		assert.notInclude(labels(avt), 'cell');
	});

	test('XSLT with another prefix: its elements are as if they weren\'t there', async () => {
		const text = stylesheet.replace(/xsl:/g, 'x:').replace('xmlns:xsl=', 'xmlns:x=');
		const items = await completions(text.replace('MARK', '<|'), '<');
		assert.strictEqual(learned(items)[0], 'td');
		assert.match(find(items, 'td')!.detail ?? '', /in tr: 2 of 2/);
	});
});

const htmlStylesheet = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:output method="html"/>
  <xsl:template match="/">
    <table class="grid">
      <tr>
        <td class="cell">MARK</td>
      </tr>
    </table>
    <ul>
      <xsl:for-each select="item">
        LIST
      </xsl:for-each>
    </ul>
  </xsl:template>
  <xsl:template match="item">
    OTHER
  </xsl:template>
</xsl:stylesheet>
`;

const html = (items: vscode.CompletionItem[]) => items.filter((i) => /^HTML /.test(i.detail ?? '')).map(labelOf);

suite('XSLT completion of literal result elements: HTML, where the output is HTML', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	suiteTeardown(async () => {
		await revertAndCloseEditorsIn(folder);
	});

	test('in an HTML element: the elements HTML allows there, after the names the stylesheet uses', async () => {
		const items = await completions(htmlStylesheet.replace('LIST', '<|'), '<');
		assert.deepEqual(html(items), ['li', 'script', 'template']);
		assert.match(find(items, 'li')!.sortText ?? '', /^~~/);
		const div = await completions(htmlStylesheet.replace('MARK', '<div><|</div>'), '<');
		// div itself is learned, from the div the '<' is in
		assert.includeMembers(html(div), ['p', 'img', 'section']);
		assert.include(labels(div), 'div');
		assert.notIncludeMembers(html(div), ['li', 'td', 'meta', 'head']);
	});

	test('a phrasing parent: phrasing elements only - and a void element is self-closed', async () => {
		const items = await completions(htmlStylesheet.replace('MARK', '<p><|</p>'), '<');
		assert.includeMembers(html(items), ['em', 'br', 'a']);
		assert.notInclude(html(items), 'div');
		assert.strictEqual(insert(items, 'br'), 'br/>$0');
		assert.strictEqual(insert(items, 'em'), 'em>$0</em>');
	});

	test('a name the stylesheet uses is offered once, as learned', async () => {
		const items = await completions(htmlStylesheet.replace('<td class="cell">MARK</td>', '<td class="cell"/><|'), '<');
		assert.strictEqual(labels(items).filter((l) => l === 'td').length, 1);
		assert.include(html(items), 'th');
	});

	test('none directly in a template, nor where the output isn\'t HTML, e.g. DocBook', async () => {
		const items = await completions(htmlStylesheet.replace('OTHER', '<|'), '<');
		assert.deepEqual(html(items), []);
		const xml = await completions(htmlStylesheet.replace('<xsl:output method="html"/>', '').replace('LIST', '<|'), '<');
		assert.deepEqual(html(xml), []);
	});

	test('attributes: the element\'s, then the global ones - and their values, a boolean attribute\'s being its name', async () => {
		const items = await completions(htmlStylesheet.replace('MARK', '<input |/>'));
		assert.includeMembers(html(items), ['type', 'checked', 'class', 'id']);
		assert.notInclude(html(items), 'onclick');
		const td = await completions(htmlStylesheet.replace('MARK', '<td |/>'));
		// class is learned, so it's not an HTML item too
		assert.strictEqual(labels(td).filter((l) => l === 'class').length, 1);
		const type = await completions(htmlStylesheet.replace('MARK', '<input type="|"/>'), '"');
		assert.includeMembers(labels(type), ['checkbox', 'text']);
		const checked = await completions(htmlStylesheet.replace('MARK', '<input checked="|"/>'), '"');
		assert.include(labels(checked), 'checked');
	});
});
