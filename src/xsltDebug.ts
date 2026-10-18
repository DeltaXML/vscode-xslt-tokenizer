/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debugger
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { SaxonTaskProvider, XSLTTask } from './saxonTaskProvider';
import { SaxonJsTaskProvider } from './saxonJsTaskProvider';

// The step-through debugger for SaxonJ: the extension runs the debug adapter (xslt-resources/xslt-debugger, built from
// debugger/src) in a JVM with the user's Saxon jar - it talks the Debug Adapter Protocol over stdin/stdout and runs
// the transform with the same Saxon command-line options as an 'xslt' task with the same properties
export class XsltDebug {
	public static readonly type = 'xslt-saxon';
	public static readonly adapterMainClass = 'com.deltaxml.xslt.debug.XsltDebugAdapter';
	public static readonly minimumSaxonVersion = 12;
	// the Java launcher - only changed by tests
	public static javaCommand = 'java';

	// the Saxon major version from the jar's file name or folder, e.g. 13 for .../SaxonPE13-1J/saxon-pe-13.1.jar,
	// 12 for Saxon-HE-12.9.jar and 9 for saxon9he.jar - undefined if neither says
	public static saxonMajorVersion(saxonJar: string): number | undefined {
		const fileMatch = /saxon-?(?:[hpe]e-?)?(\d+)(?:[-.]|[hpe]e)/i.exec(path.basename(saxonJar));
		const folderMatch = /saxon[hpe]e(\d+)-/i.exec(path.basename(path.dirname(saxonJar)));
		const match = fileMatch ?? folderMatch;
		return match ? Number.parseInt(match[1]) : undefined;
	}

	public static readonly quickRunConfigurationName = 'Debug Active Stylesheet';

	// the configurations offered without a launch.json, and written to a new one: the active stylesheet, as Quick Run
	// runs it, then one for each 'xslt' task
	public static providedConfigurations(tasks: vscode.TaskDefinition[]): vscode.DebugConfiguration[] {
		const configurations: vscode.DebugConfiguration[] = [{ type: XsltDebug.type, request: 'launch', name: XsltDebug.quickRunConfigurationName, quickRun: true }];
		const labels = new Set<string>();
		for (const task of tasks) {
			if (task.type === 'xslt' && typeof task.label === 'string' && !labels.has(task.label)) {
				labels.add(task.label);
				configurations.push({ type: XsltDebug.type, request: 'launch', name: `Debug ${task.label}`, task: task.label });
			}
		}
		return configurations;
	}

	// a launch configuration's properties, with those of the 'xslt' task it names (if any) as defaults
	public static withTaskProperties(config: vscode.DebugConfiguration, tasks: vscode.TaskDefinition[]): vscode.DebugConfiguration | string {
		if (config.task === undefined) {
			return config;
		}
		const task = tasks.find((t) => t.type === 'xslt' && t.label === config.task);
		if (!task) {
			return `XSLT debugger: no 'xslt' task labelled '${config.task}' in tasks.json`;
		}
		const { type, label, group, problemMatcher, ...taskProperties } = task;
		return { ...taskProperties, ...config };
	}

	// the variable to show when hovering at this character of a line, while debugging: a variable reference ($name),
	// or the name in an xsl:variable or xsl:param declaration - as '$name', with its range. VS Code would otherwise use
	// the word at the position, and the language's word pattern breaks names at '-' and ':'
	public static variableAt(lineText: string, character: number): { start: number; end: number; expression: string } | undefined {
		const name = '(?:[\\p{L}_][\\p{L}\\p{N}_.\\-]*:)?[\\p{L}_][\\p{L}\\p{N}_.\\-]*';
		const reference = new RegExp(`\\$\\s*(${name})`, 'gu');
		for (let m = reference.exec(lineText); m; m = reference.exec(lineText)) {
			if (character >= m.index && character <= m.index + m[0].length) {
				return { start: m.index, end: m.index + m[0].length, expression: '$' + m[1] };
			}
		}
		const declaration = new RegExp(`<xsl:(?:variable|param)\\b[^>]*?\\sname\\s*=\\s*(["'])(${name})\\1`, 'gu');
		for (let m = declaration.exec(lineText); m; m = declaration.exec(lineText)) {
			const start = m.index + m[0].length - 1 - m[2].length;
			if (character >= start && character <= start + m[2].length) {
				return { start, end: start + m[2].length, expression: '$' + m[2] };
			}
		}
		return undefined;
	}

