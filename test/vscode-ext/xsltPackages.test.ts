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
import * as vscode from 'vscode';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { GlobalInstructionType } from '../../src/xslLexer';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTConfiguration } from '../../src/languageConfigurations';

suite('XSLT packages: declarations and uses', () => {
	test('a package\'s name and version, from its root element', () => {
		assert.deepEqual(ImportIndex.packageDeclaration(`<?xml version="1.0"?>\n<!-- <xsl:package name="old"> -->\n<xsl:package xmlns:xsl="http://www.w3.org/1999/XSL/Transform"\n  name="http://example.com/a" package-version="2.1" version="3.0">`),
			{ name: 'http://example.com/a', version: '2.1' });
		assert.deepEqual(ImportIndex.packageDeclaration(`<xsl:package name='urn:b' version="3.0">`), { name: 'urn:b', version: '1' });
		// another prefix for the XSLT namespace
		assert.deepEqual(ImportIndex.packageDeclaration(`<t:package xmlns:t="http://www.w3.org/1999/XSL/Transform" name="urn:c" version="3.0">`), { name: 'urn:c', version: '1' });
		assert.isUndefined(ImportIndex.packageDeclaration(`<xsl:stylesheet name="x" version="3.0"><xsl:package name="y"/></xsl:stylesheet>`));
	});

	test('the packages used, with their versions, not in comments', () => {
		const text = `<xsl:stylesheet version="3.0">\n  <xsl:use-package name="urn:a" package-version="1.0"/>\n  <!-- <xsl:use-package name="urn:old"/> -->\n  <xsl:use-package\n    package-version="2+" name="urn:b">\n  </xsl:use-package>\n  <xsl:use-package name="urn:c"/>\n</xsl:stylesheet>`;
		assert.deepEqual(ImportIndex.usedPackages(text), [{ name: 'urn:a', versionRange: '1.0' }, { name: 'urn:b', versionRange: '2+' }, { name: 'urn:c', versionRange: undefined }]);
	});
});

