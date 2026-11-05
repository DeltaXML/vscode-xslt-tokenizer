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
import { XSpecTests, XSpecTestNode } from './xspecTests';

// A breakpoint added to an XSpec file where the debugger can't stop - e.g. on an x:param of an x:call, in an x:context's
// content, or outside the scenarios - is moved to the step it's in: its x:call or x:context, or its x:scenario - or, if
// it's not in a scenario, removed. The steps are those XSpecSourceMap maps: x:scenario, x:call, x:context and x:expect
export class XSpecBreakpoints {

	public static register(context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.debug.onDidChangeBreakpoints((event) => {
			const moved = [...event.added, ...event.changed].filter((b): b is vscode.SourceBreakpoint =>
				b instanceof vscode.SourceBreakpoint && b.location.uri.path.endsWith('.xspec'));
			if (moved.length > 0) {
				XSpecBreakpoints.snap(moved);
			}
		}));
	}

	// the 0-based line of the step for a 0-based line, from the XSpec file's text: undefined if it's not in a scenario
	public static stepLine(text: string, line: number): number | undefined {
		const lineOf = (offset: number) => text.substring(0, offset).split('\n').length - 1;
		let step: number | undefined;
		const visit = (nodes: XSpecTestNode[]) => {
			for (const node of nodes) {
				const first = lineOf(node.start);
				const last = lineOf(node.end);
				if (line < first || line > last) {
					continue;
				}
				step = first;
				if (node.callStart !== undefined) {
					const callLine = lineOf(node.callStart);
					// in the x:call or x:context: up to the first child - not the scenario's end tag after them
					const firstChild = node.children.length > 0 ? lineOf(node.children[0].start) : last;
					if (line >= callLine && line < firstChild) {
						step = callLine;
					}
				}
				visit(node.children);
				return;
			}
		};
		visit(XSpecTests.testTree(text));
		return step;
	}

	private static async snap(breakpoints: vscode.SourceBreakpoint[]) {
		const remove: vscode.SourceBreakpoint[] = [];
		const add: vscode.SourceBreakpoint[] = [];
		const notes: string[] = [];
		for (const breakpoint of breakpoints) {
			let text: string;
			try {
				text = (await vscode.workspace.openTextDocument(breakpoint.location.uri)).getText();
			} catch {
				continue;
			}
			const line = breakpoint.location.range.start.line;
			const step = XSpecBreakpoints.stepLine(text, line);
			if (step === line) {
				continue;
			}
			remove.push(breakpoint);
			const taken = vscode.debug.breakpoints.some((b) => b instanceof vscode.SourceBreakpoint && b !== breakpoint &&
				b.location.uri.toString() === breakpoint.location.uri.toString() && b.location.range.start.line === step);
			if (step === undefined) {
				notes.push(`line ${line + 1} isn't in a scenario - breakpoint removed`);
			} else {
				if (!taken) {
					add.push(new vscode.SourceBreakpoint(new vscode.Location(breakpoint.location.uri, new vscode.Position(step, 0)),
						breakpoint.enabled, breakpoint.condition, breakpoint.hitCondition, breakpoint.logMessage));
				}
				notes.push(`no step on line ${line + 1} - breakpoint moved to line ${step + 1}`);
			}
		}
		if (remove.length > 0) {
			vscode.debug.removeBreakpoints(remove);
			vscode.debug.addBreakpoints(add);
			vscode.window.setStatusBarMessage(`XSpec: ${notes.join('; ')} (breakpoints stop on x:scenario, x:call, x:context and x:expect)`, 6000);
		}
	}
}
