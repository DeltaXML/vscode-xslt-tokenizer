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
import { XmlElement, parseXml } from './xspecXml';
import { lineOf } from './debugSourceMap';

const schematronNamespace = 'http://purl.oclc.org/dsdl/schematron';

// A breakpoint added to a Schematron file where the debugger can't stop is moved when it's added - before a session starts,
// when VS Code can't yet show it as unverified - to the step it's in, keeping its condition, hit count and log message:
// - a line in an assertion's message: the assert or report
// - a line in a rule, e.g. its extends: the rule
// - a pattern's param - replaced by its value when the schema is compiled - its let, title or p: the pattern, where a
//   breakpoint pauses at each of its rules; for an abstract pattern, in each pattern that uses it
// Where nothing contains a step - e.g. sch:ns, the schema's title, a phase or sch:diagnostics - it's removed, as is one on
// the schema's or a phase's global let or param, which the debugger never pauses at. The steps are those
// SchematronSourceMap maps: rule, a rule's let, assert, report, value-of in a message, pattern and group. A pattern that isn't active in the phase is known only when a session
// starts: its breakpoints are then shown as unverified, with why
export class SchBreakpoints {

	public static register(context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.debug.onDidChangeBreakpoints((event) => {
			const added = [...event.added, ...event.changed].filter((b): b is vscode.SourceBreakpoint =>
				b instanceof vscode.SourceBreakpoint && /\.sch$/i.test(b.location.uri.path));
			if (added.length > 0) {
				SchBreakpoints.snap(added);
			}
		}));
	}

	// the 0-based line of the step for a 0-based line, from the Schematron file's text - undefined if nothing contains a
	// step - with why, for a parameter, or a global let or param
	public static stepLine(text: string, line: number): { line: number | undefined, why?: string } {
		const root = parseXml(text);
		if (!root) {
			return { line };
		}
		const lineAt = lineOf(text);
		// 0-based
		const first = (e: XmlElement) => lineAt(e.start) - 1;
		const last = (e: XmlElement) => lineAt(e.end) - 1;
		const isSchematron = (e: XmlElement) => {
			const colon = e.name.indexOf(':');
			const attribute = colon > 0 ? 'xmlns:' + e.name.substring(0, colon) : 'xmlns';
			for (let a: XmlElement | undefined = e; a; a = a.parent) {
				const uri = a.attributes.get(attribute);
				if (uri !== undefined) {
					return uri === schematronNamespace;
				}
			}
			return false;
		};
		const local = (e: XmlElement) => e.name.replace(/^.*:/, '');
		const parentName = (e: XmlElement) => e.parent && isSchematron(e.parent) ? local(e.parent) : undefined;
		const globalParent = (e: XmlElement) => ['schema', 'library', 'phase'].includes(parentName(e) ?? '') || !e.parent;
		const inAssertion = (e: XmlElement) => {
			for (let a = e.parent; a; a = a.parent) {
				if (isSchematron(a) && ['assert', 'report'].includes(local(a))) {
					return true;
				}
			}
			return false;
		};
		// whether the debugger can stop at the element itself, on its first line
		const isStep = (e: XmlElement) => {
			if (!isSchematron(e)) {
				return false;
			}
			switch (local(e)) {
				case 'rule': case 'assert': case 'report': case 'pattern': case 'group':
					return true;
				case 'let':
					return parentName(e) === 'rule';
				case 'value-of':
					return inAssertion(e);
				default:
					return false;
			}
		};
		// on the first line of a step: stays - e.g. a pattern, with is-a and its params, on one line
		const all: XmlElement[] = [];
		const collect = (e: XmlElement) => {
			all.push(e);
			e.children.forEach(collect);
		};
		collect(root);
		if (all.some((e) => first(e) === line && isStep(e))) {
			return { line };
		}
		// else the innermost element containing the line, then its ancestors: the first that's a step
		const containing = all.filter((e) => first(e) <= line && line <= last(e));
		let element: XmlElement | undefined = containing[containing.length - 1];
		const declaration = element && isSchematron(element) && ['let', 'param'].includes(local(element)) && first(element) === line ? element : undefined;
		if (declaration && globalParent(declaration)) {
			return { line: undefined, why: `a global ${local(declaration)} is evaluated before the rules run - its value is in the Globals scope` };
		}
		for (; element; element = element.parent) {
			if (isStep(element)) {
				return { line: first(element), why: declaration && local(declaration) === 'param' ? 'a parameter is replaced by its value when the schema is compiled' : undefined };
			}
		}
		return { line: undefined };
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
			const step = SchBreakpoints.stepLine(text, line);
			if (step.line === line) {
				continue;
			}
			remove.push(breakpoint);
			if (step.line === undefined) {
				notes.push(`${step.why ?? `no step at line ${line + 1}`} - breakpoint removed`);
				continue;
			}
			const taken = vscode.debug.breakpoints.some((b) => b instanceof vscode.SourceBreakpoint && b !== breakpoint &&
				b.location.uri.toString() === breakpoint.location.uri.toString() && b.location.range.start.line === step.line);
			if (!taken) {
				add.push(new vscode.SourceBreakpoint(new vscode.Location(breakpoint.location.uri, new vscode.Position(step.line!, 0)),
					breakpoint.enabled, breakpoint.condition, breakpoint.hitCondition, breakpoint.logMessage));
			}
			notes.push(`${step.why ? step.why + ' - ' : `no step at line ${line + 1} - `}breakpoint moved to line ${step.line! + 1}`);
		}
		if (remove.length > 0) {
			vscode.debug.removeBreakpoints(remove);
			vscode.debug.addBreakpoints(add);
			vscode.window.setStatusBarMessage(`Schematron: ${notes.join('; ')} (breakpoints stop on a rule, let, assert or report, a value-of in a message, or a pattern)`, 8000);
		}
	}
}