suite('XSLT packages: versions', () => {
	test('versions compare their numeric parts as integers, missing parts as 0, then a name part is lower', () => {
		const sign = (a: string, b: string) => Math.sign(XsltPackages.compareVersions(a, b));
		assert.strictEqual(sign('1.10', '1.9'), 1);
		assert.strictEqual(sign('1', '1.0.0'), 0);
		assert.strictEqual(sign('2.0-beta', '2.0'), -1);
		assert.strictEqual(sign('2.0-beta', '2.0-alpha'), 1);
		assert.strictEqual(sign('1.2', '1.2.1'), -1);
	});

	test('package-version ranges', () => {
		const matches = (version: string, range: string | undefined) => XsltPackages.versionMatches(version, range);
		assert.isTrue(matches('3.1', undefined));
		assert.isTrue(matches('3.1', '*'));
		assert.isTrue(matches('1.0.0', '1'));
		assert.isFalse(matches('1.1', '1'));
		assert.isTrue(matches('1.2.5', '1.2.*'));
		assert.isTrue(matches('1.2', '1.2.*'));
		assert.isFalse(matches('1.3', '1.2.*'));
		assert.isTrue(matches('2.5', '2+'));
		assert.isFalse(matches('1.9', '2+'));
		assert.isTrue(matches('1.5', '1 to 2'));
		assert.isTrue(matches('2.0', '1 to 2'));
		assert.isFalse(matches('2.1', '1 to 2'));
		assert.isTrue(matches('0.5', 'to 1'));
		assert.isTrue(matches('3.0', '1.0, 3.0'));
		assert.isFalse(matches('2.0', '1.0, 3.0'));
	});

	test('the highest version in the range, the setting\'s first for the same version', () => {
		const packages = [
			{ name: 'urn:a', path: 'setting/a.xsl', version: '1.0' },
			{ name: 'urn:a', path: '/ws/a1.xsl', version: '1.0.0' },
			{ name: 'urn:a', path: '/ws/a2.xsl', version: '2.1' },
			{ name: 'urn:a', path: '/ws/a3.xsl', version: '3.0-beta' },
			{ name: 'urn:b', path: '/ws/b.xsl' },
		];
		assert.strictEqual(XsltPackages.find(packages, 'urn:a')?.path, '/ws/a3.xsl');
		assert.strictEqual(XsltPackages.find(packages, 'urn:a', '1 to 2.9')?.path, '/ws/a2.xsl');
		assert.strictEqual(XsltPackages.find(packages, 'urn:a', '1.0')?.path, 'setting/a.xsl');
		// as the lexer gives an attribute's value, with its quotes
		assert.strictEqual(XsltPackages.find(packages, 'urn:a', '"1.*"')?.path, 'setting/a.xsl');
		assert.isUndefined(XsltPackages.find(packages, 'urn:a', '4+'));
		// a package with no version is version 1
		assert.strictEqual(XsltPackages.find(packages, 'urn:b', '1.0')?.path, '/ws/b.xsl');
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
	file('module.xsl', `<xsl:stylesheet ${ns}><xsl:use-package name="urn:b" package-version="1 to 2"/></xsl:stylesheet>`);
	const a = file('a.xsl', `<xsl:package name="urn:a" ${ns}><xsl:use-package name="urn:c"/></xsl:package>`);
	const b = file('b.xsl', `<xsl:package name="urn:b" package-version="2" ${ns}/>`);
	// an older version of urn:b, which the module's package-version leaves out
	file('b1.xsl', `<xsl:package name="urn:b" package-version="1.5" ${ns}/>`);
	const c = file('c.xsl', `<xsl:package name="urn:c" ${ns}/>`);
	file('unused.xsl', `<xsl:package name="urn:unused" ${ns}/>`);

	suiteSetup(async () => {
		await ImportIndex.instance.buildFrom(fs.readdirSync(dir).map((name) => path.join(dir, name)));
	});
	suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('packages in the workspace are found without the setting', () => {
		const found = XsltPackages.all().filter((p) => p.path.startsWith(dir));
		assert.sameDeepMembers(found.map((p) => [p.name, p.version]), [['urn:a', '1'], ['urn:b', '2'], ['urn:b', '1.5'], ['urn:c', '1'], ['urn:unused', '1']]);
	});

	test('the packages used by the stylesheet, its modules and the packages they use - not others', () => {
		assert.sameMembers(XsltPackages.libraryPaths(main), [a, b, c]);
	});

	const completions = async (text: string) => {
		const offset = text.indexOf('¦');
		const document = await vscode.workspace.openTextDocument({ content: text.replace('¦', ''), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		return items.map((item) => ({ label: typeof item.label === 'string' ? item.label : item.label.label, range: item.range as vscode.Range | undefined }));
	};

	test('completion of an xsl:use-package name: each package once, replacing the URI typed so far', async () => {
		const found = await completions(`<xsl:stylesheet ${ns}>\n  <xsl:use-package name="urn:¦"/>\n</xsl:stylesheet>`);
		const names = found.map((item) => item.label);
		['urn:a', 'urn:b', 'urn:c', 'urn:unused'].forEach((name) => assert.include(names, name));
		assert.strictEqual(names.filter((name) => name === 'urn:b').length, 1);
		const range = found.find((item) => item.label === 'urn:a')!.range!;
		assert.strictEqual(range.end.character - range.start.character, 'urn:'.length);
	});

	test('completion of an xsl:use-package package-version: * and the versions of the package, highest first', async () => {
		const found = await completions(`<xsl:stylesheet ${ns}>\n  <xsl:use-package name="urn:b" package-version="¦"/>\n</xsl:stylesheet>`);
		assert.deepEqual(found.map((item) => item.label), ['*', '2', '1.5']);
	});

	test('a task\'s -lib option - not with a Saxon configuration file', () => {
		const option = SaxonTaskProvider.libOption({ xsltFile: main });
		assert.exists(option);
		assert.sameMembers(option!.substring('-lib:'.length).split(path.delimiter), [a, b, c]);
		assert.isUndefined(SaxonTaskProvider.libOption({ xsltFile: main, configFilename: 'saxon-config.xml' }));
		assert.isUndefined(SaxonTaskProvider.libOption({ xsltFile: c }));
	});
});

suite('XSLT packages: not found', () => {
	test('the version a new package gets from the package-version range', () => {
		assert.strictEqual(XsltPackages.lowestVersion('2.1'), '2.1');
		assert.strictEqual(XsltPackages.lowestVersion('2+'), '2');
		assert.strictEqual(XsltPackages.lowestVersion('1.2.*'), '1.2');
		assert.strictEqual(XsltPackages.lowestVersion('1.5 to 2'), '1.5');
		assert.isUndefined(XsltPackages.lowestVersion('*'));
		assert.isUndefined(XsltPackages.lowestVersion('to 2'));
		assert.isUndefined(XsltPackages.lowestVersion(undefined));
	});

	test('XTSE3000 on the name, with the quick fixes to create the package or add a package file', async () => {
		const text = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n  <xsl:use-package name="http://example.com/strings" package-version="2+"/>\n</xsl:stylesheet>`;
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
		const start = text.indexOf('"http://example.com/strings"');
		const token = { line: 1, startCharacter: document.positionAt(start).character, length: '"http://example.com/strings"'.length, tokenType: 0, value: '' };
		const diagnostic = XsltTokenDiagnostics.createPackageNotFoundDiagnostic({ name: 'http://example.com/strings', type: GlobalInstructionType.UsePackage, token, idNumber: 0, version: '"2+"' });
		assert.strictEqual(diagnostic.message, `XTSE3000: Package 'http://example.com/strings' with package-version '2+' not found - in the workspace, or the XSLT.resources.xsltPackages setting`);
		const actions = new XSLTCodeActions().provideCodeActions(document, diagnostic.range, { diagnostics: [diagnostic], only: undefined, triggerKind: vscode.CodeActionTriggerKind.Invoke }) ?? [];
		const fixes = actions.filter((action) => action.command?.command === 'xslt-xpath.createPackage' || action.command?.command === 'xslt-xpath.addPackageFile');
		assert.deepEqual(fixes.map((action) => action.title), [`Create Package 'http://example.com/strings'...`, 'Add Existing Package File...']);
		assert.deepEqual(fixes[0].command!.arguments!.slice(0, 2), ['http://example.com/strings', '2+']);
	});
});
