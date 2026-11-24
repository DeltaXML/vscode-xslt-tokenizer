/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpRoot } from './mcpRoot';

// the last XSLT run (Run and Debug, or Run Without Debugging) in the window: its stylesheet and source, and when it ended
export interface LastRun {
	xsltFile?: string;
	xmlSource?: string;
	ended: number;
}

export type RunOutcome = 'ran' | 'declined' | 'timed out' | 'failed' | 'not asked' | 'off';

// For the MCP tools that read the user's last run (output_origin, input_rules): when there's none for what the assistant
// asks about - or the stylesheet or input has changed since - a notification in the user's window asks them to run it,
// with a button that does (Run Without Debugging, as Quick Run would), and the tool waits for it. The user decides: an
// assistant can't start the run itself, and 'Not now' answers it at once
export class RunRequest {
	private static debugType = '';
	private static last: LastRun | undefined;
	private static readonly starting = new Map<string, { xsltFile?: string, xmlSource?: string }>();
	// one notification at a time: a second tool call waits for the same answer
	private static pending: Promise<RunOutcome> | undefined;
	// the longest wait - and the default, if the assistant doesn't say
	public static readonly maxWait = 600;
	public static readonly defaultWait = 120;
	// the notification - only replaced by tests, which can't click it
	public static prompt = (message: string, ...items: string[]): Thenable<string | undefined> => vscode.window.showInformationMessage(message, ...items);
	public static readonly runChoice = 'Run Without Debugging';
	public static readonly alwaysChoice = 'Always Run for This Workspace';
	// the workspace's choice, 'Always Run for This Workspace' - in its state, not a setting a repository could set
	private static readonly alwaysKey = 'xslt.mcp.runForAssistant';
	private static workspaceState: vscode.Memento | undefined;

