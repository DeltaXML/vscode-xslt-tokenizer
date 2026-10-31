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
import { unquotedPath } from './settingPaths';
import { BaseToken, TokenLevelState } from './xpLexer';
import { XslLexer, XSLTokenLevelState } from './xslLexer';
import { XSLTConfiguration } from './languageConfigurations';

// a variable declared before the line execution is paused at: its name (with '$') and the range of the name
export interface InlineDeclaration {
	name: string;
	line: number;
	start: number;
	end: number;
}

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

	// a configuration with the ${input:id} variables in its string values (e.g. its task's parameter values) replaced,
	// for those of tasks.json's inputs that launch.json doesn't define (VS Code resolves a launch configuration's
	// variables with launch.json's inputs) - each asked for once. undefined if one was cancelled
	public static async withTaskInputs(config: vscode.DebugConfiguration, taskInputs: { id?: string }[], launchInputIds: string[], resolveInput: (input: any) => Promise<string | undefined>): Promise<vscode.DebugConfiguration | undefined> {
		const inputs = new Map(taskInputs.filter((input) => typeof input.id === 'string' && !launchInputIds.includes(input.id)).map((input) => [input.id!, input]));
		const values = new Map<string, string>();
		let cancelled = false;
		const resolveValue = async (value: any): Promise<any> => {
			if (cancelled) {
				return value;
			} else if (typeof value === 'string') {
				for (const [, id] of value.matchAll(/\$\{input:([^}]+)\}/g)) {
					if (inputs.has(id) && !values.has(id)) {
						const inputValue = await resolveInput(inputs.get(id));
						if (inputValue === undefined) {
							cancelled = true;
							return value;
						}
						values.set(id, inputValue);
					}
				}
				return value.replace(/\$\{input:([^}]+)\}/g, (match, id) => values.get(id) ?? match);
			} else if (Array.isArray(value)) {
				const result = [];
				for (const item of value) {
					result.push(await resolveValue(item));
				}
				return result;
			} else if (value && typeof value === 'object') {
				const result: { [key: string]: any } = {};
				for (const key of Object.keys(value)) {
					result[key] = await resolveValue(value[key]);
				}
				return result;
			}
			return value;
		};
		const resolved = await resolveValue(config);
		return cancelled ? undefined : resolved;
	}

	// the ids of the ${input:id} variables in a configuration's string values that neither tasks.json nor launch.json
	// defines - VS Code would say so, but offer to open launch.json, when a task's are for tasks.json
	public static undefinedInputs(config: vscode.DebugConfiguration, definedIds: string[]): string[] {
		const ids = new Set<string>();
		const find = (value: any) => {
			if (typeof value === 'string') {
				for (const [, id] of value.matchAll(/\$\{input:([^}]+)\}/g)) {
					if (!definedIds.includes(id)) {
						ids.add(id);
					}
				}
			} else if (value && typeof value === 'object') {
				Object.values(value).forEach(find);
			}
		};
		find(config);
		return [...ids];
	}

	// a tasks.json input's value, asked for as VS Code would when running the task - undefined if cancelled
	public static async inputValue(input: { type?: string; command?: string; args?: any; description?: string; default?: string; password?: boolean; options?: (string | { label?: string; value: string })[] }): Promise<string | undefined> {
		switch (input.type) {
			case 'command':
				return input.command ? vscode.commands.executeCommand<string | undefined>(input.command, input.args) : undefined;
			case 'promptString':
				return vscode.window.showInputBox({ prompt: input.description, value: input.default, password: input.password });
			case 'pickString': {
				const items = (input.options ?? []).map((option) => typeof option === 'string' ? { label: option, value: option } : { label: option.label ?? option.value, value: option.value });
				const picked = await vscode.window.showQuickPick(items, { placeHolder: input.description });
				return picked?.value;
			}
		}
		return undefined;
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
		// with any prefix for XSLT, e.g. xslt:variable: the line doesn't have the module's outermost element
		const declaration = new RegExp(`<[\\w.-]+:(?:variable|param)\\b[^>]*?\\sname\\s*=\\s*(["'])(${name})\\1`, 'gu');
		for (let m = declaration.exec(lineText); m; m = declaration.exec(lineText)) {
			const start = m.index + m[0].length - 1 - m[2].length;
			if (character >= start && character <= start + m[2].length) {
				return { start, end: start + m[2].length, expression: '$' + m[2] };
			}
		}
		return undefined;
	}

	// the variables whose values are shown inline, while paused at this (0-based) line: those declared on earlier
	// lines of the template, function or other top-level declaration paused in, and still in scope - the names of
	// xsl:variable and xsl:param elements, and in XPath, the variables bound by let, for, some, every (and 'at') and
	// an inline function's parameters. Only the last declaration of a name is given, as it's the one in scope
	public static inlineDeclarations(text: string, stopLine: number): InlineDeclaration[] {
		const tokens = new XslLexer(XSLTConfiguration.configuration).analyse(text);
		const xslStart = XslLexer.getXsltStartTokenNumber();
		const lines = text.split('\n');
		const tokenText = (token: BaseToken) => lines[token.line]?.substr(token.startCharacter, token.length) ?? '';
		// the open elements: each with the declarations among its children so far - those of a child element are
		// out of scope when it ends
		const stack: { name: string; declarations: InlineDeclaration[] }[] = [{ name: '', declarations: [] }];
		// the XPath declarations of the attribute (or text value template) being read - out of scope when it ends
		let xpathDeclarations: InlineDeclaration[] = [];
		let elementName: string | undefined;
		let isEndTag = false;
		let attributeName: string | undefined;
		let nameDeclaration: InlineDeclaration | undefined;
		// the nesting of brackets in an inline function's parameter list, and where it started
		let paramDepth = 0;
		const declaration = (token: BaseToken, name: string): InlineDeclaration => ({ name, line: token.line, start: token.startCharacter, end: token.startCharacter + token.length });
		// the XPath tokens either side, in the same expression
		const previous = (i: number) => i > 0 && tokens[i - 1].tokenType < xslStart ? tokens[i - 1] : undefined;
		const next = (i: number) => i + 1 < tokens.length && tokens[i + 1].tokenType < xslStart ? tokens[i + 1] : undefined;

		for (let i = 0; i < tokens.length && tokens[i].line < stopLine; i++) {
			const token = tokens[i];
			if (token.tokenType < xslStart) {
				const value = token.value;
				if (token.tokenType === TokenLevelState.anonymousFunction && next(i)?.value === '(') {
					paramDepth = 1;
					i++;
				} else if (paramDepth > 0) {
					if (value === '(') {
						paramDepth++;
					} else if (value === ')') {
						paramDepth--;
					} else if (paramDepth === 1 && token.tokenType === TokenLevelState.variable) {
						xpathDeclarations.push(declaration(token, value));
					}
				} else if (token.tokenType === TokenLevelState.variable) {
					const before = previous(i)?.value;
					const after = next(i)?.value;
					if (['let', 'for', 'some', 'every', 'at', 'member', 'key', 'value'].includes(before ?? '') ||
						(before === ',' && [':=', 'in', 'at', 'as'].includes(after ?? ''))) {
						xpathDeclarations.push(declaration(token, value));
					}
				}
				continue;
			}
			const type = token.tokenType - xslStart;
			if (type === XSLTokenLevelState.attributeValue || type === XSLTokenLevelState.entityRef || type === XSLTokenLevelState.attributeEquals) {
				if (type === XSLTokenLevelState.attributeValue && attributeName === 'name' && (elementName === 'xsl:variable' || elementName === 'xsl:param')) {
					const written = tokenText(token);
					const name = written.replace(/^["']|["']$/g, '').trim();
					if (name) {
						const start = token.startCharacter + written.indexOf(name);
						nameDeclaration = { name: '$' + name, line: token.line, start, end: start + name.length };
					}
				}
				continue;
			}
			// the attribute, or text, with any XPath expression, has ended
			xpathDeclarations = [];
			paramDepth = 0;
			attributeName = undefined;
			switch (type) {
				case XSLTokenLevelState.elementName:
				case XSLTokenLevelState.xslElementName:
					if (isEndTag) {
						if (stack.length > 1) {
							stack.pop();
						}
					} else {
						elementName = tokenText(token);
						nameDeclaration = undefined;
					}
					break;
				case XSLTokenLevelState.attributeName:
					attributeName = elementName !== undefined ? tokenText(token) : undefined;
					break;
				case XSLTokenLevelState.xmlPunctuation: {
					const punctuation = tokenText(token);
					if (punctuation === '<' || punctuation === '</') {
						isEndTag = punctuation === '</';
						elementName = undefined;
					} else if ((punctuation === '>' || punctuation === '/>') && elementName !== undefined && !isEndTag) {
						// in scope for the element's following siblings
						if (nameDeclaration) {
							stack[stack.length - 1].declarations.push(nameDeclaration);
						}
						if (punctuation === '>') {
							stack.push({ name: elementName, declarations: [] });
						}
						elementName = undefined;
						nameDeclaration = undefined;
					}
					break;
				}
			}
		}
		// from the template or function paused in - or the top-level declaration, not the stylesheet's globals
		// (stack[1] is the xsl:stylesheet element)
		let scopeStart = 2;
		stack.forEach((element, index) => {
			if (element.name === 'xsl:template' || element.name === 'xsl:function') {
				scopeStart = index;
			}
		});
		const inScope = stack.slice(scopeStart).flatMap((element) => element.declarations).concat(xpathDeclarations);
		const last = new Map<string, InlineDeclaration>();
		inScope.forEach((d) => { last.delete(d.name); last.set(d.name, d); });
		return [...last.values()];
	}

	// the notification when a debug session ends - for a stylesheet that didn't compile, its first static error: it
	// can't be paused at, as the stylesheet never ran; for another failure, why, if Saxon said (e.g. a source file
	// that doesn't exist, or a dynamic error)
	public static sessionEndMessage(name: string, exitCode: number, staticErrors: XsltStaticError[], failure?: XsltDebugFailure): string {
		if (exitCode === 0) {
			return `Completed debug session: '${name}'`;
		}
		if (staticErrors.length > 0) {
			const [first] = staticErrors;
			const more = staticErrors.length > 1 ? `, and ${staticErrors.length - 1} more` : '';
			const errors = staticErrors.length > 1 ? 'static errors' : 'a static error';
			return `XSLT debugger: the stylesheet has ${errors}, so it can't be debugged - ${first.code ? first.code + ' ' : ''}at line ${first.line} of ${path.basename(first.path)}${more} (see the Problems view)`;
		}
		if (failure) {
			const { message, error } = failure;
			const at = error ? ` (${error.code ? error.code + ' ' : ''}at line ${error.line} of ${path.basename(error.path)})` : '';
			return `Debug session '${name}' failed: ${message}${at}`;
		}
		return `Debug session '${name}' failed (exit code ${exitCode})`;
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
	public async provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined): Promise<vscode.DebugConfiguration[]> {
		// VS Code asks for each workspace folder and for the user settings (no folder) - the tasks are the first
		// folder's, as for Quick Run, so they're given for that folder alone (else each is listed twice)
		const firstFolder = vscode.workspace.workspaceFolders?.[0];
		if (firstFolder ? folder?.uri.toString() !== firstFolder.uri.toString() : folder !== undefined) {
			return [];
		}
		const tasks: vscode.TaskDefinition[] = (await SaxonJsTaskProvider.getTasksObject()).tasks || [];
		return XsltDebug.providedConfigurations(tasks);
	}

	public async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): Promise<vscode.DebugConfiguration | undefined> {
		if ((!config.type && !config.request && !config.name) || config.quickRun) {
			const forActiveEditor = await this.configurationForActiveEditor();
			if (!forActiveEditor) {
				return undefined;
			}
			config = { ...forActiveEditor, ...(config.stopOnEntry !== undefined ? { stopOnEntry: config.stopOnEntry } : {}) };
		}
		const tasksObject = config.task !== undefined ? await SaxonJsTaskProvider.getTasksObject() : { tasks: [] };
		const withTask = XsltDebug.withTaskProperties(config, tasksObject.tasks || []);
		if (typeof withTask === 'string') {
			vscode.window.showErrorMessage(withTask);
			return undefined;
		}
		// e.g. the values of required stylesheet parameters, asked for as when the task runs
		const launchInputIds = (vscode.workspace.getConfiguration('launch', folder?.uri).get<{ id?: string }[]>('inputs') ?? []).map((input) => input.id ?? '');
		const taskInputIds = ((tasksObject.inputs || []) as { id?: string }[]).map((input) => input.id ?? '');
		const [undefinedInput] = config.task !== undefined ? XsltDebug.undefinedInputs(withTask, launchInputIds.concat(taskInputIds)) : [];
		if (undefinedInput) {
			const openTasks = 'Open tasks.json';
			vscode.window.showErrorMessage(`XSLT debugger: the task '${config.task}' uses \${input:${undefinedInput}}, but there's no input with the id '${undefinedInput}' in the "inputs" of tasks.json.`, openTasks).then((choice) => {
				const workspaceFolder = folder ?? vscode.workspace.workspaceFolders?.[0];
				if (choice === openTasks && workspaceFolder) {
					vscode.window.showTextDocument(vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'tasks.json'));
				}
			});
			return undefined;
		}
		const resolved = await XsltDebug.withTaskInputs(withTask, tasksObject.inputs || [], launchInputIds, XsltDebug.inputValue);
		if (!resolved) {
			return undefined;
		}
		if (!resolved.saxonJar) {
			resolved.saxonJar = '${config:XSLT.tasks.saxonJar}';
		}
		return resolved;
	}

	public resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.DebugConfiguration | undefined {
		config.saxonJar = unquotedPath(config.saxonJar);
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

// while paused: the values of the variables declared before the line, shown at their declarations - looked up by
// VS Code in the paused frame's variables, so they're the Variables view's summaries, and a variable that isn't in
// scope there isn't shown
export class XsltInlineValuesProvider implements vscode.InlineValuesProvider {
	public provideInlineValues(document: vscode.TextDocument, viewPort: vscode.Range, context: vscode.InlineValueContext): vscode.InlineValue[] {
		return XsltDebug.inlineDeclarations(document.getText(), context.stoppedLocation.start.line)
			.filter((d) => d.line >= viewPort.start.line && d.line <= viewPort.end.line)
			.map((d) => new vscode.InlineValueVariableLookup(new vscode.Range(d.line, d.start, d.line, d.end), d.name, true));
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

// The output each debug session's transform has written so far - its principal result and each
// xsl:result-document - as read-only virtual documents ('xslt-debug-output:' URIs, nothing on disk), updated at each
// pause. The adapter sends each output's new text before it pauses, serialized as the result is but indented, and the
// document's language is from its output method. A document is reused for an output of the same name in the next
// session, so a rerun refreshes the same tab.
// For an XML output, the adapter also sends where each part of the text came from (see XsltDebugOutputs.locationAt), so
// a position in the output can be taken to the stylesheet instruction that wrote it, also after the session ends
// where a part of an XML output came from (from the adapter's OutputCapture and Debugger.outputLocation): the start tag
// of the instruction that wrote it; for a node copied from a source document, where its start tag ends; or for literal
// text, where Saxon reports it - where the text starts or ends
export interface XsltOutputLocation {
	id: number;
	path?: string;
	line?: number;
	column?: number;
	kind?: 'instruction' | 'source' | 'text';
}

export class XsltDebugOutputs implements vscode.TextDocumentContentProvider, vscode.DefinitionProvider, vscode.InlayHintsProvider {
	public static readonly scheme = 'xslt-debug-output';
	private static instance: XsltDebugOutputs | undefined;
	private readonly changed = new vscode.EventEmitter<vscode.Uri>();
	public readonly onDidChange = this.changed.event;
	private readonly outputs = new Map<string, { text: string; method: string; truncated: boolean; uri?: string; runs: number[]; locations: Map<number, XsltOutputLocation> }>();
	// the output being written to at the last pause, and whether the output has been opened this session
	private current: string | undefined;
	private openedThisSession = false;

	public static get(): XsltDebugOutputs {
		return XsltDebugOutputs.instance ??= new XsltDebugOutputs();
	}

	// the start of an output document's name, its tab's title - so it isn't taken for the file the result is written to
	public static readonly titlePrefix = '[XSLT OUT] ';

	public static uri(name: string): vscode.Uri {
		return vscode.Uri.from({ scheme: XsltDebugOutputs.scheme, path: `/debug output/${XsltDebugOutputs.titlePrefix}${name}` });
	}

	// the name of the output an output document is for
	public static nameOf(uri: vscode.Uri): string {
		const title = path.posix.basename(uri.path);
		return title.startsWith(XsltDebugOutputs.titlePrefix) ? title.substring(XsltDebugOutputs.titlePrefix.length) : title;
	}

	// the output's language, from its output method
	public static languageId(method: string): string {
		return method === 'xml' || method === 'xhtml' ? 'xml' : method === 'html' ? 'html' : method === 'json' ? 'json' : 'plaintext';
	}

	public provideTextDocumentContent(uri: vscode.Uri): string {
		const output = this.outputs.get(XsltDebugOutputs.nameOf(uri));
		if (!output) {
			return '';
		}
		return output.truncated ? output.text + '\n... (only the first part of the output is shown)' : output.text;
	}

	public text(name: string): string | undefined {
		return this.outputs.get(name)?.text;
	}

	public names(): string[] {
		return [...this.outputs.keys()];
	}

	public startSession() {
		for (const [name, output] of this.outputs) {
			output.text = '';
			this.changed.fire(XsltDebugOutputs.uri(name));
		}
		this.outputs.clear();
		this.current = undefined;
		this.openedThisSession = false;
	}

	// an 'xsltOutputs' event from the adapter: each output's text from an offset
	public update(body: { outputs?: { name: string; method: string; offset: number; text: string; truncated?: boolean; uri?: string; runs?: number[]; locations?: XsltOutputLocation[] }[]; current?: string }) {
		for (const update of body.outputs ?? []) {
			const output = this.outputs.get(update.name) ?? { text: '', method: update.method, truncated: false, runs: [], locations: new Map<number, XsltOutputLocation>() };
			const isReplaced = !(update.offset > 0 && update.offset <= output.text.length);
			output.text = isReplaced ? update.text : output.text.substring(0, update.offset) + update.text;
			// the runs within the text that's been replaced no longer apply
			const kept = output.runs.findIndex((offset, i) => i % 2 === 0 && offset >= (isReplaced ? 0 : update.offset));
			if (kept > -1) {
				output.runs.length = kept;
			}
			output.runs.push(...(update.runs ?? []));
			(update.locations ?? []).forEach((location) => output.locations.set(location.id, location));
			output.method = update.method;
			output.truncated = !!update.truncated;
			output.uri = update.uri ?? output.uri;
			this.outputs.set(update.name, output);
			this.changed.fire(XsltDebugOutputs.uri(update.name));
		}
		// the output being written to - by its URI, as in the event (a name is decoded, e.g. a space for %20)
		const currentName = body.current ? [...this.outputs.entries()].find(([, o]) => o.uri === body.current)?.[0] : undefined;
		this.current = currentName ?? this.current;
		if (!this.openedThisSession && vscode.workspace.getConfiguration('XSLT.debug').get('openOutput', false)) {
			const name = this.current && this.outputs.get(this.current)?.text ? this.current : this.names().find((n) => this.outputs.get(n)?.text);
			if (name) {
				this.openedThisSession = true;
				this.show(name);
			}
		}
	}

	// from the Variables view's context menu, for an output in the Output scope - or 'writing to', whose value is an
	// output's name
	public showFromVariable(context: { variable?: { name?: string; value?: string } } | undefined) {
		const variable = context?.variable;
		const name = variable?.name === 'writing to' ? variable.value : variable?.name;
		if (name && this.outputs.has(name)) {
			return this.show(name);
		}
		return this.show();
	}

	// opens the output (by default, the one being written to), beside the active editor, leaving the focus there
	public async show(name?: string) {
		const names = this.names();
		let chosen = name ?? (names.length > 1 ? undefined : names[0]) ?? this.current;
		if (!chosen && names.length > 1) {
			chosen = await vscode.window.showQuickPick(names, { placeHolder: 'The output to show' });
		}
		if (!chosen) {
			vscode.window.showInformationMessage('XSLT debugger: there is no output yet - it\'s shown once a debug session has written some.');
			return;
		}
		const document = await vscode.workspace.openTextDocument(XsltDebugOutputs.uri(chosen));
		await vscode.languages.setTextDocumentLanguage(document, XsltDebugOutputs.languageId(this.outputs.get(chosen)?.method ?? 'xml'));
		await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: false });
	}

	// where the part of an output's text at the offset came from: the location of the run of text the offset is in - for
	// the end of a tag ('>' or '/>'), the tag's, as an emitter writes the '>' of a start tag with the next event's text.
	// runs: [offset, location id, ...], each run from its offset to the next run's - an attribute has its own
	public static locationAt(text: string, runs: number[], locations: Map<number, XsltOutputLocation>, offset: number): { location: XsltOutputLocation, start: number, end: number } | undefined {
		const tagStart = text.lastIndexOf('<', offset);
		const isTagEnd = text.charAt(offset) === '>' || text.startsWith('/>', offset);
		const at = isTagEnd && tagStart > text.lastIndexOf('>', offset - 1) ? tagStart : offset;
		let low = 0;
		let high = runs.length / 2 - 1;
		let found = -1;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (runs[mid * 2] <= at) {
				found = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		const location = found > -1 ? locations.get(runs[found * 2 + 1]) : undefined;
		if (!location?.path || !location.line) {
			return undefined;
		}
		return { location, start: runs[found * 2], end: found * 2 + 2 < runs.length ? runs[found * 2 + 2] : text.length };
	}

	// the position in the source file's text for a location: an instruction's start tag; for a node copied from a source
	// document, its start tag, before where Saxon reports it (the tag's end); for literal text, where the output text
	// found is within the text node Saxon reports it for, at its start or end - else the text node's first character,
	// e.g. for a text value template, or for text in a temporary tree, which has its parent element's location, the
	// instruction after the element's start tag, e.g. xsl:value-of
	public static sourceOffset(sourceText: string, location: XsltOutputLocation, lineOffset: (line: number, character: number) => number, outputText: string): number {
		const reported = lineOffset(location.line! - 1, Math.max(location.column! - 1, 0));
		if (location.kind === 'source') {
			const tagStart = sourceText.lastIndexOf('<', reported - 1);
			return tagStart > -1 ? tagStart : reported;
		} else if (location.kind === 'text') {
			const found = outputText.trim();
			const start = sourceText.lastIndexOf('>', reported - 1) + 1;
			const next = sourceText.indexOf('<', reported);
			const end = next > -1 ? next : sourceText.length;
			const index = found ? sourceText.indexOf(found, start) : -1;
			if (index > -1 && index + found.length <= end) {
				return index;
			}
			const firstCharacter = sourceText.substring(start, end).search(/\S/);
			return firstCharacter > -1 ? start + firstCharacter : end;
		}
		return reported;
	}

	// the source location for the position in an output document - undefined if it isn't known
	public async sourceLocation(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location | undefined> {
		return document.uri.scheme === XsltDebugOutputs.scheme ? this.sourceLocationAt(XsltDebugOutputs.nameOf(document.uri), document.offsetAt(position)) : undefined;
	}

	// the source location for the offset in the named output's text
	public async sourceLocationAt(name: string, offset: number): Promise<vscode.Location | undefined> {
		const output = this.outputs.get(name);
		const found = output && offset < output.text.length ? XsltDebugOutputs.locationAt(output.text, output.runs, output.locations, offset) : undefined;
		if (!output || !found) {
			return undefined;
		}
		const { location, start, end } = found;
		// literal text: the part of the run on the line - without a start tag's '>' written with it
		const lineStart = output.text.lastIndexOf('\n', offset - 1) + 1;
		const lineEnd = output.text.indexOf('\n', offset);
		const outputText = output.text.substring(Math.max(start, lineStart), Math.min(end, lineEnd > -1 ? lineEnd : output.text.length)).replace(/^\s*>/, '');
		try {
			const source = await vscode.workspace.openTextDocument(vscode.Uri.file(location.path!));
			const sourceOffset = XsltDebugOutputs.sourceOffset(source.getText(), location, (line, character) => source.offsetAt(new vscode.Position(line, character)), outputText);
			return new vscode.Location(source.uri, source.positionAt(sourceOffset));
		} catch {
			return undefined;
		}
	}

	// go to definition: the source of the output at the position. VS Code opens it in the output's editor group - so if
	// it's open in another group, the new tab is replaced by that editor (see revealInOtherGroup). This is also asked for
	// as the cursor moves over the output with the modifier key down, so it's only noted here
	public async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
		const location = await this.sourceLocation(document, position);
		const column = vscode.window.visibleTextEditors.find((e) => e.document === document)?.viewColumn;
		if (location && column !== undefined) {
			const uri = location.uri.toString();
			const isOpenInGroup = vscode.window.tabGroups.all.some((g) => g.viewColumn === column && g.tabs.some((tab) => XsltDebugOutputs.tabUri(tab) === uri));
			this.definitionJump = { uri, range: location.range, column, isOpenInGroup, until: Date.now() + 3000 };
		}
		return location;
	}

	// the last definition given for an output: its file and range, and the output's editor group - whether the file was
	// open in that group then, and until when an editor opened for it is taken to be for it
	private definitionJump: { uri: string; range: vscode.Range; column: vscode.ViewColumn; isOpenInGroup: boolean; until: number } | undefined;

	private static tabUri(tab: vscode.Tab): string | undefined {
		return tab.input instanceof vscode.TabInputText ? tab.input.uri.toString() : undefined;
	}

	// the editor group to show a source file in, from the output's group: one showing it, else one with it open, else
	// another group with an editor - undefined if there's none
	private static otherGroup(uri: string, outputColumn: vscode.ViewColumn | undefined, withFileOnly = false): vscode.ViewColumn | undefined {
		const others = vscode.window.tabGroups.all.filter((g) => g.viewColumn !== outputColumn);
		const showing = others.find((g) => g.activeTab && XsltDebugOutputs.tabUri(g.activeTab) === uri);
		const withFile = others.find((g) => g.tabs.some((tab) => XsltDebugOutputs.tabUri(tab) === uri));
		return showing?.viewColumn ?? withFile?.viewColumn ?? (withFileOnly ? undefined : others.find((g) => g.tabs.length > 0)?.viewColumn);
	}

	// after a go to definition from an output: an editor opened for the source file in the output's group, where the file
	// wasn't open, is closed if the file is open in another group, where it's shown instead - at the definition (the new
	// editor's selection isn't set yet)
	public async revealInOtherGroup(editor: vscode.TextEditor | undefined) {
		const jump = this.definitionJump;
		if (!editor || !jump || Date.now() > jump.until || editor.viewColumn !== jump.column || jump.isOpenInGroup || editor.document.uri.toString() !== jump.uri) {
			return;
		}
		this.definitionJump = undefined;
		const column = XsltDebugOutputs.otherGroup(jump.uri, jump.column, true);
		const group = vscode.window.tabGroups.all.find((g) => g.viewColumn === jump.column);
		const tab = group?.tabs.find((t) => XsltDebugOutputs.tabUri(t) === jump.uri);
		if (column === undefined || !tab) {
			return;
		}
		// closed first, so that the editor shown last has the focus
		const document = editor.document;
		await vscode.window.tabGroups.close(tab, true);
		await vscode.window.showTextDocument(document, { viewColumn: column, selection: jump.range, preview: false });
	}

	// the 'Go to XSLT Source' command: shows the source of the output at the cursor, in another editor group from the
	// output's, where the file is already shown if it is
	public async goToSource() {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.scheme !== XsltDebugOutputs.scheme) {
			return;
		}
		const location = await this.sourceLocation(editor.document, editor.selection.active);
		if (!location) {
			const method = this.outputs.get(XsltDebugOutputs.nameOf(editor.document.uri))?.method;
			vscode.window.showInformationMessage(method && method !== 'xml' ? `XSLT debugger: only XML output can be traced back to the stylesheet - this output's method is '${method}'.` :
				'XSLT debugger: where this part of the output came from isn\'t known.');
			return;
		}
		const column = XsltDebugOutputs.otherGroup(location.uri.toString(), editor.viewColumn) ?? vscode.ViewColumn.Beside;
		await vscode.window.showTextDocument(location.uri, { viewColumn: column, selection: location.range, preview: false });
	}

	// the keys for going to the source from an output: the modifier for go to definition with the mouse - Cmd/Ctrl, or
	// Option/Alt when multiple cursors are added with Cmd/Ctrl (editor.multiCursorModifier) - or F12
	public static goToSourceKeys(platform: string = process.platform, multiCursorModifier = vscode.workspace.getConfiguration('editor').get<string>('multiCursorModifier', 'alt')): string {
		const isMac = platform === 'darwin';
		const modifier = multiCursorModifier === 'ctrlCmd' ? (isMac ? 'Option' : 'Alt') : (isMac ? 'Cmd' : 'Ctrl');
		return `${modifier}${isMac ? '-' : '+'}click or F12`;
	}

	private readonly inlayHintsChanged = new vscode.EventEmitter<void>();
	public readonly onDidChangeInlayHints = this.inlayHintsChanged.event;

	// the cursor has moved in an output document: its hint follows it
	public selectionChanged(event: vscode.TextEditorSelectionChangeEvent) {
		if (event.textEditor.document.uri.scheme === XsltDebugOutputs.scheme) {
			this.inlayHintsChanged.fire();
		}
	}

	// at the end of the cursor's line in an XML output: where the output at the cursor came from - or the line's first
	// part, with the cursor in its indentation or at its end - e.g. '→ report.xsl:4', with the keys for going there in
	// its tooltip
	public async provideInlayHints(document: vscode.TextDocument): Promise<vscode.InlayHint[]> {
		const editor = [vscode.window.activeTextEditor, ...vscode.window.visibleTextEditors].find((e) => e?.document === document);
		const output = this.outputs.get(XsltDebugOutputs.nameOf(document.uri));
		if (!editor || !output || output.method !== 'xml') {
			return [];
		}
		const cursor = editor.selection.active;
		const line = document.lineAt(cursor.line);
		const isOnText = cursor.character >= line.firstNonWhitespaceCharacterIndex && cursor.character < line.text.trimEnd().length;
		if (line.isEmptyOrWhitespace) {
			return [];
		}
		const offset = document.offsetAt(isOnText ? cursor : new vscode.Position(cursor.line, line.firstNonWhitespaceCharacterIndex));
		const location = await this.sourceLocationAt(XsltDebugOutputs.nameOf(document.uri), offset);
		if (!location) {
			return [];
		}
		const hint = new vscode.InlayHint(line.range.end, `→ ${path.basename(location.uri.fsPath)}:${location.range.start.line + 1}`);
		hint.paddingLeft = true;
		hint.tooltip = 'Jump to XSLT source with: ' + XsltDebugOutputs.goToSourceKeys();
		return [hint];
	}

	// an output view restored by VS Code from the last window is empty - outputs are only kept while VS Code runs - so
	// a tab for an output that isn't known is closed: when the extension starts, and when the tab is opened
	public closeRestoredTabs(tabs: readonly vscode.Tab[]) {
		const restored = tabs.filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === XsltDebugOutputs.scheme &&
			!this.outputs.has(XsltDebugOutputs.nameOf(tab.input.uri)));
		if (restored.length > 0) {
			vscode.window.tabGroups.close(restored, true).then(undefined, () => undefined);
		}
	}

	// a visible output document is kept scrolled to its end, where output is being added
	public static revealEnd(document: vscode.TextDocument) {
		if (document.uri.scheme !== XsltDebugOutputs.scheme) {
			return;
		}
		const end = new vscode.Range(document.lineCount - 1, 0, document.lineCount - 1, 0);
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document === document) {
				editor.revealRange(end, vscode.TextEditorRevealType.Default);
			}
		}
	}
}

