/**
 * Test suite for the top-level stylesheet remembered as a module's parent: when it's changed so it no longer imports the module
 * - e.g. a library converted to a package, which the stylesheets that used it now use with xsl:use-package - the module is
 * checked with the stylesheet that imports it now, not the one remembered
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { ImportIndex } from '../../src/importIndex';

suite('A module\'s remembered parent that no longer imports it', function () {
	this.timeout(60000);
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stale-parent-')));
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f"';
	const file = (name: string) => path.join(dir, name);
	const all = ['a', 'b', 'master', 'demo'].map((name) => file(name + '.xsl'));

	suiteSetup(() => {
		fs.writeFileSync(file('a.xsl'), `<xsl:stylesheet ${ns} version="3.0">\n<xsl:function name="f:x"><xsl:param name="p"/><xsl:sequence select="$p"/></xsl:function>\n</xsl:stylesheet>`);
		fs.writeFileSync(file('b.xsl'), `<xsl:stylesheet ${ns} version="3.0">\n<xsl:function name="f:y"><xsl:param name="p"/><xsl:sequence select="f:x($p)"/></xsl:function>\n</xsl:stylesheet>`);
		fs.writeFileSync(file('master.xsl'), `<xsl:stylesheet ${ns} version="3.0">\n<xsl:import href="a.xsl"/>\n<xsl:import href="b.xsl"/>\n</xsl:stylesheet>`);
		fs.writeFileSync(file('demo.xsl'), `<xsl:stylesheet ${ns} version="3.0">\n<xsl:import href="master.xsl"/>\n<xsl:template match="/"><xsl:sequence select="f:y(1)"/></xsl:template>\n</xsl:stylesheet>`);
	});
	suiteTeardown(() => {
		all.forEach((name) => ImportIndex.instance.setReferences(name, []));
		XsltSymbolProvider.importSymbolHrefs.clear();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('a module of a library converted to a package is checked with the package, not a stylesheet that now uses it', async () => {
		await ImportIndex.instance.buildFrom(all);
		XsltSymbolProvider.importSymbolHrefs.clear();
		const provider = new XsltSymbolProvider(XSLTConfiguration.configuration, null);
		const lint = async (name: string) => (await provider.diagnosticsFor(await vscode.workspace.openTextDocument(vscode.Uri.file(file(name))))).map((d) => d.message);
		// each checked, so the top-level stylesheet is remembered as the parent of the modules
		for (const name of ['demo.xsl', 'master.xsl', 'a.xsl', 'b.xsl']) {
			assert.deepEqual(await lint(name), [], name);
		}
		assert.isTrue([...XsltSymbolProvider.importSymbolHrefs.entries()].some(([top, hrefs]) => top === file('demo.xsl') && hrefs.includes(file('b.xsl'))));
		// the library converted: its master is a package, and the stylesheet uses it - and isn't checked again
		fs.writeFileSync(file('master.xsl'), `<xsl:package ${ns} version="3.0" name="urn:pk" package-version="1.0" declared-modes="no">\n<xsl:import href="a.xsl"/>\n<xsl:import href="b.xsl"/>\n</xsl:package>`);
		fs.writeFileSync(file('demo.xsl'), `<xsl:stylesheet ${ns} version="3.0">\n<xsl:use-package name="urn:pk" package-version="1.0"/>\n<xsl:template match="/"><xsl:sequence select="f:y(1)"/></xsl:template>\n</xsl:stylesheet>`);
		ImportIndex.instance.update(file('master.xsl'), fs.readFileSync(file('master.xsl'), 'utf8'));
		ImportIndex.instance.update(file('demo.xsl'), fs.readFileSync(file('demo.xsl'), 'utf8'));
		assert.deepEqual(await lint('b.xsl'), []);
		assert.deepEqual(await lint('a.xsl'), []);
		// the stylesheet is no longer remembered as their parent
		assert.isFalse([...XsltSymbolProvider.importSymbolHrefs.entries()].some(([top, hrefs]) => top === file('demo.xsl') && hrefs.includes(file('b.xsl'))));
	});

	test('whether a stylesheet imports a module now: from the index, else from the file\'s text', () => {
		assert.isTrue(ImportIndex.reaches(file('master.xsl'), file('b.xsl')));
		assert.isFalse(ImportIndex.reaches(file('demo.xsl'), file('b.xsl')));
		// a stylesheet that's not in the index
		const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stale-parent-outside-')));
		try {
			fs.writeFileSync(path.join(outside, 'top.xsl'), `<xsl:stylesheet ${ns} version="3.0"><xsl:include href="mid.xsl"/></xsl:stylesheet>`);
			fs.writeFileSync(path.join(outside, 'mid.xsl'), `<xsl:stylesheet ${ns} version="3.0"><xsl:import href="${file('b.xsl')}"/></xsl:stylesheet>`);
			assert.isTrue(ImportIndex.reaches(path.join(outside, 'top.xsl'), file('b.xsl')));
			assert.isFalse(ImportIndex.reaches(path.join(outside, 'top.xsl'), file('a.xsl')));
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
	});
});
