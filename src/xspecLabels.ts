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

// The labels of an XSpec file's scenarios, in bold, and of its expectations, in italic - so the scenarios read like
// headings, with their expectations under them. A label is a label attribute's value or an x:label element's content.
// And the pending scenarios and expectations - in x:pending, or with a pending attribute - faded, as XSpec doesn't run
// them, other than the reason they're pending: x:pending's label, or the pending attribute's value. Turned off with the
// XSLT.xspec.emphasiseLabels and XSLT.xspec.fadePending settings
export class XSpecLabels {
	private static readonly scenarioDecoration = vscode.window.createTextEditorDecorationType({ fontWeight: 'bold' });
	private static readonly expectDecoration = vscode.window.createTextEditorDecorationType({ fontStyle: 'italic' });
	private static readonly pendingDecoration = vscode.window.createTextEditorDecorationType({ opacity: '0.5' });

	// the offsets - [start, end] - of the labels of the scenarios and of the expectations, and of the pending parts
	public static find(text: string): { scenarios: [number, number][], expectations: [number, number][], pending: [number, number][] } {
		const scenarios: [number, number][] = [];
		const expectations: [number, number][] = [];
		const pending: [number, number][] = [];
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return { scenarios, expectations, pending };
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		const isXSpec = (name: string) => name.startsWith(prefix) && (prefix !== '' || !name.includes(':'));
		const attributeValue = (element: XmlElement, attribute: string): [number, number] | undefined => {
			const match = new RegExp(`\\s${attribute}\\s*=\\s*(["'])`).exec(text.substring(element.start, element.contentStart));
			const start = match ? element.start + match.index + match[0].length : -1;
			return match ? [start, text.indexOf(match[1], start)] : undefined;
		};
		const labelChild = (element: XmlElement) => element.children.find((child) => isXSpec(child.name) && localName(child.name) === 'label');
		// the end of the pending element faded last, so those within it aren't faded again
		let pendingEnd = -1;
		for (const element of descendants(root)) {
			const name = localName(element.name);
			const reason = element.start < pendingEnd || !isXSpec(element.name) ? undefined :
				name === 'pending' ? attributeValue(element, 'label') ?? (labelChild(element) ? [labelChild(element)!.contentStart, labelChild(element)!.contentEnd] : [element.start, element.start]) :
				name === 'scenario' || name.startsWith('expect') ? attributeValue(element, 'pending') : undefined;
			if (reason) {
				pending.push([element.start, reason[0]], [reason[1], element.end]);
				pendingEnd = element.end;
			}
			const labels = !isXSpec(element.name) ? undefined : name === 'scenario' ? scenarios : name.startsWith('expect') ? expectations : undefined;
			if (!labels) {
				continue;
			}
			const label = attributeValue(element, 'label');
			if (label) {
				labels.push(label);
			}
			const labelElement = labelChild(element);
			if (labelElement && labelElement.contentEnd > labelElement.contentStart) {
				labels.push([labelElement.contentStart, labelElement.contentEnd]);
			}
		}
		return { scenarios, expectations, pending: pending.filter(([start, end]) => end > start) };
	}

	public static register(context: vscode.ExtensionContext) {
		const timers = new Map<string, NodeJS.Timeout>();
		const decorate = (editor: vscode.TextEditor) => {
			const document = editor.document;
			const settings = vscode.workspace.getConfiguration('XSLT.xspec', document.uri);
			const labels = settings.get<boolean>('emphasiseLabels', true);
			const fade = settings.get<boolean>('fadePending', true);
			const { scenarios, expectations, pending } = document.languageId === 'xspec' && (labels || fade) ? XSpecLabels.find(document.getText()) : { scenarios: [], expectations: [], pending: [] };
			const ranges = (offsets: [number, number][]) => offsets.map(([start, end]) => new vscode.Range(document.positionAt(start), document.positionAt(end)));
			editor.setDecorations(XSpecLabels.scenarioDecoration, labels ? ranges(scenarios) : []);
			editor.setDecorations(XSpecLabels.expectDecoration, labels ? ranges(expectations) : []);
			editor.setDecorations(XSpecLabels.pendingDecoration, fade ? ranges(pending) : []);
		};
		const decorateVisible = () => vscode.window.visibleTextEditors.filter((editor) => editor.document.languageId === 'xspec').forEach(decorate);
		context.subscriptions.push(
			XSpecLabels.scenarioDecoration, XSpecLabels.expectDecoration, XSpecLabels.pendingDecoration,
			vscode.window.onDidChangeVisibleTextEditors(decorateVisible),
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (e.document.languageId !== 'xspec' || e.contentChanges.length === 0) {
					return;
				}
				const key = e.document.uri.toString();
				clearTimeout(timers.get(key));
				timers.set(key, setTimeout(() => {
					timers.delete(key);
					vscode.window.visibleTextEditors.filter((editor) => editor.document === e.document).forEach(decorate);
				}, 200));
			}),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('XSLT.xspec.emphasiseLabels') || e.affectsConfiguration('XSLT.xspec.fadePending')) {
					decorateVisible();
				}
			})
		);
		decorateVisible();
	}
}
