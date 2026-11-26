/**
 * Test suite for the options maps of built-in functions, e.g. parse-json($json, map { 'liberal': true() }), and the
 * names of system-property() - as Saxon 13.1 declares them. An option Saxon doesn't recognize is an error with syntax
 * extensions on (XSLT 4.0, or item types), and otherwise a warning, as Saxon ignores it; a value that isn't allowed, or a
 * literal of the wrong type, is an error. Completion of the options and their values, in any XPath expression, and hover
 * over an option or a property name.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { revertAndCloseEditorsIn } from './testEditors';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'function-options-'));
let fileCount = 0;

function stylesheet(body: string, version: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:map="http://www.w3.org/2005/xpath-functions/map"
	xmlns:xs="http://www.w3.org/2001/XMLSchema" version="${version}">
	<xsl:template name="t">${body}</xsl:template>
</xsl:stylesheet>`;
}

// in a folder of its own: a file already open isn't read again
async function open(body: string, version = '3.0') {
	const fileFolder = path.join(folder, String(++fileCount));
	fs.mkdirSync(fileFolder);
	const file = path.join(fileFolder, 'options.xsl');
	fs.writeFileSync(file, stylesheet(body, version));
	return vscode.workspace.openTextDocument(file);
}

async function problems(body: string, version = '3.0') {
	const document = await open(body, version);
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(document.getText());
	const docType = xslLexer.isXSLT40 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT;
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, docType, document, allTokens, xslLexer.globalInstructionData, [], []);
	const severity = (d: vscode.Diagnostic) => d.severity === vscode.DiagnosticSeverity.Error ? 'error' : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : 'other';
	return { document, found: diagnostics.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => [severity(d), d.message, document.getText(d.range)]) };
}

const ignored = (option: string, fn: string) => ['warning', `XPath: '${option}' is not an option of ${fn}() - Saxon ignores it, but raises XPTY0004 for it with syntax extensions on, as for XSLT 4.0`, `'${option}'`];
const unknown = (option: string, fn: string) => ['error', `XPath: '${option}' is not an option of ${fn}() - Saxon raises XPTY0004 for an option it doesn't recognize`, `'${option}'`];
const wrongType = (option: string, fn: string, type: string, literal: string) => ['error', `XPath: The value of the ${fn}() option '${option}' must be of type ${type} (XPTY0004)`, literal];
const notAllowed = (value: string, fn: string, option: string, values: string, code: string) =>
	['error', `XPath: '${value}' is not a value of the ${fn}() option '${option}' (${code}) - it may be: ${values}`, `'${value}'`];

async function completionLabels(body: string, marker = '|', version = '3.0') {
	const document = await open(body.replace(marker, ''), version);
	const position = document.positionAt(stylesheet(body, version).indexOf(marker));
	const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, position);
	return list.items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

suite('Built-in function options and system properties', () => {
	suiteTeardown(async () => {
		await revertAndCloseEditorsIn(folder);
	});

	suite('checks', () => {
		test('an option Saxon doesn\'t recognize: a warning in XSLT 3.0, as Saxon ignores it', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="parse-json('1', map{'liberall': true()})"/>`)).found, [ignored('liberall', 'parse-json')]);
		});
		test('an option Saxon doesn\'t recognize: an error in XSLT 4.0, with syntax extensions on', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="parse-json('1', {'liberall': true()})"/>`, '4.0')).found, [unknown('liberall', 'parse-json')]);
		});
		test('a Saxon option and an XPath 4.0 option, in XSLT 3.0', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="parse-json('1', map{'number-parser': xs:decimal#1, 'null': ()}), xml-to-json(json-to-xml('1'), map{'escape-solidus': false()})"/>`)).found, []);
		});
		test('a literal of the wrong type: a string for a boolean, a QName or a number', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="parse-json('1', map{'liberal': 'yes'}), transform(map{'initial-template': 'main', 'xslt-version': '3.0'})"/>`)).found, [
				wrongType('liberal', 'parse-json', 'xs:boolean', "'yes'"), wrongType('initial-template', 'transform', 'xs:QName', "'main'"),
				wrongType('xslt-version', 'transform', 'xs:decimal', "'3.0'")]);
		});
		test("standalone: () for none, not 'omit'", async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="serialize(1, map{'standalone': 'omit'}), serialize(1, map{'standalone': ()})"/>`)).found,
				[wrongType('standalone', 'serialize', 'xs:boolean?', "'omit'")]);
		});
		test('a value that isn\'t allowed - as Saxon 13.1 allows them, for each function', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="parse-json('1', map{'duplicates': 'retain'}), json-to-xml('1', map{'duplicates': 'retain'}), serialize(1, map{'method': 'csv'}), transform(map{'delivery-format': 'file'})"/>`)).found, [
				notAllowed('retain', 'parse-json', 'duplicates', 'reject, use-first, use-last', 'FOJS0005'),
				notAllowed('csv', 'serialize', 'method', 'xml, html, xhtml, text, json, adaptive', 'SXCH0004'),
				notAllowed('file', 'transform', 'delivery-format', 'document, serialized, raw', 'FOXT0002')]);
		});
		test('a prefixed serialization method, and allowed values', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="serialize(1, map{'method': 'saxon:base64Binary', 'indent': true()}), map:merge((), map{'duplicates': 'use-any'})"/>`)).found, []);
		});
		test("apply-templates' mode: a QName, or '#unnamed' or '#current' - not another string", async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="apply-templates(., {'mode': '#unnamed'}), apply-templates(., {'mode': '#current'}), apply-templates(., {'mode': 'm'})"/>`, '4.0')).found,
				[wrongType('mode', 'apply-templates', "xs:QName?, or '#unnamed', '#current'", "'m'")]);
		});
		test('a nested options map: transform\'s serialization-params, as for serialize()', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="transform(map{'stylesheet-location': 'a.xsl', 'serialization-params': map{'methd': 'xml', 'indent': 'yes'}})"/>`)).found,
				[ignored('methd', 'serialize'), wrongType('indent', 'serialize', 'xs:boolean', "'yes'")]);
		});
		test('a key that isn\'t a string literal, e.g. a QName for a vendor\'s option, isn\'t checked - the other keys are', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="serialize(1, map{QName('http://saxon.sf.net/', 'indent-spaces'): 2, 'indent': 'yes'})"/>`)).found,
				[wrongType('indent', 'serialize', 'xs:boolean', "'yes'")]);
		});
		test('an arrow operator\'s operand is the first argument, and a keyword argument is found by its name', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="'1' => parse-json({'x': 1}), parse-json('1', options := {'y': 1})"/>`, '4.0')).found,
				[unknown('x', 'parse-json'), unknown('y', 'parse-json')]);
		});
		test('not an options argument: a variable, a map that is part of the argument, another argument, or a dynamic call', async () => {
			assert.deepEqual((await problems(`<xsl:variable name="f" select="map{'x': 1}"/><xsl:sequence select="parse-json('1', $f), parse-json('1', map{'x': 1}?x), $f(map{'x': 1}), serialize(map{'x': 1})"/>`)).found, []);
		});
		test('system-property: a name in the XSLT namespace that isn\'t a system property', async () => {
			assert.deepEqual((await problems(`<xsl:sequence select="system-property('xsl:version'), system-property('xsl:verson'), system-property('java.version'), system-property('saxon:platform')"/>`)).found,
				[['warning', "XPath: 'xsl:verson' is not a system property in the XSLT namespace - system-property() returns an empty string for it", "'xsl:verson'"]]);
		});
		test('the quick fix for an option that isn\'t recognized: the closest names', async () => {
			const { document } = await problems(`<xsl:sequence select="parse-json('1', map{'liberall': true()})"/>`);
			const offset = document.getText().indexOf("'liberall'") + 2;
			const range = new vscode.Range(document.positionAt(offset), document.positionAt(offset));
			// the extension's own check of the document gives the diagnostic the code actions are for
			await vscode.window.showTextDocument(document);
			let titles: string[] = [];
			for (let attempt = 0; attempt < 20 && !titles.includes("Change to 'liberal'"); attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri, range);
				titles = actions.map((a) => a.title);
			}
			assert.include(titles, "Change to 'liberal'");
		});
	});

	suite('completion', () => {
		test('the options of a function, in XSLT 3.0', async () => {
			const labels = await completionLabels(`<xsl:sequence select="parse-json('1', map{|})"/>`);
			assert.includeMembers(labels, ["'liberal'", "'duplicates'", "'escape'", "'fallback'", "'number-parser'"]);
		});
		test('the options not yet used, in an attribute other than select', async () => {
			const labels = await completionLabels(`<xsl:if test="serialize(., map{'method': 'json', |})"/>`);
			assert.include(labels, "'indent'");
			assert.notInclude(labels, "'method'");
		});
		test('the values of an option with a fixed set of values, and of a boolean', async () => {
			assert.includeMembers(await completionLabels(`<xsl:sequence select="parse-json('1', map{'duplicates': |})"/>`), ["'reject'", "'use-first'", "'use-last'"]);
			assert.includeMembers(await completionLabels(`<xsl:sequence select="parse-json('1', map{'liberal': |})"/>`), ['true()', 'false()']);
		});
		test('a nested options map', async () => {
			assert.include(await completionLabels(`<xsl:sequence select="transform(map{'serialization-params': map{|}})"/>`), "'method'");
		});
		test('system-property names, with the document\'s prefix for XSLT', async () => {
			assert.includeMembers(await completionLabels(`<xsl:sequence select="system-property('|')"/>`), ['xsl:version', 'xsl:supports-streaming']);
		});
	});

	suite('hover', () => {
		const hoverText = async (body: string, text: string) => {
			const { document } = await problems(body);
			const position = document.positionAt(document.getText().indexOf(text) + 2);
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
			return hovers.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n');
		};
		test('an option: its type, function and description', async () => {
			const text = await hoverText(`<xsl:sequence select="parse-json('1', map{'duplicates': 'reject'})"/>`, "'duplicates'");
			assert.include(text, "**duplicates** `as enum('reject', 'use-first', 'use-last')` - option of `parse-json()`");
			assert.include(text, "Default: `'use-first'`");
		});
		test('a system property', async () => {
			assert.include(await hoverText(`<xsl:sequence select="system-property('xsl:is-schema-aware')"/>`, "'xsl:is-schema-aware'"), 'Whether the processor is schema-aware');
		});
	});
});
