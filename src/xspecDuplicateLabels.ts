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
import { XmlElement, parseXml, localName } from './xspecXml';

// XSpec: scenarios with the same label in one scenario (or x:description), or expectations with the same label in one
// scenario. XSpec runs them, but its report, and the Test Explorer, show the same names for different tests - so which
// failed is only found by opening them. A warning for each after the first, with the first as related information. A
// shared scenario isn't included: x:like's checks are for its label (see XSpecLike.problems)
export class XSpecDuplicateLabels {
	public static readonly code = 'xspec-duplicate-label';

	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		const text = document.getText();
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return [];
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		const diagnostics: vscode.Diagnostic[] = [];
		const check = (parent: XmlElement) => {
			const children = XSpecDuplicateLabels.children(parent, prefix);
			for (const kind of ['scenario', 'expect']) {
				const first = new Map<string, XmlElement>();
				children.filter((child) => child.name === prefix + kind && !(kind === 'scenario' && XSpecDuplicateLabels.isShared(child))).forEach((element) => {
					const label = XSpecDuplicateLabels.label(element, prefix);
					if (label === undefined || label === '') {
						return;
					}
					const earlier = first.get(label);
					if (!earlier) {
						first.set(label, element);
						return;
					}
					const where = kind === 'scenario' ? (parent === root ? 'at the top level of this file' : 'in this scenario') : 'in this scenario';
					const range = XSpecDuplicateLabels.labelRange(document, text, element, prefix);
					const diagnostic = new vscode.Diagnostic(range, `XSpec: another ${kind === 'scenario' ? 'scenario' : 'expectation'} ${where} has the label '${label}' - the report and the Test Explorer show the same name for both`, vscode.DiagnosticSeverity.Warning);
					diagnostic.code = XSpecDuplicateLabels.code;
					diagnostic.relatedInformation = [new vscode.DiagnosticRelatedInformation(new vscode.Location(document.uri, XSpecDuplicateLabels.labelRange(document, text, earlier, prefix)), `the ${kind === 'scenario' ? 'scenario' : 'expectation'} '${label}'`)];
					diagnostics.push(diagnostic);
				});
			}
			children.filter((child) => child.name === prefix + 'scenario').forEach(check);
		};
		check(root);
		return diagnostics.sort((a, b) => a.range.start.compareTo(b.range.start));
	}

	// the children, with those of an x:pending in place of it - as XSpec runs them, as pending, with its siblings
	private static children(parent: XmlElement, prefix: string): XmlElement[] {
		return parent.children.flatMap((child) => child.name === prefix + 'pending' ? XSpecDuplicateLabels.children(child, prefix) : [child]);
	}

	private static isShared(element: XmlElement) {
		return ['yes', 'true', '1'].includes((element.attributes.get('shared') ?? '').trim());
	}

	// its label attribute, or its x:label's text, with the space normalized - as the Test Explorer has it (see XSpecTests)
	private static label(element: XmlElement, prefix: string): string | undefined {
		const attribute = element.attributes.get('label');
		const labelElement = element.children.find((child) => child.name === prefix + 'label');
		const label = attribute ?? labelElement?.text;
		return label?.replace(/\s+/g, ' ').trim();
	}

	// the label attribute's value, or the x:label element - or else the element's name
	private static labelRange(document: vscode.TextDocument, text: string, element: XmlElement, prefix: string): vscode.Range {
		const startTag = text.substring(element.start, element.contentStart);
		const match = /\slabel\s*=\s*(["'])([\s\S]*?)\1/.exec(startTag);
		if (match) {
			const start = element.start + match.index + match[0].length - 1 - match[2].length;
			return new vscode.Range(document.positionAt(start), document.positionAt(start + match[2].length));
		}
		const labelElement = element.children.find((child) => child.name === prefix + 'label');
		if (labelElement) {
			return new vscode.Range(document.positionAt(labelElement.start), document.positionAt(labelElement.end));
		}
		return new vscode.Range(document.positionAt(element.start + 1), document.positionAt(element.start + 1 + element.name.length));
	}
}
