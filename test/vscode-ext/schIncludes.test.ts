/**
 * Test suite for Schematron's files in the Imports view - 'Schematron Includes': for a Schematron file, the schema that
 * includes it, found from an index of the workspace's .sch files, with the files the schema brings in. And the SchXslt2
 * checks of a file sch:include brings in, whose root is e.g. a pattern.
 *
 * The test host has no workspace folder, so the index is built from the files written to a temporary folder.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { SchIncludes } from '../../src/schIncludes';
import { ImportTreeProvider, ImportNode } from '../../src/importTreeProvider';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { SchConfiguration } from '../../src/languageConfigurations';
import { LanguageConfiguration } from '../../src/xslLexer';
import { SchXslt2Checks } from '../../src/schXslt2Checks';

const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sch-includes-')));
const iso = 'xmlns="http://purl.oclc.org/dsdl/schematron"';
const xsl = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform"';
const files: { [name: string]: string } = {
	'main.sch': `<schema ${iso} ${xsl} queryBinding="xslt3">
  <xsl:include href="lib/functions.xsl"/>
  <include href="patterns/orders.sch"/>
  <pattern id="p"><rule context="a"><extends href="rules/abstract.sch"/></rule></pattern>
</schema>`,
	'patterns/orders.sch': `<pattern ${iso} id="orders"><rule context="order"><assert test="@id">x</assert></rule></pattern>`,
	'rules/abstract.sch': `<rule ${iso} abstract="true" id="r"><assert test="@b">y</assert></rule>`,
	'lib/functions.xsl': `<xsl:stylesheet ${xsl} version="3.0"><xsl:import href="more.xsl"/></xsl:stylesheet>`,
	'lib/more.xsl': `<xsl:stylesheet ${xsl} version="3.0"/>`,
	'cycle-a.sch': `<schema ${iso}><include href="cycle-b.sch"/></schema>`,
	'cycle-b.sch': `<pattern ${iso}><include href="cycle-a.sch"/></pattern>`
};
const file = (name: string) => path.join(folder, name);

suite('Schematron includes', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		['patterns', 'rules', 'lib'].forEach((sub) => fs.mkdirSync(file(sub)));
		Object.entries(files).forEach(([name, content]) => fs.writeFileSync(file(name), content));
		SchIncludes.instance.buildFrom(Object.keys(files).filter((name) => name.endsWith('.sch')).map(file));
	});
	suiteTeardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	test('the files a schema refers to: sch:include, sch:extends href, and xsl:include and xsl:import at the top level', () => {
		const references = SchIncludes.referencesIn(files['main.sch'], file('main.sch'));
		assert.deepEqual(references.map((r) => [r.kind, path.relative(folder, r.path)]), [
			['xsl:include', path.join('lib', 'functions.xsl')],
			['sch:include', path.join('patterns', 'orders.sch')],
			['sch:extends', path.join('rules', 'abstract.sch')]
		]);
		// not an xsl:include within an XSLT element, which SchXslt2 doesn't copy
		assert.deepEqual(SchIncludes.referencesIn(`<schema ${iso} ${xsl}><xsl:function name="f"><xsl:include href="x.xsl"/></xsl:function></schema>`, file('x.sch')), []);
	});

	test('the schemas that include a file - and the chain from the schema, with no endless cycle', () => {
		assert.deepEqual(SchIncludes.instance.includersOf(file('patterns/orders.sch')), [file('main.sch')]);
		assert.deepEqual(SchIncludes.instance.chain(file('rules/abstract.sch')), [file('main.sch'), file('rules/abstract.sch')]);
		assert.deepEqual(SchIncludes.instance.chain(file('main.sch')), [file('main.sch')]);
		assert.deepEqual(SchIncludes.instance.chain(file('cycle-b.sch')), [file('cycle-a.sch'), file('cycle-b.sch')]);
	});

	test('the view, for an included file: the schema that includes it, with the path to the file expanded - and the XSLT modules\' own imports', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('patterns/orders.sch')));
		assert.strictEqual(document.languageId, 'sch');
		const provider = new ImportTreeProvider(() => document);
		const describe = (node: ImportNode) => {
			const item = provider.getTreeItem(node);
			return [item.label, item.description, vscode.TreeItemCollapsibleState[item.collapsibleState!], (item.iconPath as vscode.ThemeIcon).id, item.contextValue];
		};
		const [root] = provider.getChildren();
		assert.deepEqual(describe(root), ['main.sch', 'includes it', 'Expanded', 'root-folder', 'schema']);
		assert.include(provider.getTreeItem(root).tooltip as string, 'Schematron schema');
		const children = provider.getChildren(root);
		assert.deepEqual(children.map(describe), [
			['functions.xsl', 'lib', 'Collapsed', 'file-symlink-file', 'schemaModule'],
			['orders.sch', 'patterns · current', 'None', 'arrow-right', 'schemaModule'],
			['abstract.sch', 'rules', 'None', 'file-symlink-file', 'schemaModule']
		]);
		assert.deepEqual(children.map((c) => (provider.getTreeItem(c).tooltip as string).split('\n')[1]), ['xsl:include', 'sch:include', 'sch:extends']);
		// an XSLT module's own imports
		assert.deepEqual(provider.getChildren(children[0]).map((c) => provider.getTreeItem(c).label), ['more.xsl']);
	});

	test('the view, for a schema nothing includes: the schema itself', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('main.sch')));
		const provider = new ImportTreeProvider(() => document);
		const [root] = provider.getChildren();
		const item = provider.getTreeItem(root);
		assert.deepEqual([item.label, item.description, (item.iconPath as vscode.ThemeIcon).id], ['main.sch', 'current', 'arrow-right']);
	});

	test('SchXslt2\'s checks for a file sch:include brings in, e.g. a pattern: an ignored XSLT attribute, and Schematron 1.5', async () => {
		const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
		const problems = async (name: string, content: string) => {
			fs.writeFileSync(file(name), content);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(name)));
			return { document, diagnostics: await moduleDiagnostics.call(XsltSymbolProvider, document, false, SchConfiguration.configuration) };
		};
		const pattern = await problems('included-pattern.sch', `<pattern ${iso} ${xsl} id="i" xsl:use-when="true()"><rule context="a"><assert test="b">x</assert></rule></pattern>`);
		assert.deepEqual(pattern.diagnostics.map((d) => d.message), ['SchXslt2: the attribute xsl:use-when is ignored on sch:pattern']);
		const old = await problems('included-old.sch', `<s:pattern xmlns:s="http://www.ascc.net/xml/schematron" name="Old"><s:rule context="a"><s:assert test="b">x</s:assert></s:rule></s:pattern>`);
		assert.deepEqual(old.diagnostics.map((d) => d.message), ['SchXslt2: this isn\'t ISO Schematron, whose namespace is http://purl.oclc.org/dsdl/schematron - SchXslt2 doesn\'t validate with it']);
		// with its quick fix, as for a schema
		assert.deepEqual(SchXslt2Checks.codeActions(old.document, old.diagnostics).map((a) => a.title), ['Convert to ISO Schematron']);
	});
});
