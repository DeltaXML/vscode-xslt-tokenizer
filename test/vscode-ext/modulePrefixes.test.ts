/**
 * Test suite for declarations in modules that use different prefixes for a namespace: a name is matched by its
 * namespace and local name, not its prefix - as Saxon matches it. lib.xsl binds f to urn:fns, and main.xsl, which
 * imports it, binds my to urn:fns - and f to another namespace, so f:double in main.xsl isn't lib.xsl's function
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { assert } from 'chai';
import { ImportIndex } from '../../src/importIndex';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';

suite('Module prefixes: names matched by namespace, not prefix', function () {
	this.timeout(30000);
	let dir: string;
	const lib = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:fns">',
		'  <xsl:variable name="f:limit" select="10"/>',
		'  <xsl:function name="f:double">',
		'    <xsl:param name="n"/>',
		'    <xsl:sequence select="$n * 2"/>',
		'  </xsl:function>',
		'  <xsl:template name="f:greet"><hello/></xsl:template>',
		'  <xsl:template match="a" mode="f:m"><a/></xsl:template>',
		'  <xsl:template match="b"><b h="{f:helper(1)}" u="{f:unknown(1)}"/></xsl:template>',
		'</xsl:stylesheet>'].join('\n');
	const main = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="urn:fns" xmlns:f="urn:different">',
		'  <xsl:import href="lib.xsl"/>',
		'  <xsl:template match="/">',
		'    <r d="{my:double(2)}" l="{$my:limit}" x="{f:double(1)}" y="{my:missing(1)}"/>',
		'    <xsl:call-template name="my:greet"/>',
		'    <xsl:apply-templates mode="my:m"/>',
		'  </xsl:template>',
		'  <xsl:function name="my:helper"><xsl:param name="n"/><xsl:sequence select="$n"/></xsl:function>',
		'</xsl:stylesheet>'].join('\n');
	// binds no prefix to urn:fns: lib.xsl's function is called with an EQName
	const other = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">',
		'  <xsl:import href="lib.xsl"/>',
		'  <xsl:template match="/"><xsl:sequence select="Q{urn:fns}double(2), Q{urn:fns}nosuch(2)"/></xsl:template>',
		'</xsl:stylesheet>'].join('\n');
	const uri = (file: string) => vscode.Uri.file(path.join(dir, file));
	const mainCall = new vscode.Position(3, main.split('\n')[3].indexOf('my:double') + 4);

	suiteSetup(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-prefixes-'));
		fs.writeFileSync(path.join(dir, 'main.xsl'), main);
		fs.writeFileSync(path.join(dir, 'lib.xsl'), lib);
		fs.writeFileSync(path.join(dir, 'other.xsl'), other);
		await ImportIndex.instance.buildFrom([path.join(dir, 'main.xsl'), path.join(dir, 'lib.xsl')]);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('main.xsl')));
		await reported('main.xsl', 'my:missing');
	});

	// the names in the problems reported for the module - not hints, e.g. for a variable that's unused - once its
	// imports have been read: when one with the name is
	const reported = async (file: string, name: string) => {
		const problems = () => vscode.languages.getDiagnostics(uri(file)).filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint);
		for (let i = 0; i < 50 && !problems().some((d) => d.message.includes(name)); i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return problems().map((d) => /'([^']+)'/.exec(d.message)?.[1] ?? d.message).sort();
	};

	test('problems: only the names that aren\'t declared in the namespace', () => {
		const reported = vscode.languages.getDiagnostics(uri('main.xsl')).map((d) => d.message);
		assert.deepEqual(reported.filter((m) => /my:|f:/.test(m)).map((m) => /'([^']+)'/.exec(m)?.[1]).sort(), ['f:double', 'my:missing']);
	});

	test('problems: in an imported module, the declarations of the module importing it, with its prefixes', async () => {
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('lib.xsl')));
		assert.deepEqual(await reported('lib.xsl', 'f:unknown'), ['f:unknown']);
	});

	test('a module that binds no prefix to the namespace: an EQName', async () => {
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('other.xsl')));
		assert.deepEqual(await reported('other.xsl', 'nosuch'), ['Q{urn:fns}nosuch']);
		const call = new vscode.Position(2, other.split('\n')[2].indexOf('double') + 2);
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', uri('other.xsl'), call);
		assert.deepEqual(definitions.map((d) => [path.basename(d.uri.fsPath), d.range.start.line]), [['lib.xsl', 2]]);
	});

	test('Go to Definition: the declaration with another prefix', async () => {
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', uri('main.xsl'), mainCall);
		assert.deepEqual(definitions.map((d) => [path.basename(d.uri.fsPath), d.range.start.line]), [['lib.xsl', 2]]);
		const template = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', uri('main.xsl'), new vscode.Position(4, 30));
		assert.deepEqual(template.map((d) => [path.basename(d.uri.fsPath), d.range.start.line]), [['lib.xsl', 6]]);
	});

	test('References and Rename: from the declaration, the calls with another prefix keep their prefix', async () => {
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('lib.xsl')));
		const declaration = new vscode.Position(2, lib.split('\n')[2].indexOf('f:double') + 3);
		const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri('lib.xsl'), declaration);
		assert.deepEqual(references.map((r) => `${path.basename(r.uri.fsPath)}:${r.range.start.line}`).sort(), ['lib.xsl:2', 'main.xsl:3']);
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', uri('lib.xsl'), declaration, 'f:triple');
		const replaced = edit.entries().flatMap(([u, edits]) => edits.map((e) => `${path.basename(u.fsPath)}:${e.newText}`)).sort();
		assert.deepEqual(replaced, ['lib.xsl:f:triple', 'main.xsl:my:triple']);
	});

	test('Rename from a call: the declaration keeps its prefix', async () => {
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('main.xsl')));
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', uri('main.xsl'), mainCall, 'my:triple');
		const replaced = edit.entries().flatMap(([u, edits]) => edits.map((e) => `${path.basename(u.fsPath)}:${e.newText}`)).sort();
		assert.deepEqual(replaced, ['lib.xsl:f:triple', 'main.xsl:my:triple']);
	});
});

suite('Module prefixes: renaming a function that another module may override', function () {
	this.timeout(30000);
	let dir: string;
	const lib = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:fns">',
		'  <xsl:function name="f:area"><xsl:param name="w"/><xsl:sequence select="$w"/></xsl:function>',
		'  <xsl:function name="f:len"><xsl:param name="s"/><xsl:sequence select="$s"/></xsl:function>',
		'</xsl:stylesheet>'].join('\n');
	// my:area overrides lib.xsl's f:area, with another prefix for urn:fns - and f:len is another function, in urn:other
	const top = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="urn:fns" xmlns:f="urn:other">',
		'  <xsl:import href="lib.xsl"/>',
		'  <xsl:function name="my:area"><xsl:param name="w"/><xsl:sequence select="$w * 2"/></xsl:function>',
		'  <xsl:function name="f:len"><xsl:param name="s"/><xsl:sequence select="0"/></xsl:function>',
		'  <xsl:template match="/"><r a="{my:area(1)}" l="{f:len(\'x\')}"/></xsl:template>',
		'</xsl:stylesheet>'].join('\n');

	suiteSetup(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-prefix-overrides-'));
		fs.writeFileSync(path.join(dir, 'lib.xsl'), lib);
		fs.writeFileSync(path.join(dir, 'top.xsl'), top);
		await ImportIndex.instance.buildFrom([path.join(dir, 'top.xsl'), path.join(dir, 'lib.xsl')]);
	});

	// the reason the rename at the function's name in lib.xsl is refused - undefined if it isn't
	const refusal = async (name: string) => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'lib.xsl')));
		await vscode.window.showTextDocument(document);
		const position = document.positionAt(document.getText().indexOf(`"${name}"`) + 3);
		try {
			await new XSLTReferenceProvider().prepareRename(document, position, new vscode.CancellationTokenSource().token);
		} catch (reason) {
			return String(reason);
		}
		return undefined;
	};

	test('refused: an override in another module, with another prefix for the namespace', async () => {
		assert.match(await refusal('f:area') ?? '', /^XSLT: f:area is also declared in top\.xsl, where it may override this function/);
	});

	test('not refused: a function with the same prefix and local name, in another namespace', async () => {
		assert.isUndefined(await refusal('f:len'));
	});
});

suite('Module prefixes: variables and parameters with prefixes', function () {
	this.timeout(30000);
	let dir: string;
	const lib = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:fns">',
		'  <xsl:param name="f:size" select="1"/>',
		'  <xsl:template name="f:box">',
		'    <xsl:param name="f:width" required="yes"/>',
		'    <box w="{$f:width}"/>',
		'  </xsl:template>',
		'</xsl:stylesheet>'].join('\n');
	const main = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="urn:fns">',
		'  <xsl:import href="lib.xsl"/>',
		'  <xsl:template match="/">',
		'    <r s="{$my:size}" n="{$my:nosuch}"/>',
		'    <xsl:call-template name="my:box">',
		'      <xsl:with-param name="my:width" select="2"/>',
		'    </xsl:call-template>',
		'  </xsl:template>',
		'</xsl:stylesheet>'].join('\n');
	// another stylesheet using lib.xsl, with another prefix again
	const second = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="urn:fns">',
		'  <xsl:import href="lib.xsl"/>',
		'  <xsl:template match="/"><xsl:call-template name="s:box"><xsl:with-param name="s:width" select="3"/></xsl:call-template></xsl:template>',
		'</xsl:stylesheet>'].join('\n');
	const uri = (file: string) => vscode.Uri.file(path.join(dir, file));

	suiteSetup(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-prefix-params-'));
		fs.writeFileSync(path.join(dir, 'lib.xsl'), lib);
		fs.writeFileSync(path.join(dir, 'main.xsl'), main);
		fs.writeFileSync(path.join(dir, 'second.xsl'), second);
		await ImportIndex.instance.buildFrom([path.join(dir, 'main.xsl'), path.join(dir, 'lib.xsl'), path.join(dir, 'second.xsl')]);
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('main.xsl')));
		for (let i = 0; i < 50 && !vscode.languages.getDiagnostics(uri('main.xsl')).some((d) => d.message.includes('nosuch')); i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	});

	test('problems: a global parameter, and a template parameter, with another prefix', () => {
		const problems = vscode.languages.getDiagnostics(uri('main.xsl')).filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => d.message);
		assert.lengthOf(problems, 1, problems.join('\n'));
		assert.include(problems[0], 'my:nosuch');
	});

	test('Rename a global parameter: its references with another prefix keep it', async () => {
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('lib.xsl')));
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', uri('lib.xsl'), new vscode.Position(1, 18), 'f:length');
		const replaced = edit.entries().flatMap(([u, edits]) => edits.map((e) => `${path.basename(u.fsPath)}:${e.newText}`)).sort();
		assert.deepEqual(replaced, ['lib.xsl:f:length', 'main.xsl:my:length']);
	});

	test('Rename a template parameter: each xsl:with-param with another prefix keeps it - in another stylesheet too', async () => {
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri('lib.xsl')));
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', uri('lib.xsl'), new vscode.Position(3, 22), 'f:breadth');
		const replaced = edit.entries().flatMap(([u, edits]) => edits.map((e) => `${path.basename(u.fsPath)}:${e.newText}`)).sort();
		assert.deepEqual(replaced, ['lib.xsl:f:breadth', 'lib.xsl:f:breadth', 'main.xsl:my:breadth', 'second.xsl:s:breadth']);
	});
});
