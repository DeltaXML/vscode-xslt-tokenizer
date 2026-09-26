/**
 * Test suite for the values of instructions with an XPath 4.0 record or enumeration type from the containing element:
 * the select of an xsl:sequence and the content of an xsl:select within an xsl:variable, xsl:param, xsl:with-param or
 * xsl:function (within any xsl:if etc.), and the select of an xsl:map-entry, or an instruction within one - for the
 * linter and for completions
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="colour" as="enum('red', 'green')"/>
	<xsl:item-type name="shape" as="record(fill as colour, centre? as cx:complex)"/>
	<xsl:template name="draw"><xsl:param name="shape" as="cx:complex"/></xsl:template>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	${body}
</xsl:stylesheet>`;
}

const template = (content: string) => `<xsl:template name="t">${content}</xsl:template>`;

async function lint(body: string) {
	const xslt = stylesheet(body);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
}

const missing = (field: string, recordName: string, at = '{') => [`XPath: Record field '${field}' is missing - it's required by the record type: ${recordName}`, at];
const notAValue = (value: string) => [`XPath: '${value}' is not one of the values of the enumeration type: colour`, `'${value}'`];

const lintCases: [string, string, string[][]][] = [
	['an xsl:sequence in an xsl:param', template(`<xsl:param name="p" as="cx:complex"><xsl:sequence select="{ 'r': 1 }"/></xsl:param>`), [missing('i', 'cx:complex')]],
	['an xsl:sequence in an xsl:variable, within xsl:choose', template(`<xsl:variable name="v" as="cx:complex"><xsl:choose><xsl:when test="true()"><xsl:sequence select="{ 'r': 1 }"/></xsl:when><xsl:otherwise><xsl:sequence select="{ 'r': 1, 'i': 2 }"/></xsl:otherwise></xsl:choose></xsl:variable>`), [missing('i', 'cx:complex')]],
	['an xsl:select in an xsl:variable', template(`<xsl:variable name="v" as="cx:complex"><xsl:select>{ 'i': 1 }</xsl:select></xsl:variable>`), [missing('r', 'cx:complex')]],
	['an xsl:select with an enumeration type', template(`<xsl:variable name="c" as="colour"><xsl:select>'blue'</xsl:select></xsl:variable>`), [notAValue('blue')]],
	['an xsl:sequence with an enumeration type', template(`<xsl:variable name="c" as="colour"><xsl:sequence select="'red'"/></xsl:variable>`), []],
	['an xsl:sequence in an xsl:with-param', template(`<xsl:call-template name="draw"><xsl:with-param name="shape"><xsl:sequence select="{ 'r': 1 }"/></xsl:with-param></xsl:call-template>`), [missing('i', 'cx:complex')]],
	['an xsl:sequence in an xsl:function, within xsl:if', `<xsl:function name="cx:f" as="cx:complex"><xsl:if test="true()"><xsl:sequence select="{ 'r': 1 }"/></xsl:if></xsl:function>`, [missing('i', 'cx:complex')]],
	['an xsl:sequence that is an xsl:function result is reported once', `<xsl:function name="cx:f" as="cx:complex"><xsl:sequence select="{ 'r': 1 }"/></xsl:function>`, [missing('i', 'cx:complex')]],
	['an xsl:select that is an xsl:function result', `<xsl:function name="cx:f" as="cx:complex"><xsl:select>{ 'r': 1 }</xsl:select></xsl:function>`, [missing('i', 'cx:complex')]],
	['an xsl:map-entry select', template(`<xsl:variable name="s" as="shape"><xsl:map><xsl:map-entry key="'fill'" select="'blue'"/></xsl:map></xsl:variable>`), [notAValue('blue')]],
	['an xsl:sequence in an xsl:map-entry', template(`<xsl:variable name="s" as="shape"><xsl:map><xsl:map-entry key="'fill'" select="'red'"/><xsl:map-entry key="'centre'"><xsl:sequence select="{ 'r': 1 }"/></xsl:map-entry></xsl:map></xsl:variable>`), [missing('i', 'cx:complex')]],
	['an xsl:variable without an as', template(`<xsl:variable name="v"><xsl:sequence select="{ 'r': 1 }"/></xsl:variable>`), []],
	['an xsl:sequence in another instruction', template(`<xsl:variable name="v" as="cx:complex"><xsl:for-each select="1"><xsl:sequence select="{ 'r': 1 }"/></xsl:for-each></xsl:variable>`), []],
];

async function completions(body: string, kind: vscode.CompletionItemKind) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === kind).sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? '')).map((item) => item.label as string);
}

const Field = vscode.CompletionItemKind.Field;
const EnumMember = vscode.CompletionItemKind.EnumMember;

const completionCases: [string, string, vscode.CompletionItemKind, string[]][] = [
	['an xsl:sequence in an xsl:param', template(`<xsl:param name="p" as="cx:complex"><xsl:sequence select="{¦}"/></xsl:param>`), Field, ['\'r\'', '\'i\'']],
	['an xsl:sequence in an xsl:with-param', template(`<xsl:call-template name="draw"><xsl:with-param name="shape"><xsl:sequence select="{ 'r': 1,¦ }"/></xsl:with-param></xsl:call-template>`), Field, ['\'i\'']],
	['an xsl:select in an xsl:variable', template(`<xsl:variable name="v" as="cx:complex"><xsl:select>{¦}</xsl:select></xsl:variable>`), Field, ['\'r\'', '\'i\'']],
	['an empty xsl:select with an enumeration type', template(`<xsl:variable name="c" as="colour"><xsl:select>¦</xsl:select></xsl:variable>`), EnumMember, ['\'red\'', '\'green\'']],
	['an xsl:sequence in an xsl:variable with an enumeration type', template(`<xsl:variable name="c" as="colour"><xsl:sequence select="¦"/></xsl:variable>`), EnumMember, ['\'red\'', '\'green\'']],
	['an xsl:sequence in an xsl:map-entry', template(`<xsl:variable name="s" as="shape"><xsl:map><xsl:map-entry key="'fill'"><xsl:sequence select="¦"/></xsl:map-entry></xsl:map></xsl:variable>`), EnumMember, ['\'red\'', '\'green\'']],
];

suite('Record and enumeration types of instruction values', () => {
	lintCases.forEach(([label, body, expected]) => {
		test(`linter: ${label}`, async () => {
			assert.deepEqual(await lint(body), expected);
		});
	});
	completionCases.forEach(([label, body, kind, expected]) => {
		test(`completion: ${label}`, async () => {
			assert.deepEqual(await completions(body, kind), expected);
		});
	});
});
