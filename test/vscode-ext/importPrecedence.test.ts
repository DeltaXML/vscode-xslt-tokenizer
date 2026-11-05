/**
 * Test suite for import precedence: which of the declarations with the same name, in different modules, is used - as
 * Saxon uses it (each case below was checked with Saxon-PE 13.1). Go to Definition, hovers, references and the call
 * hierarchy all follow it
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { assert } from 'chai';
import { ImportPrecedence } from '../../src/importPrecedence';

suite('XSLT import precedence', function () {
	this.timeout(30000);
	let dir: string;
	// main.xsl imports a.xsl (which imports c.xsl) and b.xsl, then includes inc.xsl, which imports d.xsl and e.xsl;
	// each module declares the functions listed for it
	const modules: Record<string, string[]> = {
		'c': ['s3', 's4'], 'a': ['import:c', 's1', 's2', 's3', 's6'], 'b': ['s1', 's4', 's5'], 'd': ['s5', 's6', 's7'], 'e': ['s7'],
		'inc': ['import:d', 'import:e'], 'main': ['import:a', 'import:b', 'include:inc', 's2']
	};
	// the module whose function Saxon uses
	const used: Record<string, string> = { s1: 'b', s2: 'main', s3: 'a', s4: 'b', s5: 'd', s6: 'd', s7: 'e' };
	const moduleText = (name: string) => ['<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f">',
		...modules[name].map((x) => x.includes(':') ? `  <xsl:${x.split(':')[0]} href="${x.split(':')[1]}.xsl"/>` :
			`  <xsl:function name="f:${x}"><xsl:sequence select="'${name}'"/></xsl:function>`),
		...(name === 'main' ? ['  <xsl:template name="xsl:initial-template">', '    <r ' + Object.keys(used).map((s) => `${s}="{f:${s}()}"`).join(' ') + '/>', '  </xsl:template>'] : []),
		'</xsl:stylesheet>'].join('\n');

	suiteSetup(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-precedence-'));
		Object.keys(modules).forEach((name) => fs.writeFileSync(path.join(dir, name + '.xsl'), moduleText(name)));
	});

	test('the modules\' precedence, lowest first: an import below its importer, a later import above an earlier one', () => {
		const ranks = ImportPrecedence.ranks(path.join(dir, 'main.xsl'), (p) => fs.readFileSync(p, 'utf8'));
		const order = [...ranks.entries()].sort((x, y) => x[1] - y[1]).map(([p, r]) => `${path.basename(p, '.xsl')}${r}`);
		// inc.xsl has main's precedence; its imports come after main's imports before it
		assert.deepStrictEqual(order, ['c0', 'a1', 'b2', 'd3', 'e4', 'main5', 'inc5']);
	});

	test('Go to Definition goes to the declaration Saxon uses', async () => {
		const uri = vscode.Uri.file(path.join(dir, 'main.xsl'));
		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document);
		const callLine = document.getText().split('\n').findIndex((l) => l.includes('f:s1()'));
		const at = (s: string) => new vscode.Position(callLine, document.lineAt(callLine).text.indexOf(`f:${s}()`) + 3);
		const definition = async (s: string) => (await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', uri, at(s))) ?? [];
		// once the modules have been read
		for (let i = 0; i < 50 && (await definition('s1')).length === 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const found: Record<string, string> = {};
		for (const s of Object.keys(used)) {
			found[s] = (await definition(s)).map((d) => path.basename(d.uri.fsPath, '.xsl')).join('|');
		}
		assert.deepStrictEqual(found, used);
	});
});
