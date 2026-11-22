/**
 * Test suite for the MCP tool output_origin: for a line of a stylesheet's output, or text in it, the instruction that
 * wrote each part, its template or function, and the input node it was written for - from the outputs of the last debug
 * session, as the debugger's output view maps them. With a real Saxon jar, in XSLT_TEST_SAXON_JAR, also from a run.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltDebug, XsltDebugOutputs, XsltOutputLocation } from '../../src/xsltDebug';
import { OutputOrigin } from '../../src/mcp/outputOrigin';

const stylesheet = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="order" mode="summary">
    <report>
      <made><xsl:value-of select="@id"/></made>
      <literal>first line
second line</literal>
    </report>
  </xsl:template>
</xsl:stylesheet>`;

const output = `<report>
   <made>A1</made>
   <literal>first line
second line</literal>
</report>`;

const input = '<orders>\n  <order id="X0"/>\n  <order id="A1"\n    date="x">\n  </order>\n</orders>';

// as the adapter sends them: each part's offset and location id - a start tag's '>' with the next event's text
const parts: [string, number][] = [['<report>\n   ', 0], ['<made', 1], ['>A1', 2], ['</made>\n   ', 1], ['<literal', 3], ['>first line\nsecond line', 4], ['</literal>\n', 3], ['</report>', 0]];
const runs: number[] = [];
let offset = 0;
parts.forEach(([text, id]) => {
	runs.push(offset, id);
	offset += text.length;
});

function locations(file: string): XsltOutputLocation[] {
	return [
		{ id: 0, path: file, line: 3, column: 5, kind: 'instruction' },
		{ id: 1, path: file, line: 4, column: 7, kind: 'instruction' },
		{ id: 2, path: file, line: 4, column: 13, kind: 'instruction' },
		{ id: 3, path: file, line: 5, column: 7, kind: 'instruction' },
		{ id: 4, path: file, line: 6, column: 12, kind: 'text' }
	];
}

suite('MCP tool output_origin: where a part of the output came from', function () {
	this.timeout(60000);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'output-origin-'));
	const file = path.join(dir, 'report.xsl');
	const inputFile = path.join(dir, 'orders.xml');
	fs.writeFileSync(file, stylesheet);
	fs.writeFileSync(inputFile, input);
	const debugSettings = vscode.workspace.getConfiguration('XSLT.debug');
	const openOutput = debugSettings.inspect<boolean>('openOutput')?.globalValue;

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		await debugSettings.update('openOutput', false, vscode.ConfigurationTarget.Global);
	});

	suiteTeardown(async () => {
		XsltDebugOutputs.get().startSession();
		await debugSettings.update('openOutput', openOutput, vscode.ConfigurationTarget.Global);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	// the output, as an update from the adapter: <made> and its content written for the second order (input 0)
	const recorded = (method = 'xml') => {
		XsltDebugOutputs.get().startSession();
		const inputRuns = [0, -1, output.indexOf('<made'), 0, output.indexOf('</made>') + '</made>'.length, -1];
		XsltDebugOutputs.get().update({ outputs: [{ name: 'result.xml', method, offset: 0, text: output, runs, locations: locations(file),
			inputRuns, inputs: [0, 4, 14, 0], inputFiles: [inputFile], inputNodes: ['element:order'], uri: vscode.Uri.file(path.join(dir, 'out', 'result.xml')).toString() }] });
	};

	test('a line: each part - the instruction that wrote it, its template with its mode, and the input node as an XPath', async () => {
		recorded();
		const result = await OutputOrigin.describe(undefined, 2);
		assert.isFalse(result.isError, result.text);
		const text = result.text;
		assert.match(text, /^Output result\.xml \(.*\), line 2: <made>A1<\/made>/);
		// the start tag, by the literal result element; the value, by xsl:value-of - each in the template, for the order
		assert.match(text, /\n\n<made\n {2}written by: .*report\.xsl:4 {2}<made>\n {2}in: xsl:template match="order" mode="summary" \(line 2\)\n {2}input: \/orders\/order\[2\] - .*orders\.xml:3/);
		assert.match(text, /\n\nA1\n {2}written by: .*report\.xsl:4 {2}<xsl:value-of select="@id"\/>/);
		assert.include(text, 'evaluate_xpath');
	});

	test('text in the output: found, and its occurrence - literal text from the stylesheet', async () => {
		recorded();
		const result = await OutputOrigin.describe(undefined, undefined, 'second line');
		assert.isFalse(result.isError, result.text);
		assert.match(result.text, /line 4: second line<\/literal>/);
		assert.match(result.text, /literal text in the stylesheet: .*report\.xsl:6/);
		// not written for an input node
		assert.notInclude(result.text, 'input:');
		assert.isTrue((await OutputOrigin.describe(undefined, undefined, 'line', 3)).isError);
		assert.match((await OutputOrigin.describe(undefined, undefined, 'line', 2)).text, /line 4:/);
	});

	test('the outputs listed - with no line or text; an output by its name or the file it was written to', async () => {
		recorded();
		const listed = await OutputOrigin.describe();
		assert.isFalse(listed.isError);
		assert.match(listed.text, /result\.xml - xml, 5 lines - written to .*result\.xml/);
		assert.isFalse((await OutputOrigin.describe('result.xml', 1)).isError);
		assert.isFalse((await OutputOrigin.describe(path.join(dir, 'out', 'result.xml'), 1)).isError);
		const unknown = await OutputOrigin.describe('other.xml', 1);
		assert.isTrue(unknown.isError);
		assert.match(unknown.text, /No output 'other\.xml'.*\n {2}result\.xml/);
	});

	test('errors: no outputs, a line out of range, text not found, and an output that isn\'t XML', async () => {
		XsltDebugOutputs.get().startSession();
		const none = await OutputOrigin.describe(undefined, 1);
		assert.isTrue(none.isError);
		assert.match(none.text, /Run Without Debugging/);
		recorded();
		assert.match((await OutputOrigin.describe(undefined, 9)).text, /has 5 lines - no line 9/);
		assert.isTrue((await OutputOrigin.describe(undefined, undefined, 'missing')).isError);
		recorded('json');
		const json = await OutputOrigin.describe(undefined, 1);
		assert.isTrue(json.isError);
		assert.match(json.text, /only XML output/);
	});

	// with a real Saxon jar: the outputs of a Run Without Debugging
	test('from a run without debugging - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const fixtures = path.resolve(__dirname, '..', '..', '..', 'debugger', 'test');
		const name = 'output origin run';
		const ended = new Promise<void>((resolve) => {
			const listener = vscode.debug.onDidTerminateDebugSession((session) => {
				if (session.name === name) {
					listener.dispose();
					resolve();
				}
			});
		});
		assert.isTrue(await vscode.debug.startDebugging(undefined, { type: XsltDebug.type, request: 'launch', name, noDebug: true, saxonJar,
			xsltFile: path.join(fixtures, 'outputs.xsl'), xmlSource: path.join(fixtures, 'basic.xml'), resultPath: path.join(dir, 'run', 'result.xml') }));
		await ended;
		const result = await OutputOrigin.describe('result.xml', undefined, '<row n="2"');
		assert.isFalse(result.isError, result.text);
		assert.match(result.text, /written by: .*outputs\.xsl:9 {2}<row n="\{@n\}">/);
		assert.include(result.text, 'in: xsl:template match="/" (line 3)');
		assert.match(result.text, /input: \/items\/item\[2\] - .*basic\.xml:3/);
		// the XML declaration: from the serializer
		assert.match((await OutputOrigin.describe('result.xml', 1)).text, /<\?xml version.*\n {2}the XML declaration, written by the serializer \(xsl:output\)/);
	});
});
