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
import * as path from 'path';
import { McpRoot } from './mcpRoot';

export interface SessionResult {
	text: string;
	isError: boolean;
}

interface Frame {
	id: number;
	name: string;
	line: number;
	column: number;
	source?: { path?: string };
}

interface Variable {
	name: string;
	value: string;
	type?: string;
	variablesReference?: number;
}

// The debug_status and debug_evaluate tools: read-only access to the user's XSLT debug session in the window - where it's
// paused, the call stack, a frame's variables and context, and an XPath expression evaluated in a frame, as the Debug
// Console evaluates it. They never step, continue or change breakpoints: the user does that
export class DebugSessionTools {
	private static readonly sessions: vscode.DebugSession[] = [];
	private static debugType = '';
	private static readonly maxShown = 30;
	private static readonly maxWait = 600;

	public static register(context: vscode.ExtensionContext, debugType: string) {
		DebugSessionTools.debugType = debugType;
		context.subscriptions.push(vscode.debug.onDidStartDebugSession((session) => {
			if (session.type === debugType) {
				DebugSessionTools.sessions.push(session);
			}
		}));
		context.subscriptions.push(vscode.debug.onDidTerminateDebugSession((session) => {
			const index = DebugSessionTools.sessions.indexOf(session);
			if (index > -1) {
				DebugSessionTools.sessions.splice(index, 1);
			}
		}));
	}

	// the XSLT session: the active one if it's XSLT, else the last started - not one that has ended, which VS Code can
	// still give as the active one for a moment
	private static session(): vscode.DebugSession | undefined {
		const active = vscode.debug.activeDebugSession;
		if (active?.type === DebugSessionTools.debugType && DebugSessionTools.sessions.includes(active)) {
			return active;
		}
		return DebugSessionTools.sessions[DebugSessionTools.sessions.length - 1];
	}

	// the paused session's frames - undefined while it runs (the adapter answers nothing about a running transform)
	private static async frames(session: vscode.DebugSession): Promise<Frame[] | undefined> {
		try {
			const response = await session.customRequest('stackTrace', { threadId: 1 });
			const frames: Frame[] = response?.stackFrames ?? [];
			return frames.length > 0 ? frames : undefined;
		} catch {
			return undefined;
		}
	}

