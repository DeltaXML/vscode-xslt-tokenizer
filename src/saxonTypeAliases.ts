/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RecordTypes } from './recordTypes';
import { ItemTypeSupport } from './itemTypeSupport';

// a replacement of the text from start to end, as document offsets
export interface TextEdit {
	start: number;
	end: number;
	text: string;
}

// a saxon:type-alias declaration: its name and type - convertible unless it has an extensible tuple type, e.g.
// tuple(a: xs:string, *), as XSLT 4.0 has no extensible record types, or a type that isn't recognised
export interface AliasDeclaration {
	name: string;
	type: string;
	isConvertible: boolean;
}

// The conversion of Saxon's earlier syntax for named types - from Saxon 9.9 to 11, and ignored by Saxon 12.8 and 13 - to
// XSLT 4.0's, which Saxon 12.8 and 13 accept with syntax extensions, also in an XSLT 3.0 stylesheet:
// - <saxon:type-alias name="n" type="t"/> is <xsl:item-type name="n" as="t"/>
// - tuple(a: xs:string, b?: xs:integer) is record(a as xs:string, b? as xs:integer)
// - a reference to a type alias, ~n, is n
export class SaxonTypeAliases {
	public static readonly namespace = 'http://saxon.sf.net/';

	// the prefixes bound to the Saxon namespace in the module - usually 'saxon'
	public static saxonPrefixes(text: string): string[] {
		return [...text.matchAll(/xmlns:([\w.-]+)\s*=\s*(["'])http:\/\/saxon\.sf\.net\/\2/g)].map((match) => match[1]);
	}

	// the saxon:type-alias declarations of the module - not those in comments
	public static declarations(text: string): AliasDeclaration[] {
		const declarations: AliasDeclaration[] = [];
		SaxonTypeAliases.startTags(text).forEach((tag) => {
			if (!SaxonTypeAliases.isTypeAlias(tag.name, SaxonTypeAliases.saxonPrefixes(text))) {
				return;
			}
			const name = tag.attributes.find((a) => a.name === 'name')?.value;
			const type = tag.attributes.find((a) => a.name === 'type')?.value;
			if (name && type !== undefined) {
				declarations.push({ name, type, isConvertible: SaxonTypeAliases.convertType(type, new Set()).isConvertible });
			}
		});
		return declarations;
	}

	// the names of the type aliases referenced in the text, e.g. dfx:region for ~dfx:region
	public static aliasReferences(text: string): string[] {
		return [...text.matchAll(/~([\w.-]+(?::[\w.-]+)?)(?![\w.:-])/g)].map((match) => match[1]);
	}

	// the names of the type aliases that can be converted: those whose types are convertible, and only reference
	// aliases that are - e.g. not one with a field whose type is an alias with an extensible tuple type
	public static convertibleAliases(declarations: AliasDeclaration[]): Set<string> {
		const convertible = new Set(declarations.filter((d) => d.isConvertible).map((d) => d.name));
		let isChanged = true;
		while (isChanged) {
			isChanged = false;
			for (const declaration of declarations) {
				if (convertible.has(declaration.name) && SaxonTypeAliases.aliasReferences(declaration.type).some((name) => !convertible.has(name))) {
					convertible.delete(declaration.name);
					isChanged = true;
				}
			}
		}
		return convertible;
	}

	// the type with each tuple type as a record type - and each reference to one of the type aliases, e.g. ~n, as its
	// name - not convertible if a tuple type is extensible, e.g. tuple(a: xs:string, *), or isn't recognised
	public static convertType(typeText: string, aliases: Set<string>): { text: string, isConvertible: boolean } {
		let isConvertible = true;
		const convert = (text: string): string => {
			let result = '';
			let i = 0;
			while (i < text.length) {
				const ch = text.charAt(i);
				const isNameStart = i === 0 || !/[\w.:-]/.test(text.charAt(i - 1));
				const tuple = isNameStart ? /^tuple\s*\(/.exec(text.substring(i)) : null;
				if (tuple) {
					const openIndex = i + tuple[0].length - 1;
					const closeIndex = SaxonTypeAliases.closingIndex(text, openIndex);
					if (closeIndex === -1) {
						isConvertible = false;
						return text;
					}
					const fields = SaxonTypeAliases.splitTopLevel(text.substring(openIndex + 1, closeIndex)).map((field) => {
						const match = /^\s*('[^']*'|"[^"]*"|[\w.-]+)(\?)?\s*(?::\s*([\s\S]+?))?\s*$/.exec(field);
						if (!match) {
							// e.g. '*' for an extensible tuple type
							isConvertible = false;
							return field.trim();
						}
						return `${match[1]}${match[2] ?? ''}${match[3] !== undefined ? ' as ' + convert(match[3]) : ''}`;
					});
					result += `record(${fields.join(', ')})`;
					i = closeIndex + 1;
					continue;
				}
				const reference = ch === '~' ? /^~([\w.-]+(?::[\w.-]+)?)(?![\w.:-])/.exec(text.substring(i)) : null;
				if (reference && aliases.has(reference[1])) {
					result += reference[1];
					i += reference[0].length;
					continue;
				}
				if (ch === '\'' || ch === '"') {
					const end = text.indexOf(ch, i + 1);
					const literalEnd = end === -1 ? text.length : end + 1;
					result += text.substring(i, literalEnd);
					i = literalEnd;
					continue;
				}
				result += ch;
				i++;
			}
			return result;
		};
		const text = convert(typeText);
		return { text, isConvertible };
	}

	// the edits for the module: each of the type aliases that are convertible as an xsl:item-type, and in the attributes
	// of XSLT elements, their references and tuple types - an attribute with a tuple type that isn't convertible is
	// left as it is
	public static convertModule(text: string, convertible: Set<string>): TextEdit[] {
		const edits: TextEdit[] = [];
		const prefixes = SaxonTypeAliases.saxonPrefixes(text);
		const markup = RecordTypes.blankMarkup(text);
		SaxonTypeAliases.startTags(text).forEach((tag) => {
			if (SaxonTypeAliases.isTypeAlias(tag.name, prefixes)) {
				const name = tag.attributes.find((a) => a.name === 'name')?.value;
				const type = tag.attributes.find((a) => a.name === 'type');
				if (!name || !type || !convertible.has(name)) {
					return;
				}
				const converted = SaxonTypeAliases.convertType(type.value, convertible);
				if (!converted.isConvertible) {
					return;
				}
				edits.push({ start: tag.nameStart, end: tag.nameStart + tag.name.length, text: 'xsl:item-type' });
				edits.push({ start: type.nameStart, end: type.nameStart + type.name.length, text: 'as' });
				if (converted.text !== type.value) {
					edits.push({ start: type.valueStart, end: type.valueStart + type.value.length, text: converted.text });
				}
				if (!tag.isEmpty) {
					const endTag = markup.indexOf(`</${tag.name}`, tag.end);
					if (endTag > -1) {
						edits.push({ start: endTag + 2, end: endTag + 2 + tag.name.length, text: 'xsl:item-type' });
					}
				}
				return;
			}
			if (!tag.name.startsWith('xsl:')) {
				return;
			}
			tag.attributes.forEach((attribute) => {
				// an attribute that references a type alias that isn't converted is left as it is
				if ((!attribute.value.includes('~') && !/(?<![\w.:-])tuple\s*\(/.test(attribute.value)) ||
					SaxonTypeAliases.aliasReferences(attribute.value).some((name) => !convertible.has(name))) {
					return;
				}
				const converted = SaxonTypeAliases.convertType(attribute.value, convertible);
				if (converted.isConvertible && converted.text !== attribute.value) {
					edits.push({ start: attribute.valueStart, end: attribute.valueStart + attribute.value.length, text: converted.text });
				}
			});
		});
		return edits.sort((a, b) => a.start - b.start);
	}

	// the text with the edits applied
	public static apply(text: string, edits: TextEdit[]): string {
		let result = '';
		let last = 0;
		[...edits].sort((a, b) => a.start - b.start).forEach((edit) => {
			result += text.substring(last, edit.start) + edit.text;
			last = edit.end;
		});
		return result + text.substring(last);
	}

	private static isTypeAlias(elementName: string, prefixes: string[]) {
		return prefixes.some((prefix) => elementName === `${prefix}:type-alias`);
	}

	// the start tags of the text, not in comments, with their attributes, and the offsets of their names and values
	private static startTags(text: string) {
		const markup = RecordTypes.blankMarkup(text);
		const tags: { name: string, nameStart: number, end: number, isEmpty: boolean, attributes: { name: string, nameStart: number, value: string, valueStart: number }[] }[] = [];
		for (const match of markup.matchAll(new RegExp(RecordTypes.tagPattern, 'g'))) {
			if (match[1]) {
				continue;
			}
			const start = match.index!;
			const tagText = text.substring(start, start + match[0].length);
			const attributes = [...tagText.matchAll(/\s([\w.:-]+)(\s*=\s*)(["'])([^"']*?)\3/g)].map((a) => ({
				name: a[1], nameStart: start + a.index! + 1, value: a[4], valueStart: start + a.index! + 1 + a[1].length + a[2].length + 1
			}));
			tags.push({ name: match[2], nameStart: start + 1, end: start + match[0].length, isEmpty: !!match[3], attributes });
		}
		return tags;
	}

	private static closingIndex(text: string, openIndex: number) {
		let depth = 0;
		let quote = '';
		for (let i = openIndex; i < text.length; i++) {
			const ch = text.charAt(i);
			if (quote) {
				if (ch === quote) {
					quote = '';
				}
			} else if (ch === '\'' || ch === '"') {
				quote = ch;
			} else if (ch === '(') {
				depth++;
			} else if (ch === ')' && --depth === 0) {
				return i;
			}
		}
		return -1;
	}

	// the parts of the text separated by commas, outside brackets and string literals
	private static splitTopLevel(text: string): string[] {
		const parts: string[] = [];
		let depth = 0;
		let quote = '';
		let partStart = 0;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (quote) {
				if (ch === quote) {
					quote = '';
				}
			} else if (ch === '\'' || ch === '"') {
				quote = ch;
			} else if (ch === '(' || ch === '[' || ch === '{') {
				depth++;
			} else if (ch === ')' || ch === ']' || ch === '}') {
				depth--;
			} else if (depth === 0 && ch === ',') {
				parts.push(text.substring(partStart, i));
				partStart = i + 1;
			}
		}
		parts.push(text.substring(partStart));
		return parts;
	}

	// the 'Convert Saxon Type Aliases to xsl:item-type' command: for the XSLT modules of the workspace - or the files, e.g.
	// for testing - the edits for all the modules, shown in the refactor preview to confirm, unless confirm is false -
	// then an offer to enable item types in XSLT 3.0, for a module converted that isn't XSLT 4.0 - and the aliases that
	// can't be converted are listed
	public static async convertWorkspace(files?: string[], confirm = true): Promise<{ converted: string[], unconverted: string[], changedFiles: string[] }> {
		const moduleFiles = files ?? (await vscode.workspace.findFiles('**/*.{xsl,xslt}', '**/node_modules/**')).filter((uri) => uri.scheme === 'file').map((uri) => uri.fsPath);
		const texts = new Map<string, string>();
		for (const file of moduleFiles) {
			const open = vscode.workspace.textDocuments.find((d) => d.fileName === file);
			try {
				texts.set(file, open ? open.getText() : fs.readFileSync(file, 'utf8'));
			} catch {
				// unreadable: ignore
			}
		}
		// the aliases of all the modules, as a reference may be in another module
		const declarations = [...texts.values()].flatMap((text) => SaxonTypeAliases.declarations(text));
		const convertible = SaxonTypeAliases.convertibleAliases(declarations);
		const unconverted = [...new Set(declarations.filter((d) => !convertible.has(d.name)).map((d) => d.name))];
		if (declarations.length === 0) {
			if (confirm) {
				vscode.window.showInformationMessage('No saxon:type-alias declarations were found in the XSLT modules of the workspace');
			}
			return { converted: [], unconverted, changedFiles: [] };
		}
		const edit = new vscode.WorkspaceEdit();
		const changedFiles: string[] = [];
		for (const [file, text] of texts) {
			const edits = SaxonTypeAliases.convertModule(text, convertible);
			if (edits.length === 0) {
				continue;
			}
			changedFiles.push(file);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			edits.forEach((e) => {
				const range = new vscode.Range(document.positionAt(e.start), document.positionAt(e.end));
				edit.replace(document.uri, range, e.text, confirm ? { needsConfirmation: true, label: 'Convert Saxon type aliases to xsl:item-type' } : undefined);
			});
		}
		if (changedFiles.length > 0 && await vscode.workspace.applyEdit(edit, { isRefactoring: true }) && confirm) {
			const isVersion4Everywhere = changedFiles.every((file) => ItemTypeSupport.isVersion4Text(texts.get(file) ?? ''));
			if (!isVersion4Everywhere && !ItemTypeSupport.isEnabledBefore40()) {
				const enable = 'Enable for this Workspace';
				const choice = await vscode.window.showInformationMessage(`Converted ${convertible.size} type aliases. For xsl:item-type in XSLT 3.0 stylesheets, enable the setting ${ItemTypeSupport.section}.${ItemTypeSupport.setting} - for Saxon PE/EE 12.8 or later, run with syntax extensions.`, enable);
				if (choice === enable) {
					await vscode.workspace.getConfiguration(ItemTypeSupport.section).update(ItemTypeSupport.setting, true, vscode.ConfigurationTarget.Workspace);
				}
			}
		}
		if (unconverted.length > 0 && confirm) {
			vscode.window.showWarningMessage(`These type aliases weren't converted, as XSLT 4.0 has no extensible record types, e.g. tuple(a: xs:string, *): ${unconverted.join(', ')}`);
		}
		return { converted: [...convertible], unconverted, changedFiles: changedFiles.map((file) => path.resolve(file)) };
	}
}
