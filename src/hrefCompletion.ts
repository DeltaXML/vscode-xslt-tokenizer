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
import * as fs from 'fs';
import * as path from 'path';
import { RecordTypes } from './recordTypes';
import { XSpecHrefs } from './xspecHrefs';
import { parseXml, descendants, decodeReferences, localName } from './xspecXml';

// Completion of the path in an href: an XSLT module's xsl:import and xsl:include, and the files an XSpec file refers to
// (see XSpecHrefs) - the folders, and the files of the kind the attribute is for, e.g. .xspec for x:import, in the folder
// of the path typed so far. Relative to the document - or for XSpec, to the element's base URI, which xml:base changes
export class HrefCompletion {
	// the file extensions for each attribute, by the element's local name - any file when there are none
	private static readonly xsltExtensions: { [element: string]: string[] } = { import: ['.xsl', '.xslt'], include: ['.xsl', '.xslt'] };
	private static readonly xspecExtensions: { [attribute: string]: string[] } = {
		'import href': ['.xspec'], 'description stylesheet': ['.xsl', '.xslt'], 'helper stylesheet': ['.xsl', '.xslt'],
		'description schematron': ['.sch'], 'description query-at': ['.xq', '.xqm', '.xquery', '.xql'], 'helper query-at': ['.xq', '.xqm', '.xquery', '.xql'],
		'description xproc': ['.xpl'], 'helper xproc': ['.xpl']
	};
	private static readonly xspecAttributes = ['import href', 'context href', 'expect href', 'param href', 'variable href', 'input href', 'option href', ...Object.keys(HrefCompletion.xspecExtensions)];

	public static completions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		if (document.uri.scheme !== 'file' || (document.languageId !== 'xslt' && document.languageId !== 'xspec')) {
			return undefined;
		}
		const text = document.getText();
		const offset = document.offsetAt(position);
		const value = HrefCompletion.attributeAt(text, offset);
		if (!value) {
			return undefined;
		}
		const { prefix, element, attribute, valueStart, quote } = value;
		const isXSpec = document.languageId === 'xspec';
		let extensions: string[] | undefined;
		let basePath = document.fileName;
		if (isXSpec) {
			const root = /<(?:([\w.-]+):)?description\b/.exec(text);
			const xspecPrefix = root?.[1] ?? '';
			const key = `${localName(element)} ${attribute}`;
			if (prefix !== xspecPrefix || !HrefCompletion.xspecAttributes.includes(key)) {
				return undefined;
			}
			extensions = HrefCompletion.xspecExtensions[key];
			// the element's base URI, which an xml:base changes
			const parsed = parseXml(text);
			const tag = parsed ? [parsed, ...descendants(parsed)].find((e) => e.start < offset && offset < e.contentStart) : undefined;
			basePath = tag ? XSpecHrefs.basePath(tag, document.fileName) : basePath;
		} else {
			if (prefix !== RecordTypes.xsltPrefix(text) || attribute !== 'href' || !HrefCompletion.xsltExtensions[localName(element)]) {
				return undefined;
			}
			extensions = HrefCompletion.xsltExtensions[localName(element)];
		}
		// the folder of the path typed: up to its last '/'
		const typed = text.substring(valueStart, offset);
		if (/^[a-z][a-z0-9+.-]*:/i.test(typed) && !/^file:/i.test(typed)) {
			// a URI, e.g. http: or one an XML catalog maps
			return undefined;
		}
		const slash = typed.lastIndexOf('/');
		const folderPart = slash < 0 ? '' : typed.substring(0, slash + 1);
		let folder: string;
		try {
			const decoded = decodeURIComponent(decodeReferences(folderPart.replace(/^file:\/\//i, '')));
			folder = path.isAbsolute(decoded) ? decoded : path.resolve(path.dirname(basePath), decoded);
		} catch {
			return undefined;
		}
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(folder, { withFileTypes: true });
		} catch {
			return undefined;
		}
		// the name typed is replaced, to the end of the name - before any '/' or the end of the value
		const end = HrefCompletion.nameEnd(text, offset, quote);
		const range = new vscode.Range(document.positionAt(valueStart + slash + 1), document.positionAt(end));
		const encode = (name: string) => name.replace(/[ %#?]/g, (c) => encodeURIComponent(c)).replace(/&/g, '&amp;').replace(/</g, '&lt;')
			.replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&apos;');
		const items: vscode.CompletionItem[] = [];
		if (slash < 0 || folderPart.split('/').every((part) => part === '..' || part === '')) {
			const parent = new vscode.CompletionItem('../', vscode.CompletionItemKind.Folder);
			parent.range = range;
			parent.sortText = '0';
			parent.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
			items.push(parent);
		}
		for (const entry of entries) {
			const entryPath = path.join(folder, entry.name);
			if (entry.name.startsWith('.') || entry.name === 'node_modules') {
				continue;
			}
			if (entry.isDirectory()) {
				const item = new vscode.CompletionItem(entry.name + '/', vscode.CompletionItemKind.Folder);
				item.insertText = encode(entry.name) + '/';
				item.range = range;
				item.sortText = `1${entry.name}`;
				// on to the files in it
				item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
				items.push(item);
			} else if (entry.isFile() && path.normalize(entryPath) !== path.normalize(document.fileName) &&
				(!extensions || extensions.includes(path.extname(entry.name).toLowerCase()))) {
				const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.File);
				item.insertText = encode(entry.name);
				item.range = range;
				item.sortText = `2${entry.name}`;
				items.push(item);
			}
		}
		return items;
	}

	// the attribute value the offset is in: the element's prefix and name, the attribute's name, and where its value starts
	private static attributeAt(text: string, offset: number): { prefix: string, element: string, attribute: string, valueStart: number, quote: string } | undefined {
		const tagStart = text.lastIndexOf('<', offset - 1);
		if (tagStart < 0 || text.lastIndexOf('>', offset - 1) > tagStart) {
			return undefined;
		}
		const before = text.substring(tagStart, offset);
		const element = /^<([\w.-]+(?::[\w.-]+)?)/.exec(before)?.[1];
		// the last attribute, with its value not closed yet
		const attribute = /\s([\w.:-]+)\s*=\s*(["'])([^"']*)$/.exec(before);
		if (!element || !attribute || /["']/.test(attribute[3])) {
			return undefined;
		}
		// an attribute before it with an odd quote isn't closed: the offset is in its value, not this one's
		const quotes = before.substring(0, attribute.index).match(/["']/g)?.length ?? 0;
		if (quotes % 2 !== 0) {
			return undefined;
		}
		const colon = element.indexOf(':');
		return { prefix: colon > 0 ? element.substring(0, colon) : '', element, attribute: attribute[1], valueStart: offset - attribute[3].length, quote: attribute[2] };
	}

	private static nameEnd(text: string, offset: number, quote: string) {
		let end = offset;
		while (end < text.length && text[end] !== quote && text[end] !== '/' && text[end] !== '<' && text[end] !== '>' && text[end] !== '\n') {
			end++;
		}
		return end;
	}
}
