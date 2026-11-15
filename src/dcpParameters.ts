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

	public static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const text = document.getText();
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
