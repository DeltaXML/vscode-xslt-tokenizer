/**
 * Test suite for 'Wrap with...': wrapping selected instructions - or the element whose start tag is at the cursor - in
 * an instruction, or a literal result element, chosen from those that the XSLT schema allows in the parent element,
 * and that can contain the selected elements
 * - the selection must be a sequence of complete elements
 * - when it starts and ends its lines, its lines are indented within the wrapper, otherwise it's wrapped on its line
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { wrapTarget, wrappersFor, wrapEdit, wrappers, addRecentWrapper, literalElement } from '../../src/xsltWrap';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import * as fs from 'fs';
import * as path from 'path';

const stylesheet = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="/">
${body}
  </xsl:template>
</xsl:stylesheet>`;

// the text, and the offsets of the selection marked by '[' and ']', or the cursor marked by '|'
function marked(body: string) {
	const withMarks = stylesheet(body);
	const cursor = withMarks.indexOf('|');
	if (cursor > -1) {
		return { text: withMarks.replace('|', ''), start: cursor, end: cursor };
	}
	const start = withMarks.indexOf('[');
	const end = withMarks.indexOf(']') - 1;
	return { text: withMarks.replace('[', '').replace(']', ''), start, end };
}

const wrapper = (name: string) => wrappers.find((w) => w.name === name)!;

function wrapped(body: string, name: string, indentUnit = '  ') {
	const { text, start, end } = marked(body);
	const target = wrapTarget(text, start, end)!;
	const edit = wrapEdit(text, target, wrapper(name), indentUnit);
	return text.substring(0, edit.start) + edit.snippet + text.substring(edit.end);
}

const names = (body: string) => {
	const { text, start, end } = marked(body);
	return wrappersFor(text, wrapTarget(text, start, end)!, false).map((w) => w.name);
};

suite('Wrap with', () => {
	suite('the target', () => {
		const cases: [string, string, boolean][] = [
			['whole lines', '[    <a/>\n    <b>x</b>]', true],
			['whole lines, with their indentation', '[    <a/>\n    <b/>\n]', true],
			['elements with text and a comment between them', '[<a/> text <!-- c --> <b/>]', true],
			['part of an element', '[<a><b/>]</a>', false],
			['an end tag', '<a>[</a>]', false],
			['part of a start tag', '<a [x="1"/>]', false],
			['text only', '<a>[text]</a>', false]
		];
		cases.forEach(([name, body, expected]) => {
			test(`${expected ? '' : 'not '}${name}`, () => {
				const { text, start, end } = marked(body);
				assert.equal(!!wrapTarget(text, start, end), expected);
			});
		});

		test('the element whose start tag is at the cursor', () => {
			const { text, start, end } = marked('    <a x="1"|><b/></a> <c/>');
			const target = wrapTarget(text, start, end)!;
			assert.equal(text.substring(target.start, target.end), '<a x="1"><b/></a>');
		});

		test('a self-closing element at the cursor', () => {
			const { text, start, end } = marked('    <xsl:value-of sel|ect="."/>');
			const target = wrapTarget(text, start, end)!;
			assert.equal(text.substring(target.start, target.end), '<xsl:value-of select="."/>');
		});

		test('none for the cursor in text', () => {
			const { text, start, end } = marked('    <a>te|xt</a>');
			assert.isUndefined(wrapTarget(text, start, end));
		});
	});

	suite('the wrappers', () => {
		test('in a template', () => {
			assert.includeMembers(names('[    <xsl:value-of select="."/>]'), ['xsl:if', 'xsl:choose', 'xsl:for-each', 'xsl:try', literalElement]);
		});

		test('not for an xsl:param, which only xsl:iterate etc. can contain', () => {
			assert.deepEqual(names('[    <xsl:param name="p"/>]'), []);
		});

		test('only those that can contain an xsl:sort', () => {
			const { text, start, end } = marked('    <xsl:for-each select="*">\n[      <xsl:sort select="."/>]\n    </xsl:for-each>');
			assert.sameMembers(wrappersFor(text, wrapTarget(text, start, end)!, false).map((w) => w.name), ['xsl:for-each', 'xsl:for-each-group']);
		});

		test('none within xsl:choose, which only contains xsl:when and xsl:otherwise', () => {
			assert.deepEqual(names('    <xsl:choose>\n[      <xsl:when test="1"/>]\n    </xsl:choose>'), []);
		});

		test('the most recently used first', () => {
			addRecentWrapper('xsl:for-each');
			addRecentWrapper('xsl:try');
			assert.deepEqual(names('[    <a/>]').slice(0, 2), ['xsl:try', 'xsl:for-each']);
		});
	});

	suite('the edit', () => {
		test('xsl:if, indenting the lines', () => {
			assert.equal(wrapped('[    <a/>\n    <b>\n      <c/>\n    </b>]', 'xsl:if'),
				stylesheet('    <xsl:if test="${1}">\n      <a/>\n      <b>\n        <c/>\n      </b>\n    </xsl:if>'));
		});

		test('with tabs', () => {
			assert.equal(wrapped('[\t\t<a/>]', 'xsl:for-each', '\t'), stylesheet('\t\t<xsl:for-each select="${1}">\n\t\t\t<a/>\n\t\t</xsl:for-each>'));
		});

		test('xsl:choose, with the selection in an xsl:when', () => {
			assert.equal(wrapped('[    <a/>]', 'xsl:choose'),
				stylesheet('    <xsl:choose>\n      <xsl:when test="${1}">\n        <a/>\n      </xsl:when>\n      <xsl:otherwise>${0}</xsl:otherwise>\n    </xsl:choose>'));
		});

		test('a literal result element, with its name in both tags', () => {
			assert.equal(wrapped('[    <a/>]', literalElement), stylesheet('    <${1:div}>\n      <a/>\n    </${1:div}>'));
		});

		test('on the line, when the selection is within a line', () => {
			assert.equal(wrapped('    <p>[<b/>] text</p>', 'xsl:if'), stylesheet('    <p><xsl:if test="${1}"><b/></xsl:if> text</p>'));
		});

		test('the element at the cursor', () => {
			assert.equal(wrapped('    <a|/>', 'xsl:if'), stylesheet('    <xsl:if test="${1}">\n      <a/>\n    </xsl:if>'));
		});

		test('snippet characters in the selection are escaped', () => {
			assert.equal(wrapped('[    <xsl:value-of select="$a"/>]', 'xsl:if'), stylesheet('    <xsl:if test="${1}">\n      <xsl:value-of select="\\$a"/>\n    </xsl:if>'));
		});

		test('blank lines stay empty', () => {
			assert.equal(wrapped('[    <a/>\n\n    <b/>]', 'xsl:if'), stylesheet('    <xsl:if test="${1}">\n      <a/>\n\n      <b/>\n    </xsl:if>'));
		});
	});

	suite('the code action', () => {
		const actions = async (body: string) => {
			const { text, start, end } = marked(body);
			const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
			const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
			return (new XSLTCodeActions().provideCodeActions(document, range, { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? []).map((a) => a.title);
		};

		test('for selected instructions', async () => {
			assert.include(await actions('[    <xsl:value-of select="."/>]'), 'Wrap with...');
		});

		test('for the cursor on a start tag', async () => {
			assert.include(await actions('    <xsl:value-of sel|ect="."/>'), 'Wrap with...');
		});

		test('not for a partial selection', async () => {
			assert.notInclude(await actions('    <a>[<b/>\n    </a>]'), 'Wrap with...');
		});

		test('not when no instruction can wrap the target: an xsl:param', async () => {
			assert.notInclude(await actions('    <xsl:param na|me="p"/>'), 'Wrap with...');
		});

		test('not when no instruction can wrap the target: an xsl:when', async () => {
			assert.notInclude(await actions('    <xsl:choose>\n      <xsl:when te|st="1"/>\n    </xsl:choose>'), 'Wrap with...');
		});

		test('not for a top-level declaration', async () => {
			const document = await vscode.workspace.openTextDocument({ content: stylesheet('    <a/>'), language: 'xslt' });
			const position = new vscode.Position(1, 18);
			const titles = (new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? []).map((a) => a.title);
			assert.notInclude(titles, 'Wrap with...');
		});

		test('the command has a keybinding in XSLT editors', () => {
			const contributes = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')).contributes;
			const keybinding = contributes.keybindings.find((k: { command: string }) => k.command === 'xslt-xpath.wrapWith');
			assert.deepEqual(keybinding, { command: 'xslt-xpath.wrapWith', key: 'alt+shift+w', mac: 'alt+shift+w', when: 'editorTextFocus && editorLangId == xslt' });
		});

		test('not for the root element', async () => {
			const document = await vscode.workspace.openTextDocument({ content: stylesheet('    <a/>'), language: 'xslt' });
			const position = new vscode.Position(0, 3);
			const titles = (new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? []).map((a) => a.title);
			assert.notInclude(titles, 'Wrap with...');
		});
	});
});