	public static register(context: vscode.ExtensionContext, debugType: string) {
		RunRequest.debugType = debugType;
		RunRequest.workspaceState = context.workspaceState;
		context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.askBeforeAssistantRuns', async () => {
			await RunRequest.askAgain();
			vscode.window.showInformationMessage('XSLT: an AI assistant\'s request to run a stylesheet will be asked about again in this workspace.');
		}));
		context.subscriptions.push(vscode.debug.onDidStartDebugSession((session) => {
			if (session.type === debugType) {
				const config = session.configuration;
				RunRequest.starting.set(session.id, { xsltFile: RunRequest.file(config.xsltFile), xmlSource: RunRequest.file(config.xmlSource) });
			}
		}));
		context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => {
			const started = RunRequest.starting.get(session.id);
			if (started) {
				RunRequest.starting.delete(session.id);
				RunRequest.last = { ...started, ended: Date.now() };
			}
		}));
	}

	public static lastRun(): LastRun | undefined {
		return RunRequest.last;
	}

	// why a new run is needed - undefined if the last will do: hasData, whether the last run recorded what's asked about
	public static whyRun(hasData: boolean, stylesheet?: string, input?: string): string | undefined {
		if (!hasData) {
			return 'there\'s no run of it in the window yet';
		}
		const ended = RunRequest.last?.ended;
		if (ended === undefined) {
			return undefined;
		}
		for (const file of [stylesheet ?? RunRequest.last?.xsltFile, input].filter((f): f is string => !!f)) {
			try {
				if (fs.statSync(file).mtimeMs > ended) {
					return `${path.basename(file)} has changed since the last run`;
				}
			} catch {
				// not there: the tool says so
			}
		}
		return undefined;
	}

	// asks the user to run the stylesheet - on the input, if given - and waits up to waitSeconds for the run to end
	public static async ask(stylesheet: string, input: string | undefined, why: string, purpose: string, waitSeconds: number): Promise<RunOutcome> {
		if (waitSeconds <= 0) {
			return 'not asked';
		}
		RunRequest.pending ??= RunRequest.askNow(stylesheet, input, why, purpose, Math.min(waitSeconds, RunRequest.maxWait)).finally(() => {
			RunRequest.pending = undefined;
		});
		return RunRequest.pending;
	}

	// the user's setting - and, with 'ask', their choice for the workspace: 'always' once they chose to always run
	public static policy(): 'ask' | 'always' | 'never' {
		const setting = vscode.workspace.getConfiguration('XSLT.mcp').get<string>('runForAssistant', 'ask');
		if (setting === 'never' || setting === 'always') {
			return setting;
		}
		return RunRequest.workspaceState?.get<boolean>(RunRequest.alwaysKey) ? 'always' : 'ask';
	}

	// forgets 'Always Run for This Workspace'
	public static async askAgain() {
		await RunRequest.workspaceState?.update(RunRequest.alwaysKey, undefined);
	}

	private static async askNow(stylesheet: string, input: string | undefined, why: string, purpose: string, waitSeconds: number): Promise<RunOutcome> {
		const policy = RunRequest.policy();
		if (policy === 'never') {
			return 'off';
		}
		const run = RunRequest.runChoice;
		const message = `An AI assistant asks for a run of ${path.basename(stylesheet)}${input ? ` on ${path.basename(input)}` : ''}, to see ${purpose}: ${why}.`;
		// the whole wait - for an answer, then for the run to end
		let timer: NodeJS.Timeout | undefined;
		let expired = false;
		const timedOut = new Promise<undefined>((resolve) => {
			timer = setTimeout(() => {
				expired = true;
				resolve(undefined);
			}, waitSeconds * 1000);
		});
		// asked - unless the user has said to always run it
		const choice = policy === 'always' ? run : await Promise.race([RunRequest.prompt(message, run, RunRequest.alwaysChoice, 'Not Now'), timedOut]);
		if (choice === RunRequest.alwaysChoice) {
			await RunRequest.workspaceState?.update(RunRequest.alwaysKey, true);
		} else if (choice !== run) {
			clearTimeout(timer);
			// no answer in time - else 'Not Now', or the notification closed
			return expired ? 'timed out' : 'declined';
		}
		// without a notification, it's still shown that it ran, and why
		const status = policy === 'always' ? vscode.window.setStatusBarMessage(`$(play) Running ${path.basename(stylesheet)} for an AI assistant`) : undefined;
		const name = `${path.basename(stylesheet)} (for an AI assistant)`;
		const ended = new Promise<boolean>((resolve) => {
			const listener = vscode.debug.onDidTerminateDebugSession((session) => {
				if (session.name === name) {
					listener.dispose();
					resolve(true);
				}
			});
			timedOut.then(() => {
				listener.dispose();
				resolve(false);
			});
		});
		try {
			// as the user would: the input file first - it's the XML context file of a stylesheet that has none - then
			// the stylesheet, which Quick Run's configuration is for
			if (input) {
				await vscode.window.showTextDocument(vscode.Uri.file(input), { preview: true, preserveFocus: true });
			}
			await vscode.window.showTextDocument(vscode.Uri.file(stylesheet), { preview: false });
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(stylesheet));
			const started = await vscode.debug.startDebugging(folder, {
				type: RunRequest.debugType, request: 'launch', name, quickRun: true, ...(input ? { xmlSource: input } : {}),
				resultPath: RunRequest.resultPath(stylesheet)
			}, { noDebug: true });
			if (!started) {
				clearTimeout(timer);
				status?.dispose();
				return 'failed';
			}
		} catch {
			clearTimeout(timer);
			status?.dispose();
			return 'failed';
		}
		const finished = await ended;
		clearTimeout(timer);
		status?.dispose();
		if (policy === 'always' && finished) {
			vscode.window.setStatusBarMessage(`$(check) Ran ${path.basename(stylesheet)} for an AI assistant`, 5000);
		}
		return finished ? 'ran' : 'timed out';
	}

	// where a run for an assistant writes its result: a folder for the stylesheet in the temporary files - not where the user
	// would be asked, as for Quick Run, which would be a second prompt; and relative xsl:result-document hrefs go there too, not
	// into the project. The debugger's output view shows the result as for any run
	public static resultPath(stylesheet: string): string {
		const hash = crypto.createHash('sha1').update(stylesheet).digest('hex').substring(0, 8);
		const base = path.basename(stylesheet, path.extname(stylesheet));
		return path.join(os.tmpdir(), 'xslt-xpath', 'assistant-run', `${base}-${hash}`, `${base}.out`);
	}

	// a sentence for the tool's answer about how the run went, if a run was asked for
	public static note(outcome: RunOutcome | undefined, why: string | undefined): string | undefined {
		switch (outcome) {
			case 'ran': return 'It was run just now, for you, with the user\'s permission.';
			case 'off': return `Runs for an assistant are turned off by the user (${why}) - read the code, or use trace_configuration.`;
			case 'declined': return `The user chose not to run it now (${why}).`;
			case 'timed out': return `No run finished in time (${why}) - the user may not be there: ask them in the chat, or use trace_configuration.`;
			case 'failed': return `The run couldn't be started (${why}) - see the user's VS Code window.`;
			default: return why ? `Note: ${why}. Give waitForRunSeconds to ask the user to run it.` : undefined;
		}
	}

	private static file(value: unknown): string | undefined {
		if (typeof value !== 'string' || !value || /\$\{/.test(value)) {
			return undefined;
		}
		const folder = McpRoot.current();
		return path.isAbsolute(value) || !folder ? value : path.join(folder, value);
	}
}
