/**
 * Test suite for the index of xsl:import and xsl:include references between the workspace's XSLT modules: for a module
 * opened on its own, the top-level stylesheet that imports or includes it, directly or indirectly, is found from the
 * index - so that references to declarations in modules it imports resolve without it being opened first.
 *
 * The test host has no workspace folder, so the index is built from the files written to a temporary folder.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { ImportIndex } from '../../src/importIndex';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { ImportTreeProvider, ImportNode } from '../../src/importTreeProvider';

const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'import-index-')));
const namespaces = `xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:ex="ex" version="3.0"`;
const files: { [name: string]: string } = {
	'master.xsl': `<xsl:stylesheet ${namespaces}>\n  <xsl:import href="lib/a.xsl"/>\n  <xsl:import href="util.xsl"/>\n</xsl:stylesheet>`,
	'util.xsl': `<xsl:stylesheet ${namespaces}>\n  <xsl:function name="ex:util"><xsl:param name="p"/><xsl:sequence select="$p"/></xsl:function>\n</xsl:stylesheet>`,
	'lib/a.xsl': `<xsl:stylesheet ${namespaces}>\n  <xsl:include href="b.xsl"/>\n</xsl:stylesheet>`,
	'lib/b.xsl': `<xsl:stylesheet ${namespaces}>\n  <xsl:template match="/"><xsl:sequence select="ex:util(1)"/></xsl:template>\n</xsl:stylesheet>`
};
const file = (name: string) => path.join(folder, name);

suite('Import index', () => {
	suiteSetup(async () => {
		fs.mkdirSync(file('lib'));
		Object.entries(files).forEach(([name, content]) => fs.writeFileSync(file(name), content));
		await ImportIndex.instance.buildFrom(Object.keys(files).map(file));
	});
	suiteTeardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	test('the import tree: the inferred top-level stylesheet, with the path to the current module expanded', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('lib/b.xsl')));
		const provider = new ImportTreeProvider(() => document);
		const describe = (node: ImportNode) => {
			const item = provider.getTreeItem(node);
			return [item.label, item.description, vscode.TreeItemCollapsibleState[item.collapsibleState!], (item.iconPath as vscode.ThemeIcon).id];
		};
		const [root] = provider.getChildren();
		assert.deepEqual(describe(root), ['master.xsl', 'inferred top-level stylesheet', 'Expanded', 'root-folder']);
		const children = provider.getChildren(root);
		assert.deepEqual(children.map(describe), [['a.xsl', 'lib', 'Expanded', 'file-code'], ['util.xsl', '', 'None', 'file-code']]);
		assert.deepEqual(provider.getChildren(children[0]).map(describe), [['b.xsl', 'lib · current', 'None', 'arrow-right']]);
		assert.include(provider.getTreeItem(provider.getChildren(children[0])[0]).tooltip as string, 'xsl:include');
	});

	test('the import tree for a top-level stylesheet', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('master.xsl')));
		const provider = new ImportTreeProvider(() => document);
		const [root] = provider.getChildren();
		const item = provider.getTreeItem(root);
		assert.deepEqual([item.label, item.description, (item.iconPath as vscode.ThemeIcon).id], ['master.xsl', 'current', 'arrow-right']);
	});

	test('no tree without an XSLT module', () => {
		assert.deepEqual(new ImportTreeProvider(() => undefined).getChildren(), []);
	});

	suite('references in a module', () => {
		const references = (text: string) => ImportIndex.moduleReferences(text, '/a/b/main.xsl').map((r) => [r.path, r.isInclude]);

		test('imports and includes, resolved against the folder of the module', () => {
			assert.deepEqual(references(`<xsl:import href="x.xsl"/><xsl:include href='../y.xsl'/>`), [['/a/b/x.xsl', false], ['/a/y.xsl', true]]);
		});

		test('a file URI', () => {
			assert.deepEqual(references(`<xsl:import href="file:///c/z.xsl"/>`), [['/c/z.xsl', false]]);
		});

		test('not in comments, shadow attributes, attribute value templates or other URI schemes', () => {
			assert.deepEqual(references(`<!-- <xsl:import href="c.xsl"/> --><xsl:import _href="{$d}/s.xsl"/><xsl:include href="http://e.com/h.xsl"/>`), []);
		});
	});

	suite('the import chain', () => {
		const index = new ImportIndex();
		index.setReferences('/p/master.xsl', [{ path: '/p/lib/a.xsl', isInclude: false }]);
		index.setReferences('/p/lib/a.xsl', [{ path: '/p/lib/b.xsl', isInclude: true }]);
		index.setReferences('/p/other/far.xsl', [{ path: '/p/lib/b.xsl', isInclude: false }]);
		index.setReferences('/p/cycle1.xsl', [{ path: '/p/cycle2.xsl', isInclude: false }]);
		index.setReferences('/p/cycle2.xsl', [{ path: '/p/cycle1.xsl', isInclude: false }]);

		test('up to the top-level stylesheet, through the importer in the nearest folder', () => {
			assert.deepEqual(index.importChain('/p/lib/b.xsl'), ['/p/master.xsl', '/p/lib/a.xsl', '/p/lib/b.xsl']);
		});

		test('just the module, for a top-level stylesheet', () => {
			assert.deepEqual(index.importChain('/p/master.xsl'), ['/p/master.xsl']);
		});

		test('a cycle stops the chain', () => {
			assert.deepEqual(index.importChain('/p/cycle1.xsl'), ['/p/cycle2.xsl', '/p/cycle1.xsl']);
		});

		test('updating the references of a module', () => {
			index.setReferences('/p/lib/a.xsl', []);
			assert.deepEqual(index.importersOf('/p/lib/b.xsl'), ['/p/other/far.xsl']);
		});
	});

	test('a module opened on its own resolves a declaration in a module its top-level stylesheet imports', async function () {
		// showing the documents in editors takes a while
		this.timeout(20000);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('lib/b.xsl')));
		const collection = vscode.languages.createDiagnosticCollection('import-index-test');
		// the diagnostics are set for the active editor's document
		const problems = async (doc: vscode.TextDocument) => {
			await vscode.window.showTextDocument(doc);
			await new XsltSymbolProvider(XSLTConfiguration.configuration, collection).getDocumentSymbols(doc, false);
			return (collection.get(doc.uri) ?? []).map((d) => d.message);
		};
		assert.equal(ImportIndex.instance.masterFor(file('lib/b.xsl')), file('master.xsl'));
		assert.deepEqual(await problems(document), []);
		// the same module, but not imported by any indexed module
		fs.writeFileSync(file('lib/alone.xsl'), files['lib/b.xsl']);
		const alone = await vscode.workspace.openTextDocument(vscode.Uri.file(file('lib/alone.xsl')));
		assert.deepEqual(await problems(alone), ["XPath: Function: 'ex:util' with 1 arguments not found"]);
		collection.dispose();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
});
