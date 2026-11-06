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
import { HrefPaths } from './hrefPaths';
import { XmlElement, parseXml, localName, descendants } from './xspecXml';

// The files an XSpec file refers to - the stylesheet, Schematron, XQuery module or XProc step it tests, its helpers and
// the XSpec files it imports, and the documents of its x:context, x:expect, x:param, x:variable, x:input and x:option -
// resolved as XSpec resolves them: against the element's base URI, which an xml:base on it or an ancestor changes. For
// the links to them, and the problems with those that aren't found
export interface XSpecHref {
	element: string;
	attribute: string;
	// the URI, without any query
	value: string;
	// the offsets of the value in the text
	start: number;
	end: number;
	// the path the value is relative to - a file in the folder of the base URI
	basePath: string;
}

export class XSpecHrefs {
	// the attributes with a file's URI, by the local name of the XSpec element - not x:description's query or
	// x:helper's package-name, which are names, not files
	private static readonly attributes: { [element: string]: string[] } = {
		description: ['stylesheet', 'schematron', 'query-at', 'xproc'],
		helper: ['stylesheet', 'query-at', 'xproc'],
		import: ['href'],
		context: ['href'], expect: ['href'], param: ['href'], variable: ['href'], input: ['href'], option: ['href']
	};

	public static find(text: string, documentPath: string): XSpecHref[] {
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return [];
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':')) + ':' : '';
		const hrefs: XSpecHref[] = [];
		for (const element of [root, ...descendants(root)]) {
			const names = element.name.startsWith(prefix) && (prefix || !element.name.includes(':')) ? XSpecHrefs.attributes[localName(element.name)] : undefined;
			for (const attribute of names ?? []) {
				const value = element.attributes.get(attribute);
				if (value === undefined || value.trim() === '') {
					continue;
				}
				const startTag = text.substring(element.start, element.contentStart);
				const match = new RegExp(`\\s${attribute}\\s*=\\s*(["'])`).exec(startTag);
				if (!match) {
					continue;
				}
				const start = element.start + match.index + match[0].length;
				const end = text.indexOf(match[1], start);
				// without a query, e.g. Saxon's ?strip-space=yes;xinclude=yes for a document
				hrefs.push({ element: localName(element.name), attribute, value: value.trim().replace(/\?.*$/, ''), start, end, basePath: XSpecHrefs.basePath(element, documentPath) });
			}
		}
		return hrefs;
	}

	// a path in the folder of the element's base URI: the document's, unless an xml:base on it or an ancestor changes it
	public static basePath(element: XmlElement, documentPath: string): string {
		const bases: string[] = [];
		for (let e: XmlElement | undefined = element; e; e = e.parent) {
			const base = e.attributes.get('xml:base');
			if (base !== undefined) {
				bases.unshift(base);
			}
		}
		let basePath = documentPath;
		for (const base of bases) {
			const resolved = HrefPaths.toPath(base, basePath);
			if (resolved === undefined) {
				break;
			}
			// a folder, e.g. xml:base="../" - relative names are resolved within it
			basePath = /[/\\]$/.test(base) ? path.join(resolved, '_') : resolved;
		}
		return basePath;
	}

	public static links(document: vscode.TextDocument): vscode.DocumentLink[] {
		return XSpecHrefs.find(document.getText(), document.fileName).flatMap((href) => {
			const target = HrefPaths.linkTarget(href.value, href.basePath);
			if (target === undefined) {
				return [];
			}
			const link = new vscode.DocumentLink(new vscode.Range(document.positionAt(href.start), document.positionAt(href.end)), vscode.Uri.parse(target));
			link.tooltip = HrefPaths.linkTooltip(href.value, href.basePath);
			return [link];
		});
	}

	// the problems: a file that isn't found, or a URI that isn't a file - a warning for an http: URI, which may be fetched
	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		if (document.uri.scheme !== 'file') {
			return [];
		}
		return XSpecHrefs.find(document.getText(), document.fileName).flatMap((href) => {
			const range = new vscode.Range(document.positionAt(href.start), document.positionAt(href.end));
			const problem = HrefPaths.importProblem(href.value, href.basePath);
			if (problem) {
				const message = problem.message.replace(/^Included\/imported (file|URI)/, `XSpec: the ${href.attribute} URI`);
				return [new vscode.Diagnostic(range, message, problem.warning ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error)];
			}
			const filePath = HrefPaths.toPath(href.value, href.basePath);
			if (filePath !== undefined && !fs.existsSync(filePath)) {
				return [new vscode.Diagnostic(range, `XSpec: the file '${href.value}' of the ${href.attribute} attribute isn't found: ${filePath}`, vscode.DiagnosticSeverity.Error)];
			}
			if (filePath !== undefined && fs.statSync(filePath).isDirectory()) {
				return [new vscode.Diagnostic(range, `XSpec: '${href.value}' of the ${href.attribute} attribute is a folder, not a file: ${filePath}`, vscode.DiagnosticSeverity.Error)];
			}
			// x:import's file must be an XSpec file - XSpec stops the run otherwise
			if (filePath !== undefined && href.element === 'import' && XSpecHrefs.isXSpecFile(filePath) === false) {
				return [new vscode.Diagnostic(range, `XSpec: '${href.value}' isn't an XSpec file - the outermost element of a file x:import imports must be x:description`, vscode.DiagnosticSeverity.Error)];
			}
			return [];
		});
	}

	// whether the file's outermost element is XSpec's x:description - undefined if it can't be read, or has no element yet
	public static isXSpecFile(filePath: string): boolean | undefined {
		let start: string;
		try {
			const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && path.normalize(d.fileName) === path.normalize(filePath));
			start = open ? open.getText().substring(0, 65536) : XSpecHrefs.readStart(filePath);
		} catch {
			return undefined;
		}
		// after the XML declaration, comments, processing instructions and a DOCTYPE
		const root = /^\uFEFF?(?:\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)*<([\w.-]+(?::[\w.-]+)?)([^>]*)>?/.exec(start);
		if (!root) {
			return undefined;
		}
		const colon = root[1].indexOf(':');
		const prefix = colon > 0 ? root[1].substring(0, colon) : '';
		const namespace = new RegExp(`\\sxmlns${prefix ? ':' + prefix : ''}\\s*=\\s*(["'])(.*?)\\1`).exec(root[2])?.[2];
		return localName(root[1]) === 'description' && namespace === 'http://www.jenitennison.com/xslt/xspec';
	}

	private static readStart(filePath: string) {
		const fd = fs.openSync(filePath, 'r');
		try {
			const buffer = Buffer.alloc(65536);
			const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
			return buffer.subarray(0, read).toString('utf8');
		} finally {
			fs.closeSync(fd);
		}
	}

	// the file of the href at the offset - for Go to Definition
	public static hrefAt(document: vscode.TextDocument, offset: number): { href: XSpecHref, filePath: string } | undefined {
		if (document.uri.scheme !== 'file') {
			return undefined;
		}
		const href = XSpecHrefs.find(document.getText(), document.fileName).find((h) => offset >= h.start && offset <= h.end);
		const filePath = href ? HrefPaths.toPath(href.value, href.basePath) : undefined;
		return href && filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? { href, filePath } : undefined;
	}
}
