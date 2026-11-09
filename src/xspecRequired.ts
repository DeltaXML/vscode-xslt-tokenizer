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

// The attributes XSpec's schema (xspec.rnc) requires that an XSpec element is missing - not in the schema data, which
// doesn't keep which attributes are required. An error where XSpec 4 fails without it: x:import href (its compiler
// fails, XPDY0050), x:like's label ('Scenario not found') and the name of an x:param of a template - in x:call
// template="..." or x:context (its compiler fails, XPTY0004). Otherwise a warning, as XSpec runs the test, but it's
// almost certainly wrong: an x:variable or global x:param with no name can't be referred to, and a scenario or
// expectation with no label has none in the report. A label is an attribute or an x:label child
export class XSpecRequired {
	public static readonly missingAttribute = 'xspec-missing-attribute';

	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		return XSpecRequired.missing(document.getText()).map(({ element, prefix, attribute, oneOf, severity }) => {
			const start = document.positionAt(element.start + 1);
			const range = new vscode.Range(start, start.translate(0, element.name.length));
			const what = oneOf ? `one of the attributes ${oneOf.map((a) => `'${a}'`).join(', ')}` : attribute === 'label' ? `a label - a label attribute or an ${prefix}label element` : `a '${attribute}' attribute`;
			const consequence = severity === vscode.DiagnosticSeverity.Error ? ' - XSpec fails without it' : '';
			const diagnostic = new vscode.Diagnostic(range, `XSpec: ${element.name} must have ${what}${consequence}`, severity);
			diagnostic.code = XSpecRequired.missingAttribute;
			return diagnostic;
		});
	}

	// a quick fix for each: the attribute added at the end of the start tag, with its value to give
	public static codeActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
		const missing = XSpecRequired.missing(document.getText());
		return diagnostics.filter((d) => d.code === XSpecRequired.missingAttribute).flatMap((diagnostic) => {
			const found = missing.find((m) => m.element.start + 1 === document.offsetAt(diagnostic.range.start));
			if (!found) {
				return [];
			}
			const attribute = found.attribute ?? found.oneOf![0];
			const action = new vscode.CodeAction(`Add a '${attribute}' attribute`, vscode.CodeActionKind.QuickFix);
			action.diagnostics = [diagnostic];
			action.isPreferred = true;
			// before the start tag's '>' or '/>', and any space before it
			const text = document.getText();
			let at = found.element.contentStart - (text.charAt(found.element.contentStart - 2) === '/' ? 2 : 1);
			while (/\s/.test(text.charAt(at - 1))) {
				at--;
			}
			const position = document.positionAt(at);
			action.edit = new vscode.WorkspaceEdit();
			action.edit.set(document.uri, [new vscode.SnippetTextEdit(new vscode.Range(position, position), new vscode.SnippetString(` ${attribute}="$1"`))]);
			return [action];
		});
	}

	// the attributes an XSpec element must have - one of them, for oneOf; 'label' is a label attribute or an x:label child
	// - by its local name, and for x:param, where it is. fails: XSpec fails without it, so it's an error
	public static ruleFor(element: string, parent: string | undefined, parentHas: (attribute: string) => boolean): { oneOf: string[], fails: boolean } | undefined {
		switch (element) {
			case 'variable':
				return { oneOf: ['name'], fails: false };
			case 'param': {
				// a function's parameters are passed in order - a template's, and those of x:context, by name
				const isTemplateParam = parent === 'context' || (parent === 'call' && parentHas('template'));
				return isTemplateParam || parent === 'description' || parent === 'scenario' ? { oneOf: ['name'], fails: isTemplateParam } : undefined;
			}
			case 'import':
				return { oneOf: ['href'], fails: true };
			case 'like':
				return { oneOf: ['label'], fails: true };
			case 'scenario':
			case 'expect':
				return { oneOf: ['label'], fails: false };
			case 'helper':
				return { oneOf: ['stylesheet', 'package-name', 'query', 'xproc'], fails: false };
			default:
				return undefined;
		}
	}

	// the elements with an attribute missing: from x:description, not within user content - e.g. x:context's or
	// x:expect's, where an element with the XSpec prefix isn't XSpec's
	private static missing(text: string): { element: XmlElement, prefix: string, attribute?: string, oneOf?: string[], severity: vscode.DiagnosticSeverity }[] {
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return [];
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		const name = (element: XmlElement | undefined) => element && element.name.startsWith(prefix) ? element.name.substring(prefix.length) : undefined;
		const has = (element: XmlElement, attribute: string) => element.attributes.has(attribute);
		const hasLabel = (element: XmlElement) => has(element, 'label') || element.children.some((child) => child.name === prefix + 'label');
		const result: ReturnType<typeof XSpecRequired.missing> = [];
		const { Error, Warning } = vscode.DiagnosticSeverity;
		const userContent = ['context', 'expect', 'param', 'variable', 'input', 'option', 'label', 'text'];
		const visit = (element: XmlElement) => {
			const parent = element.parent;
			const rule = XSpecRequired.ruleFor(name(element) ?? '', name(parent), (attribute) => !!parent && has(parent, attribute));
			if (rule && !rule.oneOf.some((attribute) => attribute === 'label' ? hasLabel(element) : has(element, attribute))) {
				result.push({ element, prefix, ...(rule.oneOf.length === 1 ? { attribute: rule.oneOf[0] } : { oneOf: rule.oneOf }), severity: rule.fails ? Error : Warning });
			}
			// within user content, only x:context's own x:param elements
			const own = name(element) ?? '';
			const children = element === root || !userContent.includes(own) ? element.children :
				own === 'context' ? element.children.filter((child) => child.name === prefix + 'param') : [];
			children.forEach(visit);
		};
		visit(root);
		return result;
	}
}
