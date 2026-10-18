/**
 * Test suite for the SaxonJ step-through debugger ('xslt-saxon' debug configurations)
 *
 * A debug configuration has the same properties as an 'xslt' task, or names a task in tasks.json whose properties
 * it uses ('task'), and runs Saxon with the same command-line options as that task - less those for tracing and
 * timing, which the debugger's own tracing replaces. Saxon 12 or later is needed.
 *
 * The end-to-end tests run a real debug session (the Java debug adapter) - only when XSLT_TEST_SAXON_JAR is set to
 * a Saxon jar path, e.g. XSLT_TEST_SAXON_JAR=~/opt/SaxonHE13-0J/saxon-he-13.0.jar npm test
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { assert } from 'chai';
import { SaxonTaskProvider, XSLTTask } from '../../src/saxonTaskProvider';
import { XsltDebug } from '../../src/xsltDebug';

const fixtures = path.resolve(__dirname, '..', '..', '..', 'debugger', 'test');

suite('XSLT debugger - configurations', () => {
	suiteSetup(() => {
		// tasks locate the bundled xslt-resources jars
		SaxonTaskProvider.extensionURI ??= vscode.Uri.file(path.resolve(__dirname, '..', '..', '..'));
	});

	test('Saxon major version from the jar file name or folder', () => {
		assert.strictEqual(XsltDebug.saxonMajorVersion('/opt/SaxonHE13-0J/saxon-he-13.0.jar'), 13);
		assert.strictEqual(XsltDebug.saxonMajorVersion('/usr/local/java/SaxonPE12-4J/saxon-pe-12.4.jar'), 12);
		assert.strictEqual(XsltDebug.saxonMajorVersion('C:\\lib\\Saxon-HE-12.9.jar'), 12);
		assert.strictEqual(XsltDebug.saxonMajorVersion('/opt/saxon/saxon9he.jar'), 9);
		assert.strictEqual(XsltDebug.saxonMajorVersion('/opt/SaxonEE10-5J/saxon.jar'), 10);
		assert.isUndefined(XsltDebug.saxonMajorVersion('/opt/lib/saxon.jar'));
	});

	test('a configuration needs xsltFile and saxonJar, and Saxon 12 or later', () => {
		const config = { type: XsltDebug.type, request: 'launch', name: 'test' };
		assert.match(XsltDebug.configurationProblem({ ...config, saxonJar: '/opt/saxon-he-13.0.jar' })!, /no 'xsltFile'/);
		assert.match(XsltDebug.configurationProblem({ ...config, xsltFile: 'a.xsl' })!, /XSLT\.tasks\.saxonJar/);
		assert.match(XsltDebug.configurationProblem({ ...config, xsltFile: 'a.xsl', saxonJar: '/opt/SaxonPE11-5J/saxon-pe-11.5.jar' })!, /Saxon 12 or later/);
		assert.isUndefined(XsltDebug.configurationProblem({ ...config, xsltFile: 'a.xsl', saxonJar: '/opt/SaxonPE12-4J/saxon-pe-12.4.jar' }));
		// unknown versions are tried
		assert.isUndefined(XsltDebug.configurationProblem({ ...config, xsltFile: 'a.xsl', saxonJar: '/opt/lib/saxon.jar' }));
	});

	test("a 'task' configuration takes the task's properties as defaults", () => {
		const tasks = [
			{ type: 'xslt-js', label: 'report', xsltFile: 'js.xsl', xmlSource: 'js.xml' },
			{ type: 'xslt', label: 'report', saxonJar: '${config:XSLT.tasks.saxonJar}', xsltFile: 'report.xsl', xmlSource: 'books.xml', parameters: [{ name: 'p', value: '1' }], group: { kind: 'build' } },
		];
		const resolved = XsltDebug.withTaskProperties({ type: XsltDebug.type, request: 'launch', name: 'Debug report', task: 'report', xmlSource: 'other.xml' }, tasks);
		assert.deepStrictEqual(resolved, {
			saxonJar: '${config:XSLT.tasks.saxonJar}', xsltFile: 'report.xsl', xmlSource: 'other.xml', parameters: [{ name: 'p', value: '1' }],
			type: XsltDebug.type, request: 'launch', name: 'Debug report', task: 'report'
		});
		assert.match(<string>XsltDebug.withTaskProperties({ type: XsltDebug.type, request: 'launch', name: 'x', task: 'missing' }, tasks), /no 'xslt' task labelled 'missing'/);
	});

	test('runs Saxon with the task options, less tracing, timing and the message-escaping AltTransform', () => {
		const task = <XSLTTask><unknown>{
			type: 'xslt', label: 'report', saxonJar: '/opt/SaxonPE13-1J/saxon-pe-13.1.jar', xsltFile: 'report.xsl', xmlSource: 'books.xml',
			resultPath: 'out.xml', initialMode: 'm', messageEscaping: 'adaptive', traceListener: '', timing: 'on', TPfilename: 'p.html', execute: false,
			parameters: [{ name: 'p', value: '1' }], features: [{ name: 'xsltSchemaAware', value: 'false' }], classPathEntries: ['/opt/ext.jar']
		};
		const forTask = SaxonTaskProvider.commandLine(task, false);
		assert.strictEqual(forTask.mainClass, 'com.deltaxml.saxon.perf.AltTransform');
		assert.includeMembers(forTask.args, ['-T', '-t', '-TP:p.html', '-nogo']);

		const forDebug = SaxonTaskProvider.commandLine(task, true);
		assert.strictEqual(forDebug.mainClass, 'net.sf.saxon.Transform');
		assert.deepStrictEqual(forDebug.classPath, ['/opt/SaxonPE13-1J/saxon-pe-13.1.jar', '/opt/ext.jar']);
		assert.deepStrictEqual(forDebug.args, ['-xsl:report.xsl', '-s:books.xml', '-o:out.xml', '-im:m', '--allowSyntaxExtensions:on', '--xsltSchemaAware:false', 'p=1']);
	});
});

suite('XSLT debugger - debug sessions', function () {
	this.timeout(60000);
	const saxonJar = process.env.XSLT_TEST_SAXON_JAR;

	// the adapter's 'stopped' events, and the stack trace when each occurred
	let stops: { session: vscode.DebugSession; reason: string }[] = [];
	let onStop: (() => void) | undefined;
	const trackers: vscode.Disposable[] = [];

	suiteSetup(function () {
		if (!saxonJar) {
			this.skip();
		}
		trackers.push(vscode.debug.registerDebugAdapterTrackerFactory(XsltDebug.type, {
			createDebugAdapterTracker: (session) => ({
				onDidSendMessage: (message: any) => {
					if (message.type === 'event' && message.event === 'stopped') {
						stops.push({ session, reason: message.body.reason });
						onStop?.();
					}
				}
			})
		}));
	});

	suiteTeardown(() => {
		trackers.forEach((t) => t.dispose());
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
	});

	const nextStop = () => new Promise<{ session: vscode.DebugSession; reason: string }>((resolve) => {
		const check = () => {
			if (stops.length > 0) {
				onStop = undefined;
				resolve(stops.shift()!);
			}
		};
		onStop = check;
		check();
	});

	const terminated = (name: string) => new Promise<void>((resolve) => {
		const listener = vscode.debug.onDidTerminateDebugSession((session) => {
			if (session.name === name) {
				listener.dispose();
				resolve();
			}
		});
	});

	test('stops at a breakpoint, shows variables, evaluates XPath and steps into a function', async () => {
		stops = [];
		const xsltUri = vscode.Uri.file(path.join(fixtures, 'basic.xsl'));
		vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(xsltUri, new vscode.Position(11, 0)), true, '$doubled = 4')]);
		const name = 'debug basic.xsl';
		const ended = terminated(name);
		const started = await vscode.debug.startDebugging(undefined, {
			type: XsltDebug.type, request: 'launch', name, saxonJar, xsltFile: xsltUri.fsPath, xmlSource: path.join(fixtures, 'basic.xml')
		});
		assert.isTrue(started);

		let stop = await nextStop();
		assert.strictEqual(stop.reason, 'breakpoint');
		const session = stop.session;
		let { stackFrames } = await session.customRequest('stackTrace', { threadId: 1 });
		assert.strictEqual(stackFrames[0].line, 12);
		assert.strictEqual(stackFrames[0].name, 'xsl:template match="item"');

		const { scopes } = await session.customRequest('scopes', { frameId: stackFrames[0].id });
		assert.deepStrictEqual(scopes.map((s: any) => s.name), ['Locals', 'Context', 'Globals']);
		const { variables } = await session.customRequest('variables', { variablesReference: scopes[0].variablesReference });
		assert.deepInclude(variables.map((v: any) => [v.name, v.value]), ['$doubled', '4']);
		const evaluated = await session.customRequest('evaluate', { expression: 'string(@n) || "!"', frameId: stackFrames[0].id, context: 'watch' });
		assert.strictEqual(evaluated.result, '"2!"');

		do {
			await session.customRequest('stepIn', { threadId: 1 });
			stop = await nextStop();
			({ stackFrames } = await session.customRequest('stackTrace', { threadId: 1 }));
		} while (stackFrames[0].name !== 'f:square#1');
		assert.strictEqual(stop.reason, 'step');

		await session.customRequest('continue', { threadId: 1 });
		await ended;
	});

	test("the 'Debug Stylesheet' command: the active stylesheet, from xsl:initial-template with no XML context file", async () => {
		stops = [];
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		try {
			await vscode.window.showTextDocument(vscode.Uri.file(path.join(fixtures, 'error.xsl')));
			const ended = new Promise<vscode.DebugSession>((resolve) => {
				const listener = vscode.debug.onDidTerminateDebugSession((session) => {
					listener.dispose();
					resolve(session);
				});
			});
			await vscode.commands.executeCommand('xslt-xpath.debugXslt');
			const session = await ended;
			assert.strictEqual(session.type, XsltDebug.type);
			assert.include(session.configuration.saxonArgs, '-it');
			assert.notOk(session.configuration.resultPath);
		} finally {
			await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
