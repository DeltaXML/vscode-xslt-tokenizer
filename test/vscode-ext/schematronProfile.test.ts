/**
 * Test suite for profiling a Schematron schema: the rows of the Profile view are the schema's rules - added up over the
 * copies SchXslt2 makes of an abstract pattern's - and its global lets, from the compiled stylesheet's entries
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { assert } from 'chai';
import { SchematronProfile } from '../../src/schematronProfile';
import { SchematronSourceMap } from '../../src/schematronSourceMap';
import { SchematronDebug } from '../../src/schematronDebug';
import { ProfileEntry, XsltProfile } from '../../src/xsltProfile';
import { SchIncludes } from '../../src/schIncludes';
import { XsltProfileView, XsltProfileCodeLensProvider, schematronLabels } from '../../src/xsltProfileView';

suite('Schematron: profiling a schema', function () {
	this.timeout(60000);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-profile-'));
	const schema = path.join(dir, 'rules.sch');
	const compiled = path.join(dir, 'rules-debug.xsl');
	const shown = (fsPath: string) => ({ module: path.basename(fsPath), moduleTitle: fsPath });
	const entry = (construct: string, line: number, count: number, net: number, name?: string, file = compiled): ProfileEntry =>
		({ construct, name, file: vscode.Uri.file(file).toString(), line, count, net, avgNet: net / count, gross: net * 2, avgGross: net * 2 / count });

	suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('a rule\'s times - added up over its copies, with its pattern - and a global let; SchXslt2\'s own are left out', async () => {
		fs.writeFileSync(schema, `<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">
  <let name="limit" value="5"/>
  <pattern id="orders">
    <rule id="r-order" context="order">
      <let name="local" value="1"/>
      <assert test="@id">An order has an id</assert>
    </rule>
  </pattern>
</schema>`);
		// the compiled stylesheet: two templates for the rule - e.g. copies for an abstract pattern - the lines are where
		// each start tag ends
		// SchXslt2's output has the XSLT namespace as the default
		const generated = `<stylesheet xmlns="http://www.w3.org/1999/XSL/Transform" xmlns:svrl="http://purl.oclc.org/dsdl/svrl" version="3.0">
  <param name="limit" select="5"/>
  <template match="order" mode="a">
    <svrl:fired-rule id="r-order" context="order"/>
  </template>
  <template match="order" mode="b">
    <svrl:fired-rule id="r-order" context="order"/>
  </template>
  <function name="schxslt:own" xmlns:schxslt="urn:schxslt"><sequence select="1"/></function>
</stylesheet>`;
		fs.writeFileSync(compiled, generated);
		const map = new SchematronSourceMap(schema, compiled, generated);
		const rows = SchematronProfile.rows([
			entry('xsl:template', 3, 2, 1.5), entry('xsl:template', 6, 3, 2.5), entry('xsl:param', 2, 1, 0.25, 'limit'), entry('xsl:param', 2, 1, 0.5, 'schxslt:phase'),
			entry('xsl:function', 9, 40, 3, 'schxslt:own')
		], map, (file) => SchIncludes.textOf(file), shown);
		assert.deepEqual(rows.map((r) => `${r.kind} ${r.label}`), ['rule order', 'let $limit']);
		const [rule, global] = rows;
		assert.strictEqual(rule.count, 5);
		assert.strictEqual(rule.net, 4);
		assert.strictEqual(rule.avgNet, 0.8);
		assert.strictEqual(rule.mode, 'orders');
		assert.strictEqual(rule.line, 4);
		assert.strictEqual(vscode.Uri.parse(rule.file).fsPath, fs.realpathSync(schema).replace(fs.realpathSync(dir), dir));
		assert.strictEqual(global.line, 2);
		assert.strictEqual(global.net, 0.25);
		// found again as the schema is edited, by its context and id
		assert.strictEqual(rule.key, 'rule order id r-order');
		// the times above the rule and the let, in the schema
		XsltProfileView.show({ stylesheet: vscode.Uri.file(schema), labels: schematronLabels, title: 'rules.sch', processor: 'SaxonJ', settings: [], sourceSummary: '', requestedRuns: 1, runs: 1,
			time: new Date(), total: 10, netTotal: 4.25, rows });
		try {
			const lenses = new XsltProfileCodeLensProvider().provideCodeLenses(await vscode.workspace.openTextDocument(schema));
			assert.deepEqual(lenses.map((l) => l.range.start.line), [3, 1]);
			assert.match(lenses[0].command!.title, /^5 calls · 4\.00 ms net \(94%\) · 8\.00 ms gross$/);
			assert.match(lenses[1].command!.title, /^0\.25 ms \(6%\)$/);
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}
		assert.isTrue(SchematronProfile.isCompiled(entry('xsl:template', 3, 1, 1), compiled));
		assert.isFalse(SchematronProfile.isCompiled(entry('xsl:function', 3, 1, 1, 'f', schema), compiled));
	});

	test('with a real Saxon jar, in XSLT_TEST_SAXON_JAR: the rules and global lets of a schema, and the functions it uses', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR;
		if (!saxonJar || /-HE-/.test(saxonJar)) {
			this.skip();
		}
		const demo = path.join(__dirname, '..', '..', '..', 'sample', 'schematron-demo');
		const orders = path.join(demo, 'order-rules.sch');
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const savedJar = tasks.get('saxonJar');
		await tasks.update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		// the extension's own state, e.g. where its stylesheets are, which compiling the schema uses
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		try {
			const configuration = await SchematronDebug.configuration(orders, path.join(demo, 'orders.xml'));
			assert.isObject(configuration);
			const config = configuration as vscode.DebugConfiguration;
			const profileFile = path.join(dir, 'profile.xml');
			const run = childProcess.spawnSync('java', ['-cp', saxonJar!, 'net.sf.saxon.Transform', '--allowSyntaxExtensions:on', `-s:${config.xmlSource}`, `-xsl:${config.xsltFile}`,
				`-o:${config.resultPath}`, `-TP:${profileFile}`, `-TPxsl:${path.join(__dirname, '..', '..', '..', 'xslt-resources', 'profile', 'profile-xml.xsl')}`]);
			assert.strictEqual(run.status, 0, String(run.stderr));
			const profile = XsltProfile.parse(fs.readFileSync(profileFile, 'utf8'))!;
			const map = SchematronSourceMap.load(orders, config.xsltFile, config.schematronPhase)!;
			const rows = SchematronProfile.rows(profile.entries.filter((e) => SchematronProfile.isCompiled(e, config.xsltFile)), map, (file) => SchIncludes.textOf(file), shown);
			assert.isAbove(rows.filter((r) => r.kind === 'rule').length, 2, JSON.stringify(rows.map((r) => r.label)));
			assert.include(rows.map((r) => `${r.kind} ${r.label}`), 'let $max-order-total');
			assert.isTrue(rows.every((r) => Number.isFinite(r.net) && r.count > 0 && vscode.Uri.parse(r.file).fsPath.endsWith('.sch') || r.kind !== 'rule'));
			// not SchXslt2's own: every row is a rule or a global let of the schema's
			assert.isTrue(rows.every((r) => r.kind === 'rule' || r.kind === 'let'));
		} finally {
			await tasks.update('saxonJar', savedJar, vscode.ConfigurationTarget.Global);
		}
	});
});
