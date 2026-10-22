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
import * as os from 'os';
import * as fs from 'fs';
import * as cp from 'child_process';
import { XsltDebug, XsltDebugAdapterProcess, XsltDebugLog, XsltDebugOutputs, XsltDebugProblems } from '../../src/xsltDebug';
import { unquotedPath, unquotedPaths } from '../../src/settingPaths';

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

	test('configurations without a launch.json: the active stylesheet, then each xslt task', () => {
		const tasks = [
			{ type: 'xslt', label: 'report' },
			{ type: 'xslt-js', label: 'js report' },
			{ type: 'xslt', label: 'report' },
			{ type: 'xslt', label: 'summary' },
		];
		assert.deepStrictEqual(XsltDebug.providedConfigurations(tasks), [
			{ type: XsltDebug.type, request: 'launch', name: 'Debug Active Stylesheet', quickRun: true },
			{ type: XsltDebug.type, request: 'launch', name: 'Debug report', task: 'report' },
			{ type: XsltDebug.type, request: 'launch', name: 'Debug summary', task: 'summary' },
		]);
	});

	test('hovering: the whole variable reference, or the name in a variable declaration', () => {
		const select = '<xsl:if test="$total ge $discount-threshold and $f:rate-2 gt 0">';
		// the word pattern would give 'discount' or 'threshold'
		assert.strictEqual(XsltDebug.variableAt(select, select.indexOf('threshold'))?.expression, '$discount-threshold');
		assert.strictEqual(XsltDebug.variableAt(select, select.indexOf('discount'))?.expression, '$discount-threshold');
		assert.strictEqual(XsltDebug.variableAt(select, select.indexOf('$total'))?.expression, '$total');
		assert.strictEqual(XsltDebug.variableAt(select, select.indexOf('rate'))?.expression, '$f:rate-2');
		assert.isUndefined(XsltDebug.variableAt(select, select.indexOf('test')));
		assert.isUndefined(XsltDebug.variableAt(select, select.indexOf(' ge ') + 2));
		const declaration = '  <xsl:param name="discount-rate" as="xs:decimal" select="0.1"/>';
		assert.deepStrictEqual(XsltDebug.variableAt(declaration, declaration.indexOf('rate')), { start: 19, end: 32, expression: '$discount-rate' });
		assert.isUndefined(XsltDebug.variableAt(declaration, declaration.indexOf('decimal')));
		const template = '<xsl:template name="named">';
		assert.isUndefined(XsltDebug.variableAt(template, template.indexOf('named')));
	});

	test('inline values: the variables declared before the paused line, in scope there', () => {
		const text = [
			/* 1 */ '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">',
			/* 2 */ '  <xsl:variable name="global" select="1"/>',
			/* 3 */ '  <xsl:template match="item">',
			/* 4 */ '    <xsl:param name="p"',
			/* 5 */ '      select="2"/>',
			/* 6 */ '    <xsl:if test="@n">',
			/* 7 */ '      <xsl:variable name="inner" select="3"/>',
			/* 8 */ '    </xsl:if>',
			/* 9 */ '    <xsl:variable name="x" select="',
			/* 10 */ '      for $i at $pos in 1 to 3, $j in 2',
			/* 11 */ '      return fold-left($i, 0, function($acc as xs:integer, $n) {',
			/* 12 */ '        let $sum := $acc + $n, $t as xs:integer := 1',
			/* 13 */ '        return $sum + $j * $t',
			/* 14 */ '      })"/>',
			/* 15 */ '    <!-- <xsl:variable name="commented"/> -->',
			/* 16 */ '    <out a="{let $avt := 1 return $avt}">{$x}</out>',
			/* 17 */ '    <xsl:variable name="x" select="$x + 1"/>',
			/* 18 */ '    <xsl:sequence select="$x, $p"/>',
			/* 19 */ '  </xsl:template>',
			/* 20 */ '  <xsl:function name="f:f">',
			/* 21 */ '    <xsl:param name="a"/>',
			/* 22 */ '    <xsl:sequence select="$a"/>',
			/* 23 */ '  </xsl:function>',
			/* 24 */ '</xsl:stylesheet>'
		].join('\n');
		// at a 1-based line: the names, with the 1-based lines of their declarations
		const at = (line: number) => XsltDebug.inlineDeclarations(text, line - 1).map((d) => `${d.name}@${d.line + 1}`);
		// the template's param, but not the stylesheet's global variable
		assert.deepStrictEqual(at(6), ['$p@4']);
		// not a variable in an element that has ended
		assert.deepStrictEqual(at(9), ['$p@4']);
		// within the multi-line select: its for, 'at', inline function parameters, and let bindings
		assert.deepStrictEqual(at(12), ['$p@4', '$i@10', '$pos@10', '$j@10', '$acc@11', '$n@11']);
		assert.deepStrictEqual(at(13), ['$p@4', '$i@10', '$pos@10', '$j@10', '$acc@11', '$n@11', '$sum@12', '$t@12']);
		// after the select: only the variable, not the bindings within it - nor those in a comment or a completed AVT
		assert.deepStrictEqual(at(17), ['$p@4', '$x@9']);
		// a variable declared again: the later declaration
		assert.deepStrictEqual(at(18), ['$p@4', '$x@17']);
		assert.deepStrictEqual(at(22), ['$a@21']);
		// the range of the name
		const sum = XsltDebug.inlineDeclarations(text, 12).find((d) => d.name === '$sum')!;
		assert.strictEqual(text.split('\n')[sum.line].substring(sum.start, sum.end), '$sum');
		const p = XsltDebug.inlineDeclarations(text, 5).find((d) => d.name === '$p')!;
		assert.strictEqual(text.split('\n')[p.line].substring(p.start, p.end), 'p');
	});

	test('the notification at the end of a session: for a stylesheet with static errors, the first of them', () => {
		assert.strictEqual(XsltDebug.sessionEndMessage('report', 0, []), "Completed debug session: 'report'");
		assert.strictEqual(XsltDebug.sessionEndMessage('report', 2, []), "Debug session 'report' failed (exit code 2)");
		const error = { path: path.join('/ws', 'count.xsl'), line: 16, code: 'XTTE0570' };
		assert.strictEqual(XsltDebug.sessionEndMessage('report', 2, [error]),
			"XSLT debugger: the stylesheet has a static error, so it can't be debugged - XTTE0570 at line 16 of count.xsl (see the Problems view)");
		assert.strictEqual(XsltDebug.sessionEndMessage('report', 2, [error, { ...error, line: 20 }, { ...error, line: 30 }]),
			"XSLT debugger: the stylesheet has static errors, so it can't be debugged - XTTE0570 at line 16 of count.xsl, and 2 more (see the Problems view)");
	});

	test('why the debug adapter stopped, from the JVM\'s stderr', () => {
		assert.match(XsltDebugAdapterProcess.failureReason('Exception in thread "main" java.lang.NoClassDefFoundError: net/sf/saxon/om/Sequence', 1, '/opt/x.jar'),
			/Saxon's classes weren't found: check that '\/opt\/x.jar' is a Saxon jar/);
		assert.match(XsltDebugAdapterProcess.failureReason('java.lang.UnsupportedClassVersionError: net/sf/saxon/Transform has been compiled by a more recent version of the Java Runtime (class file version 61.0), this version of the Java Runtime only recognizes class file versions up to 55.0', 1, '/opt/s.jar'),
			/too old for the Saxon jar '\/opt\/s.jar' \(class file version 61.0\)/);
		assert.strictEqual(XsltDebugAdapterProcess.failureReason('boom\nline 2', 3, undefined), 'the debug adapter stopped unexpectedly (exit code 3): boom line 2');
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

	test("a Saxon jar path with quotes around it, as Windows Explorer's 'Copy as path' gives", () => {
		assert.strictEqual(unquotedPath('"C:\\Users\\A B\\saxon jar\\saxon-pe-13.1.jar"'), 'C:\\Users\\A B\\saxon jar\\saxon-pe-13.1.jar');
		assert.strictEqual(unquotedPath(' "/opt/saxon-he-13.0.jar" '), '/opt/saxon-he-13.0.jar');
		assert.strictEqual(unquotedPath('/opt/saxon-he-13.0.jar'), '/opt/saxon-he-13.0.jar');
		assert.isUndefined(unquotedPath(undefined));
		// e.g. the XSLT.tasks.saxonCLibraryPaths setting
		assert.deepStrictEqual(unquotedPaths(['"C:\\Saxon C\\lib"', 'C:\\other']), ['C:\\Saxon C\\lib', 'C:\\other']);
		assert.isUndefined(unquotedPaths(undefined));
		const task = <XSLTTask><unknown>{ type: 'xslt', label: 'quoted', saxonJar: '"C:\\saxon jar\\saxon-pe-13.1.jar"', xsltFile: 'a.xsl' };
		assert.deepStrictEqual(SaxonTaskProvider.commandLine(task, true).classPath, ['C:\\saxon jar\\saxon-pe-13.1.jar']);
	});
});

