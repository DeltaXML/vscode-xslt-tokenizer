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
import { XmlElement, parseXml, descendants } from './xspecXml';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';

// a requirement: one of the attributes - fails: SchXslt2, the Schematron processor bundled with XSpec, fails without it
export interface SchRequirement {
	oneOf: string[];
	fails: boolean;
}

// The attributes ISO Schematron requires that a Schematron element is missing - not in the schema data, which doesn't
// keep which attributes are required. An error where SchXslt2 fails without it - found by transpiling and running a
// schema without each - e.g. a rule's context or an assertion's test, and otherwise a warning: SchXslt2 carries on, but
// the element can't be referred to, or does nothing, e.g. a phase with no id, or extends with neither rule nor href
export class SchRequired {
	public static readonly missingAttribute = 'sch-missing-attribute';

	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		return SchRequired.missing(document.getText()).map(({ element, requirement }) => {
			const start = document.positionAt(element.start + 1);
			const range = new vscode.Range(start, start.translate(0, element.name.length));
			const what = requirement.oneOf.length > 1 ? `one of the attributes ${requirement.oneOf.map((a) => `'${a}'`).join(', ')}` : `a '${requirement.oneOf[0]}' attribute`;
			const consequence = requirement.fails ? ' - SchXslt2 fails without it' : ' - ISO Schematron requires it';
			const diagnostic = new vscode.Diagnostic(range, `Schematron: ${element.name} must have ${what}${consequence}`,
				requirement.fails ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
			diagnostic.code = SchRequired.missingAttribute;
			return diagnostic;
		});
	}

	// a quick fix for each: the attribute added at the end of the start tag, with its value to give
	public static codeActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
		const missing = SchRequired.missing(document.getText());
		return diagnostics.filter((d) => d.code === SchRequired.missingAttribute).flatMap((diagnostic) => {
			const found = missing.find((m) => m.element.start + 1 === document.offsetAt(diagnostic.range.start) && diagnostic.message.includes(`'${m.requirement.oneOf[0]}'`));
			if (!found) {
				return [];
			}
			const attribute = found.requirement.oneOf[0];
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

	// the attributes a Schematron element must have, by its local name - with whether it, and its parent, are abstract,
	// and for sch:param, whether its parent is a pattern or group with is-a, whose parameters are given values
	public static ruleFor(element: string, parent: string | undefined, attribute: (name: string) => string | undefined, parentAttribute: (name: string) => string | undefined): SchRequirement[] {
		const isAbstract = attribute('abstract')?.trim() === 'true';
		switch (element) {
			case 'ns':
				return [{ oneOf: ['prefix'], fails: true }, { oneOf: ['uri'], fails: true }];
			case 'rule':
				return isAbstract ? [{ oneOf: ['id'], fails: false }] : [{ oneOf: ['context'], fails: true }];
			case 'pattern':
			case 'group':
				return isAbstract ? [{ oneOf: ['id'], fails: false }] : [];
			case 'assert':
			case 'report':
				return [{ oneOf: ['test'], fails: true }];
			case 'let':
				return [{ oneOf: ['name'], fails: true }];
			case 'param': {
				// in a pattern with is-a, its value replaces the abstract pattern's parameter - the schema's needs one too
				const isInstance = (parent === 'pattern' || parent === 'group') && parentAttribute('is-a') !== undefined;
				const needsValue = isInstance || parent === 'schema' || parent === 'library';
				return needsValue ? [{ oneOf: ['name'], fails: true }, { oneOf: ['value'], fails: isInstance }] : [{ oneOf: ['name'], fails: true }];
			}
			case 'value-of':
				return [{ oneOf: ['select'], fails: true }];
			case 'include':
				return [{ oneOf: ['href'], fails: true }];
			case 'extends':
				return [{ oneOf: ['rule', 'href'], fails: false }];
			case 'phase':
			case 'diagnostic':
			case 'property':
				return [{ oneOf: ['id'], fails: false }];
			case 'active':
				return [{ oneOf: ['pattern'], fails: false }];
			case 'span':
				return [{ oneOf: ['class'], fails: false }];
			default:
				return [];
		}
	}

	// the Schematron elements with an attribute missing - not those in another namespace, e.g. Schematron QuickFix's
	private static missing(text: string): { element: XmlElement, requirement: SchRequirement }[] {
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const local = (element: XmlElement | undefined) => element && (prefix ? element.name.startsWith(prefix) : !element.name.includes(':')) ?
			element.name.substring(prefix.length) : undefined;
		const result: { element: XmlElement, requirement: SchRequirement }[] = [];
		// not an element in another namespace, or within one, e.g. sch:value-of in sqf:title
		const foreign = XsltTokenDiagnostics.schForeignElements(text);
		for (const element of [root, ...descendants(root)]) {
			const name = local(element);
			if (name === undefined || element.name.substring(prefix.length).includes(':') || foreign.has(element.start + 1)) {
				continue;
			}
			SchRequired.ruleFor(name, local(element.parent), (attribute) => element.attributes.get(attribute), (attribute) => element.parent?.attributes.get(attribute))
				.filter((requirement) => !requirement.oneOf.some((attribute) => element.attributes.has(attribute)))
				.forEach((requirement) => result.push({ element, requirement }));
		}
		return result;
	}
}