// the errors Saxon reported in the last debug session - compiling or running the stylesheet - in the Problems view,
// as for tasks with the Saxon problem matcher; cleared when the next session starts
export class XsltDebugProblems {
	private static collection: vscode.DiagnosticCollection | undefined;
	private static pending = new Map<string, vscode.Diagnostic[]>();

	public static clear() {
		XsltDebugProblems.pending.clear();
		XsltDebugProblems.get().clear();
	}

	public static add(fsPath: string, line: number, code: string, message: string, isWarning: boolean) {
		const diagnostic = new vscode.Diagnostic(new vscode.Range(line - 1, 0, line - 1, Number.MAX_SAFE_INTEGER), message,
			isWarning ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
		diagnostic.code = code || undefined;
		diagnostic.source = 'Saxon';
		const diagnostics = XsltDebugProblems.pending.get(fsPath) ?? [];
		diagnostics.push(diagnostic);
		XsltDebugProblems.pending.set(fsPath, diagnostics);
		XsltDebugProblems.get().set(vscode.Uri.file(fsPath), diagnostics);
	}

	// the file has been edited: its problems, from when Saxon ran it, may no longer apply - e.g. the error has been
	// fixed - so they're removed (those of other files are kept)
	public static clearDocument(uri: vscode.Uri) {
		if (uri.scheme !== 'file' || XsltDebugProblems.pending.size === 0) {
			return;
		}
		// the adapter's paths have symbolic links resolved (e.g. /tmp on macOS), and on Windows, are lower-cased
		let realPath = uri.fsPath;
		try {
			realPath = fs.realpathSync(uri.fsPath);
		} catch {
			// not found: the path as it is
		}
		const same = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
		for (const fsPath of [...XsltDebugProblems.pending.keys()]) {
			if (same(fsPath, uri.fsPath) || same(fsPath, realPath)) {
				XsltDebugProblems.pending.delete(fsPath);
				XsltDebugProblems.get().delete(vscode.Uri.file(fsPath));
			}
		}
	}

	public static get(): vscode.DiagnosticCollection {
		return XsltDebugProblems.collection ??= vscode.languages.createDiagnosticCollection('XSLT debugger');
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
	// VS Code has been sent the 'terminated' event, which ends the session
	private terminatedSent = false;
	private exited = false;
	// VS Code has asked for the session to end - rather than the adapter failing
	private endedByVsCode = false;
	// 'disconnect' has been sent: the adapter exits without answering any later request
	private disconnected = false;
	// the requests sent to the adapter that it hasn't answered, by seq
	private readonly pending = new Map<number, string>();

	constructor(private session: vscode.DebugSession, command: string, args: string[], cwd: string | undefined) {
		const quote = (arg: string) => /[\s"']/.test(arg) ? JSON.stringify(arg) : arg;
		XsltDebugLog.info(`Debug session '${session.name}': ${command} ${args.map(quote).join(' ')}${cwd ? `\n    in ${cwd}` : ''}`);
		XsltDebugProblems.clear();
		XsltDebugOutputs.get().startSession();
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
			this.exited = true;
			if (this.endedByVsCode) {
				this.pending.forEach((command, seq) => this.respondHere({ command, seq }));
				this.pending.clear();
			}
			if (!this.ended) {
				this.fail(XsltDebugAdapterProcess.failureReason(this.stderr, code, session.configuration.saxonJar));
			} else if (!this.terminatedSent) {
				// VS Code only knows the session has ended from this event
				this.fireTerminated();
			}
		});
	}

	public handleMessage(message: vscode.DebugProtocolMessage): void {
		const request = message as { type?: string; command?: string; seq: number };
		if (request.type === 'request') {
			if (this.disconnected || (this.exited && this.endedByVsCode)) {
				// the adapter has gone, or is going: answered here - VS Code waits for a response to each request
				// before it ends the session
				this.respondHere(request);
				if (!this.terminatedSent) {
					this.fireTerminated();
				}
				return;
			}
			if (request.command === 'disconnect' || request.command === 'terminate') {
				this.ended = true;
				this.endedByVsCode = true;
			}
			this.pending.set(request.seq, request.command ?? '');
		}
		const json = JSON.stringify(message);
		this.process.stdin?.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`, 'utf8');
		if (request.type === 'request' && request.command === 'disconnect') {
			this.disconnected = true;
		}
	}

	// a response for a request the adapter won't answer: success - with nothing, for requests about the paused state,
	// e.g. no stack frames - so VS Code doesn't retry them
	private respondHere(request: { command?: string; seq: number }) {
		const empty: { [command: string]: object } = { threads: { threads: [] }, stackTrace: { stackFrames: [], totalFrames: 0 }, scopes: { scopes: [] }, variables: { variables: [] } };
		const succeeds = request.command === 'disconnect' || request.command === 'terminate' || (request.command ?? '') in empty;
		this.messages.fire({ seq: 0, type: 'response', request_seq: request.seq, success: succeeds, command: request.command,
			...(succeeds ? { body: empty[request.command ?? ''] } : { message: 'the debug session has ended' }) } as vscode.DebugProtocolMessage);
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
			if (message.type === 'response') {
				this.pending.delete(message.request_seq);
			}
			if (message.type === 'event' && message.event === 'xsltDebugLaunch') {
				const { saxon, java, javaHome, saxonArgs } = message.body ?? {};
				XsltDebugLog.info(`Debug session '${this.session.name}': ${saxon}, on Java ${java} at ${javaHome}\n    Saxon options: ${(saxonArgs ?? []).join(' ')}`);
			} else if (message.type === 'event' && message.event === 'xsltOutputs') {
				XsltDebugOutputs.get().update(message.body ?? {});
			} else if (message.type === 'event' && message.event === 'xsltDebugError') {
				const { path: fsPath, line, code, message: text, severity } = message.body ?? {};
				if (typeof fsPath === 'string' && typeof line === 'number') {
					XsltDebugProblems.add(fsPath, line, code, text, severity === 'warning');
				}
			} else if (message.type === 'event' && message.event === 'terminated') {
				this.ended = true;
				this.terminatedSent = true;
			} else if (message.type === 'response' && message.command === 'disconnect') {
				// VS Code ends the session at this response - waiting 500ms first if any request is unanswered, e.g. a
				// stackTrace it sends just after the disconnect - so it's held back until none is: those sent later are
				// answered here, and those the adapter exits without answering, when it exits
				const held = Date.now();
				const release = () => {
					if (this.pending.size === 0 || Date.now() - held >= XsltDebugAdapterProcess.disconnectMaxDelay) {
						this.messages.fire(message);
					} else {
						setTimeout(release, 10);
					}
				};
				setTimeout(release, XsltDebugAdapterProcess.disconnectDelay);
				continue;
			}
			this.messages.fire(message);
		}
	}

	// how long the response to 'disconnect' is held back: at least, and at most while requests are unanswered
	public static disconnectDelay = 50;
	public static disconnectMaxDelay = 300;

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
		this.fireTerminated();
	}

	private fireTerminated() {
		this.terminatedSent = true;
		this.messages.fire({ seq: 0, type: 'event', event: 'terminated', body: {} } as vscode.DebugProtocolMessage);
	}
}

// the exit code of each debug session's transform (from the adapter's 'exited' event) - undefined if the session
// ended before the transform did
// a static error, found when the stylesheet was compiled - so it couldn't run, or be debugged
export interface XsltStaticError {
	path: string;
	line: number;
	code: string;
}

// why a transform failed, from Saxon - with the error's location, for a dynamic error
export interface XsltDebugFailure {
	message: string;
	error?: XsltStaticError;
}

export class XsltDebugExitCodes implements vscode.DebugAdapterTrackerFactory {
	private exitCodes = new Map<string, number>();
	private staticErrors = new Map<string, XsltStaticError[]>();
	private failures = new Map<string, XsltDebugFailure>();
	// the last dynamic error reported - the failure's, if it has the same message (not one caught by xsl:try)
	private lastErrors = new Map<string, XsltStaticError & { message: string }>();

	public createDebugAdapterTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
		return {
			onDidSendMessage: (message: any) => {
				if (message?.type === 'event' && message.event === 'exited') {
					this.exitCodes.set(session.id, message.body?.exitCode);
				} else if (message?.type === 'event' && message.event === 'xsltDebugError' && message.body?.severity === 'error') {
					const { path: fsPath, line, code } = message.body;
					if (message.body.compiling) {
						this.staticErrors.set(session.id, [...(this.staticErrors.get(session.id) ?? []), { path: fsPath, line, code }]);
					} else {
						this.lastErrors.set(session.id, { path: fsPath, line, code, message: message.body.message });
					}
				} else if (message?.type === 'event' && message.event === 'xsltDebugFailure' && message.body?.message) {
					const lastError = this.lastErrors.get(session.id);
					const error = lastError && lastError.message === message.body.message ?{ path: lastError.path, line: lastError.line, code: lastError.code } : undefined;
					this.failures.set(session.id, { message: message.body.message, error });
				}
			}
		};
	}

	public take(session: vscode.DebugSession): number | undefined {
		const exitCode = this.exitCodes.get(session.id);
		this.exitCodes.delete(session.id);
		return exitCode;
	}

	public takeStaticErrors(session: vscode.DebugSession): XsltStaticError[] {
		const errors = this.staticErrors.get(session.id) ?? [];
		this.staticErrors.delete(session.id);
		return errors;
	}

	public takeFailure(session: vscode.DebugSession): XsltDebugFailure | undefined {
		const failure = this.failures.get(session.id);
		this.failures.delete(session.id);
		this.lastErrors.delete(session.id);
		return failure;
	}
}
