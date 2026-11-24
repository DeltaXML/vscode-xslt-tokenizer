/**
 * Test suite for the XSpec check for a stylesheet that uses a package: XSpec imports the stylesheet tested into its test runner,
 * and an xsl:use-package can't be in an imported stylesheet (XTSE3008) - at its top level, or in a module it includes or imports.
 * With a real Saxon jar, in XSLT_TEST_SAXON_JAR, Saxon runs the tests: it stops for what is reported, and runs what isn't.
 */
import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSpecConfiguration } from '../../src/languageConfigurations';
import { LanguageConfiguration } from '../../src/xslLexer';
import { XsltPackages } from '../../src/xsltPackages';
import { TestConfiguration } from '../../src/mcp/assistantRuns';
import { RunConfiguration } from '../../src/mcp/runConfiguration';
import { revertAndCloseEditorsIn } from './testEditors';

suite('XSpec: a stylesheet that uses a package', function () {
	this.timeout(120000);
	const realJar = process.env.XSLT_TEST_SAXON_JAR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xspec-use-package-'));
	const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
	const header = '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0" xmlns:inv="http://example.com/invoicing" xmlns:xs="http://www.w3.org/2001/XMLSchema">';
	const usePackage = '<xsl:use-package name="http://example.com/invoicing" package-version="1.*"/>';
	const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
	const savedJar = tasks.inspect<string>('saxonJar')?.globalValue;
	const runSaxon = RunConfiguration.runSaxon;
	const additional = XsltPackages.additional;
	const write = (name: string, text: string) => fs.writeFileSync(path.join(dir, name), text);
	let count = 0;

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		// the sample's package, copied: the package the stylesheets use, for Saxon to find with -lib
		fs.copyFileSync(path.join(vscode.extensions.getExtension('deltaxml.xslt-xpath')!.extensionPath, 'sample', 'packages-demo', 'lib', 'invoicing.xsl'), path.join(dir, 'pkg.xsl'));
		XsltPackages.additional = [{ name: 'http://example.com/invoicing', version: '1.2', path: path.join(dir, 'pkg.xsl') }];
		write('uses.xsl', `${header}\n  ${usePackage}\n</xsl:stylesheet>`);
		write('module.xsl', `${header}\n  ${usePackage}\n</xsl:stylesheet>`);
		write('includes.xsl', `${header}\n  <xsl:include href="module.xsl"/>\n</xsl:stylesheet>`);
		write('imports.xsl', `${header}\n  <xsl:import href="module.xsl"/>\n</xsl:stylesheet>`);
		write('plain.xsl', `${header}\n</xsl:stylesheet>`);
		write('logic.xsl', `${header}\n  <xsl:function name="inv:label" as="xs:string"><xsl:param name="n" as="xs:decimal"/><xsl:sequence select="'Total ' || inv:format-amount($n)"/></xsl:function>\n</xsl:stylesheet>`);
		write('a-package.xsl', `<xsl:package xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0" name="urn:a-package" package-version="1.0" xmlns:inv="http://example.com/invoicing">\n  ${usePackage}\n</xsl:package>`);
		if (realJar) {
			await tasks.update('saxonJar', realJar, vscode.ConfigurationTarget.Global);
		} else {
			const jar = path.join(dir, 'saxon-pe-13.1.jar');
			fs.writeFileSync(jar, '');
			await tasks.update('saxonJar', jar, vscode.ConfigurationTarget.Global);
			RunConfiguration.runSaxon = async () => ({ output: 'SaxonJ-PE 13.1 from Saxonica\n' });
		}
	});

	suiteTeardown(async () => {
		XsltPackages.additional = additional;
		RunConfiguration.runSaxon = runSaxon;
		await tasks.update('saxonJar', savedJar, vscode.ConfigurationTarget.Global);
		await revertAndCloseEditorsIn(dir);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const scenario = '<x:scenario label="s"><x:call function="inv:format-amount"><x:param select="xs:decimal(12.5)"/></x:call><x:expect label="e" test="$x:result instance of xs:string"/></x:scenario>';
	const xspecFile = (stylesheet: string, attributes = '', helpers = '') => {
		const file = path.join(dir, `test${count++}.xspec`);
		fs.writeFileSync(file, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:inv="http://example.com/invoicing" xmlns:xs="http://www.w3.org/2001/XMLSchema" stylesheet="${stylesheet}"${attributes}>\n${helpers}${scenario}\n</x:description>`);
		return file;
	};
	const problems = async (file: string) => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		return (await moduleDiagnostics.call(XsltSymbolProvider, document, false, XSpecConfiguration.configuration)).filter((d) => d.message.includes('XTSE3008'));
	};

	test('a stylesheet with an xsl:use-package at its top level: reported on its stylesheet attribute', async () => {
		const file = xspecFile('uses.xsl');
		const found = await problems(file);
		assert.lengthOf(found, 1, found.map((d) => d.message).join('\n'));
		assert.match(found[0].message, /^XSpec: the test runner imports the stylesheet tested, and xsl:use-package can't be in an imported stylesheet \(XTSE3008\) - it has one, for the package http:\/\/example\.com\/invoicing\. /);
		assert.include(found[0].message, 'x:helper package-name');
		assert.strictEqual(found[0].severity, vscode.DiagnosticSeverity.Error);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		assert.strictEqual(document.getText(found[0].range), 'uses.xsl');
	});

	test('a module it includes or imports that has one: the same, whichever way the module is brought in', async () => {
		for (const stylesheet of ['includes.xsl', 'imports.xsl']) {
			const found = await problems(xspecFile(stylesheet));
			assert.lengthOf(found, 1, stylesheet);
			assert.include(found[0].message, 'module.xsl, which it includes or imports, has one');
		}
	});

	test('not reported: a stylesheet without one - run-as="external", which doesn\'t import it - or a package', async () => {
		assert.deepEqual(await problems(xspecFile('plain.xsl')), []);
		assert.deepEqual(await problems(xspecFile('uses.xsl', ' run-as="external"')), []);
		// a package can't be imported at all: its own check says so
		assert.deepEqual(await problems(xspecFile('a-package.xsl')), []);
		assert.deepEqual(await problems(xspecFile('logic.xsl', '', '<x:helper package-name="http://example.com/invoicing" package-version="1.*"/>\n')), []);
	});

	test('a helper\'s stylesheet that uses a package: reported on the helper', async () => {
		const file = xspecFile('plain.xsl', '', '<x:helper stylesheet="uses.xsl"/>\n');
		const found = await problems(file);
		assert.lengthOf(found, 1);
		assert.include(found[0].message, 'imports this helper stylesheet');
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		assert.strictEqual(document.getText(found[0].range), 'uses.xsl');
	});

	// Saxon, as the Test Explorer runs the tests: the commands the test_configuration tool gives
	const runTests = async (xspec: string) => {
		const text = (await TestConfiguration.describe(xspec)).text;
		const oneLine = /In one line: (java [^\n]+)/.exec(text)![1];
		const summary = new RegExp('prints the numbers passed[^\\n]*\\n\\s+(java [^\\n]+)').exec(text)![1];
		const shell = (command: string) => childProcess.execSync(command, { cwd: os.tmpdir(), encoding: 'utf8', shell: '/bin/sh', stdio: 'pipe', env: { ...process.env, SAXON_LICENSE_DIR: process.env.SAXON_LICENSE_DIR ?? '' } });
		try {
			shell(oneLine);
		} catch (e: any) {
			return `stopped: ${e.stderr ?? e.message}`;
		}
		return shell(summary);
	};

	test('Saxon agrees - with a real Saxon jar, in XSLT_TEST_SAXON_JAR: it stops for what is reported, and runs the tests of what x:helper gives the package', async function () {
		if (!realJar || process.platform === 'win32') {
			this.skip();
		}
		const reported = await runTests(xspecFile('uses.xsl'));
		assert.match(reported, /^stopped: [\s\S]*XTSE3008/, reported);
		const viaInclude = await runTests(xspecFile('includes.xsl'));
		assert.match(viaInclude, /^stopped: [\s\S]*XTSE3008/, viaInclude);
		// what the message recommends: the module with the logic, and the package for the runner from x:helper
		const recommended = xspecFile('logic.xsl', '', '<x:helper package-name="http://example.com/invoicing" package-version="1.*"/>\n').replace(/inv:format-amount/, 'inv:format-amount');
		fs.writeFileSync(recommended, fs.readFileSync(recommended, 'utf8').replace(scenario, '<x:scenario label="s"><x:call function="inv:label"><x:param select="xs:decimal(12.5)"/></x:call><x:expect label="e" test="starts-with($x:result, \'Total\')"/></x:scenario>'));
		assert.deepEqual(await problems(recommended), []);
		assert.match(await runTests(recommended), /^XSpec: 1 passed, 0 failed, 0 pending - 1 tests/m);
	});
});
