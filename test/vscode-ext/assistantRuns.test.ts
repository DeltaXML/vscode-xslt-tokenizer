/**
 * Test suite for the MCP tools that say how to run XSpec tests (test_configuration) and a Schematron validation
 * (validation_configuration), and how to profile a stylesheet (profile_configuration): the commands, with the files they write in the temporary files, and how to read the result. With
 * a real Saxon jar, in XSLT_TEST_SAXON_JAR, the commands given are run, as an assistant would run them.
 */
import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { ProfileConfiguration, TestConfiguration, TraceConfiguration, ValidationConfiguration } from '../../src/mcp/assistantRuns';
import { RunConfiguration } from '../../src/mcp/runConfiguration';

suite('MCP tools: how to run XSpec tests and a Schematron validation', function () {
	this.timeout(120000);
	const realJar = process.env.XSLT_TEST_SAXON_JAR;
	const samples = path.join(vscode.extensions.getExtension('deltaxml.xslt-xpath')!.extensionPath, 'sample');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-runs-'));
	const xspecDemo = path.join(dir, 'xspec-demo');
	const schematronDemo = path.join(dir, 'schematron-demo');
	const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
	const savedJar = tasks.inspect<string>('saxonJar')?.globalValue;
	const runSaxon = RunConfiguration.runSaxon;

	suiteSetup(async () => {
		fs.cpSync(path.join(samples, 'xspec-demo'), xspecDemo, { recursive: true });
		fs.rmSync(path.join(xspecDemo, 'xspec'), { recursive: true, force: true });
		fs.cpSync(path.join(samples, 'schematron-demo'), schematronDemo, { recursive: true });
		fs.rmSync(path.join(schematronDemo, 'xspec'), { recursive: true, force: true });
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		if (realJar) {
			await tasks.update('saxonJar', realJar, vscode.ConfigurationTarget.Global);
		} else {
			// a jar that exists, and Saxon's report of it as a stub: the commands are made, not run
			const jar = path.join(dir, 'saxon-pe-13.1.jar');
			fs.writeFileSync(jar, '');
			await tasks.update('saxonJar', jar, vscode.ConfigurationTarget.Global);
			RunConfiguration.runSaxon = async () => ({ output: 'SaxonJ-PE 13.1 from Saxonica\nUsing license serial number A014667\n' });
		}
	});

	suiteTeardown(async () => {
		RunConfiguration.runSaxon = runSaxon;
		await tasks.update('saxonJar', savedJar, vscode.ConfigurationTarget.Global);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('test_configuration: the steps for an XSpec file - in the temporary files, with how to read the result', async () => {
		const xspec = path.join(xspecDemo, 'order-report.xspec');
		const result = await TestConfiguration.describe(xspec);
		assert.isFalse(result.isError, result.text);
		const text = result.text;
		assert.include(text, 'They test the stylesheet');
		assert.include(text, 'order-report.xsl');
		assert.include(text, 'compile-xslt-tests.xsl');
		assert.include(text, 'xspec}main');
		assert.match(text, /1\. Compile the tests/);
		assert.match(text, /2\. Run the tests/);
		// the files are in the temporary files - not in an xspec folder beside the XSpec file
		assert.include(text, path.join(os.tmpdir(), 'xslt-xpath', 'xspec', 'order-report-'));
		assert.isFalse(fs.existsSync(path.join(xspecDemo, 'xspec')));
		assert.include(text, 'xspec-summary.xsl');
		assert.match(text, /exits with 0 whether or not tests failed/);
		assert.include(text, 'In one line: java ');
		// the scenarios
		assert.include(text, 'Its scenarios:');
		assert.include(text, 'o:line-total');
		// the same folder each time, so the temporary files don't collect
		assert.strictEqual((await TestConfiguration.describe(xspec)).text, text);
	});

	// an XSpec file in the temporary files with a helper package - one of the sample's, which the test host has no workspace to
	// find, so the XSLT.resources.xsltPackages setting declares it: the runner uses it, so the run needs it with -lib
	const resources = vscode.workspace.getConfiguration('XSLT.resources');
	const savedPackages = resources.inspect<unknown>('xsltPackages')?.globalValue;
	const invoicing = path.join(samples, 'packages-demo', 'lib', 'invoicing.xsl');
	const packageXSpec = async () => {
		await resources.update('xsltPackages', [{ path: invoicing }], vscode.ConfigurationTarget.Global);
		const stylesheet = path.join(dir, 'nothing.xsl');
		fs.writeFileSync(stylesheet, '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>');
		const file = path.join(dir, 'invoice-package.xspec');
		fs.writeFileSync(file, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:inv="http://example.com/invoicing" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    stylesheet="nothing.xsl">
  <x:helper package-name="http://example.com/invoicing" package-version="1.*"/>
  <x:scenario label="inv:format-amount, from the package">
    <x:call function="inv:format-amount"><x:param select="xs:decimal(12.5)"/></x:call>
    <x:expect label="is text" test="$x:result instance of xs:string"/>
  </x:scenario>
</x:description>`);
		return file;
	};
	teardown(async () => {
		await resources.update('xsltPackages', savedPackages, vscode.ConfigurationTarget.Global);
	});

	test('test_configuration: an XSpec file with a helper package - the package is passed to the run with -lib', async () => {
		const text = (await TestConfiguration.describe(await packageXSpec())).text;
		assert.match(text, /Packages \(-lib\): .*invoicing\.xsl/);
		assert.match(text, /-lib:\S*invoicing\.xsl/);
	});

	test('test_configuration: a test runner left by an earlier run - from before the XSpec file had its helper - doesn\'t decide the packages', async () => {
		const xspec = await packageXSpec();
		const text = (await TestConfiguration.describe(xspec)).text;
		const compiled = /-o:(\S+-compiled\.xsl)/.exec(text)![1];
		fs.mkdirSync(path.dirname(compiled), { recursive: true });
		fs.writeFileSync(compiled, '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>');
		try {
			const again = (await TestConfiguration.describe(xspec)).text;
			assert.match(again, /-lib:\S*invoicing\.xsl/, again);
		} finally {
			fs.rmSync(compiled, { force: true });
		}
	});

	test('test_configuration: not an XSpec file, or not there', async () => {
		const notXSpec = await TestConfiguration.describe(path.join(xspecDemo, 'order-report.xsl'));
		assert.isTrue(notXSpec.isError);
		assert.match(notXSpec.text, /^Not an XSpec file: /);
		const missing = await TestConfiguration.describe(path.join(xspecDemo, 'none.xspec'));
		assert.isTrue(missing.isError);
		assert.match(missing.text, /^File not found: /);
	});

	test('test_configuration: the XSpec file of a Schematron schema - its steps first', async () => {
		const result = await TestConfiguration.describe(path.join(schematronDemo, 'order-rules.xspec'));
		assert.isFalse(result.isError, result.text);
		assert.include(result.text, 'They test the Schematron schema');
		assert.match(result.text, /1\. Compiling the Schematron to XSLT/);
		assert.match(result.text, /2\. Converting the XSpec for the Schematron's XSLT/);
		assert.match(result.text, /3\. Compile the tests/);
		assert.match(result.text, /4\. Run the tests/);
	});

	test('validation_configuration: the command for a schema and the XML file it validates - with its phases and how to read the report', async () => {
		const schema = path.join(schematronDemo, 'order-rules.sch');
		const xml = path.join(schematronDemo, 'orders.xml');
		const result = await ValidationConfiguration.describe(schema, xml);
		assert.isFalse(result.isError, result.text);
		const text = result.text;
		assert.include(text, 'validate.xsl');
		assert.include(text, '?schema=');
		assert.include(text, 'transpile.xsl');
		assert.include(text, path.join(os.tmpdir(), 'xslt-xpath', 'schematron', 'orders-'));
		assert.include(text, 'svrl-summary.xsl');
		assert.match(text, /exits with 0 whether or not assertions failed/);
		assert.include(text, 'evaluate_xpath');
		assert.match(text, /Phase: .*phases are .*\(the default\)/);
		// another phase, and one it hasn't
		const phases = /phases are ([^;]*);/.exec(text)![1].split(', ').map((p) => p.replace(' (the default)', ''));
		const other = phases.find((p) => p !== 'all-checks')!;
		const chosen = await ValidationConfiguration.describe(schema, xml, other);
		assert.isFalse(chosen.isError, chosen.text);
		assert.include(chosen.text, `"?phase='${other}'"`);
		const unknown = await ValidationConfiguration.describe(schema, xml, 'no-such-phase');
		assert.isTrue(unknown.isError);
		assert.match(unknown.text, /has no phase 'no-such-phase' - its phases are /);
	});

	test('validation_configuration: an XML file with no schema known - and a file that isn\'t there', async () => {
		const loose = path.join(dir, 'loose.xml');
		fs.writeFileSync(loose, '<a/>');
		const none = await ValidationConfiguration.describe(loose);
		assert.isTrue(none.isError);
		assert.match(none.text, /No schema is known for .*loose\.xml.*pairedWith/);
		const missing = await ValidationConfiguration.describe(path.join(dir, 'none.sch'));
		assert.isTrue(missing.isError);
		assert.match(missing.text, /^File not found: /);
		const unpaired = await ValidationConfiguration.describe(path.join(schematronDemo, 'order-rules.sch'), path.join(dir, 'none.xml'));
		assert.isTrue(unpaired.isError);
		assert.match(unpaired.text, /The XML file doesn't exist/);
	});

	// the commands, as an assistant runs them: in a shell, from another folder
	const runInShell = (command: string) => childProcess.execSync(command, { cwd: os.tmpdir(), encoding: 'utf8', shell: '/bin/sh', env: { ...process.env, SAXON_LICENSE_DIR: process.env.SAXON_LICENSE_DIR ?? '' } });
	const commandAfter = (text: string, marker: string) => new RegExp(`${marker}[^\\n]*\\n\\s+(java [^\\n]+)`).exec(text)?.[1];

	test('test_configuration: its commands run, and the summary gives the numbers - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		if (!realJar || process.platform === 'win32') {
			this.skip();
		}
		const text = (await TestConfiguration.describe(path.join(xspecDemo, 'order-report.xspec'))).text;
		const oneLine = /In one line: (java [^\n]+)/.exec(text)![1];
		// the one command: the steps, then the summary
		assert.match(runInShell(oneLine), /^XSpec: \d+ passed, \d+ failed, \d+ pending - \d+ tests/m);
		const summary = commandAfter(text, 'summarises the result|prints the numbers passed')!;
		const output = runInShell(summary);
		assert.match(output, /^XSpec: \d+ passed, \d+ failed, \d+ pending - \d+ tests/m, output);
		// the demo has one test that fails, and one that is pending
		assert.match(output, /FAILED +o:repeatParasSection > the result/);
		assert.match(output, /PENDING /);
		assert.isFalse(fs.existsSync(path.join(xspecDemo, 'xspec')), 'nothing is written beside the XSpec file');
	});

	test('test_configuration: the commands of an XSpec file with a helper package run - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		if (!realJar || process.platform === 'win32') {
			this.skip();
		}
		const text = (await TestConfiguration.describe(await packageXSpec())).text;
		runInShell(/In one line: (java [^\n]+)/.exec(text)![1]);
		const output = runInShell(commandAfter(text, 'prints the numbers passed')!);
		assert.match(output, /^XSpec: 1 passed, 0 failed, 0 pending - 1 tests/m, output);
	});

	test('validation_configuration: its command runs, and the summary gives the failed assertions - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		if (!realJar || process.platform === 'win32') {
			this.skip();
		}
		const text = (await ValidationConfiguration.describe(path.join(schematronDemo, 'order-rules.sch'), path.join(schematronDemo, 'orders.xml'))).text;
		runInShell(commandAfter(text, 'This command runs nothing here')!);
		const output = runInShell(commandAfter(text, 'This prints the numbers of failed assertions')!);
		assert.match(output, /^Schematron: [1-9]\d* failed assertions, \d+ successful reports - \d+ rules fired/m, output);
		assert.match(output, /^assert \[error\] \/Q\{\}orders\[1\]\/Q\{\}order\[1\]/m, output);
	});

	test('profile_configuration: the Quick Run with Saxon\'s profile, several runs, in the temporary files - and the command that summarises it', async () => {
		const result = await ProfileConfiguration.describe(path.join(xspecDemo, 'order-report.xsl'));
		assert.isFalse(result.isError, result.text);
		const text = result.text;
		const command = /(java -cp [^\n]+)/.exec(text)![1];
		assert.include(command, 'net.sf.saxon.Transform');
		// the profile and the result are in the temporary files, with the extension's stylesheet making the profile XML
		const folder = path.join(os.tmpdir(), 'xslt-xpath', 'profile', 'order-report-');
		assert.include(command, '-TP:' + folder);
		assert.include(command, 'profile.xml');
		assert.include(command, '-o:' + folder);
		assert.include(command, 'profile-xml.xsl');
		// the setting's default of 1 run is mostly warm-up: more are asked for, and the text says so
		assert.include(command, '-repeat:5');
		assert.match(text, /5 times \(the XSLT\.tasks\.profileRuns setting is 1/);
		assert.include(text, 'profile-summary.xsl');
		assert.match(text, /-it:main/);
		assert.match(text, /base=\S+xspec-demo\//);
		assert.match(text, /ranked by net time/);
		assert.isFalse(fs.existsSync(path.join(xspecDemo, 'profile.xml')));
		assert.strictEqual((await ProfileConfiguration.describe(path.join(xspecDemo, 'order-report.xsl'))).text, text);
	});

	test('profile_configuration: not with Saxon-HE, and not a stylesheet or a file that isn\'t there', async () => {
		const stylesheet = path.join(xspecDemo, 'order-report.xsl');
		const he = path.join(dir, 'saxon-he-13.0.jar');
		fs.writeFileSync(he, '');
		const current = vscode.workspace.getConfiguration('XSLT.tasks').inspect<string>('saxonJar')?.globalValue;
		await tasks.update('saxonJar', he, vscode.ConfigurationTarget.Global);
		try {
			const refused = await ProfileConfiguration.describe(stylesheet);
			assert.isTrue(refused.isError);
			assert.match(refused.text, /Saxon PE and EE.*Saxon-HE/);
		} finally {
			await tasks.update('saxonJar', current, vscode.ConfigurationTarget.Global);
		}
		const notXslt = await ProfileConfiguration.describe(path.join(xspecDemo, 'orders.xml'));
		assert.isTrue(notXslt.isError);
		assert.match(notXslt.text, /^Not an XSLT stylesheet/);
		const missing = await ProfileConfiguration.describe(path.join(xspecDemo, 'none.xsl'));
		assert.isTrue(missing.isError);
		assert.match(missing.text, /^Stylesheet not found/);
	});

	test('profile_configuration: its commands run, and the summary ranks by net time - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		if (!realJar || process.platform === 'win32' || /-he\b/i.test(path.basename(realJar))) {
			this.skip();
		}
		const text = (await ProfileConfiguration.describe(path.join(xspecDemo, 'order-report.xsl'), undefined, path.join(xspecDemo, 'orders.xml'))).text;
		assert.include(text, '-s:' + path.join(xspecDemo, 'orders.xml'));
		runInShell(/(java -cp [^\n]+)/.exec(text)![1]);
		const output = runInShell(commandAfter(text, 'Then read the profile as text')!);
		assert.match(output, /^Profile: average of runs 2-5, after a warm-up run; total [\d.,]+ ms/m, output);
		assert.match(output, /^[\d.,]+ net +\d+% +[\d.,]+ gross +[\d,]+ calls +template .+ order-report\.xsl:\d+$/m, output);
		assert.isFalse(fs.existsSync(path.join(xspecDemo, 'profile.xml')), 'nothing is written beside the stylesheet');
	});

	test('trace_configuration: the Quick Run with TraceRun from the debugger jar, LOGPOINTS to fill in, the result in the temporary files', async () => {
		const result = await TraceConfiguration.describe(path.join(xspecDemo, 'order-report.xsl'), path.join(xspecDemo, 'orders.xml'));
		assert.isFalse(result.isError, result.text);
		const command = /(java -cp [^\n]+)/.exec(result.text)![1];
		assert.include(command, 'xslt-debugger.jar');
		assert.include(command, 'com.deltaxml.xslt.debug.TraceRun LOGPOINTS -- ');
		assert.include(command, '-s:' + path.join(xspecDemo, 'orders.xml'));
		assert.include(command, '-o:' + path.join(os.tmpdir(), 'xslt-xpath', 'trace', 'order-report-'));
		assert.match(result.text, /--log FILE:LINE /);
		assert.match(result.text, /--when 'FILE:LINE=CONDITION'/);
		assert.isTrue((await TraceConfiguration.describe(path.join(xspecDemo, 'orders.xml'))).isError);
	});

	test('trace_configuration: its command runs with logpoints - values at each, a condition, and the hits - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		if (!realJar || process.platform === 'win32') {
			this.skip();
		}
		const xsl = path.join(xspecDemo, 'order-report.xsl');
		const text = (await TraceConfiguration.describe(xsl, path.join(xspecDemo, 'orders.xml'))).text;
		const command = /(java -cp [^\n]+)/.exec(text)![1];
		// the variable in o:line-total, when it's over 10 - and a line with no instruction
		const output = runInShell(command.replace('LOGPOINTS', `--log ${xsl}:25 --when '${xsl}:25=$total gt 10' --log ${xsl}:1`));
		assert.match(output, /Logpoint .*order-report\.xsl:1 not set: /);
		assert.match(output, /order-report\.xsl:25 #1: .*o:line-total#2[\s\S]*total: +40/);
		assert.notInclude(output, '3.6');
		assert.match(output, /--- The run ended\n.*order-report\.xsl:25: 2 hits/);
		assert.isFalse(fs.existsSync(path.join(xspecDemo, 'result.out')));
	});

	test('trace_configuration: --rules - what processed the input, and the elements only built-in rules did - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		if (!realJar || process.platform === 'win32') {
			this.skip();
		}
		// the trial's bug: a mode on the template rule, not on the xsl:apply-templates meant to reach it
		const xsl = path.join(dir, 'rules.xsl');
		const xml = path.join(dir, 'rules.xml');
		fs.writeFileSync(xsl, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="/"><report><xsl:apply-templates select="orders/order"/></report></xsl:template>
  <xsl:template match="order"><o><xsl:apply-templates select="shipping"/></o></xsl:template>
  <xsl:template match="shipping" mode="detail"><s/></xsl:template>
</xsl:stylesheet>`);
		fs.writeFileSync(xml, '<orders>\n  <order>\n    <shipping><to>London</to></shipping>\n  </order>\n</orders>');
		const text = (await TraceConfiguration.describe(xsl, xml)).text;
		assert.include(text, '--rules');
		const output = runInShell(/(java -cp [^\n]+)/.exec(text)![1].replace('LOGPOINTS', '--rules'));
		assert.match(output, /--- Input rules for .*rules\.xml: 4 elements - 1 processed by/, output);
		assert.match(output, /\n {2}xsl:template match="order" - .*rules\.xsl:3: 1 element\n/, output);
		assert.match(output, /\n {2}\/orders\/order\/shipping \(line 3\): built-in rule \(text-only\) - its text is copied to the output as it is - and its 1 descendant\n/, output);
	});
});
