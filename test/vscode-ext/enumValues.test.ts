/**
 * Test suite for XPath 4.0 enumeration types, e.g. enum('red', 'green') or a named item type declared as one:
 * - completions of the values: for a map constructor entry, the select of an xsl:map-entry for a record field, and the
 *   select of an xsl:variable etc. - xs:boolean has true() and false()
 * - a string literal that isn't one of the values is reported (Saxon 13: XTTE0570 for a record field, XPTY0004 for a variable)
 *
 * The cursor position is marked by '¦' in each stylesheet body.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const declarations = `<xsl:item-type name="colour" as="enum('red', 'green')"/>
	<xsl:item-type name="flag" as="xs:boolean"/>
	<xsl:item-type name="shape" as="record(fill as colour, size as enum('s', 'm'), outline as xs:boolean, visible? as flag, both as (enum('a') | enum('b')), label as xs:string)"/>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	${body}
</xsl:stylesheet>`;
}

async function values(body: string) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === vscode.CompletionItemKind.EnumMember || item.kind === vscode.CompletionItemKind.Value);
}

const labels = async (body: string) => (await values(body)).map((item) => item.label as string);
const shapeVariable = (select: string) => `<xsl:variable name="v" as="shape" select="${select}"/>`;
const shapeMap = (content: string) => `<xsl:variable name="v" as="shape"><xsl:map>${content}</xsl:map></xsl:variable>`;

const completionCases: [string, string, string[]][] = [
	['a map entry with a named enumeration type', shapeVariable(`{ 'fill': ¦ }`), ['\'red\'', '\'green\'']],
	['a map entry with an enumeration type', shapeVariable(`{ 'fill': 'red', 'size':¦ }`), ['\'s\'', '\'m\'']],
	['a choice of enumeration types', shapeVariable(`{ 'both': ¦ }`), ['\'a\'', '\'b\'']],
	['an xs:boolean field', shapeVariable(`{ 'outline': ¦ }`), ['true()', 'false()']],
	['a named item type for xs:boolean', shapeVariable(`{ 'visible': ¦ }`), ['true()', 'false()']],
	['an xs:string field', shapeVariable(`{ 'label': ¦ }`), []],
	['a nested map constructor', `<xsl:item-type name="outer" as="record(inner as shape)"/><xsl:variable name="v" as="outer" select="{ 'inner': { 'fill': ¦ } }"/>`, ['\'red\'', '\'green\'']],
	['an xsl:map-entry select', shapeMap(`<xsl:map-entry key="'fill'" select="¦"/>`), ['\'red\'', '\'green\'']],
	['an xsl:map-entry select in apostrophes', shapeMap(`<xsl:map-entry key="'fill'" select='¦'/>`), ['"red"', '"green"']],
	['an xsl:variable select', `<xsl:variable name="c" as="colour" select="¦"/>`, ['\'red\'', '\'green\'']],
	['an xsl:param select with an enumeration type', `<xsl:param name="c" as="enum('x', 'y')?" select="¦"/>`, ['\'x\'', '\'y\'']],
	['an xsl:function result', `<xsl:function name="cx:c" as="colour"><xsl:sequence select="¦"/></xsl:function>`, ['\'red\'', '\'green\'']],
	['a select that is not empty', `<xsl:variable name="c" as="colour" select="'red', ¦"/>`, []],
];

function diagnose(body: string) {
	return (async () => {
		const xslt = stylesheet(body);
		const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
		const xslLexer = new XslLexer(XSLTConfiguration.configuration);
		xslLexer.provideCharLevelState = true;
		const allTokens = xslLexer.analyse(xslt);
		const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
		return diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
	})();
}

const notAValue = (value: string, typeText: string) => [`XPath: '${value}' is not one of the values of the enumeration type: ${typeText}`, `'${value}'`];
const complete = `'size': 's', 'outline': true(), 'both': 'a', 'label': 'x'`;

const lintCases: [string, string, string[][]][] = [
	['a record field value', shapeVariable(`{ 'fill': 'red', ${complete} }`), []],
	['a record field value that is not an enumeration value', shapeVariable(`{ 'fill': 'blue', ${complete} }`), [notAValue('blue', 'colour')]],
	['an xsl:variable value', `<xsl:variable name="c" as="colour" select="'green'"/>`, []],
	['an xsl:variable value that is not an enumeration value', `<xsl:variable name="c" as="colour" select="'blue'"/>`, [notAValue('blue', 'colour')]],
	['an xsl:param value with an enumeration type', `<xsl:param name="c" as="enum('x', 'y')" select="'z'"/>`, [notAValue('z', `enum('x', 'y')`)]],
];

suite('Enumeration types', () => {
	completionCases.forEach(([label, body, expected]) => {
		test(`completion: ${label}`, async () => {
			assert.deepEqual(await labels(body), expected);
		});
	});

	test('completion: a leading space after the colon', async () => {
		const items = await values(shapeVariable(`{ 'fill':¦ }`));
		assert.deepEqual(items.map((item) => item.insertText), [' \'red\'', ' \'green\'']);
	});

	lintCases.forEach(([label, body, expected]) => {
		test(`linter: ${label}`, async () => {
			assert.deepEqual(await diagnose(body), expected);
		});
	});
});

suite('Completions within a string literal replace it', () => {
	// the select attribute's text after applying the first completion with the label
	async function apply(body: string, label: string) {
		const marked = stylesheet(body);
		const offset = marked.indexOf('¦');
		const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
		const position = document.positionAt(offset);
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		const item = items.find((i) => i.label === label);
		assert.isDefined(item, `completion ${label}`);
		const range = (item!.range as vscode.Range | undefined) ?? new vscode.Range(position, position);
		const insertText = item!.insertText instanceof vscode.SnippetString ? item!.insertText.value.replace(/\$0/, '') : item!.insertText as string;
		const text = document.getText();
		const fixed = text.substring(0, document.offsetAt(range.start)) + insertText + text.substring(document.offsetAt(range.end));
		return /select=(["'])(.*?)\1/.exec(fixed.substring(fixed.lastIndexOf('<xsl:')))![2];
	}

	test('an enumeration value within quotes', async () => {
		assert.equal(await apply(shapeVariable(`{ 'fill': '¦' }`), '\'red\''), `{ 'fill': 'red' }`);
	});

	test('a partly typed enumeration value', async () => {
		assert.equal(await apply(shapeVariable(`{ 'fill': 'gr¦' }`), '\'green\''), `{ 'fill': 'green' }`);
	});

	test('an unclosed string literal', async () => {
		assert.equal(await apply(shapeVariable(`{ 'fill': 'gr¦ }`), '\'green\''), `{ 'fill': 'green' }`);
	});

	test('a key within quotes', async () => {
		assert.equal(await apply(shapeVariable(`{ '¦' }`), '\'fill\''), `{ 'fill':  }`);
	});

	test('a key that has a colon', async () => {
		assert.equal(await apply(shapeVariable(`{ 'fi¦': 'red' }`), '\'fill\''), `{ 'fill': 'red' }`);
	});

	test('a select within quotes', async () => {
		assert.equal(await apply(`<xsl:variable name="c" as="colour" select="'¦'"/>`, '\'red\''), `'red'`);
	});

	test('a partly typed select', async () => {
		assert.equal(await apply(`<xsl:variable name="c" as="colour" select="'gr¦"/>`, '\'green\''), `'green'`);
	});
});
