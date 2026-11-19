/**
 * Test suite for Check Problems in Workspace / in Folder: the problems of files that aren't open, e.g. after a package
 * component's visibility is narrowed, in a collection of their own - errors only by default - removed when a file is
 * opened in an editor, changed on disk, or cleared
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { WorkspaceCheck } from '../../src/workspaceCheck';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltPackages } from '../../src/xsltPackages';

suite('Check Problems in Workspace', function () {
	this.timeout(30000);
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:p="urn:p" version="3.0"';
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-workspace-check-')));
	const file = (name: string, content: string) => {
		const fsPath = path.join(dir, name);
		fs.mkdirSync(path.dirname(fsPath), { recursive: true });
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	// p:hidden was public, and has been narrowed to private: user.xsl, which calls it, now has an error. The package's
	// abstract function, which user.xsl doesn't override, is a warning
	const pkg = file('lib/pkg.xsl', `<xsl:package name="urn:p" package-version="1.0" ${ns}>
  <xsl:function name="p:hidden" visibility="private"><xsl:sequence select="1"/></xsl:function>
  <xsl:function name="p:shown" visibility="public"><xsl:sequence select="2"/></xsl:function>
  <xsl:function name="p:todo" visibility="abstract"/>
</xsl:package>`);
	const user = file('app/user.xsl', `<xsl:stylesheet ${ns}>
  <xsl:use-package name="urn:p" package-version="1.0"/>
  <xsl:template name="main"><xsl:sequence select="p:hidden(), p:shown()"/></xsl:template>
</xsl:stylesheet>`);
	const other = file('other/other.xsl', `<xsl:stylesheet ${ns}>
  <xsl:template name="main"><xsl:sequence select="p:nothing()"/></xsl:template>
</xsl:stylesheet>`);
	file('app/clean.xsl', `<xsl:stylesheet ${ns}><xsl:template name="main"><xsl:sequence select="1"/></xsl:template></xsl:stylesheet>`);
	file('node_modules/dep/bad.xsl', `<xsl:stylesheet ${ns}><xsl:template name="main"><xsl:sequence select="p:nothing()"/></xsl:template></xsl:stylesheet>`);

	const provider = new XsltSymbolProvider(XSLTConfiguration.configuration, null);
	let check: WorkspaceCheck;
	suiteSetup(() => {
		XsltPackages.additional = [{ name: 'urn:p', path: pkg, version: '1.0' }];
		check = new WorkspaceCheck((document) => document.languageId === 'xslt' ? provider.diagnosticsFor(document) : undefined);
	});
	suiteTeardown(async () => {
		check.dispose();
		XsltPackages.additional = [];
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const resultFor = (fsPath: string) => check.results.find(([uri]) => uri.fsPath === fsPath)?.[1];
	const until = async (condition: () => boolean, what: string) => {
		for (let i = 0; i < 100 && !condition(); i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.isTrue(condition(), what);
	};

	test('a folder: the errors of its files - not warnings, nor files in node_modules - shown as from the workspace check', async () => {
		// the linter has a warning for user.xsl too: the abstract function it doesn't override
		const all = await provider.diagnosticsFor(await vscode.workspace.openTextDocument(user));
		assert.isTrue(all.some((d) => d.severity === vscode.DiagnosticSeverity.Warning && /abstract components that aren't overridden/.test(d.message)), JSON.stringify(all.map((d) => d.message)));
		const checked = await check.check(vscode.Uri.file(dir), false);
		assert.strictEqual(checked, 4);
		assert.deepEqual(check.results.map(([uri]) => path.relative(dir, uri.fsPath)).sort(), [path.join('app', 'user.xsl'), path.join('other', 'other.xsl')]);
		const problems = resultFor(user)!;
		assert.deepEqual(problems.map((d) => d.message), ["The function p:hidden#0 is private in package 'urn:p', so it can't be used here - it must be public in the package"]);
		assert.isTrue(problems.every((d) => d.source === WorkspaceCheck.source && d.severity === vscode.DiagnosticSeverity.Error));
	});

	test('checking a folder again replaces its results - and keeps those of other folders', async () => {
		await check.check(vscode.Uri.file(dir), false);
		fs.writeFileSync(other, `<xsl:stylesheet ${ns}><xsl:template name="main"/></xsl:stylesheet>`);
		await check.check(vscode.Uri.file(path.join(dir, 'other')), false);
		assert.isUndefined(resultFor(other));
		assert.isDefined(resultFor(user));
	});

	test('a file opened in an editor loses its results - the editor\'s checks show its problems', async () => {
		await check.check(vscode.Uri.file(dir), false);
		assert.isDefined(resultFor(user));
		await vscode.window.showTextDocument(vscode.Uri.file(user));
		await until(() => resultFor(user) === undefined, 'opened: no results from the workspace check');
		// and while it's open, it isn't checked
		await check.check(vscode.Uri.file(dir), false);
		assert.isUndefined(resultFor(user));
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('a file changed on disk loses its results, as they may no longer apply', async () => {
		fs.writeFileSync(other, `<xsl:stylesheet ${ns}>\n  <xsl:template name="main"><xsl:sequence select="p:nothing()"/></xsl:template>\n</xsl:stylesheet>`);
		await check.check(vscode.Uri.file(dir), false);
		assert.isDefined(resultFor(other));
		fs.writeFileSync(other, `<xsl:stylesheet ${ns}>\n  <xsl:template name="main"><xsl:sequence select="p:still-nothing()"/></xsl:template>\n</xsl:stylesheet>`);
		await until(() => resultFor(other) === undefined, 'changed: no results from the workspace check');
	});

	test('clear: every result removed', async () => {
		await check.check(vscode.Uri.file(dir), false);
		assert.isAbove(check.results.length, 0);
		check.clear();
		assert.deepEqual(check.results, []);
	});
});
