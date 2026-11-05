/**
 * Test suite for the XSLT 4.0 xsl:record instruction with an XPath 4.0 record type - its xsl:as, or the declared type of
 * its value from the containing element, e.g. an xsl:variable with an 'as': each attribute in no namespace is a field.
 * The linter reports an attribute that isn't a field, a missing required field and a literal value that doesn't suit the
 * field's type, with quick fixes to add the missing fields and to change an unknown name to a field's. The completions
 * are the attributes for the fields, and an xsl:record with all the fields. A field's attribute is renamed with the field.
 *
 * The cursor position is marked by '|'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';

const declarations = `<xsl:item-type name="cx:complex" as="record(r as xs:double, i as xs:double)"/>
	<xsl:item-type name="colour" as="enum('red', 'green')"/>
	<xsl:item-type name="shape" as="record(fill as colour, centre? as cx:complex)"/>
	<xsl:item-type name="person" as="record(name as xs:string, age? as xs:integer, address as record(city as xs:string, zip? as xs:string))"/>
	<xsl:item-type name="member" as="record(id as xs:integer, 'first name' as xs:string)"/>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
	${declarations}
	${body}
</xsl:stylesheet>`;
}

const variable = (content: string, as = 'cx:complex') => `<xsl:template name="t"><xsl:variable name="v" as="${as}">${content}</xsl:variable><xsl:sequence select="$v"/></xsl:template>`;

function diagnose(document: vscode.TextDocument) {
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(document.getText());
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused' && !d.message.startsWith('XPath: Placeholder'));
}

async function lint(body: string) {
	const document = await vscode.workspace.openTextDocument({ content: stylesheet(body), language: 'xslt' });
	return diagnose(document).map((d) => [d.message, document.getText(d.range)]);
}

const missing = (field: string, recordName = 'cx:complex') => [`XSLT: Record field '${field}' is missing from the xsl:record - it's required by the record type: ${recordName}`, 'xsl:record'];
const unknown = (field: string, recordName = 'cx:complex') => [`XSLT: The xsl:record attribute '${field}' is not a field of the record type: ${recordName}`, field];
const notAValue = (value: string) => [`XPath: '${value}' is not one of the values of the enumeration type: colour`, `'${value}'`];

const lintCases: [string, string, string[][]][] = [
	['all the fields', variable(`<xsl:record r="1" i="2"/>`), []],
	['a missing field', variable(`<xsl:record r="1"/>`), [missing('i')]],
	['an attribute that is not a field', variable(`<xsl:record r="1" i="2" j="3"/>`), [unknown('j')]],
	['its own xsl:as', variable(`<xsl:record xsl:as="cx:complex" r="1"/>`, 'item()'), [missing('i')]],
	['standard attributes and namespace declarations', variable(`<xsl:record xmlns:a="com.example.a" xsl:duplicates="'use-first'" r="1" i="2"/>`), []],
	['an xsl:map-entry child for a field', variable(`<xsl:record r="1"><xsl:map-entry key="'i'" select="2"/></xsl:record>`), []],
	['other content may add the fields', variable(`<xsl:record r="1"><xsl:sequence select="{ 'i': 2 }"/></xsl:record>`), []],
	['an xsl:map-entry child with a key that is not a literal', variable(`<xsl:record r="1"><xsl:map-entry key="'i' || ''" select="2"/></xsl:record>`), []],
	['a value that is not of the field type', variable(`<xsl:record r="'a'" i="2"/>`), [[`XPath: The value for record field 'r' must be of type: xs:double`, `'a'`]]],
	['a value that is not an enumeration value', variable(`<xsl:record fill="'blue'"/>`, 'shape'), [notAValue('blue')]],
	['a map constructor for a field with a record type', variable(`<xsl:record name="'Ann'" address="{ 'zip': 'Z1' }"/>`, 'person'),
		[[`XPath: Record field 'city' is missing - it's required by the record type: record(city as xs:string, zip? as xs:string)`, '{']]],
	['in an xsl:map-entry of an xsl:map', variable(`<xsl:map><xsl:map-entry key="'fill'" select="'red'"/><xsl:map-entry key="'centre'"><xsl:record r="1"/></xsl:map-entry></xsl:map>`, 'shape'), [missing('i')]],
	['the select of an xsl:map-entry child', variable(`<xsl:record><xsl:map-entry key="'fill'" select="'blue'"/></xsl:record>`, 'shape'), [notAValue('blue')]],
	['an xsl:function result', `<xsl:function name="cx:f" as="cx:complex"><xsl:record r="1"/></xsl:function>`, [missing('i')]],
	['within xsl:choose', variable(`<xsl:choose><xsl:when test="true()"><xsl:record i="1"/></xsl:when></xsl:choose>`), [missing('r')]],
	['a field whose name is not an NCName', variable(`<xsl:record id="1"/>`, 'member'), [missing('first name', 'member')]],
	['not a record type', variable(`<xsl:record r="1" j="2"/>`, 'map(*)'), []],
];

// applies the quick fix with the title for the first problem with the message text, returning the xsl:record afterwards
async function quickFix(body: string, messageText: string, title: string) {
	const document = await vscode.workspace.openTextDocument({ content: stylesheet(body), language: 'xslt' });
	const diagnostics = diagnose(document);
	const problem = diagnostics.find((d) => d.message.includes(messageText));
	assert.isDefined(problem, 'the problem');
	const actions = new XSLTCodeActions().provideCodeActions(document, problem!.range, { diagnostics: [problem!], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
	const fix = actions.find((a) => a.title === title);
	assert.isDefined(fix, `the fix '${title}' in: ${actions.map((a) => a.title).join(', ')}`);
	assert.isTrue(await vscode.workspace.applyEdit(fix!.edit!));
	const text = document.getText();
	return { fixed: /<xsl:record[^>]*>/.exec(text)?.[0] ?? /select="[^"]*"/.exec(text.substring(text.indexOf('<xsl:template')))![0], titles: actions.map((a) => a.title), remaining: diagnose(document).map((d) => d.message) };
}

const missingFixCases: [string, string, string][] = [
	['after the last attribute', variable(`<xsl:record r="1"/>`), `<xsl:record r="1" i="__TODO.i"/>`],
	['no attributes', variable(`<xsl:record/>`), `<xsl:record r="__TODO.r" i="__TODO.i"/>`],
	['a map constructor for a field with a record type', variable(`<xsl:record age="1"/>`, 'person'), `<xsl:record age="1" name="__TODO.name" address="{ 'city': __TODO.city }"/>`],
	['after an attribute in apostrophes', variable(`<xsl:record name='"Ann"'/>`, 'person'), `<xsl:record name='"Ann"' address="{ 'city': __TODO.city }"/>`],
	['with content', variable(`<xsl:record><xsl:map-entry key="'r'" select="1"/></xsl:record>`), `<xsl:record i="__TODO.i">`],
];

// the labels and snippets of the completions at the cursor, of the kind
async function completions(body: string, kind: vscode.CompletionItemKind) {
	const marked = stylesheet(body);
	const offset = marked.indexOf('|');
	const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.filter((item) => item.kind === kind).sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''))
		.map((item) => [item.label as string, item.insertText instanceof vscode.SnippetString ? item.insertText.value : item.insertText]);
}

const fieldLabels = async (body: string) => (await completions(body, vscode.CompletionItemKind.Field)).map(([label]) => label);

const attributeCases: [string, string, string[]][] = [
	['no attributes', variable(`<xsl:record |/>`), ['r', 'i']],
	['an attribute before the cursor', variable(`<xsl:record r="1" |/>`), ['i']],
	['an attribute after the cursor', variable(`<xsl:record | i="2"/>`), ['r']],
	['a partly typed name', variable(`<xsl:record r="1" x|/>`), ['i']],
	['required fields first', variable(`<xsl:record |/>`, 'person'), ['name', 'address', 'age']],
	['an xsl:map-entry child', variable(`<xsl:record |><xsl:map-entry key="'r'" select="1"/></xsl:record>`), ['i']],
	['its own xsl:as', variable(`<xsl:record xsl:as="cx:complex" |/>`, 'item()'), ['r', 'i']],
	['not a name that is not an NCName', variable(`<xsl:record |/>`, 'member'), ['id']],
	['not a record type', variable(`<xsl:record |/>`, 'map(*)'), []],
	['not within an attribute value', variable(`<xsl:record r="| "/>`), []],
];

const renameContent = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">
  <xsl:item-type name="cx:point" as="record(x as xs:double, y as xs:double)"/>
  <xsl:item-type name="cx:other" as="record(x as xs:string)"/>
  <xsl:variable name="p" as="cx:point"><xsl:record x="1" y="2"/></xsl:variable>
  <xsl:variable name="o" as="cx:other"><xsl:record x="'a'"/></xsl:variable>
  <xsl:variable name="q"><xsl:record xsl:as="cx:point" x="3"><xsl:map-entry key="'y'" select="4"/></xsl:record></xsl:variable>
  <xsl:template name="t"><xsl:sequence select="$p?x, $o?x, $q"/></xsl:template>
</xsl:stylesheet>`;

async function rename(text: string, delta: number, newName: string) {
	const document = await vscode.workspace.openTextDocument({ content: renameContent, language: 'xslt' });
	const position = document.positionAt(renameContent.indexOf(text) + delta);
	const provider = new XSLTReferenceProvider();
	const token = new vscode.CancellationTokenSource().token;
	assert.isDefined(await provider.prepareRename(document, position, token), 'rename is possible');
	const edit = await provider.provideRenameEdits(document, position, newName, token);
	assert.isTrue(await vscode.workspace.applyEdit(edit!));
	return document.getText().split('\n').map((line) => line.trim());
}

suite('XSLT 4.0 xsl:record with a record type', () => {
	lintCases.forEach(([label, body, expected]) => {
		test(`lint: ${label}`, async () => {
			assert.deepEqual(await lint(body), expected);
		});
	});

	missingFixCases.forEach(([label, body, expected]) => {
		test(`add missing fields: ${label}`, async () => {
			const { fixed, remaining } = await quickFix(body, 'is missing from the xsl:record', 'Add missing record fields');
			assert.equal(fixed, expected);
			assert.deepEqual(remaining, []);
		});
	});

	test('change an unknown attribute to a field', async () => {
		const { fixed, titles, remaining } = await quickFix(variable(`<xsl:record r="1" j="2"/>`), `attribute 'j'`, `Change to 'i'`);
		assert.equal(fixed, `<xsl:record r="1" i="2"/>`);
		assert.deepEqual(titles.filter((t) => t.startsWith('Change to')), [`Change to 'i'`]);
		assert.deepEqual(remaining, []);
	});

	test('change an unknown attribute: the unused fields, closest first', async () => {
		const { titles } = await quickFix(variable(`<xsl:record nam="'Ann'" address="{ 'city': 'X' }"/>`, 'person'), `attribute 'nam'`, `Change to 'name'`);
		assert.deepEqual(titles.filter((t) => t.startsWith('Change to')), [`Change to 'name'`, `Change to 'age'`]);
	});

	test('change an unknown key of a map constructor to a field', async () => {
		const { fixed, remaining } = await quickFix(`<xsl:variable name="v" as="cx:complex" select="{ 'r': 1, 'j': 2 }"/>`, `'j' is not a field`, `Change to 'i'`);
		assert.equal(fixed, `select="{ 'r': 1, 'i': 2 }"`);
		assert.deepEqual(remaining, []);
	});

	attributeCases.forEach(([label, body, expected]) => {
		test(`attribute completions: ${label}`, async () => {
			assert.deepEqual(await fieldLabels(body), expected);
		});
	});

	test('an attribute completion snippet', async () => {
		assert.deepEqual(await completions(variable(`<xsl:record r="1" |/>`), vscode.CompletionItemKind.Field), [['i', 'i="$1"']]);
	});

	test('xsl:map-entry completions within an xsl:record', async () => {
		assert.deepEqual(await fieldLabels(variable(`<xsl:record r="1"><|</xsl:record>`)), [`xsl:map-entry 'i'`]);
	});

	test('xsl:record element completions', async () => {
		const items = (await completions(variable(`<|`, 'person'), vscode.CompletionItemKind.Snippet)).filter(([label]) => (label as string).startsWith('xsl:record '));
		assert.deepEqual(items, [
			['xsl:record person: required fields', `xsl:record name="\${1:__TODO.name}" address="\${2:{ 'city': __TODO.city \\}}"/>$0`],
			['xsl:record person: all fields', `xsl:record name="\${1:__TODO.name}" age="\${2:__TODO.age}" address="\${3:{ 'city': __TODO.city \\}}"/>$0`]
		]);
	});

	test('xsl:record element completions: an xsl:map-entry for a name that is not an NCName', async () => {
		const items = (await completions(variable(`<|`, 'member'), vscode.CompletionItemKind.Snippet)).filter(([label]) => (label as string).startsWith('xsl:record '));
		assert.deepEqual(items, [['xsl:record member: required fields', `xsl:record id="\${1:__TODO.id}">\n\t<xsl:map-entry key="'first name'" select="\${2:__TODO.first_name}"/>\n</xsl:record>$0`]]);
	});

	const xRenamed = (lines: string[]) => {
		assert.include(lines, `<xsl:item-type name="cx:point" as="record(east as xs:double, y as xs:double)"/>`);
		assert.include(lines, `<xsl:variable name="p" as="cx:point"><xsl:record east="1" y="2"/></xsl:variable>`);
		assert.include(lines, `<xsl:variable name="q"><xsl:record xsl:as="cx:point" east="3"><xsl:map-entry key="'y'" select="4"/></xsl:record></xsl:variable>`);
		assert.include(lines, `<xsl:template name="t"><xsl:sequence select="$p?east, $o?x, $q"/></xsl:template>`);
		// the field with the same name in another record type
		assert.include(lines, `<xsl:variable name="o" as="cx:other"><xsl:record x="'a'"/></xsl:variable>`);
	};

	test('rename a field from its declaration', async () => {
		xRenamed(await rename('record(x as', 7, 'east'));
	});

	test('rename a field from an xsl:record attribute', async () => {
		xRenamed(await rename('<xsl:record x=', 12, 'east'));
	});

	test('rename a field from an xsl:map-entry key in an xsl:record', async () => {
		const lines = await rename(`key="'y'"`, 7, 'north');
		assert.include(lines, `<xsl:item-type name="cx:point" as="record(x as xs:double, north as xs:double)"/>`);
		assert.include(lines, `<xsl:variable name="p" as="cx:point"><xsl:record x="1" north="2"/></xsl:variable>`);
		assert.include(lines, `<xsl:variable name="q"><xsl:record xsl:as="cx:point" x="3"><xsl:map-entry key="'north'" select="4"/></xsl:record></xsl:variable>`);
	});

	test('find the references from an xsl:record attribute', async () => {
		const document = await vscode.workspace.openTextDocument({ content: renameContent, language: 'xslt' });
		const position = document.positionAt(renameContent.indexOf('<xsl:record x=') + 12);
		const locations = await new XSLTReferenceProvider().provideReferences(document, position, { includeDeclaration: true }, new vscode.CancellationTokenSource().token);
		const lines = (locations ?? []).map((l) => `${l.range.start.line}:${document.getText(l.range)}`).sort();
		assert.deepEqual(lines, ['1:x', '3:x', '5:x', '6:x']);
	});
});
