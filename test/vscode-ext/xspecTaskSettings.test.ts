/**
 * Test suite for the Saxon settings XSpec's runs take from the task of the stylesheet tested (see XSpecTaskSettings):
 * the 'xslt' tasks for the stylesheet, their Saxon settings - not those of the transform - and the options and
 * classpath they give. The run with them needs a Saxon jar, in XSPEC_SAXON_JAR, else it's skipped
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { XSpecTaskSettingsFinder } from '../../src/xspecTaskSettings';
import { XSpecRunner } from '../../src/xspecRunner';

suite('XSpec: the Saxon settings of the stylesheet\'s task', () => {
	const workspaceFolder = path.resolve('/work/project');
	const fsPath = (...segments: string[]) => path.join(workspaceFolder, ...segments);

	test('the xslt tasks for the stylesheet, with any source', () => {
		const tasks = [
			{ type: 'xslt', label: 'a', xsltFile: '${workspaceFolder}/report.xsl', xmlSource: '${workspaceFolder}/books.xml' },
			{ type: 'xslt', label: 'b', xsltFile: 'report.xsl', xmlSource: '' },
			{ type: 'xslt', label: 'c', xsltFile: '${workspaceFolder}/other.xsl' },
			{ type: 'xslt-c', label: 'd', xsltFile: '${workspaceFolder}/report.xsl' },
			{ type: 'xslt', label: 'e', xsltFile: '${file}' }
		];
		assert.deepEqual(XSpecTaskSettingsFinder.tasksFor(tasks, fsPath('report.xsl'), workspaceFolder).map((t) => t.label), ['a', 'b']);
	});

	test('only the Saxon settings, not those of the transform', () => {
		const settings = XSpecTaskSettingsFinder.settingsOf({
			type: 'xslt', label: 'a', saxonJar: 'saxon.jar', xsltFile: 'report.xsl', xmlSource: 'books.xml', resultPath: 'out.xml', initialMode: 'm',
			parameters: [{ name: 'p', value: '1' }], classPathEntries: ['lib/ext.jar'], configFilename: 'saxon.xml', features: [{ name: 'strip', value: 'all' }]
		});
		assert.deepEqual(settings, { label: 'a', classPathEntries: ['lib/ext.jar'], configFilename: 'saxon.xml', features: [{ name: 'strip', value: 'all' }] });
	});

	test('tasks whose Saxon settings are all the same need no pick', () => {
		const a = { label: 'report with a.xml', classPathEntries: ['lib/ext.jar'] };
		const b = { label: 'report with b.xml', classPathEntries: ['lib/ext.jar'] };
		const c = { label: 'report with c.xml', classPathEntries: ['lib/other.jar'] };
		assert.isTrue(XSpecTaskSettingsFinder.allTheSame([a, b]));
		assert.isFalse(XSpecTaskSettingsFinder.allTheSame([a, b, c]));
		assert.isFalse(XSpecTaskSettingsFinder.allTheSame([a, { label: 'none' }]));
	});

	test('the classpath and options, with paths relative to the workspace folder', () => {
		const { classPath, args } = XSpecTaskSettingsFinder.commandLine({
			label: 'a', classPathEntries: ['lib/ext.jar', '${workspaceFolder}/lib/more.jar', path.resolve('/abs/x.jar')], configFilename: 'saxon.xml',
			catalogFilenames: 'cat/a.xml;${workspaceFolder}/cat/b.xml', features: [{ name: 'strip', value: 'all' }], dtd: 'on', enableAssertions: 'on', expandValues: 'off'
		}, workspaceFolder);
		assert.deepEqual(classPath, [fsPath('lib', 'ext.jar'), fsPath('lib', 'more.jar'), path.resolve('/abs/x.jar')]);
		assert.deepEqual(args, ['-config:' + fsPath('saxon.xml'), '-catalog:' + fsPath('cat', 'a.xml') + ';' + fsPath('cat', 'b.xml'), '-dtd:on', '-ea:on', '-expand:off', '--strip:all']);
	});

	test('for the debugger: the task\'s properties, without its label', () => {
		assert.deepEqual(XSpecTaskSettingsFinder.launchProperties({ label: 'a', classPathEntries: ['lib/ext.jar'], enableAssertions: 'on' }), { classPathEntries: ['lib/ext.jar'], enableAssertions: 'on' });
		assert.deepEqual(XSpecTaskSettingsFinder.launchProperties(undefined), {});
	});

	suite('a run with them', function () {
		this.timeout(120000);
		const saxonJar = process.env.XSPEC_SAXON_JAR;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xspec-task-'));
		// the assertion fails only with Saxon's -ea:on - the task's enableAssertions
		fs.writeFileSync(path.join(dir, 'asserts.xsl'), `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">
  <xsl:function name="f:one"><xsl:assert test="false()" error-code="f:ASSERTED">asserted</xsl:assert><xsl:sequence select="1"/></xsl:function>
</xsl:stylesheet>`);
		const xspecPath = path.join(dir, 'asserts.xspec');
		fs.writeFileSync(xspecPath, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="asserts.xsl">
  <x:scenario label="one"><x:call function="f:one"/><x:expect label="is one" select="1"/></x:scenario>
</x:description>`);

		suiteSetup(async function () {
			if (!saxonJar) {
				this.skip();
			}
			await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
			await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		});

		test('Saxon\'s options from the task', async () => {
			const files = XSpecRunner.files(xspecPath);
			assert.isTrue((await XSpecRunner.compile(xspecPath, files)).ok);
			const without = await XSpecRunner.run(xspecPath, files);
			assert.isTrue(without.ok, without.output);
			const withTask = await XSpecRunner.run(xspecPath, files, undefined, { label: 'asserts', enableAssertions: 'on' });
			assert.isFalse(withTask.ok);
			assert.include(withTask.output, 'ASSERTED');
		});
	});
});
