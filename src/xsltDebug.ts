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
	// can't be paused at, as the stylesheet never ran
	public static sessionEndMessage(name: string, exitCode: number, staticErrors: XsltStaticError[]): string {
		if (exitCode === 0) {
			return `Completed debug session: '${name}'`;
		}
		if (staticErrors.length > 0) {
			const [first] = staticErrors;
			const more = staticErrors.length > 1 ? `, and ${staticErrors.length - 1} more` : '';
			const errors = staticErrors.length > 1 ? 'static errors' : 'a static error';
			return `XSLT debugger: the stylesheet has ${errors}, so it can't be debugged - ${first.code ? first.code + ' ' : ''}at line ${first.line} of ${path.basename(first.path)}${more} (see the Problems view)`;
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

export class XsltDebugOutputs implements vscode.TextDocumentContentProvider, vscode.DefinitionProvider {
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

	public static uri(name: string): vscode.Uri {
		return vscode.Uri.from({ scheme: XsltDebugOutputs.scheme, path: `/debug output/${name}` });
	}

	// the output's language, from its output method
	public static languageId(method: string): string {
		return method === 'xml' || method === 'xhtml' ? 'xml' : method === 'html' ? 'html' : method === 'json' ? 'json' : 'plaintext';
	}

	public provideTextDocumentContent(uri: vscode.Uri): string {
		const output = this.outputs.get(path.posix.basename(uri.path));
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
		if (!this.openedThisSession && vscode.workspace.getConfiguration('XSLT.debug').get('openOutput', true)) {
			const name = this.current && this.outputs.get(this.current)?.text ? this.current : this.names().find((n) => this.outputs.get(n)?.text);
			if (name) {
				this.openedThisSession = true;
				this.show(name);
			}
		}
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
	// an offset within a tag, the tag's, as an emitter writes the '>' of a start tag with the next event's text.
	// runs: [offset, location id, ...], each run from its offset to the next run's
	public static locationAt(text: string, runs: number[], locations: Map<number, XsltOutputLocation>, offset: number): { location: XsltOutputLocation, start: number, end: number } | undefined {
		const tagStart = text.lastIndexOf('<', offset);
		const at = tagStart > text.lastIndexOf('>', offset - 1) ? tagStart : offset;
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
	// found is within the text node Saxon reports it for, at its start or end - else the reported position
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
			return index > -1 && index + found.length <= end ? index : reported;
		}
		return reported;
	}

	// the source location for the position in an output document - undefined if it isn't known
	public async sourceLocation(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location | undefined> {
		return document.uri.scheme === XsltDebugOutputs.scheme ? this.sourceLocationAt(path.posix.basename(document.uri.path), document.offsetAt(position)) : undefined;
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

	// go to definition: the source of the output at the position
	public async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
		return this.sourceLocation(document, position);
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
			const method = this.outputs.get(path.posix.basename(editor.document.uri.path))?.method;
			vscode.window.showInformationMessage(method && method !== 'xml' ? `XSLT debugger: only XML output can be traced back to the stylesheet - this output's method is '${method}'.` :
				'XSLT debugger: where this part of the output came from isn\'t known.');
			return;
		}
		const others = vscode.window.visibleTextEditors.filter((e) => e.viewColumn !== editor.viewColumn);
		const column = others.find((e) => e.document.uri.toString() === location.uri.toString())?.viewColumn ?? others[0]?.viewColumn ?? vscode.ViewColumn.Beside;
		await vscode.window.showTextDocument(location.uri, { viewColumn: column, selection: location.range, preview: false });
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

export class XsltDebugExitCodes implements vscode.DebugAdapterTrackerFactory {
	private exitCodes = new Map<string, number>();
	private staticErrors = new Map<string, XsltStaticError[]>();

	public createDebugAdapterTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
		return {
			onDidSendMessage: (message: any) => {
				if (message?.type === 'event' && message.event === 'exited') {
					this.exitCodes.set(session.id, message.body?.exitCode);
				} else if (message?.type === 'event' && message.event === 'xsltDebugError' && message.body?.compiling && message.body.severity === 'error') {
					const { path: fsPath, line, code } = message.body;
					this.staticErrors.set(session.id, [...(this.staticErrors.get(session.id) ?? []), { path: fsPath, line, code }]);
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
}
