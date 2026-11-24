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
import { parseXml, descendants } from './xspecXml';

// DCP: a pipeline parameter's hover - from $name in XPath, a parameterRef, if or unless attribute, or its declaration's
// name: its element (booleanParameter or stringParameter), default value and description
export class DcpParameters {
	private static readonly parameterElements = ['booleanParameter', 'stringParameter'];

	// the parameter name at the offset: of $name, or the value of parameterRef, if, unless, or a parameter's name
	public static nameAt(text: string, offset: number): string | undefined {
		const before = /\$([\w.-]*)$/.exec(text.substring(Math.max(0, offset - 200), offset));
		if (before) {
			return before[1] + (/^[\w.-]*/.exec(text.substring(offset))?.[0] ?? '');
		}
		const tagStart = text.lastIndexOf('<', offset);
		const tagEnd = text.indexOf('>', tagStart);
		if (tagStart < 0 || tagEnd < offset) {
			return undefined;
		}
		const tag = text.substring(tagStart, tagEnd);
		const isDeclaration = DcpParameters.parameterElements.some((e) => new RegExp(`^<${e}\\b`).test(tag));
		for (const match of tag.matchAll(/\s([\w-]+)\s*=\s*(["'])([^"']*)\2/g)) {
			const valueStart = tagStart + match.index! + match[0].length - match[3].length - 1;
			if (offset >= valueStart && offset <= valueStart + match[3].length &&
				(['parameterRef', 'if', 'unless'].includes(match[1]) || (isDeclaration && match[1] === 'name'))) {
				return match[3].trim();
			}
		}
		return undefined;
	}

	// the XPath of imageXpath's and xPathToReferencedSVG's literalValue: passed, once the DCP is loaded, to the image and
	// SVG comparison, which evaluates it on the input documents, relative to the element, e.g. *:img/@src - where pipeline
	// parameters aren't in scope. Its value's offsets in the text
	public static inputXPaths(text: string): { start: number, end: number }[] {
		const values: { start: number, end: number }[] = [];
		for (const match of text.matchAll(/<(imageXpath|xPathToReferencedSVG)\b[^>]*?\sliteralValue\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
			const value = match[2] ?? match[3];
			const start = match.index! + match[0].length - value.length - 1;
			values.push({ start, end: start + value.length });
		}
		return values;
	}

	public static isInInputXPath(text: string, offset: number) {
		return DcpParameters.inputXPaths(text).some((v) => offset >= v.start && offset <= v.end);
	}

	// - a $name in an input document XPath (see inputXPaths): parameters aren't in scope there - not in string literals
	// - a booleanParameter's defaultValue that isn't true or false: it's not an attribute value template - DeltaNova makes
	//   it the expression true() or false()
	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		const text = document.getText();
		const problems: vscode.Diagnostic[] = [];
		const rangeOf = (start: number, length: number) => new vscode.Range(document.positionAt(start), document.positionAt(start + length));
		DcpParameters.inputXPaths(text).forEach(({ start, end }) => {
			const value = text.substring(start, end);
			for (const match of value.matchAll(/"[^"]*"|'[^']*'|\$([\w.-]+)/g)) {
				if (match[1]) {
					problems.push(new vscode.Diagnostic(rangeOf(start + match.index!, match[0].length),
						`DCP: ${match[0]} isn't in scope here - this XPath is evaluated on the input documents, where pipeline parameters aren't declared`, vscode.DiagnosticSeverity.Error));
				}
			}
		});
		for (const match of text.matchAll(/<booleanParameter\b[^>]*?\sdefaultValue\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
			const value = match[1] ?? match[2];
			if (value.trim() !== 'true' && value.trim() !== 'false') {
				problems.push(new vscode.Diagnostic(rangeOf(match.index! + match[0].length - value.length - 1, value.length),
					`DCP: a booleanParameter's defaultValue must be true or false - it isn't an attribute value template`, vscode.DiagnosticSeverity.Error));
			}
		}
		return problems;
	}

	public static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const text = document.getText();
		if (DcpParameters.isInInputXPath(text, document.offsetAt(position))) {
			return undefined;
		}
		const name = DcpParameters.nameAt(text, document.offsetAt(position));
		const root = name ? parseXml(text) : undefined;
		const declaration = root ? descendants(root).find((e) => DcpParameters.parameterElements.includes(e.name) && e.attributes.get('name')?.trim() === name) : undefined;
		if (!declaration) {
			return undefined;
		}
		const defaultValue = declaration.attributes.get('defaultValue');
		const description = declaration.children.find((c) => c.name === 'description');
		const descriptionText = description ? [description.text, ...descendants(description).map((d) => d.text)].join(' ').replace(/\s+/g, ' ').trim() : '';
		const markdown = new vscode.MarkdownString();
		markdown.appendCodeblock(`<${declaration.name} name="${name}"${defaultValue !== undefined ? ` defaultValue="${defaultValue}"` : ''}/>`, 'xml');
		if (descriptionText) {
			// escaped markdown, not appendText, which writes spaces as &nbsp;
			markdown.appendMarkdown(descriptionText.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, '\\$&'));
		}
		return new vscode.Hover(markdown);
	}
}
