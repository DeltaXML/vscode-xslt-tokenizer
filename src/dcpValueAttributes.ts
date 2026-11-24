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
import { parseXml, descendants, XmlElement } from './xspecXml';
import { DCPSchema } from './dcpSchema';

// DCP: an element that takes its value from a literalValue, parameterRef or xpath attribute must have exactly one of them,
// as the schema asserts (document-comparator-1_1.xsd: exactly-one((@literalValue,@parameterRef,@xpath))) - with none, or
// more than one, the DCP isn't valid. Not for feature, or the elements of the simple parameter types, e.g. property,
// whose name is enough
export class DcpValueAttributes {
	public static readonly missingValue = 'dcp-missing-value';
	private static readonly valueAttributes = ['literalValue', 'parameterRef', 'xpath'];
	private static readonly exceptions = new Set(['feature']);
	private static readonly exceptionTypes = new Set(['simpleStringParameterType', 'simpleBooleanParameterType']);
	private static schema: DCPSchema | undefined;

	// whether the element takes its value from one of the attributes: it allows literalValue
	public static takesValue(name: string): boolean {
		const schema = DcpValueAttributes.schema = DcpValueAttributes.schema ?? new DCPSchema();
		const element = schema.elements[name];
		if (!element || DcpValueAttributes.exceptions.has(name) || (element.type && DcpValueAttributes.exceptionTypes.has(element.type))) {
			return false;
		}
		const attrs = element.attrs ?? (element.type ? schema.complexTypes[element.type]?.attrs : undefined);
		return !!attrs && 'literalValue' in attrs;
	}

	// each element with none of the attributes, or more than one: those it has
	public static invalid(text: string): { element: XmlElement, present: string[] }[] {
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		return [root, ...descendants(root)].filter((element) => DcpValueAttributes.takesValue(element.name))
			.map((element) => ({ element, present: DcpValueAttributes.valueAttributes.filter((a) => element.attributes.has(a)) }))
			.filter(({ present }) => present.length !== 1);
	}

	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		const quoted = (names: string[]) => names.map((n) => `'${n}'`);
		return DcpValueAttributes.invalid(document.getText()).map(({ element, present }) => {
			const start = document.positionAt(element.start + 1);
			const range = new vscode.Range(start, start.translate(0, element.name.length));
			const [a, b, c] = quoted(DcpValueAttributes.valueAttributes);
			const message = present.length === 0 ? `DCP: ${element.name} must have one of the attributes ${a}, ${b} or ${c}` :
				`DCP: ${element.name} must have only one of the attributes ${a}, ${b} and ${c} - it has ${quoted(present).join(' and ')}`;
			const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
			if (present.length === 0) {
				diagnostic.code = DcpValueAttributes.missingValue;
			}
			return diagnostic;
		});
	}

	// with none: a quick fix adding literalValue, at the end of the start tag
	public static codeActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
		const invalid = DcpValueAttributes.invalid(document.getText());
		const text = document.getText();
		return diagnostics.filter((d) => d.code === DcpValueAttributes.missingValue).flatMap((diagnostic) => {
			const found = invalid.find((i) => i.present.length === 0 && i.element.start + 1 === document.offsetAt(diagnostic.range.start));
			if (!found) {
				return [];
			}
			const action = new vscode.CodeAction('Add a \'literalValue\' attribute', vscode.CodeActionKind.QuickFix);
			action.diagnostics = [diagnostic];
			action.isPreferred = true;
			// before the start tag's '>' or '/>', and any space before it
			let at = found.element.contentStart - (text.charAt(found.element.contentStart - 2) === '/' ? 2 : 1);
			while (/\s/.test(text.charAt(at - 1))) {
				at--;
			}
			const position = document.positionAt(at);
			action.edit = new vscode.WorkspaceEdit();
			action.edit.set(document.uri, [new vscode.SnippetTextEdit(new vscode.Range(position, position), new vscode.SnippetString(' literalValue="$1"'))]);
			return [action];
		});
	}
}