	// the problem with a configuration (after variable substitution) that would stop it running, if any
	public static configurationProblem(config: vscode.DebugConfiguration): string | undefined {
		if (!config.xsltFile) {
			return "XSLT debugger: the launch configuration has no 'xsltFile' (or 'task')";
		}
		if (!config.saxonJar) {
			return 'XSLT debugger: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.';
		}
		const version = XsltDebug.saxonMajorVersion(config.saxonJar);
		if (version !== undefined && version < XsltDebug.minimumSaxonVersion) {
			return `XSLT debugger: Saxon ${XsltDebug.minimumSaxonVersion} or later is needed - '${path.basename(config.saxonJar)}' is Saxon ${version}`;
		}
		return undefined;
	}
}

export class XsltDebugConfigurationProvider implements vscode.DebugConfigurationProvider {

	// configurationForActiveEditor: for F5 with no launch.json, or a "quickRun" configuration - the configuration to
	// debug the active stylesheet as Quick Run would run it, or undefined (having said why) if it can't be debugged
	constructor(private configurationForActiveEditor: () => Promise<vscode.DebugConfiguration | undefined>) { }

	// for 'create a launch.json file' (Initial) and the Run and Debug view's 'XSLT (Saxon)' configurations with no
	// launch.json (Dynamic): the active stylesheet, as Quick Run runs it, and each 'xslt' task in tasks.json
	public async provideDebugConfigurations(_folder: vscode.WorkspaceFolder | undefined): Promise<vscode.DebugConfiguration[]> {
		const tasks: vscode.TaskDefinition[] = (await SaxonJsTaskProvider.getTasksObject()).tasks || [];
		return XsltDebug.providedConfigurations(tasks);
	}

	public async resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): Promise<vscode.DebugConfiguration | undefined> {
		if ((!config.type && !config.request && !config.name) || config.quickRun) {
			const forActiveEditor = await this.configurationForActiveEditor();
			if (!forActiveEditor) {
				return undefined;
			}
			config = { ...forActiveEditor, ...(config.stopOnEntry !== undefined ? { stopOnEntry: config.stopOnEntry } : {}) };
		}
		const tasksObject = config.task !== undefined ? await SaxonJsTaskProvider.getTasksObject() : { tasks: [] };
		const resolved = XsltDebug.withTaskProperties(config, tasksObject.tasks || []);
		if (typeof resolved === 'string') {
			vscode.window.showErrorMessage(resolved);
			return undefined;
		}
		if (!resolved.saxonJar) {
			resolved.saxonJar = '${config:XSLT.tasks.saxonJar}';
		}
		return resolved;
	}

	public resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.DebugConfiguration | undefined {
		let problem = XsltDebug.configurationProblem(config);
		// a relative path is relative to the workspace folder, as for tasks
		const saxonJar = typeof config.saxonJar === 'string' && folder && !path.isAbsolute(config.saxonJar) ? path.join(folder.uri.fsPath, config.saxonJar) : config.saxonJar;
		if (!problem && !fs.existsSync(saxonJar)) {
			problem = `XSLT debugger: the Saxon jar '${saxonJar}' doesn't exist - check the "XSLT.tasks.saxonJar" setting, or the configuration's "saxonJar"`;
		}
		if (problem) {
			XsltDebugLog.error(`Debug session '${config.name}' not started: ${problem}`);
			XsltDebugLog.showError(problem);
			return undefined;
		}
		// read by the adapter factory (classPath) and sent to the adapter in the launch request (saxonArgs)
		const { classPath, args } = SaxonTaskProvider.commandLine(<XSLTTask><unknown>config, true);
		config.classPath = classPath;
		config.saxonArgs = args;
		return config;
	}
}

