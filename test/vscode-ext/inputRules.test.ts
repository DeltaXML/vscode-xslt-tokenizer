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

	// as the debug adapter sends it: both orders by the order template, the first's id and its line only by the built-in
	// rule - each element by where its start tag ends
	const recorded = () => XsltNodeRules.update({
		rules: [{ path: file('node-rules.xsl'), line: 3, column: 3, label: 'xsl:template match="order"' }, { builtIn: 'text-only-copy', mode: '#default' }],
		names: ['element:order', 'attribute:id', 'element:line'],
		files: { [file('node-rules.xml')]: [4, 28, 2, 0, 0, 1, 1, 1, 1, 8, 18, 1, 0, 0, 1, 5, 38, 1, 2, 1, 1] }
	}, 'node rules');

	test('the file: how many elements each rule processed, and those only built-in rules did - with what that did', () => {
		recorded();
		const result = InputRules.describe(file('node-rules.xml'));
		assert.isFalse(result.isError, result.text);
		assert.match(result.text, /^Input .*node-rules\.xml, in the last run \(node rules\): 6 elements - 2 processed by .*, 1 only by built-in rules, 3 not selected by any\./);
		assert.match(result.text, /\n {2}match="order" - .*node-rules\.xsl:3: 2 elements/);
		assert.match(result.text, /\n {2}\/orders\/order\[1\]\/line \(line 5\): built-in rule \(text-only-copy\) - no template matched - its text is copied to the output as it is/);
	});

	test('an element, by its path or its line: what processed it and its attributes - or one of them', () => {
		recorded();
		const byPath = InputRules.describe(file('node-rules.xml'), undefined, '/orders/order[1]');
		assert.isFalse(byPath.isError, byPath.text);
		assert.match(byPath.text, /^Input .*node-rules\.xml: \/orders\/order\[1\] \(line 3\), in the last run \(node rules\):/);
		assert.match(byPath.text, /\n {2}order: match="order" - .*node-rules\.xsl:3\n {2}@id: built-in rule \(text-only-copy\) - no template matched/);
		// by the line of its start tag - any line of it
		assert.strictEqual(InputRules.describe(file('node-rules.xml'), 4).text, byPath.text);
		// an attribute of it
		const id = InputRules.describe(file('node-rules.xml'), undefined, '/orders/order[1]/@id').text;
		assert.include(id, '/orders/order[1]/@id (line 3)');
		assert.notInclude(id, 'match="order"');
		// only built-in rules
		assert.match(InputRules.describe(file('node-rules.xml'), 5).text, /Only built-in rules processed it: .* its text is copied to the output as it is/);
	});

	test('an element nothing selected: said so, with its nearest ancestor a rule processed', () => {
		recorded();
		const note = InputRules.describe(file('node-rules.xml'), undefined, '/orders/order[1]/note').text;
		assert.include(note, 'No rule processed it');
		assert.match(note, /nearest ancestor processed by a rule: \/orders\/order\[1\] \(line 3\) - match="order"/);
	});

	test('errors: no run, a file it didn\'t record, a path not in the simple form or not there, a line out of range', () => {
		assert.match(InputRules.describe(file('node-rules.xml')).text, /No run recorded/);
		recorded();
		assert.match(InputRules.describe(file('node-rules-products.xml')).text, /didn't record .*node-rules-products\.xml/);
		assert.match(InputRules.describe(file('node-rules.xml'), undefined, '//line').text, /simple form .* evaluate_xpath/);
		assert.match(InputRules.describe(file('node-rules.xml'), undefined, '/orders/order[3]').text, /No element \/orders\/order\[3\]/);
		assert.match(InputRules.describe(file('node-rules.xml'), 99).text, /no line 99/);
		assert.match(InputRules.describe(file('node-rules.xml'), 1).text, /No start tag on line 1/);
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
		const summary = InputRules.describe(file('node-rules.xml')).text;
		assert.match(summary, /match="line" priority="2" - .*node-rules\.xsl:6: 2 elements/);
		// the root element: the mode's on-no-match="shallow-skip"
		assert.match(summary, /\n {2}\/orders \(line 2\): built-in rule \(shallow-skip\) - no template matched - it is skipped, and its content processed/);
		const line = InputRules.describe(file('node-rules.xml'), undefined, '/orders/order[1]/line').text;
		assert.match(line, /\n {2}line:\n {4}match="line" priority="2" - .*node-rules\.xsl:6\n {4}match="line" - .*node-rules\.xsl:11/);
		assert.match(line, /\n {2}@product: match="@product" mode="attr" - .*node-rules\.xsl:14/);
		assert.match(line, /\n {2}text\(\): match="text\(\)\[normalize-space\(\)\]"/);
		// a file read with doc() is recorded too
		assert.match(InputRules.describe(file('node-rules-products.xml')).text, /match="product"/);
	});
});
