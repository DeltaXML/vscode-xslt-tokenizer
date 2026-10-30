/**
 * Test suite for finding the XSLT packages that xsl:use-package uses
 *
 * Packages in the workspace are found from their xsl:package element, so they need no XSLT.resources.xsltPackages
 * setting - and the packages a stylesheet uses, directly or through its modules and other packages, are passed to Saxon
 * with -lib.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { ImportIndex } from '../../src/importIndex';
import { XsltPackages } from '../../src/xsltPackages';
import { SaxonTaskProvider } from '../../src/saxonTaskProvider';

suite('XSLT packages: declarations and uses', () => {
	test('a package\'s name and version, from its root element', () => {
		assert.deepEqual(ImportIndex.packageDeclaration(`<?xml version="1.0"?>\n<!-- <xsl:package name="old"> -->\n<xsl:package xmlns:xsl="http://www.w3.org/1999/XSL/Transform"\n  name="http://example.com/a" package-version="2.1" version="3.0">`),
			{ name: 'http://example.com/a', version: '2.1' });
		assert.deepEqual(ImportIndex.packageDeclaration(`<xsl:package name='urn:b' version="3.0">`), { name: 'urn:b', version: '1' });
		// another prefix for the XSLT namespace
		assert.deepEqual(ImportIndex.packageDeclaration(`<t:package xmlns:t="http://www.w3.org/1999/XSL/Transform" name="urn:c" version="3.0">`), { name: 'urn:c', version: '1' });
		assert.isUndefined(ImportIndex.packageDeclaration(`<xsl:stylesheet name="x" version="3.0"><xsl:package name="y"/></xsl:stylesheet>`));
	});

	test('the packages used, not in comments', () => {
		const text = `<xsl:stylesheet version="3.0">\n  <xsl:use-package name="urn:a" package-version="1.0"/>\n  <!-- <xsl:use-package name="urn:old"/> -->\n  <xsl:use-package\n    package-version="*" name="urn:b">\n  </xsl:use-package>\n</xsl:stylesheet>`;
		assert.deepEqual(ImportIndex.usedPackageNames(text), ['urn:a', 'urn:b']);
	});
});

suite('XSLT packages: -lib for a stylesheet', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-packages-'));
	const file = (name: string, content: string) => {
		const fsPath = path.join(dir, name);
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"';
	const main = file('main.xsl', `<xsl:stylesheet ${ns}><xsl:import href="module.xsl"/><xsl:use-package name="urn:a"/></xsl:stylesheet>`);
	file('module.xsl', `<xsl:stylesheet ${ns}><xsl:use-package name="urn:b"/></xsl:stylesheet>`);
	const a = file('a.xsl', `<xsl:package name="urn:a" ${ns}><xsl:use-package name="urn:c"/></xsl:package>`);
	const b = file('b.xsl', `<xsl:package name="urn:b" package-version="2" ${ns}/>`);
	const c = file('c.xsl', `<xsl:package name="urn:c" ${ns}/>`);
	file('unused.xsl', `<xsl:package name="urn:unused" ${ns}/>`);

	suiteSetup(async () => {
		await ImportIndex.instance.buildFrom(fs.readdirSync(dir).map((name) => path.join(dir, name)));
	});
	suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('packages in the workspace are found without the setting', () => {
		const found = XsltPackages.all().filter((p) => p.path.startsWith(dir));
		assert.sameDeepMembers(found.map((p) => [p.name, p.version]), [['urn:a', '1'], ['urn:b', '2'], ['urn:c', '1'], ['urn:unused', '1']]);
	});

	test('the packages used by the stylesheet, its modules and the packages they use - not others', () => {
		assert.sameMembers(XsltPackages.libraryPaths(main), [a, b, c]);
	});

	test('a task\'s -lib option - not with a Saxon configuration file', () => {
		const option = SaxonTaskProvider.libOption({ xsltFile: main });
		assert.exists(option);
		assert.sameMembers(option!.substring('-lib:'.length).split(path.delimiter), [a, b, c]);
		assert.isUndefined(SaxonTaskProvider.libOption({ xsltFile: main, configFilename: 'saxon-config.xml' }));
		assert.isUndefined(SaxonTaskProvider.libOption({ xsltFile: c }));
	});
});