// what's evaluated for a hover while debugging: the whole variable reference at the position
export class XsltEvaluatableExpressionProvider implements vscode.EvaluatableExpressionProvider {
	public provideEvaluatableExpression(document: vscode.TextDocument, position: vscode.Position): vscode.EvaluatableExpression | undefined {
		const variable = XsltDebug.variableAt(document.lineAt(position.line).text, position.character);
		return variable ? new vscode.EvaluatableExpression(new vscode.Range(position.line, variable.start, position.line, variable.end), variable.expression) : undefined;
	}
}

export class XsltDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	constructor(private extensionUri: vscode.Uri) { }

	public createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		const adapterJar = vscode.Uri.joinPath(this.extensionUri, 'xslt-resources', 'xslt-debugger', 'xslt-debugger.jar').fsPath;
		const classPath: string[] = [adapterJar].concat(session.configuration.classPath || []);
		// relative paths in the configuration are relative to the workspace folder, as for tasks
		const cwd = session.workspaceFolder?.uri.fsPath;
		const args = ['-cp', classPath.join(path.delimiter), XsltDebug.adapterMainClass];
		return new vscode.DebugAdapterInlineImplementation(new XsltDebugAdapterProcess(session, XsltDebug.javaCommand, args, cwd));
	}
}

// the 'XSLT Debugger' log, in the Output panel: the debugger's own diagnostics - how each session was launched, and
// why one didn't start - rather than the stylesheet's output, which is in the Debug Console
export class XsltDebugLog {
	private static channel: vscode.LogOutputChannel | undefined;
	// the most recent messages, for tests
	public static readonly messages: string[] = [];

	public static info(message: string) {
		XsltDebugLog.add(message);
		XsltDebugLog.get().info(message);
	}

	public static error(message: string) {
		XsltDebugLog.add(message);
		XsltDebugLog.get().error(message);
	}

	public static showError(message: string) {
		const showOutput = 'Show Output';
		vscode.window.showErrorMessage(message, showOutput).then((choice) => {
			if (choice === showOutput) {
				XsltDebugLog.get().show(true);
			}
		});
	}

	private static add(message: string) {
		XsltDebugLog.messages.push(message);
		if (XsltDebugLog.messages.length > 200) {
			XsltDebugLog.messages.shift();
		}
	}

	private static get() {
		return XsltDebugLog.channel ??= vscode.window.createOutputChannel('XSLT Debugger', { log: true });
	}
}

// Runs the Java debug adapter, relaying Debug Adapter Protocol messages to and from it - rather than VS Code running
// it (as a DebugAdapterExecutable) - so its stderr and its exit can be logged and reported: e.g. when Java isn't
// found, or a class isn't on the classpath, the JVM fails before the adapter can say so in the protocol
export class XsltDebugAdapterProcess implements vscode.DebugAdapter {
	private readonly messages = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
	public readonly onDidSendMessage = this.messages.event;
	private readonly process: cp.ChildProcess;
	private buffer = Buffer.alloc(0);
	private stderr = '';
	// the session has ended, or is being ended by VS Code: the adapter exiting is expected
	private ended = false;

