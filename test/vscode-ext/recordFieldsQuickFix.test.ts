/**
 * Test suite for the quick fix that adds the missing fields to a map constructor with an XPath 4.0 record type: one
 * fix adds all the required fields that are missing, with a placeholder for each value, e.g. __TODO.city
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XSLTCodeActions } from '../../src/xsltCodeActions';

const declarations = `<xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string))"/>`;

function stylesheet(variable: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="4.0">
	${declarations}
	${variable}
</xsl:stylesheet>`;
}

function diagnose(document: vscode.TextDocument) {
	const xslt = document.getText();
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
}

// applies the quick fix, returning the fixed variable declaration and the problems remaining after the fix
async function quickFix(variable: string) {
	const document = await vscode.workspace.openTextDocument({ content: stylesheet(variable), language: 'xslt' });
	const diagnostics = diagnose(document);
	const missing = diagnostics.filter((d) => d.message.includes('is missing'));
	assert.isNotEmpty(missing, 'missing field problems');
	const actions = new XSLTCodeActions().provideCodeActions(document, missing[0].range, { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
	const fixes = actions.filter((a) => a.title === 'Add missing record fields');
	assert.lengthOf(fixes, 1, 'one quick fix');
	assert.isTrue(await vscode.workspace.applyEdit(fixes[0].edit!));
	const fixed = document.getText();
	const remaining = diagnose(document).filter((d) => !d.message.startsWith('XPath: Placeholder') && d.message !== 'variable is unused').map((d) => d.message);
	return { fixed: fixed.substring(fixed.indexOf('<xsl:variable'), fixed.indexOf('</xsl:stylesheet>')).trim(), remaining };
}

const cases: [string, string, string][] = [
	['after the last entry, with a nested map constructor', `<xsl:variable name="p" as="person" select="{ 'name': 'Ann' }"/>`,
		`<xsl:variable name="p" as="person" select="{ 'name': 'Ann', 'address': { 'city': __TODO.city } }"/>`],
	['an empty map constructor', `<xsl:variable name="p" as="person" select="{}"/>`,
		`<xsl:variable name="p" as="person" select="{ 'name': __TODO.name, 'address': { 'city': __TODO.city } }"/>`],
	['an empty map constructor with a space', `<xsl:variable name="p" as="person" select="map { }"/>`,
		`<xsl:variable name="p" as="person" select="map { 'name': __TODO.name, 'address': { 'city': __TODO.city } }"/>`],
	['a nested map constructor', `<xsl:variable name="p" as="person" select="{ 'name': 'Ann', 'address': { 'zip': 'Z1' } }"/>`,
		`<xsl:variable name="p" as="person" select="{ 'name': 'Ann', 'address': { 'zip': 'Z1', 'city': __TODO.city } }"/>`],
	['an attribute in apostrophes', `<xsl:variable name="p" as="person" select='{ "address": { "city": "x" } }'/>`,
		`<xsl:variable name="p" as="person" select='{ "address": { "city": "x" }, "name": __TODO.name }'/>`],
];

suite('Record types: quick fix for missing fields', () => {
	cases.forEach(([label, variable, expected]) => {
		test(label, async () => {
			const { fixed, remaining } = await quickFix(variable);
			assert.equal(fixed, expected);
			assert.deepEqual(remaining, []);
		});
	});
});
