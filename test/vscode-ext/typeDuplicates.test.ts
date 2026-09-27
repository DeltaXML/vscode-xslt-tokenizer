/**
 * Test suite for duplicates in XPath 4.0 record and enumeration types. As in Saxon 13, a duplicate field name of a
 * record type is a static error - also for a quoted name, e.g. record(a, 'a'). Saxon allows a duplicate value of an
 * enumeration type, but it's likely a mistake, so the linter warns, with a quick fix that removes it.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="4.0">
  ${body}
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

const field = (name: string, text = name) => [`XPath: Duplicate field name in the record type: '${name}'`, text, 'Error'];
const value = (name: string) => [`XPath: Duplicate value in the enumeration type: '${name}'`, `'${name}'`, 'Warning'];
const itemType = (as: string) => `<xsl:item-type name="t" as="${as}"/>`;

const lintCases: [string, string, string[][]][] = [
	['distinct fields', itemType('record(a as xs:string, b, c?)'), []],
	['a duplicate field', itemType('record(a as xs:string, b, a as xs:integer)'), [field('a')]],
	['a duplicate optional field', itemType('record(a?, a)'), [field('a')]],
	['a duplicate quoted field', itemType(`record(a, 'a')`), [field('a', `'a'`)]],
	['the same field name in a nested record', itemType('record(a, b as record(a, c))'), []],
	['a duplicate field in a nested record', itemType('record(a, b as record(c, c))'), [field('c')]],
	['a duplicate field in an as attribute', `<xsl:variable name="v" as="record(a, a)?" select="()"/>`, [field('a')]],
	['a duplicate field in an expression', `<xsl:variable name="v" select="{ 'a': 1 } instance of record(a, a)"/>`, [field('a')]],
	['distinct values', itemType(`enum('x', 'y')`), []],
	['a duplicate value', itemType(`enum('x', 'y', 'x')`), [value('x')]],
	['a duplicate value with other quotes', `<xsl:variable name="v" select="'x' instance of enum('x', &quot;x&quot;)"/>`, [[`XPath: Duplicate value in the enumeration type: 'x'`, '&quot;x&quot;', 'Warning']]],
	['duplicate values in a record field type', itemType(`record(c as enum('x', 'x'))`), [value('x')]],
];

suite('Duplicates in record and enumeration types', () => {
	lintCases.forEach(([name, body, expected]) => {
		test(`linter: ${name}`, async () => {
			assert.deepEqual(await problems(body), expected);
		});
	});

	test('quick fix: remove a duplicate value', async () => {
		const document = await vscode.workspace.openTextDocument({ content: stylesheet(itemType(`enum('x', 'y', 'x', 'z')`)), language: 'xslt' });
		const diagnostics = await lint(document);
		const actions = new XSLTCodeActions().provideCodeActions(document, diagnostics[0].range, { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const fix = actions.find((a) => a.title === 'Remove duplicate enum value');
		assert.isDefined(fix);
		assert.isTrue(await vscode.workspace.applyEdit(fix!.edit!));
		assert.include(document.getText(), `as="enum('x', 'y', 'z')"`);
		assert.deepEqual(await lint(document), []);
	});
});