suite('XSLT debugger - Saxon\'s problems', () => {
	test('cleared for a file when it is edited - those of other files are kept', async () => {
		// the extension's handler for document changes
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		// os.tmpdir() on macOS is under /var, a symbolic link to /private/var: the adapter reports the resolved path
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-debug-problems-'));
		const edited = path.join(folder, 'edited.xsl');
		const other = path.join(folder, 'other.xsl');
		fs.writeFileSync(edited, '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>\n');
		fs.writeFileSync(other, '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>\n');
		XsltDebugProblems.clear();
		XsltDebugProblems.add(fs.realpathSync(edited), 1, 'XTTE0570', 'a type error', false);
		XsltDebugProblems.add(fs.realpathSync(other), 1, 'FOAR0001', 'division by zero', false);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(edited));
		const otherUri = vscode.Uri.file(fs.realpathSync(other));
		assert.strictEqual(XsltDebugProblems.get().get(vscode.Uri.file(fs.realpathSync(edited)))?.length, 1);

		const edit = new vscode.WorkspaceEdit();
		edit.insert(document.uri, new vscode.Position(0, 0), '<!-- fixed -->');
		await vscode.workspace.applyEdit(edit);
		// the change event can follow the edit
		const editedProblems = () => XsltDebugProblems.get().get(vscode.Uri.file(fs.realpathSync(edited)))?.length ?? 0;
		for (let i = 0; i < 50 && editedProblems() > 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.strictEqual(editedProblems(), 0);
		assert.strictEqual(XsltDebugProblems.get().get(otherUri)?.length, 1);
		XsltDebugProblems.clear();
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});
});

