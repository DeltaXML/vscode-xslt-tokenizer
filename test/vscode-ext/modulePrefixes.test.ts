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
