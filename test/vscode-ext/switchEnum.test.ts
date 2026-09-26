/**
 * Test suite for xsl:switch on a value with an XPath 4.0 enumeration type - a variable, user-defined function call or
 * record field lookup with a declared type. As in Saxon 13, a case that isn't one of the values, or is also tested by an
 * earlier xsl:when, never matches, and with no xsl:when or xsl:otherwise for a value, the result is empty:
 * - the linter reports these, with a quick fix that adds an xsl:when for each value that isn't tested
 * - completions of the values for an xsl:when test, other than those tested already
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const declarations = `<xsl:item-type name="colour" as="enum('red', 'green', 'blue')"/>
  <xsl:item-type name="shape" as="record(fill as colour)"/>
  <xsl:variable name="c" as="colour" select="'red'"/>
  <xsl:variable name="s" as="shape" select="{ 'fill': 'red' }"/>
  <xsl:function name="cx:colour" as="colour"><xsl:sequence select="'red'"/></xsl:function>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
  ${declarations}
  <xsl:template name="t">
    ${body}
  </xsl:template>
</xsl:stylesheet>`;
}

async function lint(document: vscode.TextDocument) {
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(document.getText());
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused');
}

async function problems(body: string) {
	const document = await vscode.workspace.openTextDocument({ content: stylesheet(body), language: 'xslt' });
	return (await lint(document)).map((d) => [d.message, document.getText(d.range), vscode.DiagnosticSeverity[d.severity]]);
}

const missing = (values: string) => [`XSLT: xsl:switch has no xsl:when or xsl:otherwise for the enumeration values: ${values}`, 'xsl:switch', 'Information'];
const notAValue = (value: string) => [`XPath: '${value}' is not one of the values of the enumeration type colour, so this xsl:when never matches it`, `'${value}'`, 'Warning'];
const duplicate = (value: string) => [`XPath: '${value}' is also tested by an earlier xsl:when, so this xsl:when never matches it`, `'${value}'`, 'Warning'];
const whens = (select: string, cases: string) => `<xsl:switch select="${select}">${cases}</xsl:switch>`;
const allCases = `<xsl:when test="'red'">R</xsl:when><xsl:when test="'green', 'blue'">GB</xsl:when>`;

const lintCases: [string, string, string[][]][] = [
	['all values tested', whens('$c', allCases), []],
	['a value not tested', whens('$c', `<xsl:when test="'red'">R</xsl:when>`), [missing(`'green', 'blue'`)]],
	['a value not tested, with xsl:otherwise', whens('$c', `<xsl:when test="'red'">R</xsl:when><xsl:otherwise>O</xsl:otherwise>`), []],
	['not one of the values', whens('$c', `${allCases}<xsl:when test="'purple'">P</xsl:when>`), [notAValue('purple')]],
	['a duplicate value', whens('$c', `${allCases}<xsl:when test="'red'">R2</xsl:when>`), [duplicate('red')]],
	['a user-defined function call', whens('cx:colour()', `<xsl:when test="'red'">R</xsl:when>`), [missing(`'green', 'blue'`)]],
	['a record field lookup', whens('$s?fill', `<xsl:when test="'blue'">B</xsl:when>`), [missing(`'red', 'green'`)]],
	['a local variable', `<xsl:variable name="v" as="colour" select="'red'"/>${whens('$v', `<xsl:when test="'red', 'green'">R</xsl:when>`)}`, [missing(`'blue'`)]],
	['a test that is not a string literal', whens('$c', `<xsl:when test="$c">R</xsl:when>`), []],
	['a select without an enumeration type', whens(`'red'`, `<xsl:when test="'purple'">P</xsl:when>`), []],
	['no xsl:when (Saxon 13: XTSE0010)', whens('$c', `<xsl:otherwise>O</xsl:otherwise>`), [['XSLT: xsl:switch must contain at least one xsl:when', 'xsl:switch', 'Error']]],
	['no xsl:when and no xsl:otherwise', whens('$c', ''), [['XSLT: xsl:switch must contain at least one xsl:when', 'xsl:switch', 'Error'], missing(`'red', 'green', 'blue'`)]],
	['the empty string literal from the xsl:switch snippet', whens('$c', `<xsl:when test="''">R</xsl:when><xsl:otherwise>O</xsl:otherwise>`), [notAValue('')]],
];

async function completionLabels(body: string) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
	await lint(document);
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === vscode.CompletionItemKind.EnumMember).map((item) => item.label as string);
}

const completionCases: [string, string, string[]][] = [
	['an empty test', whens('$c', `<xsl:when test="'red'">R</xsl:when><xsl:when test="¦"/>`), ['\'green\'', '\'blue\'']],
	['within the empty string literal from the xsl:switch snippet', whens('$c', `<xsl:when test="'¦'"></xsl:when>`), ['\'red\'', '\'green\'', '\'blue\'']],
	['a string literal being typed', whens('$c', `<xsl:when test="'¦'"/><xsl:when test="'blue'">B</xsl:when>`), ['\'red\'', '\'green\'']],
	['after a comma', whens('$c', `<xsl:when test="'green', ¦"/>`), ['\'red\'', '\'blue\'']],
	['a switch without an enumeration type', whens(`'red'`, `<xsl:when test="¦"/>`), []],
];

suite('xsl:switch on an enumeration type', () => {
	lintCases.forEach(([label, body, expected]) => {
		test(`linter: ${label}`, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});

	const withSelect = 'Add missing xsl:when cases with select';
	const withContent = 'Add missing xsl:when cases with content';

	// the document's text after applying the quick fix, and the problems that remain
	async function quickFix(body: string, title: string) {
		const document = await vscode.workspace.openTextDocument({ content: stylesheet(body), language: 'xslt' });
		const diagnostics = await lint(document);
		const actions = new XSLTCodeActions().provideCodeActions(document, diagnostics[0].range, { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		assert.includeMembers(actions.map((a) => a.title), [withSelect, withContent]);
		const fix = actions.find((a) => a.title === title);
		assert.isTrue(await vscode.workspace.applyEdit(fix!.edit!));
		return { text: document.getText(), problems: (await lint(document)).map((d) => d.message) };
	}

	const oneWhen = `<xsl:switch select="$c">\n      <xsl:when test="'red'">R</xsl:when>\n    </xsl:switch>`;
	const selectCases = (first = '') => `${first}\n      <xsl:when test="'green'" select=""/>\n      <xsl:when test="'blue'" select=""/>`;
	const contentCases = (first = '') => `${first}\n      <xsl:when test="'green'">\n        \n      </xsl:when>\n      <xsl:when test="'blue'">\n        \n      </xsl:when>`;
	const whenRed = `\n      <xsl:when test="'red'">R</xsl:when>`;
	const allCasesFor = (cases: string) => `<xsl:switch select="$c">${cases}\n    </xsl:switch>`;

	const quickFixCases: [string, string, string, string][] = [
		['after the last xsl:when, with select', oneWhen, withSelect, allCasesFor(selectCases(whenRed))],
		['after the last xsl:when, with content', oneWhen, withContent, allCasesFor(contentCases(whenRed))],
		['no xsl:when, with the end tag on a new line', `<xsl:switch select="$c">\n    </xsl:switch>`, withSelect,
			allCasesFor(`\n      <xsl:when test="'red'" select=""/>${selectCases()}`)],
		['no xsl:when, with the end tag on the same line', `<xsl:switch select="$c"></xsl:switch>`, withContent,
			allCasesFor(`\n      <xsl:when test="'red'">\n        \n      </xsl:when>${contentCases()}`)],
		['an empty xsl:switch element', `<xsl:switch select="$c"/>`, withSelect, allCasesFor(`\n      <xsl:when test="'red'" select=""/>${selectCases()}`)],
		['an empty line before the end tag, after the last xsl:when', `<xsl:switch select="$c">${whenRed}\n      \n    </xsl:switch>`, withSelect, allCasesFor(selectCases(whenRed))],
		['an empty line before the end tag, with content', `<xsl:switch select="$c">${whenRed}\n\n    </xsl:switch>`, withContent, allCasesFor(contentCases(whenRed))],
		['an empty line before the end tag, with no xsl:when', `<xsl:switch select="$c">\n      \n    </xsl:switch>`, withSelect,
			allCasesFor(`\n      <xsl:when test="'red'" select=""/>${selectCases()}`)],
	];
	quickFixCases.forEach(([label, body, title, expected]) => {
		test(`quick fix: ${label}`, async () => {
			const { text, problems } = await quickFix(body, title);
			assert.equal(text, stylesheet(expected));
			// the cases are complete - an empty select is for the user to fill in
			assert.notInclude(problems.join('\n'), 'xsl:switch');
		});
	});

	// the text at the cursor after applying the quick fix in an editor: the line up to the cursor, and after it
	async function cursorAfterFix(body: string, title: string) {
		const document = await vscode.workspace.openTextDocument({ content: stylesheet(body), language: 'xslt' });
		const editor = await vscode.window.showTextDocument(document);
		const diagnostics = await lint(document);
		const actions = new XSLTCodeActions().provideCodeActions(document, diagnostics[0].range, { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		assert.isTrue(await vscode.workspace.applyEdit(actions.find((a) => a.title === title)!.edit!));
		const cursor = editor.selection.active;
		const line = document.lineAt(cursor.line).text;
		return [line.substring(0, cursor.character), line.substring(cursor.character)];
	}

	test('cursor: within the first select', async () => {
		assert.deepEqual(await cursorAfterFix(oneWhen, withSelect), [`      <xsl:when test="'green'" select="`, `"/>`]);
	});

	test('cursor: within the first xsl:when content, indented', async () => {
		assert.deepEqual(await cursorAfterFix(oneWhen, withContent), ['        ', '']);
	});

	test('cursor: the content of the first xsl:when, with no xsl:when before', async () => {
		const [before] = await cursorAfterFix(`<xsl:switch select="$c">\n    </xsl:switch>`, withContent);
		assert.equal(before, '        ');
	});

	completionCases.forEach(([label, body, expected]) => {
		test(`completion: ${label}`, async () => {
			assert.deepEqual(await completionLabels(body), expected);
		});
	});
});
