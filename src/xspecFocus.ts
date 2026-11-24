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
import { XmlElement, parseXml, localName, descendants } from './xspecXml';

// XSpec: pending and focus on x:scenario - code actions in a scenario's start tag to add or remove each, and information
// for each focus attribute: with one, XSpec runs only the focused scenarios, and every other scenario in the file is
// pending - easily left in by mistake. Its quick fixes remove it, or every focus attribute in the file
export class XSpecFocus {
	public static readonly code = 'xspec-focus';

	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		const text = document.getText();
		return XSpecFocus.scenarios(text).flatMap((scenario) => {
			const focus = XSpecFocus.attributeRange(text, scenario, 'focus');
			if (!focus) {
				return [];
			}
			const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(focus.nameStart), document.positionAt(focus.end)),
				'XSpec: focus - only the focused scenarios are run, and every other scenario in this file is pending', vscode.DiagnosticSeverity.Information);
			diagnostic.code = XSpecFocus.code;
			return [diagnostic];
		});
	}

	public static codeActions(document: vscode.TextDocument, range: vscode.Range, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
		const text = document.getText();
		const scenarios = XSpecFocus.scenarios(text);
		const offset = document.offsetAt(range.start);
		const actions: vscode.CodeAction[] = [];
		const focused = scenarios.filter((s) => XSpecFocus.attributeRange(text, s, 'focus'));
		const removeAllFocus = (kind: vscode.CodeActionKind, diagnostic?: vscode.Diagnostic) => {
			const action = new vscode.CodeAction(`Remove focus from ${focused.length === 1 ? 'the scenario' : `all ${focused.length} scenarios`} in this file`, kind);
			action.edit = new vscode.WorkspaceEdit();
			focused.forEach((s) => XSpecFocus.remove(document, action.edit!, text, s, 'focus'));
			if (diagnostic) {
				action.diagnostics = [diagnostic];
			}
			return action;
		};
		// the quick fixes for a focus problem
		diagnostics.filter((d) => d.code === XSpecFocus.code).forEach((diagnostic) => {
			const scenario = scenarios.find((s) => XSpecFocus.attributeRange(text, s, 'focus')?.nameStart === document.offsetAt(diagnostic.range.start));
			if (scenario) {
				const action = new vscode.CodeAction('Remove focus', vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				action.edit = new vscode.WorkspaceEdit();
				XSpecFocus.remove(document, action.edit, text, scenario, 'focus');
				actions.push(action);
				if (focused.length > 1) {
					actions.push(removeAllFocus(vscode.CodeActionKind.QuickFix, diagnostic));
				}
			}
		});
		// in a scenario's start tag
		const scenario = scenarios.find((s) => s.start < offset && offset < s.contentStart);
		if (!scenario) {
			return actions;
		}
		const kind = vscode.CodeActionKind.RefactorRewrite;
		for (const [attribute, add, remove] of [['pending', 'Mark the scenario as pending', 'Remove pending - run the scenario'], ['focus', 'Focus on the scenario - the others are pending', 'Remove focus']]) {
			if (XSpecFocus.attributeRange(text, scenario, attribute)) {
				if (attribute !== 'focus' || !actions.some((a) => a.title === remove)) {
					const action = new vscode.CodeAction(remove, kind);
					action.edit = new vscode.WorkspaceEdit();
					XSpecFocus.remove(document, action.edit, text, scenario, attribute);
					actions.push(action);
				}
			} else {
				const action = new vscode.CodeAction(add, kind);
				action.edit = new vscode.WorkspaceEdit();
				const position = document.positionAt(XSpecFocus.tagEnd(text, scenario));
				// the reason, or a name for the focus
				action.edit.set(document.uri, [new vscode.SnippetTextEdit(new vscode.Range(position, position), new vscode.SnippetString(` ${attribute}="\${1:${attribute === 'pending' ? 'to do' : 'debugging'}}"`))]);
				actions.push(action);
			}
		}
		if (focused.length > 1 && !actions.some((a) => a.title.startsWith('Remove focus from'))) {
			actions.push(removeAllFocus(kind));
		}
		return actions;
	}

	private static scenarios(text: string): XmlElement[] {
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return [];
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		return descendants(root).filter((element) => element.name === prefix + 'scenario');
	}

	// where the attribute is in the element's start tag: its name, and the end of its value
	private static attributeRange(text: string, element: XmlElement, attribute: string): { start: number, nameStart: number, end: number } | undefined {
		const startTag = text.substring(element.start, element.contentStart);
		const match = new RegExp(`(\\s+)${attribute}\\s*=\\s*("[^"]*"|'[^']*')`).exec(startTag);
		return match ? { start: element.start + match.index, nameStart: element.start + match.index + match[1].length, end: element.start + match.index + match[0].length } : undefined;
	}

	private static remove(document: vscode.TextDocument, edit: vscode.WorkspaceEdit, text: string, element: XmlElement, attribute: string) {
		const range = XSpecFocus.attributeRange(text, element, attribute);
		if (range) {
			edit.delete(document.uri, new vscode.Range(document.positionAt(range.start), document.positionAt(range.end)));
		}
	}

	// before the start tag's '>' or '/>', and any space before it
	private static tagEnd(text: string, element: XmlElement): number {
		let at = element.contentStart - (text.charAt(element.contentStart - 2) === '/' ? 2 : 1);
		while (/\s/.test(text.charAt(at - 1))) {
			at--;
		}
		return at;
	}
}