suite('XSLT debugger - sessions that fail to start', function () {
	this.timeout(30000);
	const fixture = path.join(fixtures, 'basic.xsl');
	// not a jar at all, but with a Saxon jar's name
	const notAJar = path.join(os.tmpdir(), 'xslt-debug-test', 'saxon-he-13.0.jar');

	suiteSetup(() => {
		fs.mkdirSync(path.dirname(notAJar), { recursive: true });
		fs.writeFileSync(notAJar, '');
	});

	const logged = (pattern: RegExp) => XsltDebugLog.messages.some((m) => pattern.test(m));
	// a session whose adapter fails before it responds isn't started (startDebugging gives false) - wait for the log
	const whenLogged = async (pattern: RegExp) => {
		for (let wait = 0; wait < 100 && !logged(pattern); wait++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return logged(pattern);
	};

	test("a Saxon jar that doesn't exist: not started, and logged", async () => {
		const started = await vscode.debug.startDebugging(undefined, { type: XsltDebug.type, request: 'launch', name: 'no jar', saxonJar: '/no/such/saxon-he-13.0.jar', xsltFile: fixture });
		assert.isFalse(started);
		assert.isTrue(logged(/'no jar' not started: .*the Saxon jar '\/no\/such\/saxon-he-13.0.jar' doesn't exist/));
	});

	test("Java not found: logged, and the session ends", async () => {
		XsltDebug.javaCommand = 'no-such-java-for-xslt-tests';
		try {
			await vscode.debug.startDebugging(undefined, { type: XsltDebug.type, request: 'launch', name: 'no java', saxonJar: notAJar, xsltFile: fixture });
			assert.isTrue(await whenLogged(/'no java': Java wasn't found: 'no-such-java-for-xslt-tests' isn't on the PATH/));
			assert.isUndefined(vscode.debug.activeDebugSession);
		} finally {
			XsltDebug.javaCommand = 'java';
		}
	});

	test("not a Saxon jar: the JVM's error is logged, and explained", async function () {
		if (cp.spawnSync('java', ['-version']).status !== 0) {
			this.skip();
		}
		await vscode.debug.startDebugging(undefined, { type: XsltDebug.type, request: 'launch', name: 'not saxon', saxonJar: notAJar, xsltFile: fixture });
		assert.isTrue(await whenLogged(/'not saxon': Saxon's classes weren't found/));
		assert.isTrue(logged(/NoClassDefFoundError: net\/sf\/saxon/));
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
		assert.deepStrictEqual(scopes.map((s: any) => s.name), ['Locals', 'Context', 'Globals', 'Output']);
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
		// the launch, in the 'XSLT Debugger' log
		assert.isTrue(XsltDebugLog.messages.some((m) => /'debug basic.xsl': java -cp .*xslt-debugger.jar/.test(m)));
		assert.isTrue(XsltDebugLog.messages.some((m) => /'debug basic.xsl': Saxon.*, on Java [\d.]+.*\n    Saxon options: .*-xsl:.*-T:com.deltaxml.xslt.debug.DebugTraceListener -opt:0/.test(m)));
	});

	// VS Code waits for a response to each request before it ends a session - up to 500ms
	test('stopping while paused: the session ends at once, with one stop', async () => {
		stops = [];
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		const xsltUri = vscode.Uri.file(path.join(fixtures, 'basic.xsl'));
		vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(xsltUri, new vscode.Position(11, 0)))]);
		const name = 'stop basic.xsl';
		const ended = terminated(name);
		assert.isTrue(await vscode.debug.startDebugging(undefined, {
			type: XsltDebug.type, request: 'launch', name, saxonJar, xsltFile: xsltUri.fsPath, xmlSource: path.join(fixtures, 'basic.xml')
		}));
		const stop = await nextStop();
		// as a user would: not within the moment after the pause when VS Code fetches the call stack
		await new Promise((resolve) => setTimeout(resolve, 300));
		const start = Date.now();
		await vscode.debug.stopDebugging(stop.session);
		const timedOut = new Promise<string>((resolve) => setTimeout(() => resolve('timed out'), 500));
		assert.strictEqual(await Promise.race([ended.then(() => 'ended'), timedOut]), 'ended', `not ended ${Date.now() - start}ms after one stop`);
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
	});

	test("a 'quickRun' configuration (as offered with no launch.json): the active stylesheet, with its task's settings", async () => {
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
			const started = await vscode.debug.startDebugging(undefined, { type: XsltDebug.type, request: 'launch', name: XsltDebug.quickRunConfigurationName, quickRun: true });
			assert.isTrue(started);
			// error.xsl's division by zero: paused there, then on to the end
			const stop = await nextStop();
			await stop.session.customRequest('continue', { threadId: 1 });
			const session = await ended;
			assert.strictEqual(path.basename(session.configuration.xsltFile), 'error.xsl');
			assert.include(session.configuration.saxonArgs, '-it');
		} finally {
			await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('a dynamic error: pauses there, and is in the Problems view', async () => {
		stops = [];
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		const xsltUri = vscode.Uri.file(path.join(fixtures, 'errors.xsl'));
		const name = 'debug errors.xsl';
		const ended = terminated(name);
		assert.isTrue(await vscode.debug.startDebugging(undefined, { type: XsltDebug.type, request: 'launch', name, saxonJar, xsltFile: xsltUri.fsPath, initialTemplate: '' }));
		const stop = await nextStop();
		// 'Dynamic Errors' is on by default
		assert.strictEqual(stop.reason, 'exception');
		const info = await stop.session.customRequest('exceptionInfo', { threadId: 1 });
		assert.strictEqual(info.exceptionId, 'FORG0001');
		await stop.session.customRequest('continue', { threadId: 1 });
		await ended;
		const problems = XsltDebugProblems.get().get(xsltUri) ?? [];
		assert.deepStrictEqual(problems.map((d) => [d.code, d.range.start.line, d.severity]), [['FORG0001', 10, vscode.DiagnosticSeverity.Error]]);
		assert.match(problems[0].message, /Cannot convert string "abc" to xs:decimal/);
	});

	test('the output so far: opened at the first pause with output, in the language of its output method', async () => {
		stops = [];
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		const xsltUri = vscode.Uri.file(path.join(fixtures, 'outputs.xsl'));
		vscode.debug.addBreakpoints([9, 14].map((line) => new vscode.SourceBreakpoint(new vscode.Location(xsltUri, new vscode.Position(line - 1, 0)))));
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-debug-out-'));
		const name = 'debug outputs.xsl';
		const ended = terminated(name);
		assert.isTrue(await vscode.debug.startDebugging(undefined, { type: XsltDebug.type, request: 'launch', name, saxonJar, xsltFile: xsltUri.fsPath,
			xmlSource: path.join(fixtures, 'basic.xml'), resultPath: path.join(outDir, 'result.xml') }));
		// the 1st row: nothing written yet; the 2nd: the 1st row
		for (let i = 0; i < 2; i++) {
			const stop = await nextStop();
			await stop.session.customRequest('continue', { threadId: 1 });
		}
		let stop = await nextStop();
		assert.match(XsltDebugOutputs.get().text('result.xml') ?? '', /<report>\n {3}<row n="1">text<\/row>\n {3}<row n="2">text<\/row>$/);
		// opened by itself, beside the stylesheet
		const opened = vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === XsltDebugOutputs.scheme);
		assert.ok(opened, 'the output is open');
		assert.strictEqual(XsltDebugOutputs.nameOf(opened!.document.uri), 'result.xml');
		// its title shows it's the debugger's view, not the result file
		assert.strictEqual(path.posix.basename(opened!.document.uri.path), '[XSLT OUT] result.xml');
		assert.strictEqual(opened!.document.languageId, 'xml');
		await stop.session.customRequest('continue', { threadId: 1 });
		stop = await nextStop();
		assert.match(XsltDebugOutputs.get().text('side.json') ?? '', /"count":3/);
		await XsltDebugOutputs.get().show('side.json');
		const side = vscode.window.visibleTextEditors.find((e) => e.document.uri.path.endsWith('side.json'));
		assert.strictEqual(side?.document.languageId, 'json');
		await stop.session.customRequest('continue', { threadId: 1 });
		await ended;
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
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
			const stop = await nextStop();
			await stop.session.customRequest('continue', { threadId: 1 });
			const session = await ended;
			assert.strictEqual(session.type, XsltDebug.type);
			assert.include(session.configuration.saxonArgs, '-it');
			assert.notOk(session.configuration.resultPath);
		} finally {
			await vscode.workspace.getConfiguration('XSLT.tasks').update('saxonJar', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
