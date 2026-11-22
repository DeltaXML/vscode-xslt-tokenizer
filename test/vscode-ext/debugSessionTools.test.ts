/**
 * Test suite for the MCP tools debug_status and debug_evaluate: read-only access to the user's XSLT debug session - where
 * it's paused, the call stack, a frame's variables and context, and XPath evaluated in a frame. Needs a real Saxon jar,
 * in XSLT_TEST_SAXON_JAR, for a session.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { assert } from 'chai';
import { XsltDebug } from '../../src/xsltDebug';
import { DebugSessionTools } from '../../src/mcp/debugSessionTools';

const fixtures = path.resolve(__dirname, '..', '..', '..', 'debugger', 'test');

suite('MCP tools debug_status and debug_evaluate: the user\'s paused debug session', function () {
	this.timeout(60000);

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	teardown(() => {
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
	});

	test('no session: said so, with what to ask the user', async () => {
		const status = await DebugSessionTools.status();
		assert.isFalse(status.isError);
		assert.match(status.text, /^No XSLT debug session .* trace_configuration/);
		const evaluated = await DebugSessionTools.evaluate('1');
		assert.isTrue(evaluated.isError);
		assert.match(evaluated.text, /No XSLT debug session - debug_evaluate needs one paused/);
	});

	test('paused at a breakpoint: waited for, the call stack, the frame\'s variables and context - and XPath evaluated there - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const xsltUri = vscode.Uri.file(path.join(fixtures, 'basic.xsl'));
		vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(xsltUri, new vscode.Position(11, 0)), true, '$doubled = 4')]);
		const name = 'debug session tools';
		const ended = new Promise<void>((resolve) => {
			const listener = vscode.debug.onDidTerminateDebugSession((session) => {
				if (session.name === name) {
					listener.dispose();
					resolve();
				}
			});
		});
		assert.isTrue(await vscode.debug.startDebugging(undefined, {
			type: XsltDebug.type, request: 'launch', name, saxonJar, xsltFile: xsltUri.fsPath, xmlSource: path.join(fixtures, 'basic.xml')
		}));
		// waits for the pause
		const status = await DebugSessionTools.status(30);
		assert.isFalse(status.isError, status.text);
		const text = status.text;
		assert.match(text, /^Debug session 'debug session tools' \(.*basic\.xsl\): paused at .*basic\.xsl:12/);
		assert.match(text, /\n {2}0 xsl:template match="item" - .*basic\.xsl:12\n/);
		assert.match(text, /\n {2}Locals:\n {4}\$doubled = 4/);
		assert.match(text, /\n {2}Context:\n {4}\. = .*\/items\/item\[2\]/);
		assert.notMatch(text, /\$greeting = /, 'globals aren\'t listed');
		// a global, with its entries
		const config = await DebugSessionTools.evaluate('$config');
		assert.isFalse(config.isError, config.text);
		assert.match(config.text, /^\$config in frame 0 \(xsl:template match="item"\)\n {2}= \{'a': 1, 'b': \[1, 2\]\}/);
		assert.match(config.text, /\n {4}'b' = \[1, 2\]/);
		assert.match((await DebugSessionTools.evaluate('string(@n) || "!"')).text, /= '2!'/);
		// an error, and a frame that isn't there
		const error = await DebugSessionTools.evaluate('$nope');
		assert.isTrue(error.isError);
		assert.match(error.text, /error: /);
		assert.isTrue((await DebugSessionTools.status(0, 9)).isError);
		const session = vscode.debug.activeDebugSession!;
		await session.customRequest('continue', { threadId: 1 });
		await ended;
		assert.match((await DebugSessionTools.status()).text, /^No XSLT debug session/);
	});
});
