/**
 * Test suite for renaming a value of an XPath 4.0 enumeration type, and finding its references: the value in its
 * enum(...) declaration, and the string literals matched to it - variable values, function arguments (positional and
 * keyword), map constructor values for a record field, typed let bindings and xsl:switch cases. A value of an item type
 * is renamed for that type - also when used as another item type declared as it - but not in another item type with
 * the same value. Inline enum(...) types are identified by their values. Also for a value of an item type in an
 * imported module.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';

const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">
  <xsl:item-type name="cx:color" as="enum('red', 'green', 'blue')"/>
  <xsl:item-type name="cx:shade" as="cx:color"/>
  <xsl:item-type name="cx:fruit" as="enum('red', 'apple')"/>
  <xsl:item-type name="cx:car" as="record(paint as cx:color)"/>
  <xsl:variable name="c" as="cx:color" select="'red'"/>
  <xsl:variable name="s" as="cx:shade" select="'red'"/>
  <xsl:variable name="f" as="cx:fruit" select="'red'"/>
  <xsl:variable name="car" as="cx:car" select="{ 'paint': 'red' }"/>
  <xsl:variable name="mode" as="enum('off', 'on')" select="'on'"/>
  <xsl:variable name="other" as="enum('on', 'off', 'auto')" select="'on'"/>
  <xsl:function name="cx:paint" as="xs:string">
    <xsl:param name="color" as="cx:color"/>
    <xsl:sequence select="string($color)"/>
  </xsl:function>
  <xsl:function name="cx:set" as="xs:string">
    <xsl:param name="state" as="enum('on', 'off')"/>
    <xsl:sequence select="string($state)"/>
  </xsl:function>
  <xsl:template name="t">
    <xsl:sequence select="cx:paint('red'), cx:paint(color := 'red'), cx:set('on'), let $x as cx:color := 'red' return $x"/>
    <xsl:switch select="$c">
      <xsl:when test="'red'">R</xsl:when>
      <xsl:otherwise>other</xsl:otherwise>
    </xsl:switch>
  </xsl:template>
</xsl:stylesheet>`;

const token = () => new vscode.CancellationTokenSource().token;

// the lines of the document after renaming the value at the offset of the text, plus the delta
async function rename(text: string, delta: number, newName: string, source = content) {
	const document = await vscode.workspace.openTextDocument({ content: source, language: 'xslt' });
	const position = document.positionAt(source.indexOf(text) + delta);
	const provider = new XSLTReferenceProvider();
	const range = await provider.prepareRename(document, position, token());
	assert.isDefined(range, 'rename is possible');
	const edit = await provider.provideRenameEdits(document, position, newName, token());
	assert.isTrue(await vscode.workspace.applyEdit(edit!));
	return document.getText().split('\n').map((line) => line.trim());
}

// the rejection of a rename to the new name, from the value at the offset of the text, plus the delta
async function renameError(text: string, delta: number, newName: string, source = content) {
	const document = await vscode.workspace.openTextDocument({ content: source, language: 'xslt' });
	const position = document.positionAt(source.indexOf(text) + delta);
	const provider = new XSLTReferenceProvider();
	await provider.prepareRename(document, position, token());
	try {
		await provider.provideRenameEdits(document, position, newName, token());
	} catch (e) {
		return String(e);
	}
	return '';
}

suite('Enumeration values: rename and find references', () => {
	const redRenamed = (lines: string[]) => {
		assert.include(lines, `<xsl:item-type name="cx:color" as="enum('crimson', 'green', 'blue')"/>`);
		assert.include(lines, `<xsl:variable name="c" as="cx:color" select="'crimson'"/>`);
		assert.include(lines, `<xsl:variable name="s" as="cx:shade" select="'crimson'"/>`);
		assert.include(lines, `<xsl:variable name="car" as="cx:car" select="{ 'paint': 'crimson' }"/>`);
		assert.include(lines, `<xsl:sequence select="cx:paint('crimson'), cx:paint(color := 'crimson'), cx:set('on'), let $x as cx:color := 'crimson' return $x"/>`);
		assert.include(lines, `<xsl:when test="'crimson'">R</xsl:when>`);
		// the same value of another item type
		assert.include(lines, `<xsl:item-type name="cx:fruit" as="enum('red', 'apple')"/>`);
		assert.include(lines, `<xsl:variable name="f" as="cx:fruit" select="'red'"/>`);
	};

	test('from the declaration', async () => {
		redRenamed(await rename(`enum('red'`, 6, 'crimson'));
	});

	test('from a variable value', async () => {
		redRenamed(await rename(`as="cx:color" select="'red'"`, 23, 'crimson'));
	});

	test('from a value for an item type declared as another', async () => {
		redRenamed(await rename(`as="cx:shade" select="'red'"`, 23, 'crimson'));
	});

	test('from a function argument', async () => {
		redRenamed(await rename(`cx:paint('red')`, 10, 'crimson'));
	});

	test('from an xsl:switch case', async () => {
		redRenamed(await rename(`test="'red'"`, 7, 'crimson'));
	});

	test('a value of another item type with the same value', async () => {
		const lines = await rename(`as="cx:fruit" select="'red'"`, 23, 'cherry');
		assert.include(lines, `<xsl:item-type name="cx:fruit" as="enum('cherry', 'apple')"/>`);
		assert.include(lines, `<xsl:variable name="f" as="cx:fruit" select="'cherry'"/>`);
		assert.include(lines, `<xsl:item-type name="cx:color" as="enum('red', 'green', 'blue')"/>`);
		assert.include(lines, `<xsl:variable name="c" as="cx:color" select="'red'"/>`);
	});

	test('a value of inline enumeration types with the same values', async () => {
		const lines = await rename(`cx:set('on')`, 8, 'enabled');
		assert.include(lines, `<xsl:param name="state" as="enum('enabled', 'off')"/>`);
		assert.include(lines, `<xsl:variable name="mode" as="enum('off', 'enabled')" select="'enabled'"/>`);
		assert.include(lines, `<xsl:sequence select="cx:paint('red'), cx:paint(color := 'red'), cx:set('enabled'), let $x as cx:color := 'red' return $x"/>`);
		// an inline enumeration type with other values
		assert.include(lines, `<xsl:variable name="other" as="enum('on', 'off', 'auto')" select="'on'"/>`);
	});

	test('from an inline declaration', async () => {
		const lines = await rename(`as="enum('on', 'off')"`, 10, 'enabled');
		assert.include(lines, `<xsl:param name="state" as="enum('enabled', 'off')"/>`);
		assert.include(lines, `<xsl:variable name="mode" as="enum('off', 'enabled')" select="'enabled'"/>`);
		assert.include(lines, `<xsl:variable name="other" as="enum('on', 'off', 'auto')" select="'on'"/>`);
	});

	test('a new value that is already a value of the type is rejected', async () => {
		assert.include(await renameError(`cx:paint('red')`, 10, 'green'), 'already a value');
	});

	test('a new value with a quote that is not doubled is rejected', async () => {
		assert.include(await renameError(`cx:paint('red')`, 10, `it's`), 'must be doubled');
	});

	// the literals of a value written in each form: single quotes, quotes as references, and element content
	const quoted = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:cx="cx" version="4.0">
  <xsl:item-type name="cx:mark" as="enum('dot', 'it''s')"/>
  <xsl:variable name="a" as="cx:mark" select="'dot'"/>
  <xsl:variable name="c" as="cx:mark" select="&quot;dot&quot;"/>
  <xsl:variable name="d" as="cx:mark"><xsl:select>'dot'</xsl:select></xsl:variable>
  <xsl:variable name="e" as="cx:mark" select="'it''s'"/>
</xsl:stylesheet>`;

	test('a new value with a doubled quote, written in the form of each literal', async () => {
		const lines = await rename(`select="'dot'"`, 10, `don''t`, quoted);
		assert.include(lines, `<xsl:item-type name="cx:mark" as="enum('don''t', 'it''s')"/>`);
		assert.include(lines, `<xsl:variable name="a" as="cx:mark" select="'don''t'"/>`);
		assert.include(lines, `<xsl:variable name="c" as="cx:mark" select="&quot;don't&quot;"/>`);
		assert.include(lines, `<xsl:variable name="d" as="cx:mark"><xsl:select>'don''t'</xsl:select></xsl:variable>`);
	});

	test('a value with a doubled quote', async () => {
		const lines = await rename(`select="'it''s'"`, 10, 'its', quoted);
		assert.include(lines, `<xsl:item-type name="cx:mark" as="enum('dot', 'its')"/>`);
		assert.include(lines, `<xsl:variable name="e" as="cx:mark" select="'its'"/>`);
	});

	test('a new value with the quote of attributes with double quotes is rejected', async () => {
		// as &quot; - e.g. &quot;&quot; within &quot;...&quot;, which the lexer splits
		assert.include(await renameError(`enum('dot'`, 6, `say "hi"`, quoted), `can't be written`);
	});

	test('a new value with a quote that would have to be a reference is rejected', async () => {
		// "..." within select='...' - a single quote there would have to be &apos;
		const source = quoted.replace(`<xsl:variable name="a" as="cx:mark" select="'dot'"/>`, `<xsl:variable name="a" as="cx:mark" select='"dot"'/>`);
		assert.include(await renameError(`enum('dot'`, 6, `don''t`, source), `can't be written`);
	});

	test('find all references', async () => {
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		const position = document.positionAt(content.indexOf(`cx:paint('red')`) + 10);
		const locations = await new XSLTReferenceProvider().provideReferences(document, position, { includeDeclaration: true }, token()) ?? [];
		// the declaration, 2 variables, a map constructor value, 2 arguments, a let binding and an xsl:switch case
		assert.equal(locations.length, 8);
		locations.forEach((location) => assert.equal(document.getText(location.range), 'red'));
	});

	test('a value of an item type in an imported module', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enum-rename-'));
		const libPath = path.join(dir, 'lib.xsl');
		const mainPath = path.join(dir, 'main.xsl');
		fs.writeFileSync(libPath, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">
  <xsl:item-type name="cx:color" as="enum('red', 'green')"/>
  <xsl:variable name="default" as="cx:color" select="'red'"/>
</xsl:stylesheet>`);
		fs.writeFileSync(mainPath, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">
  <xsl:import href="lib.xsl"/>
  <xsl:variable name="c" as="cx:color" select="'red'"/>
</xsl:stylesheet>`);
		const main = await vscode.workspace.openTextDocument(vscode.Uri.file(mainPath));
		const position = main.positionAt(main.getText().indexOf(`select="'red'"`) + 9);
		const provider = new XSLTReferenceProvider();
		assert.isDefined(await provider.prepareRename(main, position, token()));
		const edit = await provider.provideRenameEdits(main, position, 'crimson', token());
		assert.isTrue(await vscode.workspace.applyEdit(edit!));
		const lib = await vscode.workspace.openTextDocument(vscode.Uri.file(libPath));
		assert.include(main.getText(), `<xsl:variable name="c" as="cx:color" select="'crimson'"/>`);
		assert.include(lib.getText(), `as="enum('crimson', 'green')"`);
		assert.include(lib.getText(), `<xsl:variable name="default" as="cx:color" select="'crimson'"/>`);
		// the edited modules would otherwise be left unsaved, and closing their editors in a later test would prompt
		await main.save();
		await lib.save();
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
