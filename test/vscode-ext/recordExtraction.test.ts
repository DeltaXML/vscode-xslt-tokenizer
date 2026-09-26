/**
 * Test suite for the XSLT 4.0 'Extract record type' refactoring: for a selected map constructor or xsl:map that is the
 * value of a declaration, an xsl:item-type is added with a record type inferred from the keys and literal values, and
 * the declaration's 'as' is set to it - replacing a generic type such as map(*) - or 'Use record type' uses an existing
 * record type with the same field names
 *
 * The selection is marked by '«' and '»'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTCodeActions } from '../../src/xsltCodeActions';

function stylesheet(body: string, version = '4.0') {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" version="${version}">
  <xsl:import href="common.xsl"/>
  ${body}
</xsl:stylesheet>`;
}

// the code actions for the selection, and a function to apply one of them and return the document's text
async function actionsFor(marked: string) {
	const start = marked.indexOf('«');
	const end = marked.indexOf('»') - 1;
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('«', '').replace('»', ''), language: 'xslt' });
	const provider = new XSLTCodeActions();
	const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
	const actions = provider.provideCodeActions(document, range, { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
	const recordActions = actions.filter((a) => a.title === 'Extract record type' || a.title.startsWith('Use record type'));
	const apply = async (title: string) => {
		const action = recordActions.find((a) => a.title === title);
		assert.isDefined(action, `action: ${title}`);
		const resolved = await provider.resolveCodeAction(action!, new vscode.CancellationTokenSource().token);
		assert.isTrue(await vscode.workspace.applyEdit(resolved.edit!));
		return document.getText();
	};
	return { titles: recordActions.map((a) => a.title), apply };
}

const importLine = `  <xsl:import href="common.xsl"/>`;

suite('Extract record type', () => {
	test('a map constructor replacing a generic as', async () => {
		const { apply } = await actionsFor(stylesheet(`<xsl:variable name="p" as="map(*)*" select="«{ 'name': 'Ann', 'age': 42, 'ok': true(), 'address': { 'city': 'Oxford', 'lat': 1.5e0 }, 'x': $v }»"/>`));
		assert.equal(await apply('Extract record type'), stylesheet(`<xsl:variable name="p" as="record-type*" select="{ 'name': 'Ann', 'age': 42, 'ok': true(), 'address': { 'city': 'Oxford', 'lat': 1.5e0 }, 'x': $v }"/>`)
			.replace(importLine, `${importLine}\n  <xsl:item-type name="record-type" as="record(name as xs:string, age as xs:integer, ok as xs:boolean, address as record(city as xs:string, lat as xs:double), x)"/>`));
	});

	test('a map constructor for a declaration without an as', async () => {
		const { apply } = await actionsFor(stylesheet(`<xsl:variable name="q" select="«map { 'r': 1.5, 'first name': 'A' }»"/>`));
		assert.equal(await apply('Extract record type'), stylesheet(`<xsl:variable name="q" as="record-type" select="map { 'r': 1.5, 'first name': 'A' }"/>`)
			.replace(importLine, `${importLine}\n  <xsl:item-type name="record-type" as="record(r as xs:decimal, 'first name' as xs:string)"/>`));
	});

	test('an xsl:map in an xsl:function, within xsl:if', async () => {
		const body = (as: string, map: string) => `<xsl:function name="f:f" as="${as}"><xsl:if test="true()">${map}</xsl:if></xsl:function>`;
		const map = `<xsl:map><xsl:map-entry key="'a'" select="1"/><xsl:map-entry key="'b'"><xsl:map><xsl:map-entry key="'c'" select="'x'"/></xsl:map></xsl:map-entry></xsl:map>`;
		const { apply } = await actionsFor(stylesheet(body('map(*)', `«${map}»`)));
		assert.equal(await apply('Extract record type'), stylesheet(body('record-type', map))
			.replace(importLine, `${importLine}\n  <xsl:item-type name="record-type" as="record(a as xs:integer, b as record(c as xs:string))"/>`));
	});

	test('the content of an xsl:select', async () => {
		const { apply } = await actionsFor(stylesheet(`<xsl:variable name="v"><xsl:select>«{ 'r': 1 }»</xsl:select></xsl:variable>`));
		assert.equal(await apply('Extract record type'), stylesheet(`<xsl:variable name="v" as="record-type"><xsl:select>{ 'r': 1 }</xsl:select></xsl:variable>`)
			.replace(importLine, `${importLine}\n  <xsl:item-type name="record-type" as="record(r as xs:integer)"/>`));
	});

	test('a name that is not used by another xsl:item-type', async () => {
		const existing = `<xsl:item-type name="record-type" as="record(z)"/>`;
		const { apply } = await actionsFor(stylesheet(`${existing}\n  <xsl:param name="p" as="item()" select="«{ 'r': 1 }»"/>`));
		assert.equal(await apply('Extract record type'), stylesheet(`${existing}\n  <xsl:item-type name="record-type-2" as="record(r as xs:integer)"/>\n  <xsl:param name="p" as="record-type-2" select="{ 'r': 1 }"/>`));
	});

	test('use an existing record type with the same field names', async () => {
		const existing = `<xsl:item-type name="point" as="record(y as xs:double, x as xs:double)"/>`;
		const { titles, apply } = await actionsFor(stylesheet(`${existing}\n  <xsl:variable name="p" as="map(*)" select="«{ 'x': 1, 'y': 2 }»"/>`));
		assert.deepEqual(titles, ['Extract record type', 'Use record type \'point\'']);
		assert.equal(await apply('Use record type \'point\''), stylesheet(`${existing}\n  <xsl:variable name="p" as="point" select="{ 'x': 1, 'y': 2 }"/>`));
	});

	test('before the first top-level element when there are no imports', async () => {
		const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">\n  <xsl:variable name="p" select="«{ 'r': 1 }»"/>\n</xsl:stylesheet>`;
		const { apply } = await actionsFor(marked);
		assert.equal(await apply('Extract record type'), `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">\n  <xsl:item-type name="record-type" as="record(r as xs:integer)"/>\n  <xsl:variable name="p" as="record-type" select="{ 'r': 1 }"/>\n</xsl:stylesheet>`);
	});

	const notOffered: [string, string][] = [
		['a declaration with a specific as', stylesheet(`<xsl:variable name="s" as="xs:string" select="«{ 'r': 1 }»"/>`)],
		['part of a map constructor', stylesheet(`<xsl:variable name="p" select="«{ 'r': 1 }, 2»"/>`)],
		['a map constructor that is not the whole select', stylesheet(`<xsl:variable name="p" select="f:f(«{ 'r': 1 }»)"/>`)],
		['a map constructor with a key that is not a string literal', stylesheet(`<xsl:variable name="p" select="«{ $k: 1 }»"/>`)],
		['an xsl:map that is not the whole selection', stylesheet(`<xsl:variable name="p">«<xsl:map><xsl:map-entry key="'a'" select="1"/></xsl:map»></xsl:variable>`)],
		['an xsl:map within another instruction', stylesheet(`<xsl:variable name="p"><xsl:for-each select="1">«<xsl:map><xsl:map-entry key="'a'" select="1"/></xsl:map>»</xsl:for-each></xsl:variable>`)],
		['XSLT 3.0', stylesheet(`<xsl:variable name="p" select="«map { 'r': 1 }»"/>`, '3.0')],
	];
	notOffered.forEach(([label, marked]) => {
		test(`not offered: ${label}`, async () => {
			assert.deepEqual((await actionsFor(marked)).titles, []);
		});
	});
});

suite('Extract record type: at the cursor', () => {
	// the code actions for the cursor, marked by '¦'
	async function actionsAt(marked: string) {
		const offset = marked.indexOf('¦');
		const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
		const provider = new XSLTCodeActions();
		const position = document.positionAt(offset);
		const actions = provider.provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const recordActions = actions.filter((a) => a.title === 'Extract record type' || a.title.startsWith('Use record type'));
		const apply = async (title: string) => {
			const action = recordActions.find((a) => a.title === title);
			assert.isDefined(action, `action: ${title}`);
			const resolved = await provider.resolveCodeAction(action!, new vscode.CancellationTokenSource().token);
			assert.isTrue(await vscode.workspace.applyEdit(resolved.edit!));
			return document.getText();
		};
		return { titles: recordActions.map((a) => a.title), apply };
	}

	const itemType = (recordType: string) => `${importLine}\n  <xsl:item-type name="record-type" as="${recordType}"/>`;

	const cases: [string, string, string, string][] = [
		['on the name of an xsl:variable with a select', `<xsl:variable na¦me="p" select="map { 'r': 1 }"/>`, `<xsl:variable name="p" as="record-type" select="map { 'r': 1 }"/>`, 'record(r as xs:integer)'],
		['on the element name, replacing map(xs:string, item()*)', `<xsl:v¦ariable name="p" as="map(xs:string, item()*)" select="{ 'r': 'a' }"/>`, `<xsl:variable name="p" as="record-type" select="{ 'r': 'a' }"/>`, 'record(r as xs:string)'],
		['on the as value', `<xsl:variable name="p" as="map(*)¦?" select="{ 'r': 'a' }"/>`, `<xsl:variable name="p" as="record-type?" select="{ 'r': 'a' }"/>`, 'record(r as xs:string)'],
		['an xsl:param with an xsl:map', `<xsl:param name="p"¦>\n    <xsl:map><xsl:map-entry key="'a'" select="1"/></xsl:map>\n  </xsl:param>`, `<xsl:param name="p" as="record-type">\n    <xsl:map><xsl:map-entry key="'a'" select="1"/></xsl:map>\n  </xsl:param>`, 'record(a as xs:integer)'],
		['an xsl:variable with an xsl:select', `<xsl:variable ¦name="v"><xsl:select>{ 'r': true() }</xsl:select></xsl:variable>`, `<xsl:variable name="v" as="record-type"><xsl:select>{ 'r': true() }</xsl:select></xsl:variable>`, 'record(r as xs:boolean)'],
		['an xsl:function with an xsl:sequence', `<xsl:function name="f:f" as="item()"¦><xsl:sequence select="{ 'r': 1 }"/></xsl:function>`, `<xsl:function name="f:f" as="record-type"><xsl:sequence select="{ 'r': 1 }"/></xsl:function>`, 'record(r as xs:integer)'],
		['an xsl:sequence, with its own as', `<xsl:template name="t"><xsl:sequ¦ence select="{ 'r': 1 }"/></xsl:template>`, `<xsl:template name="t"><xsl:sequence as="record-type" select="{ 'r': 1 }"/></xsl:template>`, 'record(r as xs:integer)'],
		['an xsl:select, with its own as', `<xsl:template name="t"><xsl:select¦>{ 'r': 1 }</xsl:select></xsl:template>`, `<xsl:template name="t"><xsl:select as="record-type">{ 'r': 1 }</xsl:select></xsl:template>`, 'record(r as xs:integer)'],
	];
	cases.forEach(([label, body, expected, recordType]) => {
		test(label, async () => {
			const { apply } = await actionsAt(stylesheet(body));
			assert.equal(await apply('Extract record type'), stylesheet(expected).replace(importLine, itemType(recordType)));
		});
	});

	test('use an existing record type', async () => {
		const existing = `<xsl:item-type name="point" as="record(x, y)"/>`;
		const { titles, apply } = await actionsAt(stylesheet(`${existing}\n  <xsl:variable name="p¦" select="{ 'x': 1, 'y': 2 }"/>`));
		assert.deepEqual(titles, ['Extract record type', 'Use record type \'point\'']);
		assert.equal(await apply('Use record type \'point\''), stylesheet(`${existing}\n  <xsl:variable name="p" as="point" select="{ 'x': 1, 'y': 2 }"/>`));
	});

	const notOffered: [string, string][] = [
		['in the content, not the start tag', stylesheet(`<xsl:variable name="v">¦<xsl:select>{ 'r': 1 }</xsl:select></xsl:variable>`)],
		['a specific as', stylesheet(`<xsl:variable na¦me="s" as="xs:string" select="{ 'r': 1 }"/>`)],
		['a map type with keys that are not strings', stylesheet(`<xsl:variable na¦me="s" as="map(xs:integer, item())" select="{ 'r': 1 }"/>`)],
		['a select that is not a map constructor', stylesheet(`<xsl:variable na¦me="s" select="{ 'r': 1 }, 2"/>`)],
		['a key that is not a string literal', stylesheet(`<xsl:variable na¦me="s" select="{ $k: 1 }"/>`)],
		['more than one child element', stylesheet(`<xsl:variable na¦me="s"><xsl:map/><xsl:map/></xsl:variable>`)],
		['another element', stylesheet(`<xsl:template na¦me="t"><xsl:sequence select="{ 'r': 1 }"/></xsl:template>`)],
		['XSLT 3.0', stylesheet(`<xsl:variable na¦me="p" select="map { 'r': 1 }"/>`, '3.0')],
	];
	notOffered.forEach(([label, marked]) => {
		test(`not offered: ${label}`, async () => {
			assert.deepEqual((await actionsAt(marked)).titles, []);
		});
	});
});
