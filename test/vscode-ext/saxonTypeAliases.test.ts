/**
 * Test suite for the conversion of Saxon's earlier syntax for named types - saxon:type-alias, tuple types and ~ for a
 * reference to a type alias, from Saxon 9.9 to 11, and ignored by Saxon 12.8 and 13 - to XSLT 4.0's xsl:item-type,
 * record types and plain names, which Saxon 12.8 and 13 accept with syntax extensions: the conversion of a type, of a
 * module, and the command for the workspace's modules - and the linter's warning for saxon:type-alias, with its fix.
 * A tuple type that's extensible, e.g. tuple(a: xs:string, *), isn't converted, as XSLT 4.0 has no extensible record
 * types - nor is a type alias that references one.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { SaxonTypeAliases } from '../../src/saxonTypeAliases';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const aliases = new Set(['dfx:rectangle', 'dfx:dimension', 'dfx:origin', 'dfx:region']);
const converted = (type: string) => SaxonTypeAliases.convertType(type, aliases);

const stylesheet = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:dfx="dfx" xmlns:saxon="http://saxon.sf.net/" exclude-result-prefixes="#all" version="3.0">
${body}
</xsl:stylesheet>`;

const moduleText = stylesheet(`    <saxon:type-alias name="dfx:rectangle" type="tuple(x: xs:integer, y: xs:integer, width: xs:integer, height: xs:integer)"/>
    <saxon:type-alias name="dfx:rectangle-ver" type="tuple(rect: ~dfx:rectangle, versions: xs:string+)"/>
    <saxon:type-alias name="dfx:dimension" type="tuple(width: xs:integer, height: xs:integer)"/>
    <saxon:type-alias name="dfx:builder" type="tuple(first-seen-column: xs:integer, size: ~dfx:dimension?, present-in-rows: xs:integer*)"/>
    <saxon:type-alias name="dfx:origin" type="xs:string"/>
    <saxon:type-alias name="dfx:region-map" type="map(~dfx:origin, ~dfx:rectangle-ver)"/>
    <!--<saxon:type-alias name="dfx:old" type="tuple(a: ~dfx:origin)"/>-->
    <saxon:type-alias name="dfx:result-span" type="tuple(numCols: xs:integer, entrytblCols?: xs:integer*)"/>
    <xsl:function name="dfx:width" as="xs:integer">
        <xsl:param name="r" as="~dfx:rectangle"/>
        <xsl:sequence select="$r?width"/>
    </xsl:function>
    <xsl:template name="xsl:initial-template">
        <xsl:variable name="r" as="~dfx:rectangle" select="map { 'x': 1, 'y': 2, 'width': 3, 'height': 4 }"/>
        <xsl:variable name="inline" as="tuple(n: xs:integer)" select="map { 'n': 5 }"/>
        <xsl:sequence select="dfx:width($r), $inline?n, $r instance of ~dfx:rectangle"/>
    </xsl:template>`);

// the module as Saxon 12.8 and 13 both run it
const expected = stylesheet(`    <xsl:item-type name="dfx:rectangle" as="record(x as xs:integer, y as xs:integer, width as xs:integer, height as xs:integer)"/>
    <xsl:item-type name="dfx:rectangle-ver" as="record(rect as dfx:rectangle, versions as xs:string+)"/>
    <xsl:item-type name="dfx:dimension" as="record(width as xs:integer, height as xs:integer)"/>
    <xsl:item-type name="dfx:builder" as="record(first-seen-column as xs:integer, size as dfx:dimension?, present-in-rows as xs:integer*)"/>
    <xsl:item-type name="dfx:origin" as="xs:string"/>
    <xsl:item-type name="dfx:region-map" as="map(dfx:origin, dfx:rectangle-ver)"/>
    <!--<saxon:type-alias name="dfx:old" type="tuple(a: ~dfx:origin)"/>-->
    <xsl:item-type name="dfx:result-span" as="record(numCols as xs:integer, entrytblCols? as xs:integer*)"/>
    <xsl:function name="dfx:width" as="xs:integer">
        <xsl:param name="r" as="dfx:rectangle"/>
        <xsl:sequence select="$r?width"/>
    </xsl:function>
    <xsl:template name="xsl:initial-template">
        <xsl:variable name="r" as="dfx:rectangle" select="map { 'x': 1, 'y': 2, 'width': 3, 'height': 4 }"/>
        <xsl:variable name="inline" as="record(n as xs:integer)" select="map { 'n': 5 }"/>
        <xsl:sequence select="dfx:width($r), $inline?n, $r instance of dfx:rectangle"/>
    </xsl:template>`);

const convertModule = (text: string) => SaxonTypeAliases.apply(text, SaxonTypeAliases.convertModule(text, SaxonTypeAliases.convertibleAliases(SaxonTypeAliases.declarations(text))));

suite('Saxon type aliases', () => {
	const typeCases: [string, string, string][] = [
		['a tuple type', 'tuple(x: xs:integer, y: xs:integer)', 'record(x as xs:integer, y as xs:integer)'],
		['an optional field', 'tuple(a: xs:string, b?: xs:integer*)', 'record(a as xs:string, b? as xs:integer*)'],
		['a field without a type', 'tuple(a, b?)', 'record(a, b?)'],
		['a reference to a type alias', 'tuple(rect: ~dfx:rectangle, size: ~dfx:dimension?)', 'record(rect as dfx:rectangle, size as dfx:dimension?)'],
		['a nested tuple type', 'tuple(a: tuple(b: xs:string)+, c: map(xs:string, tuple(d: node()*)))', 'record(a as record(b as xs:string)+, c as map(xs:string, record(d as node()*)))'],
		['a map of type aliases', 'map(~dfx:origin, ~dfx:region)', 'map(dfx:origin, dfx:region)'],
		['a type with no tuple type or reference', 'xs:string', 'xs:string'],
		['a quoted field name', `tuple('first name': xs:string)`, `record('first name' as xs:string)`],
	];
	typeCases.forEach(([label, type, result]) => {
		test(`type: ${label}`, () => {
			assert.deepEqual(converted(type), { text: result, isConvertible: true });
		});
	});

	test('type: an extensible tuple type is not convertible', () => {
		assert.isFalse(converted('tuple(a: xs:string, *)').isConvertible);
	});

	test('type: a reference to a name that is not a type alias is left', () => {
		assert.equal(converted('tuple(a: ~dfx:unknown)').text, 'record(a as ~dfx:unknown)');
	});

	test('the type aliases that can be converted: not one that references one with an extensible tuple type', () => {
		const text = stylesheet(`  <saxon:type-alias name="dfx:open" type="tuple(a: xs:string, *)"/>
  <saxon:type-alias name="dfx:uses-open" type="tuple(o: ~dfx:open)"/>
  <saxon:type-alias name="dfx:uses-that" type="map(xs:string, ~dfx:uses-open)"/>
  <saxon:type-alias name="dfx:fine" type="tuple(a: xs:string)"/>`);
		assert.deepEqual([...SaxonTypeAliases.convertibleAliases(SaxonTypeAliases.declarations(text))], ['dfx:fine']);
	});

	test('module: the declarations, their references and tuple types in XSLT attributes - not in comments', () => {
		assert.equal(convertModule(moduleText), expected);
	});

	test('module: an unconverted type alias and its references are left as they are', () => {
		const text = stylesheet(`  <saxon:type-alias name="dfx:open" type="tuple(a: xs:string, *)"/>
  <xsl:variable name="o" as="~dfx:open" select="map { 'a': 'x' }"/>`);
		assert.equal(convertModule(text), text);
	});

	test('module: another prefix for the Saxon namespace', () => {
		const text = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:sx="http://saxon.sf.net/" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="3.0">
  <sx:type-alias name="point" type="tuple(x: xs:integer)"/>
  <xsl:variable name="p" as="~point" select="map { 'x': 1 }"/>
</xsl:stylesheet>`;
		assert.include(convertModule(text), '<xsl:item-type name="point" as="record(x as xs:integer)"/>');
		assert.include(convertModule(text), '<xsl:variable name="p" as="point"');
	});

	test('workspace: the declarations in one module, and their references in another', async () => {
		const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'saxon-aliases-')));
		try {
			const types = stylesheet(`  <saxon:type-alias name="dfx:rectangle" type="tuple(x: xs:integer, y: xs:integer)"/>
  <saxon:type-alias name="dfx:open" type="tuple(a: xs:string, *)"/>`);
			const uses = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:dfx="dfx" version="3.0">
  <xsl:import href="types.xsl"/>
  <xsl:variable name="r" as="~dfx:rectangle" select="map { 'x': 1, 'y': 2 }"/>
  <xsl:variable name="o" as="~dfx:open" select="map { 'a': 'x' }"/>
</xsl:stylesheet>`;
			fs.writeFileSync(path.join(dir, 'types.xsl'), types);
			fs.writeFileSync(path.join(dir, 'uses.xsl'), uses);
			const result = await SaxonTypeAliases.convertWorkspace([path.join(dir, 'types.xsl'), path.join(dir, 'uses.xsl')], false);
			assert.deepEqual(result.converted, ['dfx:rectangle']);
			assert.deepEqual(result.unconverted, ['dfx:open']);
			const typesDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'types.xsl')));
			const usesDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'uses.xsl')));
			assert.include(typesDocument.getText(), '<xsl:item-type name="dfx:rectangle" as="record(x as xs:integer, y as xs:integer)"/>');
			assert.include(typesDocument.getText(), '<saxon:type-alias name="dfx:open" type="tuple(a: xs:string, *)"/>');
			assert.include(usesDocument.getText(), '<xsl:variable name="r" as="dfx:rectangle"');
			assert.include(usesDocument.getText(), '<xsl:variable name="o" as="~dfx:open"');
			// the edited modules would otherwise be left unsaved
			await typesDocument.save();
			await usesDocument.save();
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('linter: a warning for saxon:type-alias, with a fix that runs the command', async () => {
		const text = stylesheet(`  <saxon:type-alias name="dfx:origin" type="xs:string"/>\n  <!--<saxon:type-alias name="dfx:old" type="xs:string"/>-->`);
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
		const xslLexer = new XslLexer(XSLTConfiguration.configuration);
		xslLexer.provideCharLevelState = true;
		const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: false }, DocumentTypes.XSLT, document, xslLexer.analyse(text), xslLexer.globalInstructionData, [], []);
		const warnings = diagnostics.filter((d) => d.message.includes('type-alias'));
		assert.deepEqual(warnings.map((d) => [d.message, document.getText(d.range)]), [
			[`XSLT: saxon:type-alias is ignored by Saxon 12.8 and later - use xsl:item-type: one quick fix converts the type aliases in all the workspace's files`, 'saxon:type-alias']
		]);
		const actions = new XSLTCodeActions().provideCodeActions(document, warnings[0].range, { diagnostics: warnings, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const fix = actions.find((a) => a.title === 'Convert all Saxon type aliases in the workspace to xsl:item-type...');
		assert.equal(fix?.command?.command, 'xslt-xpath.convertSaxonTypeAliases');
	});

	test('the command is contributed', () => {
		const contributes = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')).contributes;
		assert.isDefined(contributes.commands.find((c: { command: string }) => c.command === 'xslt-xpath.convertSaxonTypeAliases'));
	});
});
