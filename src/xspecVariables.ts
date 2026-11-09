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
import * as path from 'path';
import { XslLexer } from './xslLexer';
import { TokenLevelState } from './xpLexer';
import { XSpecConfiguration } from './languageConfigurations';
import { XSpecLike, XSpecVariableDeclaration } from './xspecLike';
import { XSpecSourceMap } from './xspecSourceMap';
import { parseXml, descendants } from './xspecXml';

// The variables an XSpec file declares - x:variable, and x:param of x:description or x:scenario - and their references
// in XPath expressions: Go to Definition, Find All References, Rename and hover, as XSpec scopes them (see
// XSpecLike.scopes). A reference in a shared scenario may be to more than one declaration - one for each x:like using
// it - and those declarations' references include it. The stylesheet's variables are left to the XSLT providers
type Reference = { file: string, start: number, end: number, name: string };
type Declaration = XSpecVariableDeclaration & { nameStart: number, nameEnd: number, text: string };

export class XSpecVariables {
	// at a reference - at a declaration, others give its definition, e.g. a global x:param's, the stylesheet's parameter
	public static definition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
		const found = XSpecVariables.at(document, position, false);
		return found ? found.declarations.map((d) => XSpecVariables.location(d.file, d.text, d.nameStart, d.nameEnd)) : undefined;
	}

	public static references(document: vscode.TextDocument, position: vscode.Position, includeDeclaration: boolean): vscode.Location[] | undefined {
		const found = XSpecVariables.at(document, position);
		if (!found) {
			return undefined;
		}
		const { declarations, references } = XSpecVariables.uses(document, found.declarations);
		return [...(includeDeclaration ? declarations.map((d) => XSpecVariables.location(d.file, d.text, d.nameStart, d.nameEnd)) : []),
			...references.map((r) => XSpecVariables.location(r.file, r.text, r.start, r.end))];
	}

	public static prepareRename(document: vscode.TextDocument, position: vscode.Position): { range: vscode.Range, placeholder: string } | undefined {
		const found = XSpecVariables.at(document, position);
		return found ? { range: new vscode.Range(document.positionAt(found.start), document.positionAt(found.end)), placeholder: document.getText().substring(found.start, found.end) } : undefined;
	}

	public static renameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string): vscode.WorkspaceEdit | undefined {
		const found = XSpecVariables.at(document, position);
		if (!found) {
			return undefined;
		}
		const name = newName.trim().replace(/^\$/, '');
		const { declarations, references } = XSpecVariables.uses(document, found.declarations);
		const edit = new vscode.WorkspaceEdit();
		[...declarations.map((d) => ({ file: d.file, text: d.text, start: d.nameStart, end: d.nameEnd })), ...references].forEach((use) => {
			const location = XSpecVariables.location(use.file, use.text, use.start, use.end);
			edit.replace(location.uri, location.range, name);
		});
		return edit;
	}

	// the declaration's start tag - and where it is, for one in another file or more than one
	public static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const found = XSpecVariables.at(document, position, false);
		if (!found || found.declarations.length === 0) {
			return undefined;
		}
		const markdown = new vscode.MarkdownString();
		found.declarations.forEach((d, index) => {
			const startTag = d.text.substring(d.element.start, d.element.contentStart).replace(/\s+/g, ' ');
			const hasContent = d.element.contentEnd > d.element.contentStart;
			const line = d.text.substring(0, d.element.start).split('\n').length;
			const where = XSpecSourceMap.samePath(d.file, document.fileName) ? `line ${line}` : `${path.basename(d.file)}, line ${line}`;
			markdown.appendMarkdown(`${index > 0 ? '\n\n---\n\n' : ''}**XSpec variable** — ${where}${hasContent ? ' — its value is the content' : ''}\n`);
			markdown.appendCodeblock(startTag, 'xml');
		});
		return new vscode.Hover(markdown, new vscode.Range(document.positionAt(found.start), document.positionAt(found.end)));
	}

	// at a reference's name, after the '$', or a declaration's name attribute: the declarations, and the name's offsets
	private static at(document: vscode.TextDocument, position: vscode.Position, atDeclaration = true): { declarations: Declaration[], start: number, end: number } | undefined {
		if (document.uri.scheme !== 'file') {
			return undefined;
		}
		const text = document.getText();
		const offset = document.offsetAt(position);
		const declarations = XSpecVariables.declarationsIn(text, document.fileName);
		const declared = declarations.find((d) => d.nameStart <= offset && offset <= d.nameEnd);
		if (declared) {
			return atDeclaration ? { declarations: [declared], start: declared.nameStart, end: declared.nameEnd } : undefined;
		}
		const reference = XSpecVariables.referencesIn(text, document.fileName).find((r) => r.start <= offset && offset <= r.end);
		if (!reference) {
			return undefined;
		}
		const resolved = XSpecVariables.resolve(text, document.fileName, reference);
		return resolved.length > 0 ? { declarations: resolved, start: reference.start, end: reference.end } : undefined;
	}

	// the declarations a reference is to, with their texts
	private static resolve(text: string, filePath: string, reference: Reference): Declaration[] {
		const found = XSpecLike.scopes(text, filePath).declarationsOf(reference.name, reference.start);
		const texts = new Map(XSpecLike.gatheredFiles(text, filePath).map((f) => [path.normalize(f.file), f.text]));
		return found.flatMap((d) => {
			const declarationText = texts.get(path.normalize(d.file));
			return declarationText !== undefined ? XSpecVariables.declarationsIn(declarationText, d.file).filter((e) => e.element.start === d.element.start) : [];
		});
	}

	// the declarations, and the references to any of them - in the files gathered with the document
	private static uses(document: vscode.TextDocument, of: Declaration[]): { declarations: Declaration[], references: (Reference & { text: string })[] } {
		const same = (a: XSpecVariableDeclaration, b: XSpecVariableDeclaration) => XSpecSourceMap.samePath(a.file, b.file) && a.element.start === b.element.start;
		const references: (Reference & { text: string })[] = [];
		const localNames = new Set(of.map((d) => (d.element.attributes.get('name') ?? '').trim().replace(/^.*[:}]/, '')));
		for (const f of XSpecLike.gatheredFiles(document.getText(), document.fileName)) {
			const candidates = XSpecVariables.referencesIn(f.text, f.file).filter((r) => localNames.has(r.name.replace(/^.*[:}]/, '')));
			if (candidates.length === 0) {
				continue;
			}
			const scopes = XSpecLike.scopes(f.text, f.file);
			candidates.filter((r) => scopes.declarationsOf(r.name, r.start).some((d) => of.some((o) => same(o, d)))).forEach((r) => references.push({ ...r, text: f.text }));
		}
		return { declarations: of, references };
	}

	// the x:variable elements, and x:param of x:description and x:scenario, with the offsets of their names
	private static declarationsIn(text: string, filePath: string): Declaration[] {
		const prefix = /<(?:([\w.-]+):)?description\b/.exec(text)?.[1];
		const x = prefix ? prefix + ':' : '';
		const result: Declaration[] = [];
		const root = parseXml(text);
		if (!root) {
			return result;
		}
		for (const element of descendants(root)) {
			const isDeclaration = element.name === x + 'variable' || (element.name === x + 'param' && !!element.parent && (element.parent === root || element.parent.name === x + 'scenario'));
			const match = isDeclaration ? /\sname\s*=\s*(["'])\s*([^"']*?)\s*\1/.exec(text.substring(element.start, element.contentStart)) : null;
			if (match && match[2] !== '') {
				const nameStart = element.start + match.index + match[0].indexOf(match[2], match[0].indexOf(match[1]));
				result.push({ file: filePath, element, nameStart, nameEnd: nameStart + match[2].length, text });
			}
		}
		return result;
	}

	// the variable references in XPath expressions, from the lexer - each name's offsets, after the '$' - not one bound
	// in its expression, e.g. by for $i in ..., or the binding itself
	private static referencesIn(text: string, filePath: string): Reference[] {
		const lexer = new XslLexer(XSpecConfiguration.configuration);
		const tokens = lexer.analyse(text);
		const lineStarts = [0];
		for (let i = text.indexOf('\n'); i > -1; i = text.indexOf('\n', i + 1)) {
			lineStarts.push(i + 1);
		}
		return tokens.filter((token) => token.tokenType === TokenLevelState.variable && token.value.startsWith('$')).flatMap((token) => {
			const start = lineStarts[token.line] + token.startCharacter + 1;
			const name = token.value.substring(1);
			// the expression before it, in its start tag: a binding of the same name, e.g. for $i in, let $i :=, some $i in, or , $i in
			const tagStart = text.lastIndexOf('<', start);
			const before = text.substring(tagStart, start - 1);
			const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const bound = new RegExp(`(?:\\b(?:for|let|some|every)\\s+|,\\s*)\\$${escaped}\\s*(?:in\\b|:=)`).test(before) ||
				// or it's the binding, e.g. the $i of for $i in
				(/(?:\b(?:for|let|some|every)\s+|,\s*)$/.test(before) && /^\s*(?:in\b|:=)/.test(text.substring(start + name.length, start + name.length + 20)));
			return bound ? [] : [{ file: filePath, start, end: start + name.length, name }];
		});
	}

	private static location(file: string, text: string, start: number, end: number): vscode.Location {
		const position = (offset: number) => {
			const lines = text.substring(0, offset).split('\n');
			return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
		};
		return new vscode.Location(vscode.Uri.file(file), new vscode.Range(position(start), position(end)));
	}
}
