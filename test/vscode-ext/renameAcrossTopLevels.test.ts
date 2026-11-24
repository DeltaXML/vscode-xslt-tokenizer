/**
 * Test suite for renaming a function in a library that several top-level stylesheets import - e.g. the examples of a
 * library, each in a folder of its own: they're all renamed, found from the index of the workspace's modules - unless one
 * of them declares a function with the name, which may override the library's, when the rename is refused
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';
import { ImportIndex } from '../../src/importIndex';

suite('Renaming a function that several top-level stylesheets use', function () {
	this.timeout(60000);
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rename-top-')));
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0"';
	const files: { [name: string]: string } = {
		'library/lib.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:function name="f:area"><xsl:param name="w"/><xsl:sequence select="$w * $w"/></xsl:function>\n</xsl:stylesheet>`,
		'example-a/main.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:import href="../library/lib.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="f:area(2)"/></xsl:template>\n</xsl:stylesheet>`,
		'example-b/main.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:import href="../library/lib.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="f:area(3)"/></xsl:template>\n</xsl:stylesheet>`,
		'example-c/main.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:import href="../library/lib.xsl"/>\n  <xsl:function name="f:area"><xsl:param name="w"/><xsl:sequence select="0"/></xsl:function>\n  <xsl:template match="/"><xsl:sequence select="f:area(4)"/></xsl:template>\n</xsl:stylesheet>`
	};
	const file = (name: string) => path.join(dir, ...name.split('/'));
	const open = (name: string) => vscode.workspace.openTextDocument(vscode.Uri.file(file(name)));

	suiteSetup(async () => {
		Object.entries(files).forEach(([name, text]) => {
			fs.mkdirSync(path.dirname(file(name)), { recursive: true });
			fs.writeFileSync(file(name), text);
		});
	});
	suiteTeardown(async () => {
		for (const name of Object.keys(files)) {
			ImportIndex.instance.setReferences(file(name), []);
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	async function renameInLibrary() {
		const lib = await open('library/lib.xsl');
		const position = lib.positionAt(lib.getText().indexOf('f:area') + 3);
		const provider = new XSLTReferenceProvider();
		const token = new vscode.CancellationTokenSource().token;
		await provider.prepareRename(lib, position, token);
		return provider.provideRenameEdits(lib, position, 'f:surface', token);
	}

	test('refused when one of the stylesheets declares a function with the name, which may override the library\'s - none is renamed', async () => {
		await ImportIndex.instance.buildFrom(Object.keys(files).map(file));
		const lib = await open('library/lib.xsl');
		const position = lib.positionAt(lib.getText().indexOf('f:area') + 3);
		try {
			await new XSLTReferenceProvider().prepareRename(lib, position, new vscode.CancellationTokenSource().token);
		} catch (reason) {
			assert.include(String(reason), 'f:area is also declared in main.xsl, where it may override');
			return;
		}
		assert.fail('the rename is not refused');
	});

	test('every stylesheet that imports the library has its calls renamed, in every folder', async () => {
		// without the overriding stylesheet: it's no longer in the index
		ImportIndex.instance.setReferences(file('example-c/main.xsl'), []);
		await ImportIndex.instance.buildFrom(Object.keys(files).filter((name) => !name.startsWith('example-c')).map(file));
		const edit = await renameInLibrary();
		assert.deepEqual([...new Set(edit!.entries().map(([uri]) => path.relative(dir, uri.fsPath)))].sort(), ['example-a/main.xsl'.replace('/', path.sep), 'example-b/main.xsl'.replace('/', path.sep), path.join('library', 'lib.xsl')].sort());
		assert.isTrue(await vscode.workspace.applyEdit(edit!));
		assert.include((await open('example-a/main.xsl')).getText(), 'f:surface(2)');
		assert.include((await open('example-b/main.xsl')).getText(), 'f:surface(3)');
		for (const name of ['library/lib.xsl', 'example-a/main.xsl', 'example-b/main.xsl']) {
			await (await open(name)).save();
		}
	});
});