	constructor(private session: vscode.DebugSession, command: string, args: string[], cwd: string | undefined) {
		const quote = (arg: string) => /[\s"']/.test(arg) ? JSON.stringify(arg) : arg;
		XsltDebugLog.info(`Debug session '${session.name}': ${command} ${args.map(quote).join(' ')}${cwd ? `\n    in ${cwd}` : ''}`);
		this.process = cp.spawn(command, args, { cwd });
		this.process.stdout?.on('data', (data: Buffer) => this.receive(data));
		this.process.stderr?.on('data', (data: Buffer) => {
			const text = data.toString();
			this.stderr += text;
			XsltDebugLog.error(text.trimEnd());
		});
		this.process.on('error', (e: NodeJS.ErrnoException) => {
			this.fail(e.code === 'ENOENT' ? `Java wasn't found: '${command}' isn't on the PATH - install a Java runtime, as Saxon needs, or add it to the PATH` : `the debug adapter couldn't be started: ${e.message}`);
		});
		this.process.on('exit', (code, signal) => {
			XsltDebugLog.info(`Debug session '${session.name}': the debug adapter exited${code !== null ? ` with code ${code}` : ` (${signal})`}`);
			if (!this.ended) {
				this.fail(XsltDebugAdapterProcess.failureReason(this.stderr, code, session.configuration.saxonJar));
			}
		});
	}

	public handleMessage(message: vscode.DebugProtocolMessage): void {
		const request = message as { type?: string; command?: string };
		if (request.type === 'request' && (request.command === 'disconnect' || request.command === 'terminate')) {
			this.ended = true;
		}
		const json = JSON.stringify(message);
		this.process.stdin?.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`, 'utf8');
	}

	public dispose() {
		this.ended = true;
		this.process.kill();
	}

	private receive(data: Buffer) {
		this.buffer = Buffer.concat([this.buffer, data]);
		while (true) {
			const headerEnd = this.buffer.indexOf('\r\n\r\n');
			const length = headerEnd < 0 ? undefined : /Content-Length: *(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString('ascii'))?.[1];
			if (length === undefined || this.buffer.length < headerEnd + 4 + Number(length)) {
				return;
			}
			const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + Number(length)).toString('utf8');
			this.buffer = this.buffer.subarray(headerEnd + 4 + Number(length));
			const message = JSON.parse(body);
			if (message.type === 'event' && message.event === 'xsltDebugLaunch') {
				const { saxon, java, javaHome, saxonArgs } = message.body ?? {};
				XsltDebugLog.info(`Debug session '${this.session.name}': ${saxon}, on Java ${java} at ${javaHome}\n    Saxon options: ${(saxonArgs ?? []).join(' ')}`);
			} else if (message.type === 'event' && message.event === 'terminated') {
				this.ended = true;
			}
			this.messages.fire(message);
		}
	}

	// why the adapter stopped before it could say, from what the JVM wrote to stderr
	public static failureReason(stderr: string, exitCode: number | null, saxonJar: string | undefined): string {
		const jar = saxonJar ? `'${saxonJar}'` : 'the Saxon jar';
		if (/NoClassDefFoundError: net\/sf\/saxon\/|ClassNotFoundException: net\.sf\.saxon\./.test(stderr)) {
			return `Saxon's classes weren't found: check that ${jar} is a Saxon jar (the "XSLT.tasks.saxonJar" setting)`;
		}
		const tooNew = /UnsupportedClassVersionError: (\S+) .*?class file version ([\d.]+)/.exec(stderr);
		if (tooNew) {
			return `this Java runtime is too old for ${tooNew[1].startsWith('net/sf/saxon') ? `the Saxon jar ${jar}` : tooNew[1]} (class file version ${tooNew[2]}) - use a newer Java`;
		}
		const detail = stderr.trim().split('\n').slice(0, 3).join(' ');
		return `the debug adapter stopped unexpectedly${exitCode !== null ? ` (exit code ${exitCode})` : ''}${detail ? `: ${detail}` : ''}`;
	}

	// ends the session, having reported why
	private fail(reason: string) {
		if (this.ended) {
			return;
		}
		this.ended = true;
		XsltDebugLog.error(`Debug session '${this.session.name}': ${reason}`);
		XsltDebugLog.showError(`XSLT debugger: ${reason}`);
		this.messages.fire({ seq: 0, type: 'event', event: 'output', body: { category: 'stderr', output: `XSLT debugger: ${reason}\n` } } as vscode.DebugProtocolMessage);
		this.messages.fire({ seq: 0, type: 'event', event: 'terminated', body: {} } as vscode.DebugProtocolMessage);
	}
}

// the exit code of each debug session's transform (from the adapter's 'exited' event) - undefined if the session
// ended before the transform did
export class XsltDebugExitCodes implements vscode.DebugAdapterTrackerFactory {
	private exitCodes = new Map<string, number>();

	public createDebugAdapterTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
		return {
			onDidSendMessage: (message: any) => {
				if (message?.type === 'event' && message.event === 'exited') {
					this.exitCodes.set(session.id, message.body?.exitCode);
				}
			}
		};
	}

	public take(session: vscode.DebugSession): number | undefined {
		const exitCode = this.exitCodes.get(session.id);
		this.exitCodes.delete(session.id);
		return exitCode;
	}
}
