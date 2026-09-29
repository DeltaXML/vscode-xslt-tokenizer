/**
 * Test suite for renaming a field of an XPath 4.0 record type, and finding its references: the field's name in the
 * record type, its references - lookups, map constructor keys, xsl:map-entry keys and child steps on a JNode - and the
 * @field tags for it in the documentation notes of the xsl:item-type declaring it, and of one declared as that one - but
 * not a field with the same name in another record type. Also for a field of an item type in an imported module.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';

const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">
  <xsl:item-type name="cx:point" as="record(x as xs:double, y as xs:double, 'unit name'? as xs:string)">
    <xsl:note format="xdoc-md">
      A point.
      @field x the horizontal position
      @field y the vertical position
    </xsl:note>
  </xsl:item-type>
  <xsl:item-type name="cx:location" as="cx:point">
    <xsl:note format="xdoc-md">
      @field x the east position
    </xsl:note>
  </xsl:item-type>
  <xsl:item-type name="cx:other" as="record(x as xs:string)"/>
  <xsl:item-type name="cx:box" as="record(size as record(w as xs:double))"/>
  <xsl:variable name="p" as="cx:point" select="{ 'x': 1, 'y': 2 }"/>
  <xsl:variable name="l" as="cx:location" select="{ 'x': 3, 'y': 4 }"/>
  <xsl:variable name="o" as="cx:other" select="{ 'x': 'a' }"/>
  <xsl:variable name="b" as="cx:box" select="{ 'size': { 'w': 1 } }"/>
  <xsl:variable name="q" as="record(r as xs:double)" select="{ 'r': 1 }"/>
  <xsl:variable name="m" as="cx:point"><xsl:map><xsl:map-entry key="'x'" select="1"/><xsl:map-entry key="'y'" select="2"/></xsl:map></xsl:variable>
  <xsl:template name="t"><xsl:sequence select="$p?x, $l?x, $o?x, jtree($p)/x, $p?'unit name', $b?size?w, $q?r"/></xsl:template>
</xsl:stylesheet>`;

const token = () => new vscode.CancellationTokenSource().token;

// the lines of the document after renaming the field at the offset of the text, plus the delta
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

suite('Record fields: rename and find references', () => {
	const xRenamed = (lines: string[]) => {
		assert.include(lines, `<xsl:item-type name="cx:point" as="record(east as xs:double, y as xs:double, 'unit name'? as xs:string)">`);
		assert.include(lines, '@field east the horizontal position');
		assert.include(lines, '@field east the east position');
		assert.include(lines, `<xsl:variable name="p" as="cx:point" select="{ 'east': 1, 'y': 2 }"/>`);
		assert.include(lines, `<xsl:variable name="l" as="cx:location" select="{ 'east': 3, 'y': 4 }"/>`);
		assert.include(lines, `<xsl:variable name="m" as="cx:point"><xsl:map><xsl:map-entry key="'east'" select="1"/><xsl:map-entry key="'y'" select="2"/></xsl:map></xsl:variable>`);
		assert.include(lines, `<xsl:template name="t"><xsl:sequence select="$p?east, $l?east, $o?x, jtree($p)/east, $p?'unit name', $b?size?w, $q?r"/></xsl:template>`);
		// the field with the same name in another record type
		assert.include(lines, `<xsl:item-type name="cx:other" as="record(x as xs:string)"/>`);
		assert.include(lines, `<xsl:variable name="o" as="cx:other" select="{ 'x': 'a' }"/>`);
	};

	test('from the declaration', async () => {
		xRenamed(await rename('record(x as', 7, 'east'));
	});

	test('from a lookup', async () => {
		xRenamed(await rename('$p?x,', 3, 'east'));
	});

	test('from a lookup on an item type declared as another', async () => {
		xRenamed(await rename('$l?x,', 3, 'east'));
	});

	test('from an @field tag', async () => {
		xRenamed(await rename('@field x the horizontal', 7, 'east'));
	});

	test('from an @field tag of an item type declared as another', async () => {
		xRenamed(await rename('@field x the east', 7, 'east'));
	});

	test('from an xsl:map-entry key', async () => {
		xRenamed(await rename(`key="'x'"`, 6, 'east'));
	});

	test('a field of another record type with the same name', async () => {
		const lines = await rename('$o?x', 3, 'label');
		assert.include(lines, `<xsl:item-type name="cx:other" as="record(label as xs:string)"/>`);
		assert.include(lines, `<xsl:variable name="o" as="cx:other" select="{ 'label': 'a' }"/>`);
		assert.include(lines, `<xsl:template name="t"><xsl:sequence select="$p?x, $l?x, $o?label, jtree($p)/x, $p?'unit name', $b?size?w, $q?r"/></xsl:template>`);
		assert.include(lines, '@field x the horizontal position');
	});

	test('a field of a nested record type', async () => {
		const lines = await rename('?w', 1, 'width');
		assert.include(lines, `<xsl:item-type name="cx:box" as="record(size as record(width as xs:double))"/>`);
		assert.include(lines, `<xsl:variable name="b" as="cx:box" select="{ 'size': { 'width': 1 } }"/>`);
		assert.include(lines, `<xsl:template name="t"><xsl:sequence select="$p?x, $l?x, $o?x, jtree($p)/x, $p?'unit name', $b?size?width, $q?r"/></xsl:template>`);
	});

	test('a field of an inline record type', async () => {
		const lines = await rename('record(r as', 7, 'radius');
		assert.include(lines, `<xsl:variable name="q" as="record(radius as xs:double)" select="{ 'radius': 1 }"/>`);
		assert.include(lines, `<xsl:template name="t"><xsl:sequence select="$p?x, $l?x, $o?x, jtree($p)/x, $p?'unit name', $b?size?w, $q?radius"/></xsl:template>`);
	});

	test('a quoted field name, keeping the quotes', async () => {
		const lines = await rename(`$p?'unit name'`, 5, 'units');
		assert.include(lines, `<xsl:item-type name="cx:point" as="record(x as xs:double, y as xs:double, 'units'? as xs:string)">`);
		assert.include(lines, `<xsl:template name="t"><xsl:sequence select="$p?x, $l?x, $o?x, jtree($p)/x, $p?'units', $b?size?w, $q?r"/></xsl:template>`);
	});

	test('a new name that is not an NCName is rejected for a field whose name is one', async () => {
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		const position = document.positionAt(content.indexOf('$p?x,') + 3);
		const provider = new XSLTReferenceProvider();
		await provider.prepareRename(document, position, token());
		let error: unknown;
		try {
			await provider.provideRenameEdits(document, position, 'east west', token());
		} catch (e) {
			error = e;
		}
		assert.include(String(error), 'not an NCName');
	});

	test('find all references', async () => {
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		const position = document.positionAt(content.indexOf('$p?x,') + 3);
		const locations = await new XSLTReferenceProvider().provideReferences(document, position, { includeDeclaration: true }, token()) ?? [];
		// the declaration, 2 @field tags, 2 map constructor keys, an xsl:map-entry key, 2 lookups and a child step
		assert.equal(locations.length, 9);
		locations.forEach((location) => assert.equal(document.getText(location.range), 'x'));
	});

	test('a field of an item type in an imported module', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-rename-'));
		const libPath = path.join(dir, 'lib.xsl');
		const mainPath = path.join(dir, 'main.xsl');
		fs.writeFileSync(libPath, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">
  <xsl:item-type name="cx:point" as="record(x as xs:double, y as xs:double)">
    <xsl:note format="xdoc-md">
      @field x the horizontal position
    </xsl:note>
  </xsl:item-type>
  <xsl:function name="cx:origin" as="cx:point"><xsl:sequence select="{ 'x': 0, 'y': 0 }"/></xsl:function>
</xsl:stylesheet>`);
		fs.writeFileSync(mainPath, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">
  <xsl:import href="lib.xsl"/>
  <xsl:variable name="p" as="cx:point" select="{ 'x': 1, 'y': 2 }"/>
  <xsl:template name="t"><xsl:sequence select="$p?x"/></xsl:template>
</xsl:stylesheet>`);
		const main = await vscode.workspace.openTextDocument(vscode.Uri.file(mainPath));
		const position = main.positionAt(main.getText().indexOf('$p?x') + 3);
		const provider = new XSLTReferenceProvider();
		assert.isDefined(await provider.prepareRename(main, position, token()));
		const edit = await provider.provideRenameEdits(main, position, 'east', token());
		assert.isTrue(await vscode.workspace.applyEdit(edit!));
		const lib = await vscode.workspace.openTextDocument(vscode.Uri.file(libPath));
		assert.include(main.getText(), `<xsl:variable name="p" as="cx:point" select="{ 'east': 1, 'y': 2 }"/>`);
		assert.include(main.getText(), `select="$p?east"`);
		assert.include(lib.getText(), `as="record(east as xs:double, y as xs:double)"`);
		assert.include(lib.getText(), '@field east the horizontal position');
		assert.include(lib.getText(), `{ 'east': 0, 'y': 0 }`);
		// the edited modules would otherwise be left unsaved, and closing their editors in a later test would prompt
		await main.save();
		await lib.save();
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
