/**
 * Test suite for the jars of a SaxonJ download's lib folder that Saxon 13's invisible-xml() needs - CoffeeFilter and
 * CoffeeGrinder - added to the classpath with the Saxon jar for tasks, Quick Run, the debugger, XSpec, Schematron and
 * XPath queries. With a licensed Saxon-PE or EE 13 jar in XSPEC_SAXON_JAR, a stylesheet calling invisible-xml() is run.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import { assert } from 'chai';
import { SaxonLib } from '../../src/saxonLib';
import { SaxonTaskProvider, XSLTTask } from '../../src/saxonTaskProvider';
import { XSpecRunner } from '../../src/xspecRunner';
import { XPathQuery } from '../../src/xpathQuery';

const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'saxon-lib-')));
const saxonFolder = path.join(folder, 'SaxonPE13-1J');
const saxonJar = path.join(saxonFolder, 'saxon-pe-13.1.jar');
const lib = path.join(saxonFolder, 'lib');
const coffee = [path.join(lib, 'coffeefilter-3.3.8.jar'), path.join(lib, 'coffeegrinder-3.3.8.jar')];

suite('Saxon\'s lib jars for invisible-xml()', () => {
	suiteSetup(async () => {
		// a task's command line has the extension's AltTransform jar
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		fs.mkdirSync(lib, { recursive: true });
		[saxonJar, ...coffee, path.join(lib, 'xmlresolver-6.1.0.jar'), path.join(lib, 'icu4j-72.1.jar')].forEach((jar) => fs.writeFileSync(jar, ''));
		SaxonLib.clearCache();
	});

	suiteTeardown(async () => {
		await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', undefined, vscode.ConfigurationTarget.Global);
		SaxonLib.clearCache();
	});

	test('CoffeeFilter and CoffeeGrinder from the lib folder beside the Saxon jar - not its other jars', () => {
		assert.deepStrictEqual(SaxonLib.jarsFor(saxonJar), coffee);
		assert.deepStrictEqual(SaxonLib.classPath(saxonJar, ['/x/ext.jar']), [saxonJar, '/x/ext.jar', ...coffee]);
	});

	test('none for a jar without a lib folder, e.g. from Maven, or a path with a variable - and none twice', () => {
		assert.deepStrictEqual(SaxonLib.jarsFor(path.join(folder, 'saxon-he-13.0.jar')), []);
		assert.deepStrictEqual(SaxonLib.jarsFor('${workspaceFolder}/saxon/saxon-pe-13.1.jar'), []);
		assert.deepStrictEqual(SaxonLib.jarsFor(undefined), []);
		// one the task's classPathEntries already has, by name
		assert.deepStrictEqual(SaxonLib.jarsFor(saxonJar, [saxonJar, '/elsewhere/coffeefilter-3.3.8.jar']), [coffee[1]]);
	});

	test('tasks and the debugger: with the task\'s saxonJar, or the setting\'s path for its variable', async () => {
		const task = <XSLTTask><unknown>{ type: 'xslt', label: 'ixml', saxonJar, xsltFile: 'a.xsl', classPathEntries: ['/x/ext.jar'] };
		// a task's starts with the jar of the message-escaping AltTransform
		assert.deepStrictEqual(SaxonTaskProvider.commandLine(task, false).classPath.slice(-4), [saxonJar, '/x/ext.jar', ...coffee]);
		assert.deepStrictEqual(SaxonTaskProvider.commandLine(task, true).classPath, [saxonJar, '/x/ext.jar', ...coffee]);
		await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		const fromSetting = <XSLTTask><unknown>{ type: 'xslt', label: 'ixml', saxonJar: '${config:XSLT.tasks.saxonJar}', xsltFile: 'a.xsl' };
		const classPath = SaxonTaskProvider.commandLine(fromSetting, true).classPath;
		assert.includeMembers(classPath, coffee);
	});

	test('XSpec, Schematron and XPath queries: with the Saxon jar of the XSLT.tasks.saxonJar setting', async () => {
		await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		const uri = vscode.Uri.file(path.join(folder, 'tests.xspec'));
		const xspecClassPath = XSpecRunner.javaArgs(uri, [])[1].split(path.delimiter);
		assert.includeMembers(xspecClassPath, [saxonJar, ...coffee]);
		const query = XPathQuery.javaArguments(vscode.Uri.file(folder), saxonJar).args[1].split(path.delimiter);
		assert.includeMembers(query, [saxonJar, ...coffee]);
	});

	test('a stylesheet calling invisible-xml() runs with the task\'s classpath - with a Saxon-PE or EE 13 jar in XSPEC_SAXON_JAR', function () {
		const jar = process.env.XSPEC_SAXON_JAR;
		if (!jar || !fs.existsSync(jar) || SaxonLib.jarsFor(jar).length === 0) {
			this.skip();
		}
		this.timeout(60000);
		const xsl = path.join(folder, 'ixml.xsl');
		fs.writeFileSync(xsl, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">
  <xsl:template name="xsl:initial-template">
    <xsl:sequence select="invisible-xml('date: day, -&quot; &quot;, year. day: [&quot;0&quot;-&quot;9&quot;]+. year: [&quot;0&quot;-&quot;9&quot;]+.')('12 2026')"/>
  </xsl:template>
</xsl:stylesheet>`);
		const task = <XSLTTask><unknown>{ type: 'xslt', label: 'ixml', saxonJar: jar, xsltFile: xsl, xmlSource: '', initTemplate: 'xsl:initial-template', features: [{ name: 'allowSyntaxExtensions', value: 'on' }] };
		const { classPath } = SaxonTaskProvider.commandLine(task, true);
		const result = cp.spawnSync('java', ['-cp', classPath.join(path.delimiter), 'net.sf.saxon.Transform', '-xsl:' + xsl, '-it', '--allowSyntaxExtensions:on'], { encoding: 'utf8' });
		assert.include(result.stdout, '<date><day>12</day><year>2026</year></date>', result.stderr);
	});
});
