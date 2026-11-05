/**
 * Test suite for the XSLT call hierarchy ('Show Call Hierarchy'): incoming and outgoing calls of stylesheet functions
 * and named templates, across included modules - template rules are callers only
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { assert } from 'chai';
import { ImportIndex } from '../../src/importIndex';

suite('XSLT call hierarchy', function () {
	this.timeout(30000);
	let dir: string;
	const main = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f">',
		'  <xsl:include href="lib.xsl"/>',
		'  <xsl:template match="order">',
		'    <total value="{f:total(line)}"/>',
		'    <xsl:call-template name="footer"/>',
		'  </xsl:template>',
		'  <xsl:template name="footer">',
		'    <end count="{f:count(//order)}" sum="{sum((1, 2)!f:double#1(.))}"/>',
		'  </xsl:template>',
		'</xsl:stylesheet>'].join('\n');
	const lib = [
		'<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f">',
		'  <xsl:function name="f:total">',
		'    <xsl:param name="lines"/>',
		'    <xsl:sequence select="if (empty($lines)) then 0 else f:double(head($lines)/@n) + f:total(tail($lines))"/>',
		'  </xsl:function>',
		'  <xsl:function name="f:double">',
		'    <xsl:param name="n"/>',
		'    <xsl:sequence select="$n * 2"/>',
		'  </xsl:function>',
		'  <xsl:function name="f:count">',
		'    <xsl:param name="s"/>',
		'    <xsl:sequence select="count($s)"/>',
		'  </xsl:function>',
		'</xsl:stylesheet>'].join('\n');

	suiteSetup(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-calls-'));
		fs.writeFileSync(path.join(dir, 'main.xsl'), main);
		fs.writeFileSync(path.join(dir, 'lib.xsl'), lib);
		// the modules that include or import lib.xsl, as for a workspace: its callers in them are found from the index
		await ImportIndex.instance.buildFrom([path.join(dir, 'main.xsl'), path.join(dir, 'lib.xsl')]);
	});

	const prepare = async (file: string, line: number, character: number) => {
		const uri = vscode.Uri.file(path.join(dir, file));
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
		// once the stylesheet's modules have been read - just opened, its included module's declarations aren't known
		// yet: until then, the call f:total(line) has no definition
		const mainUri = vscode.Uri.file(path.join(dir, 'main.xsl'));
		for (let i = 0; i < 50 && !(await vscode.commands.executeCommand<unknown[]>('vscode.executeDefinitionProvider', mainUri, new vscode.Position(3, 24)))?.length; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, new vscode.Position(line, character));
		return items[0];
	};
	const where = (item: vscode.CallHierarchyItem) => `${item.name} (${item.detail}) ${path.basename(item.uri.fsPath)}:${item.range.start.line + 1}`;

	test('incoming calls of a function in another module: grouped by the declaration they are in, recursion included', async () => {
		// at the call f:total(line) in main.xsl
		const item = await prepare('main.xsl', 3, 24);
		assert.strictEqual(where(item), 'f:total (function) lib.xsl:2');
		const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', item);
		assert.deepStrictEqual(incoming.map((c) => `${where(c.from)} ×${c.fromRanges.length}`).sort(),
			['f:total (function) lib.xsl:2 ×1', 'order (template rule) main.xsl:3 ×1']);
	});

	test('outgoing calls: functions (calls and named references) and named templates', async () => {
		// in the template rule, not on a call: the template itself
		const rule = await prepare('main.xsl', 3, 6);
		assert.strictEqual(where(rule), 'order (template rule) main.xsl:3');
		let outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', rule);
		assert.deepStrictEqual(outgoing.map((c) => where(c.to)), ['f:total (function) lib.xsl:2', 'footer (named template) main.xsl:7']);
		const footer = outgoing[1].to;
		outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>('vscode.provideOutgoingCalls', footer);
		assert.deepStrictEqual(outgoing.map((c) => where(c.to)), ['f:count (function) lib.xsl:10', 'f:double (function) lib.xsl:6']);
		// a named template's callers
		const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', footer);
		assert.deepStrictEqual(incoming.map((c) => where(c.from)), ['order (template rule) main.xsl:3']);
	});

	test('a template rule has no incoming calls: xsl:apply-templates is resolved at run time', async () => {
		const rule = await prepare('main.xsl', 2, 4);
		const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', rule);
		assert.deepStrictEqual(incoming, []);
	});
});