	// waitSeconds: how long to wait for a pause, e.g. while the user runs to a breakpoint; frame: the frame to show, 0 the top
	public static async status(waitSeconds = 0, frame = 0): Promise<SessionResult> {
		const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), DebugSessionTools.maxWait) * 1000;
		let session = DebugSessionTools.session();
		let frames = session ? await DebugSessionTools.frames(session) : undefined;
		while (!frames && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 250));
			session = DebugSessionTools.session();
			frames = session ? await DebugSessionTools.frames(session) : undefined;
		}
		if (!session) {
			return {
				text: 'No XSLT debug session in the user\'s VS Code window. Ask the user to set a breakpoint and start one (Run and Debug, F5) - ' +
					'or call this again with waitForPauseSeconds while they do. For values without a session, use trace_configuration.',
				isError: false
			};
		}
		const title = `Debug session '${session.name}'${session.configuration.xsltFile ? ` (${DebugSessionTools.shown(session.configuration.xsltFile)})` : ''}`;
		if (!frames) {
			return {
				text: `${title}: running, not paused${waitSeconds > 0 ? ` - it didn't pause within ${waitSeconds} s` : ''}. ` +
					'Ask the user to pause it at a breakpoint; you can\'t step or continue it yourself.',
				isError: false
			};
		}
		if (frame < 0 || frame >= frames.length) {
			return { text: `${title}: paused, with ${frames.length} frames - no frame ${frame}`, isError: true };
		}
		const top = frames[0];
		const lines = [`${title}: paused at ${DebugSessionTools.where(top)}`, '', 'Call stack (frame 0 is where it\'s paused):'];
		frames.slice(0, DebugSessionTools.maxShown).forEach((f, i) => lines.push(`  ${i} ${f.name} - ${DebugSessionTools.where(f)}`));
		if (frames.length > DebugSessionTools.maxShown) {
			lines.push(`  ... ${frames.length - DebugSessionTools.maxShown} more`);
		}
		const shownFrame = frames[frame];
		lines.push('', `Frame ${frame} (${shownFrame.name}):`);
		try {
			const { scopes } = await session.customRequest('scopes', { frameId: shownFrame.id });
			for (const scope of (scopes ?? []) as { name: string, variablesReference: number }[]) {
				if (scope.name === 'Globals' || scope.name === 'Output') {
					continue;
				}
				const variables: Variable[] = (await session.customRequest('variables', { variablesReference: scope.variablesReference })).variables ?? [];
				lines.push(`  ${scope.name}:${variables.length === 0 ? ' none' : ''}`);
				variables.slice(0, DebugSessionTools.maxShown).forEach((v) => lines.push(`    ${v.name} = ${v.value}${v.type ? `  (${v.type})` : ''}`));
				if (variables.length > DebugSessionTools.maxShown) {
					lines.push(`    ... ${variables.length - DebugSessionTools.maxShown} more`);
				}
			}
		} catch (e) {
			lines.push(`  (its variables couldn't be read: ${e instanceof Error ? e.message : String(e)} - the session may have moved on)`);
		}
		lines.push('', 'Global variables aren\'t listed: evaluate one with debug_evaluate, e.g. $name. Values are one-line summaries - ' +
			'debug_evaluate gives a value\'s items, entries or children, and XPath goes further ($m?key, $order/line[2]).');
		return { text: lines.join('\n'), isError: false };
	}

	// an XPath expression evaluated in a frame of the paused session, as the Debug Console does - with the first items,
	// entries or children of the result
	public static async evaluate(expression: string, frame = 0): Promise<SessionResult> {
		const session = DebugSessionTools.session();
		const frames = session ? await DebugSessionTools.frames(session) : undefined;
		if (!session || !frames) {
			return { text: `${session ? `Debug session '${session.name}' is running, not paused` : 'No XSLT debug session'} - debug_evaluate needs one paused at a breakpoint: ask the user. debug_status waits for a pause.`, isError: true };
		}
		if (frame < 0 || frame >= frames.length) {
			return { text: `The session is paused with ${frames.length} frames - no frame ${frame}`, isError: true };
		}
		let result: { result: string, type?: string, variablesReference?: number };
		try {
			result = await session.customRequest('evaluate', { expression, frameId: frames[frame].id, context: 'watch' });
		} catch (e) {
			return { text: `${expression}\n  error: ${e instanceof Error ? e.message : String(e)}`, isError: true };
		}
		const lines = [`${expression} in frame ${frame} (${frames[frame].name})`, `  = ${result.result}${result.type ? `  (${result.type})` : ''}`];
		if (result.variablesReference && result.variablesReference > 0) {
			try {
				const children: Variable[] = (await session.customRequest('variables', { variablesReference: result.variablesReference })).variables ?? [];
				children.slice(0, DebugSessionTools.maxShown).forEach((c) => lines.push(`    ${c.name} = ${c.value}${c.type ? `  (${c.type})` : ''}`));
				if (children.length > DebugSessionTools.maxShown) {
					lines.push(`    ... ${children.length - DebugSessionTools.maxShown} more - narrow the expression to see them`);
				}
			} catch {
				// its children aren't essential
			}
		}
		return { text: lines.join('\n'), isError: false };
	}

	private static where(frame: Frame): string {
		return frame.source?.path ? `${DebugSessionTools.shown(frame.source.path)}:${frame.line}` : `line ${frame.line}`;
	}

	private static shown(file: string): string {
		const folder = McpRoot.current();
		return folder && file.startsWith(folder + path.sep) ? path.relative(folder, file) : file;
	}
}
