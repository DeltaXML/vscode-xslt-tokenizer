/**
 * Test suite for the XSLT.resources.catalog setting: an OASIS XML catalog used to resolve the hrefs of xsl:import and
 * xsl:include - e.g. an http: href mapped to a local file - and passed to Saxon, with the -catalog option, by XSLT tasks
 * that don't set their own catalogFilenames. The catalog's own resolution is tested in test/unit/xmlCatalog.spec.ts.
 *
 * The test host has no workspace folder, so the setting is an absolute path.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { CatalogSetting } from '../../src/catalogSetting';
import { HrefPaths } from '../../src/hrefPaths';
import { XmlCatalog } from '../../src/xmlCatalog';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSLTConfiguration, XSLTLightConfiguration } from '../../src/languageConfigurations';
import { DocumentLinkProvider } from '../../src/documentLinkProvider';
import { CatalogDocumentProvider } from '../../src/catalogDocumentProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { SaxonTaskProvider } from '../../src/saxonTaskProvider';
import { SaxonCTaskProvider } from '../../src/saxonCTaskProvider';

const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xml-catalog-')));
const catalogPath = path.join(folder, 'catalog.xml');
const namespaces = `xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"`;
const settings = () => vscode.workspace.getConfiguration(CatalogSetting.section);

// the extension's catalog, once the setting's change is handled
async function catalogChanged(expected: string | undefined) {
	for (let i = 0; i < 50 && HrefPaths.catalog?.catalogPath !== expected; i++) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.strictEqual(HrefPaths.catalog?.catalogPath, expected);
}

suite('XML catalog setting: the catalog\'s path', () => {
	const cases: [value: string | undefined, workspaceFolder: string | undefined, expected: string | undefined][] = [
		[undefined, '/ws', undefined],
		['  ', '/ws', undefined],
		['catalog.xml', '/ws', path.resolve('/ws/catalog.xml')],
		['../shared/catalog.xml', '/ws', path.resolve('/shared/catalog.xml')],
		['${workspaceFolder}/xml/catalog.xml', '/ws', path.resolve('/ws/xml/catalog.xml')],
		[path.resolve('/abs/catalog.xml'), '/ws', path.resolve('/abs/catalog.xml')],
		[path.resolve('/abs/catalog.xml'), undefined, path.resolve('/abs/catalog.xml')],
		// no workspace folder to resolve it against
		['catalog.xml', undefined, undefined],
		['${workspaceFolder}/catalog.xml', undefined, undefined],
	];
	cases.forEach(([value, workspaceFolder, expected]) => {
		test(`${JSON.stringify(value)} in ${workspaceFolder} → ${expected}`, () => {
			assert.strictEqual(CatalogSetting.catalogPath(value, workspaceFolder), expected);
		});
	});

	test('a task\'s -catalog option: only when the task has no catalogFilenames', () => {
		assert.strictEqual(CatalogSetting.taskOption({}, '/ws/catalog.xml'), '-catalog:/ws/catalog.xml');
		assert.strictEqual(CatalogSetting.taskOption({ catalogFilenames: 'own.xml' }, '/ws/catalog.xml'), undefined);
		assert.strictEqual(CatalogSetting.taskOption({}, undefined), undefined);
	});
});

suite('XML catalog setting: offering the workspace folder\'s catalog.xml', () => {
	const catalogFile = path.join('/ws', 'catalog.xml');
	const files: { [file: string]: string } = { [catalogFile]: `<catalog xmlns="${XmlCatalog.namespace}"/>` };
	const read = (file: string) => files[file];

	test('offered when there\'s no setting, and it\'s an XML catalog', () => {
		assert.strictEqual(CatalogSetting.catalogToOffer('/ws', false, false, read), catalogFile);
	});

	test('not offered when there\'s a setting, \'Don\'t Ask Again\' was chosen, or there\'s no workspace folder', () => {
		assert.strictEqual(CatalogSetting.catalogToOffer('/ws', true, false, read), undefined);
		assert.strictEqual(CatalogSetting.catalogToOffer('/ws', false, true, read), undefined);
		assert.strictEqual(CatalogSetting.catalogToOffer(undefined, false, false, read), undefined);
	});

	test('not offered when there\'s no catalog.xml, it\'s another kind of file, or it can\'t be read', () => {
		assert.strictEqual(CatalogSetting.catalogToOffer('/other', false, false, read), undefined);
		assert.strictEqual(CatalogSetting.catalogToOffer('/ws', false, false, () => '<catalog><product/></catalog>'), undefined);
		assert.strictEqual(CatalogSetting.catalogToOffer('/ws', false, false, () => {
			throw new Error('unreadable');
		}), undefined);
	});
});

suite('XML catalog setting: imports and tasks', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		fs.mkdirSync(path.join(folder, 'local'));
		fs.writeFileSync(catalogPath, `<catalog xmlns="${XmlCatalog.namespace}"><uri name="http://example.com/lib.xsl" uri="local/lib.xsl"/></catalog>`);
		fs.writeFileSync(path.join(folder, 'local', 'lib.xsl'), `<xsl:stylesheet ${namespaces}>\n  <xsl:variable name="fromCatalog" select="1"/>\n</xsl:stylesheet>`);
	});
	suiteTeardown(async () => {
		await settings().update(CatalogSetting.setting, undefined, vscode.ConfigurationTarget.Global);
		fs.rmSync(folder, { recursive: true, force: true });
	});

	let count = 0;
	// the problems in a module importing the href, by default http://example.com/lib.xsl, with the diagnostics set for
	// the active editor's document - a new file each time, as VS Code keeps a document's text once it's opened
	async function diagnostics(href = 'http://example.com/lib.xsl') {
		const file = path.join(folder, `main${++count}.xsl`);
		fs.writeFileSync(file, `<xsl:stylesheet ${namespaces}>
  <xsl:import href="${href}"/>
  <xsl:template name="xsl:initial-template">
    <xsl:sequence select="$fromCatalog"/>
  </xsl:template>
</xsl:stylesheet>`);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const collection = vscode.languages.createDiagnosticCollection('xml-catalog-test');
		await vscode.window.showTextDocument(document);
		await new XsltSymbolProvider(XSLTConfiguration.configuration, collection).getDocumentSymbols(document, false);
		const found = [...(collection.get(document.uri) ?? [])];
		collection.dispose();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		return found;
	}
	const problems = async (href?: string) => (await diagnostics(href)).map((d) => d.message);
	const unresolvedVariable = 'XPath: The variable/parameter: $fromCatalog cannot be resolved here, but it may be defined in an external module.';

	test('with no catalog, an http: import isn\'t resolved - a warning, suggesting a catalog', async function () {
		this.timeout(20000);
		await settings().update(CatalogSetting.setting, undefined, vscode.ConfigurationTarget.Global);
		await catalogChanged(undefined);
		const found = await diagnostics();
		assert.deepEqual(found.map((d) => [d.message, d.severity]), [
			['Included/imported URI \'http://example.com/lib.xsl\' isn\'t a file - its declarations aren\'t known, and Saxon will fetch it, if it can - an XML catalog can map it to a local file (the XSLT.resources.catalog setting)', vscode.DiagnosticSeverity.Warning],
			[unresolvedVariable, vscode.DiagnosticSeverity.Warning],
		]);
	});

	test('with the catalog, an http: URI not in it is a warning, and a urn: URI an error - naming the catalog, with a link to it', async function () {
		this.timeout(20000);
		await settings().update(CatalogSetting.setting, catalogPath, vscode.ConfigurationTarget.Global);
		await catalogChanged(catalogPath);
		const http = (await diagnostics('http://example.com/missing.xsl'))[0];
		assert.strictEqual(http.message, 'Included/imported URI \'http://example.com/missing.xsl\' isn\'t resolved to a file by the XML catalog catalog.xml - its declarations aren\'t known, and Saxon will fetch it, if it can');
		assert.strictEqual(http.severity, vscode.DiagnosticSeverity.Warning);
		assert.strictEqual(http.relatedInformation?.[0].location.uri.fsPath, catalogPath);
		const urn = (await diagnostics('urn:example:missing'))[0];
		assert.strictEqual(urn.message, 'Included/imported URI \'urn:example:missing\' isn\'t resolved to a file by the XML catalog catalog.xml');
		assert.strictEqual(urn.severity, vscode.DiagnosticSeverity.Error);
	});

	test('with the catalog, the document link of a URI not in it opens the catalog', async () => {
		await settings().update(CatalogSetting.setting, catalogPath, vscode.ConfigurationTarget.Global);
		await catalogChanged(catalogPath);
		const document = await vscode.workspace.openTextDocument({ language: 'xslt', content: `<xsl:stylesheet ${namespaces}>\n  <xsl:import href="http://example.com/missing.xsl"/>\n  <xsl:import href="http://example.com/lib.xsl"/>\n</xsl:stylesheet>` });
		const links = new DocumentLinkProvider(XSLTLightConfiguration.configuration).provideDocumentLinks(document, new vscode.CancellationTokenSource().token);
		assert.deepEqual(links.map((link) => [link.target?.fsPath, link.tooltip]), [
			[catalogPath, 'Not resolved to a file by the XML catalog catalog.xml - open the catalog'],
			[path.join(folder, 'local', 'lib.xsl'), undefined],
		]);
	});

	test('with the catalog setting, an http: import is resolved to the local file', async function () {
		this.timeout(20000);
		await settings().update(CatalogSetting.setting, catalogPath, vscode.ConfigurationTarget.Global);
		await catalogChanged(catalogPath);
		assert.deepEqual(await problems(), []);
	});

	test('the catalog is passed to Saxon by the xslt and xslt-c tasks with no catalogFilenames of their own', async () => {
		await settings().update(CatalogSetting.setting, catalogPath, vscode.ConfigurationTarget.Global);
		await catalogChanged(catalogPath);
		const javaArgs = (definition: object) => (new SaxonTaskProvider('').getTask({ type: 'xslt', label: 'catalog test', saxonJar: '/saxon/saxon.jar', xsltFile: 'main.xsl', xmlSource: '', ...definition })!.execution as vscode.ProcessExecution).args;
		assert.include(javaArgs({}), `-catalog:${catalogPath}`);
		const ownArgs = javaArgs({ catalogFilenames: 'own.xml' });
		assert.include(ownArgs, '-catalog:own.xml');
		assert.notInclude(ownArgs, `-catalog:${catalogPath}`);

		const cTask = new SaxonCTaskProvider('').getTask({ type: 'xslt-c', label: 'catalog test', saxonCPath: '/saxonc/bin', xsltFile: 'main.xsl', xmlSource: '', unescapeMessages: false });
		assert.include((cTask!.execution as vscode.ProcessExecution).args, `-catalog:${catalogPath}`);
	});
});

suite('XML catalog files: document links and missing files', () => {
	const catalogFolder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xml-catalog-files-')));
	const file = (name: string) => path.join(catalogFolder, name);
	suiteSetup(async () => {
		// the extension's catalog, from the setting, isn't set while these tests set their own
		await settings().update(CatalogSetting.setting, undefined, vscode.ConfigurationTarget.Global);
		await catalogChanged(undefined);
		fs.mkdirSync(file('lib'));
		fs.mkdirSync(file('catalogs'));
		fs.writeFileSync(file('lib/a.xsl'), `<xsl:stylesheet ${namespaces}/>`);
		fs.writeFileSync(file('catalogs/libraries.xml'), `<catalog xmlns="${XmlCatalog.namespace}">\n  <uri name="http://example.com/a.xsl" uri="../lib/a.xsl"/>\n</catalog>`);
		fs.writeFileSync(file('catalog.xml'), `<catalog xmlns="${XmlCatalog.namespace}">
  <uri name="http://example.com/a.xsl" uri="lib/a.xsl"/>
  <uri name="http://example.com/moved.xsl" uri="lib/moved.xsl"/>
  <rewriteURI uriStartString="http://example.com/lib/" rewritePrefix="lib/"/>
  <rewriteURI uriStartString="http://example.com/old/" rewritePrefix="old/"/>
  <uri name="http://example.com/remote.xsl" uri="http://mirror.example.com/remote.xsl"/>
  <nextCatalog catalog="catalogs/libraries.xml"/>
  <nextCatalog catalog="catalogs/missing.xml"/>
</catalog>`);
		fs.writeFileSync(file('products.xml'), '<catalog><product uri="lib/none.xsl"/></catalog>');
	});
	suiteTeardown(() => fs.rmSync(catalogFolder, { recursive: true, force: true }));

	test('the uri and nextCatalog entries are links - with their values, in quotes, as the ranges', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('catalog.xml')));
		const links = new CatalogDocumentProvider().provideDocumentLinks(document);
		assert.deepEqual(links.map((link) => [document.getText(link.range), link.target?.fsPath]), [
			['"lib/a.xsl"', file('lib/a.xsl')],
			['"lib/moved.xsl"', file('lib/moved.xsl')],
			['"catalogs/libraries.xml"', file('catalogs/libraries.xml')],
			['"catalogs/missing.xml"', file('catalogs/missing.xml')],
		]);
	});

	test('the files and folders that aren\'t found are warnings', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('catalog.xml')));
		assert.deepEqual(CatalogDocumentProvider.diagnostics(document).map((d) => [document.getText(d.range), d.message, d.severity]), [
			['"lib/moved.xsl"', `XML catalog: the file of this uri isn't found: ${file('lib/moved.xsl')}`, vscode.DiagnosticSeverity.Warning],
			['"old/"', `XML catalog: the folder of this rewritePrefix isn't found: ${file('old/')}`, vscode.DiagnosticSeverity.Warning],
			['"catalogs/missing.xml"', `XML catalog: the catalog file of this catalog isn't found: ${file('catalogs/missing.xml')}`, vscode.DiagnosticSeverity.Warning],
		]);
	});

	test('a secondary catalog\'s paths are relative to it', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('catalogs/libraries.xml')));
		assert.deepEqual(new CatalogDocumentProvider().provideDocumentLinks(document).map((link) => link.target?.fsPath), [file('lib/a.xsl')]);
		assert.deepEqual(CatalogDocumentProvider.diagnostics(document), []);
	});

	test('an XML file that isn\'t a catalog has no links or warnings', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('products.xml')));
		assert.deepEqual(new CatalogDocumentProvider().provideDocumentLinks(document), []);
		assert.deepEqual(CatalogDocumentProvider.diagnostics(document), []);
	});

	test('the hover of an href resolved by the catalog: the entry, and the catalogs it was found through', () => {
		HrefPaths.catalog = new XmlCatalog(file('catalog.xml'));
		try {
			const link = (name: string) => `[${vscode.workspace.asRelativePath(file(name))}](${vscode.Uri.file(file(name)).toString()})`;
			assert.strictEqual(XSLTHoverProvider.catalogResolutionMarkdown('http://example.com/a.xsl', file('main.xsl')),
				`Resolved by the XML catalog: the \`uri\` entry for \`http://example.com/a.xsl\` in ${link('catalog.xml')}`);
			assert.strictEqual(XSLTHoverProvider.catalogResolutionMarkdown('http://example.com/lib/b.xsl', file('main.xsl')),
				`Resolved by the XML catalog: the \`rewriteURI\` entry for \`http://example.com/lib/\` in ${link('catalog.xml')}`);
			HrefPaths.catalog = new XmlCatalog(file('catalogs/libraries.xml'));
			assert.strictEqual(XSLTHoverProvider.catalogResolutionMarkdown('lib/a.xsl', file('main.xsl')), undefined);
		} finally {
			HrefPaths.catalog = undefined;
		}
	});

	test('the hover of an href resolved through a nextCatalog entry', () => {
		fs.writeFileSync(file('master.xml'), `<catalog xmlns="${XmlCatalog.namespace}"><nextCatalog catalog="catalogs/libraries.xml"/></catalog>`);
		HrefPaths.catalog = new XmlCatalog(file('master.xml'));
		try {
			const link = (name: string) => `[${vscode.workspace.asRelativePath(file(name))}](${vscode.Uri.file(file(name)).toString()})`;
			assert.strictEqual(XSLTHoverProvider.catalogResolutionMarkdown('http://example.com/a.xsl', file('main.xsl')),
				`Resolved by the XML catalog: the \`uri\` entry for \`http://example.com/a.xsl\` in ${link('catalogs/libraries.xml')}, via ${link('master.xml')}`);
		} finally {
			HrefPaths.catalog = undefined;
		}
	});
});
