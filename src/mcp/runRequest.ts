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
import * as fs from 'fs';
import * as path from 'path';
import { McpRoot } from './mcpRoot';

// the last XSLT run (Run and Debug, or Run Without Debugging) in the window: its stylesheet and source, and when it ended
export interface LastRun {
	xsltFile?: string;
	xmlSource?: string;
	ended: number;
}

export type RunOutcome = 'ran' | 'declined' | 'timed out' | 'failed' | 'not asked';

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

	public static register(context: vscode.ExtensionContext, debugType: string) {
		RunRequest.debugType = debugType;
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

	private static async askNow(stylesheet: string, input: string | undefined, why: string, purpose: string, waitSeconds: number): Promise<RunOutcome> {
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
		const choice = await Promise.race([RunRequest.prompt(message, run, 'Not Now'), timedOut]);
		if (choice !== run) {
			clearTimeout(timer);
			// no answer in time - else 'Not Now', or the notification closed
			return expired ? 'timed out' : 'declined';
		}
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
				type: RunRequest.debugType, request: 'launch', name, quickRun: true, ...(input ? { xmlSource: input } : {})
			}, { noDebug: true });
			if (!started) {
				clearTimeout(timer);
				return 'failed';
			}
		} catch {
			clearTimeout(timer);
			return 'failed';
		}
		const finished = await ended;
		clearTimeout(timer);
		return finished ? 'ran' : 'timed out';
	}

	// a sentence for the tool's answer about how the run went, if a run was asked for
	public static note(outcome: RunOutcome | undefined, why: string | undefined): string | undefined {
		switch (outcome) {
			case 'ran': return 'The user ran it just now, when you asked.';
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
