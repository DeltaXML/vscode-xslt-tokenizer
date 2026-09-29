/**
 * Test suite for XSLT 4.0 named item types - xsl:item-type, with record and enumeration types, also in 'as'
 * attributes - and xsl:note in an XSLT 3.0 stylesheet, with the setting XSLT.validation.xslt30ItemTypesAndNotes: for
 * Saxon PE/EE 12.8 or later with syntax extensions, which accepts them. Other XSLT 4.0 features still need
 * version="4.0". The stylesheet is one that Saxon 12.8 and 13 both run with syntax extensions.
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { ItemTypeSupport } from '../../src/itemTypeSupport';

const declarations = `  <xsl:item-type name="dfx:bounds" as="record(t as xs:integer, l as xs:integer, b as xs:integer, r as xs:integer)"/>
  <xsl:item-type name="dfx:rectangle" as="record(x as xs:integer, y as xs:integer, width as xs:integer, height as xs:integer)"/>
  <xsl:item-type name="dfx:region" as="record(version as xs:string, rect as dfx:rectangle, label? as xs:string)"/>
  <xsl:item-type name="dfx:region-map" as="map(xs:string, dfx:region)"/>
  <xsl:item-type name="dfx:table-type" as="enum('CALS', 'HTML', 'simpletable')"/>
  <xsl:variable name="bounds" as="dfx:bounds" select="map { 't': 0, 'l': 0, 'b': 4, 'r': 6 }"/>
  <xsl:variable name="region" as="dfx:region" select="map { 'version': 'A', 'rect': map { 'x': 1, 'y': 2, 'width': 3, 'height': 4 } }"/>
  <xsl:variable name="regions" as="dfx:region-map" select="map { 'A1': $region }"/>
  <xsl:variable name="table-type" as="dfx:table-type" select="'CALS'"/>
  <xsl:variable name="inline" as="record(n as xs:integer)" select="map { 'n': 1 }"/>
  <xsl:function name="dfx:area" as="xs:integer">
    <xsl:param name="bounds" as="dfx:bounds"/>
    <xsl:sequence select="($bounds?b - $bounds?t) * ($bounds?r - $bounds?l)"/>
  </xsl:function>`;

const stylesheet = (body = '', version = '3.0') => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:dfx="dfx" exclude-result-prefixes="#all" version="${version}">
${declarations}
  <xsl:template name="xsl:initial-template"><xsl:sequence select="dfx:area($bounds), $regions?A1?rect?width, $table-type, $inline?n"/></xsl:template>
  ${body}
</xsl:stylesheet>`;

async function lint(xslt: string) {
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const isVersion4 = xslLexer.isXSLT40;
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused').map((d) => d.message);
}

async function open(marked: string) {
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	return { document, position: document.positionAt(offset) };
}

async function completionLabels(marked: string, triggerCharacter?: string) {
	const { document, position } = await open(marked);
	const context = triggerCharacter ? { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter } : { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined };
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, new vscode.CancellationTokenSource().token, context);
	return (Array.isArray(result) ? result : result?.items ?? []).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

const requires40 = 'XSLT: xsl:note is XSLT 4.0 - an XSLT 3.0 processor reports XTSE0010 for it. Use version="4.0", or exclude it with use-when="false()"';

suite('XSLT 3.0 with item types and notes', () => {
	suiteSetup(() => {
		ItemTypeSupport.before40Override = true;
	});
	suiteTeardown(() => {
		ItemTypeSupport.before40Override = undefined;
	});

	test('linter: the item types, and their use in as attributes', async () => {
		assert.deepEqual(await lint(stylesheet()), []);
	});

	test('linter: without the setting, they are reported', async () => {
		ItemTypeSupport.before40Override = false;
		try {
			const messages = await lint(stylesheet());
			assert.isTrue(messages.some((m) => m.includes('xsl:item-type')), messages.join('\n'));
		} finally {
			ItemTypeSupport.before40Override = true;
		}
	});

	test('linter: a map constructor without a field of the record type', async () => {
		const messages = await lint(stylesheet(`<xsl:variable name="b2" as="dfx:bounds" select="map { 't': 0, 'l': 0, 'b': 4 }"/>`));
		assert.isTrue(messages.some((m) => m.includes(`'r'`)), messages.join('\n'));
	});

	test('linter: a value that is not one of the enumeration type', async () => {
		const messages = await lint(stylesheet(`<xsl:variable name="t2" as="dfx:table-type" select="'XHTML'"/>`));
		assert.include(messages, `XPath: 'XHTML' is not one of the values of the enumeration type: dfx:table-type`);
	});

	test('linter: a lookup of a field that the record type does not have', async () => {
		const messages = await lint(stylesheet(`<xsl:variable name="top" select="$bounds?top"/>`));
		assert.isTrue(messages.some((m) => m.includes('top')), messages.join('\n'));
	});

	test('linter: an undeclared named item type', async () => {
		const messages = await lint(stylesheet(`<xsl:variable name="u" as="dfx:unknown" select="()"/>`));
		assert.isTrue(messages.some((m) => m.includes('dfx:unknown')), messages.join('\n'));
	});

	test('linter: xsl:note needs no use-when', async () => {
		assert.deepEqual(await lint(stylesheet(`<xsl:template name="t"><xsl:note>A note.</xsl:note><xsl:sequence select="1"/></xsl:template>`)), []);
	});

	test('linter: xsl:note without the setting', async () => {
		ItemTypeSupport.before40Override = false;
		try {
			assert.include(await lint(`<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n  <xsl:note>A note.</xsl:note>\n</xsl:stylesheet>`), requires40);
		} finally {
			ItemTypeSupport.before40Override = true;
		}
	});

	test('linter: other XSLT 4.0 features still need version="4.0"', async () => {
		const switchMessages = await lint(stylesheet(`<xsl:template name="t"><xsl:switch select="1"><xsl:when test="1">a</xsl:when></xsl:switch></xsl:template>`));
		assert.isTrue(switchMessages.some((m) => m.includes('xsl:switch')), switchMessages.join('\n'));
		const fnMessages = await lint(stylesheet(`<xsl:variable name="f" as="fn(xs:string) as xs:string" select="upper-case#1"/>`));
		assert.isNotEmpty(fnMessages);
	});

	test('completion: xsl:item-type at the top level', async () => {
		assert.include(await completionLabels(stylesheet('<¦'), '<'), 'xsl:item-type');
	});

	test('completion: no xsl:item-type without the setting', async () => {
		ItemTypeSupport.before40Override = false;
		try {
			assert.notInclude(await completionLabels(stylesheet('<¦'), '<'), 'xsl:item-type');
		} finally {
			ItemTypeSupport.before40Override = true;
		}
	});

	test('completion: record and enumeration types, and the named item types, in an as attribute', async () => {
		const labels = await completionLabels(stylesheet(`<xsl:variable name="v" as="¦" select="()"/>`));
		assert.includeMembers(labels, ['record()', 'enum()', 'dfx:bounds', 'dfx:table-type']);
	});

	test('completion: the fields of a record type, for a lookup', async () => {
		const labels = await completionLabels(stylesheet(`<xsl:template name="t2"><xsl:sequence select="$bounds?¦"/></xsl:template>`));
		assert.includeMembers(labels, ['t', 'l', 'b', 'r']);
	});

	test('completion: the fields of a record type, for a map constructor', async () => {
		const labels = await completionLabels(stylesheet(`<xsl:variable name="b3" as="dfx:bounds" select="map { 't': 0, ¦ }"/>`));
		assert.includeMembers(labels, [`'l'`, `'b'`, `'r'`]);
	});

	test('completion: the values of an enumeration type', async () => {
		const labels = await completionLabels(stylesheet(`<xsl:variable name="t3" as="dfx:table-type" select="¦"/>`));
		assert.includeMembers(labels, [`'CALS'`, `'HTML'`, `'simpletable'`]);
	});

	test('completion: xsl:note without use-when', async () => {
		const { document, position } = await open(stylesheet(`<xsl:template name="t2"><¦</xsl:template>`));
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: '<' });
		const note = (Array.isArray(result) ? result : result?.items ?? []).find((item) => item.label === 'xsl:note xdoc-md');
		assert.equal((note?.insertText as vscode.SnippetString).value, 'xsl:note format="xdoc-md">\n\t$0\n</xsl:note>');
	});

	test('add documentation note: without use-when', async () => {
		const xslt = stylesheet();
		const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
		await vscode.window.showTextDocument(document);
		const position = document.positionAt(xslt.indexOf('dfx:table-type') + 2);
		const actions = new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const action = actions.find((a) => a.title === 'Add documentation note');
		assert.isDefined(action);
		assert.isTrue(await vscode.workspace.applyEdit(action!.edit!));
		assert.include(document.getText(), `<xsl:item-type name="dfx:table-type" as="enum('CALS', 'HTML', 'simpletable')">\n    <xsl:note format="xdoc-md">`);
	});

	test('hover: a record field', async () => {
		const marked = stylesheet(`<xsl:template name="t2"><xsl:sequence select="$bounds?¦r"/></xsl:template>`);
		const { document, position } = await open(marked);
		// the linter records the field references for the document
		const xslLexer = new XslLexer(XSLTConfiguration.configuration);
		xslLexer.provideCharLevelState = true;
		XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: false }, DocumentTypes.XSLT, document, xslLexer.analyse(document.getText()), xslLexer.globalInstructionData, [], []);
		const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
		assert.include((hover?.contents as vscode.MarkdownString[]).map((c) => c.value).join('\n'), 'Field of the record type: `dfx:bounds`');
	});

	test('rename: a record field', async () => {
		const { document, position } = await open(stylesheet().replace('$bounds?b - $bounds?t', '$bounds?¦b - $bounds?t'));
		const provider = new XSLTReferenceProvider();
		const token = new vscode.CancellationTokenSource().token;
		assert.isDefined(await provider.prepareRename(document, position, token));
		const edit = await provider.provideRenameEdits(document, position, 'bottom', token);
		assert.isTrue(await vscode.workspace.applyEdit(edit!));
		const text = document.getText();
		assert.include(text, 'record(t as xs:integer, l as xs:integer, bottom as xs:integer, r as xs:integer)');
		assert.include(text, `map { 't': 0, 'l': 0, 'bottom': 4, 'r': 6 }`);
		assert.include(text, '($bounds?bottom - $bounds?t)');
	});
	// for the warning when a task runs a stylesheet with "allowSyntaxExtensions40": "off"
	test('syntax extensions: needed for an XSLT 3.0 stylesheet with item types, record types or notes', () => {
		const xslt30 = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n  ${body}\n</xsl:stylesheet>`;
		assert.equal(ItemTypeSupport.syntaxExtensionsReason(stylesheet('', '4.0')), 'xslt40');
		assert.equal(ItemTypeSupport.syntaxExtensionsReason(stylesheet()), 'itemTypes');
		assert.equal(ItemTypeSupport.syntaxExtensionsReason(xslt30('<xsl:variable name="v" as="record(a as xs:string)" select="()"/>')), 'itemTypes');
		assert.equal(ItemTypeSupport.syntaxExtensionsReason(xslt30('<xsl:template name="t"><xsl:note>n</xsl:note></xsl:template>')), 'itemTypes');
		assert.isUndefined(ItemTypeSupport.syntaxExtensionsReason(xslt30('<xsl:variable name="v" as="xs:string" select="record(1)"/>')));
		assert.isUndefined(ItemTypeSupport.syntaxExtensionsReason(xslt30('<!-- <xsl:item-type name="t" as="xs:string"/> -->')));
		ItemTypeSupport.before40Override = false;
		try {
			// without the setting, the linter reports them instead
			assert.isUndefined(ItemTypeSupport.syntaxExtensionsReason(stylesheet()));
		} finally {
			ItemTypeSupport.before40Override = true;
		}
	});
});
