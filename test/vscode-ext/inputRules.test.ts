/**
 * Test suite for the MCP tool input_rules: for an input file of the last run, or an element of it, what processed it -
 * template rules, xsl:for-each etc., and built-in rules where no template matched - as the input file's hover shows it.
 * With a real Saxon jar, in XSLT_TEST_SAXON_JAR, also from a run.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltDebug } from '../../src/xsltDebug';
import { XsltNodeRules } from '../../src/xsltNodeRules';
import { InputRules } from '../../src/mcp/inputRules';
import { RunRequest } from '../../src/mcp/runRequest';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';

const fixtures = path.resolve(__dirname, '..', '..', '..', 'debugger', 'test');

suite('MCP tool input_rules: what processed an input file\'s elements', function () {
	this.timeout(60000);
	let folder = '';
	const file = (name: string) => path.join(folder, name);

	setup(() => {
		folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'input-rules-')));
		['node-rules.xsl', 'node-rules.xml', 'node-rules-products.xml'].forEach((name) => fs.copyFileSync(path.join(fixtures, name), file(name)));
		XsltNodeRules.clear();
	});
	teardown(() => {
		XsltNodeRules.clear();
		fs.rmSync(folder, { recursive: true, force: true });
	});

	// not asking the user to run the stylesheet: tests don't wait for a notification
	const rules = (file: string, line?: number, xpath?: string) => InputRules.describe(file, line, xpath, undefined, 0);

	// as the debug adapter sends it: both orders by the order template, the first's id and its line only by the built-in
	// rule - each element by where its start tag ends
	const recorded = () => XsltNodeRules.update({
		rules: [{ path: file('node-rules.xsl'), line: 3, column: 3, label: 'xsl:template match="order"' }, { builtIn: 'text-only-copy', mode: '#default' }],
		names: ['element:order', 'attribute:id', 'element:line'],
		files: { [file('node-rules.xml')]: [4, 28, 2, 0, 0, 1, 1, 1, 1, 8, 18, 1, 0, 0, 1, 5, 38, 1, 2, 1, 1] }
	}, 'node rules');

	test('the file: how many elements each rule processed, and those only built-in rules did - with what that did', async () => {
		recorded();
		const result = (await rules(file('node-rules.xml')));
		assert.isFalse(result.isError, result.text);
		assert.match(result.text, /^Input .*node-rules\.xml, in the last run \(node rules\): 6 elements - 2 processed by .*, 1 only by built-in rules, 3 not selected by any\./);
		assert.match(result.text, /\n {2}match="order" - .*node-rules\.xsl:3: 2 elements/);
		assert.match(result.text, /\n {2}\/orders\/order\[1\]\/line \(line 5\): built-in rule \(text-only-copy\) - no template matched - its text is copied to the output as it is/);
		// the elements nothing selected - each where the chain starts: the root, and those whose parent a template processed
		assert.match(result.text, /\nNot selected by any - .*\n {2}\/orders \(line 2\)\n {2}\/orders\/order\[1\]\/note \(line 6\)\n {2}\/orders\/order\[2\]\/line \(line 8\)\n/);
	});

	test('an element, by its path or its line: what processed it and its attributes - or one of them', async () => {
		recorded();
		const byPath = (await rules(file('node-rules.xml'), undefined, '/orders/order[1]'));
		assert.isFalse(byPath.isError, byPath.text);
		assert.match(byPath.text, /^Input .*node-rules\.xml: \/orders\/order\[1\] \(line 3\), in the last run \(node rules\):/);
		assert.match(byPath.text, /\n {2}order: match="order" - .*node-rules\.xsl:3\n {2}@id: built-in rule \(text-only-copy\) - no template matched/);
		// by the line of its start tag - any line of it
		assert.strictEqual((await rules(file('node-rules.xml'), 4)).text, byPath.text);
		// an attribute of it
		const id = (await rules(file('node-rules.xml'), undefined, '/orders/order[1]/@id')).text;
		assert.include(id, '/orders/order[1]/@id (line 3)');
		assert.notInclude(id, 'match="order"');
		// only built-in rules
		assert.match((await rules(file('node-rules.xml'), 5)).text, /Only built-in rules processed it: .* its text is copied to the output as it is/);
	});

	test('built-in rules: an element listed with its descendants they processed too - not past an element a template processed', async () => {
		// as Saxon names the default built-in rule: text-only. /orders and its first order's id, line and note by it; the
		// first order by a template - so its line is listed on its own; the second order by it, with its line
		XsltNodeRules.update({
			rules: [{ path: file('node-rules.xsl'), line: 3, column: 3, label: 'xsl:template match="order"' }, { builtIn: 'text-only', mode: '#default' }],
			names: ['element:orders', 'element:order', 'element:line'],
			files: { [file('node-rules.xml')]: [2, 9, 1, 0, 1, 1, 4, 28, 1, 1, 0, 1, 5, 38, 1, 2, 1, 1, 8, 18, 1, 1, 1, 1, 8, 39, 1, 2, 1, 1] }
		}, 'node rules');
		const text = (await rules(file('node-rules.xml'))).text;
		assert.match(text, /\n {2}\/orders \(line 2\): built-in rule \(text-only\) - no template matched - its text is copied to the output as it is - and its 2 descendants\n/);
		assert.match(text, /\n {2}\/orders\/order\[1\]\/line \(line 5\): .* its text is copied to the output as it is\n/);
	});

	test('an element nothing selected: said so, with its nearest ancestor a rule processed', async () => {
		recorded();
		const note = (await rules(file('node-rules.xml'), undefined, '/orders/order[1]/note')).text;
		assert.include(note, 'No rule processed it');
		assert.match(note, /nearest ancestor processed by a rule: \/orders\/order\[1\] \(line 3\) - match="order"/);
	});

	test('errors: no run, a file it didn\'t record, a path not in the simple form or not there, a line out of range', async () => {
		assert.match((await rules(file('node-rules.xml'))).text, /No run recorded/);
		recorded();
		assert.match((await rules(file('node-rules-products.xml'))).text, /didn't record .*node-rules-products\.xml/);
		assert.match((await rules(file('node-rules.xml'), undefined, '//line')).text, /simple form .* evaluate_xpath/);
		assert.match((await rules(file('node-rules.xml'), undefined, '/orders/order[3]')).text, /No element \/orders\/order\[3\]/);
		assert.match((await rules(file('node-rules.xml'), 99)).text, /no line 99/);
		assert.match((await rules(file('node-rules.xml'), 1)).text, /No start tag on line 1/);
	});

	test('from a run without debugging - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const received = new Promise<void>((resolve) => {
			const listener = vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
				if (event.event === 'xsltNodeRules') {
					listener.dispose();
					// after the extension's own listener has stored it
					setTimeout(resolve, 100);
				}
			});
		});
		assert.isTrue(await vscode.debug.startDebugging(undefined, {
			type: XsltDebug.type, request: 'launch', name: 'input rules', noDebug: true, saxonJar, xsltFile: file('node-rules.xsl'), xmlSource: file('node-rules.xml')
		}, { noDebug: true }));
		await received;
		const summary = (await rules(file('node-rules.xml'))).text;
		assert.match(summary, /match="line" priority="2" - .*node-rules\.xsl:6: 2 elements/);
		// the root element: the mode's on-no-match="shallow-skip"
		assert.match(summary, /\n {2}\/orders \(line 2\): built-in rule \(shallow-skip\) - no template matched - it is skipped, and its content processed/);
		const line = (await rules(file('node-rules.xml'), undefined, '/orders/order[1]/line')).text;
		assert.match(line, /\n {2}line:\n {4}match="line" priority="2" - .*node-rules\.xsl:6\n {4}match="line" - .*node-rules\.xsl:11/);
		assert.match(line, /\n {2}@product: match="@product" mode="attr" - .*node-rules\.xsl:14/);
		assert.match(line, /\n {2}text\(\): match="text\(\)\[normalize-space\(\)\]"/);
		// a file read with doc() is recorded too
		assert.match((await rules(file('node-rules-products.xml'))).text, /match="product"/);
	});

	test('no run of the input: the user is asked to run the stylesheet - and declines, doesn\'t answer, or runs it - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const savedJar = tasks.inspect<string>('saxonJar')?.globalValue;
		await tasks.update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		const prompt = RunRequest.prompt;
		const asked: string[] = [];
		// no XML context file - as another test may leave it: the input asked about is the run's source all the same
		const context = await DocumentChangeHandler.contextFor(undefined);
		DocumentChangeHandler.setLastPicked(null, true);
		try {
			// declined: answered at once, with the stylesheet named
			RunRequest.prompt = async (message) => { asked.push(message); return 'Not Now'; };
			let result = await InputRules.describe(file('node-rules.xml'), undefined, undefined, file('node-rules.xsl'), 30);
			assert.match(asked[0], /^An AI assistant asks for a run of node-rules\.xsl on node-rules\.xml, to see which templates processed its input: there's no run of it/);
			assert.match(result.text, /No run recorded[\s\S]*The user chose not to run it now/);
			// no answer in time
			RunRequest.prompt = () => new Promise<string | undefined>(() => undefined);
			result = await InputRules.describe(file('node-rules.xml'), undefined, undefined, file('node-rules.xsl'), 1);
			assert.match(result.text, /No run finished in time/);
			// run: the tool waits for it, then answers from it
			RunRequest.prompt = async () => RunRequest.runChoice;
			result = await InputRules.describe(file('node-rules.xml'), undefined, '/orders/order[1]/line', file('node-rules.xsl'), 60);
			assert.match(result.text, /^It was run just now, for you, with the user's permission\.\n\nInput .*node-rules\.xml: \/orders\/order\[1\]\/line/);
			assert.match(result.text, /match="line" priority="2"/);
			// the result in the temporary files - not asked for, as Quick Run would - and nothing written beside the stylesheet
			assert.isTrue(fs.existsSync(RunRequest.resultPath(file('node-rules.xsl'))), RunRequest.resultPath(file('node-rules.xsl')));
			assert.include(RunRequest.resultPath(file('node-rules.xsl')), path.join(os.tmpdir(), 'xslt-xpath', 'assistant-run'));
			// the last run's stylesheet is used by default - and asked about again once it has changed since
			asked.length = 0;
			RunRequest.prompt = async (message) => { asked.push(message); return 'Not Now'; };
			assert.notMatch((await InputRules.describe(file('node-rules.xml'), undefined, undefined, undefined, 30)).text, /chose not to/);
			assert.lengthOf(asked, 0);
			const later = new Date(Date.now() + 5000);
			fs.utimesSync(file('node-rules.xsl'), later, later);
			result = await InputRules.describe(file('node-rules.xml'), undefined, undefined, undefined, 30);
			assert.match(asked[0], /node-rules\.xsl has changed since the last run/);
			assert.match(result.text, /The user chose not to run it now \(node-rules\.xsl has changed since the last run\)/);
			// 'Always Run for This Workspace': run - and then not asked again, until the user says to ask
			RunRequest.prompt = async (message) => { asked.push(message); return RunRequest.alwaysChoice; };
			asked.length = 0;
			result = await InputRules.describe(file('node-rules.xml'), undefined, undefined, undefined, 60);
			assert.lengthOf(asked, 1);
			assert.match(result.text, /^It was run just now/);
			const later2 = new Date(Date.now() + 10000);
			fs.utimesSync(file('node-rules.xsl'), later2, later2);
			result = await InputRules.describe(file('node-rules.xml'), undefined, undefined, undefined, 60);
			assert.lengthOf(asked, 1, 'not asked again');
			assert.match(result.text, /^It was run just now/);
			await vscode.commands.executeCommand('xslt-xpath.askBeforeAssistantRuns');
			assert.strictEqual(RunRequest.policy(), 'ask');
			// never: not asked, and the assistant is told
			const later3 = new Date(Date.now() + 15000);
			fs.utimesSync(file('node-rules.xsl'), later3, later3);
			await vscode.workspace.getConfiguration('XSLT.mcp').update('runForAssistant', 'never', vscode.ConfigurationTarget.Global);
			asked.length = 0;
			result = await InputRules.describe(file('node-rules.xml'), undefined, undefined, undefined, 30);
			assert.lengthOf(asked, 0);
			assert.match(result.text, /Runs for an assistant are turned off by the user/);
		} finally {
			await vscode.workspace.getConfiguration('XSLT.mcp').update('runForAssistant', undefined, vscode.ConfigurationTarget.Global);
			await RunRequest.askAgain();
			DocumentChangeHandler.setLastPicked(context.uri, context.isNone);
			RunRequest.prompt = prompt;
			await tasks.update('saxonJar', savedJar, vscode.ConfigurationTarget.Global);
			const ours = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath.startsWith(folder));
			await vscode.window.tabGroups.close(ours);
		}
	});
});
