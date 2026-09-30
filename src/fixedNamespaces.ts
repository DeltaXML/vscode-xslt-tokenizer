/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as fs from 'fs';
import { RecordTypes } from './recordTypes';
import { HrefPaths } from './hrefPaths';

// a token of a fixed-namespaces attribute that's reported, as Saxon 13 reports XTSE0122: its offset in the attribute's
// value, and why
export interface FixedNamespacesProblem {
	token: string;
	offset: number;
	reason: 'unreadable' | 'xmlns' | 'xml';
}

// XSLT 4.0: the fixed-namespaces attribute of the outermost element of a stylesheet module - xsl:stylesheet,
// xsl:transform or xsl:package - defines all the namespace bindings for its XPath expressions, patterns, and attributes
// with QNames, e.g. name, mode and as - instead of the in-scope namespaces, which still apply to element and attribute
// names, e.g. of literal result elements. Saxon 13 implements it; Saxon 12.8 doesn't.
export class FixedNamespaces {
	public static readonly xmlNamespace = 'http://www.w3.org/XML/1998/namespace';
	// the reserved namespaces, bound by #standard, or by their prefixes
	public static readonly standard: [string, string][] = [
		['xsl', 'http://www.w3.org/1999/XSL/Transform'],
		['xml', FixedNamespaces.xmlNamespace],
		['xs', 'http://www.w3.org/2001/XMLSchema'],
		['xsi', 'http://www.w3.org/2001/XMLSchema-instance'],
		['fn', 'http://www.w3.org/2005/xpath-functions'],
		['math', 'http://www.w3.org/2005/xpath-functions/math'],
		['map', 'http://www.w3.org/2005/xpath-functions/map'],
		['array', 'http://www.w3.org/2005/xpath-functions/array'],
		['err', 'http://www.w3.org/2005/xqt-errors']
	];

	// the namespace declarations of the start tag at the offset, e.g. of the outermost element, as prefix to URI - not
	// the default namespace, which fixed-namespaces doesn't affect
	public static declarations(text: string, tagStart: number): Map<string, string> {
		const declarations = new Map<string, string>();
		const markup = RecordTypes.blankMarkup(text);
		const tag = new RegExp(RecordTypes.tagPattern, 'y');
		tag.lastIndex = tagStart;
		const match = tag.exec(markup);
		if (match) {
			const tagText = text.substring(tagStart, tagStart + match[0].length);
			for (const declaration of tagText.matchAll(/\sxmlns:([\w.-]+)\s*=\s*(["'])(.*?)\2/g)) {
				declarations.set(declaration[1], declaration[3]);
			}
		}
		return declarations;
	}

	// the offset of the start tag of the stylesheet module's outermost element
	public static rootOffset(text: string): number | undefined {
		return /<([\w.-]+:)?(stylesheet|transform|package)[\s>]/.exec(RecordTypes.blankMarkup(text))?.index;
	}

	// the fixed namespace bindings for the value of a fixed-namespaces attribute: each whitespace-separated token, in
	// order, with the last binding for a prefix winning, is the first that applies of:
	// - #standard: the reserved namespaces
	// - a prefix bound on the outermost element (native): its binding
	// - a reserved prefix, e.g. math: its reserved namespace, unless the outermost element binds it to another
	// - prefix=uri
	// - a URI of a namespace well-formed XML document, resolved against the module's file: the namespace declarations
	//   of its outermost element
	// with the tokens that are reported: a URI whose document can't be read, or that binds xmlns, or xml to another URI
	public static bindings(value: string, native: Map<string, string>, moduleFile?: string, readText = FixedNamespaces.readFile): { bindings: Map<string, string>, problems: FixedNamespacesProblem[] } {
		const bindings = new Map<string, string>();
		const problems: FixedNamespacesProblem[] = [];
		const reserved = new Map(FixedNamespaces.standard);
		const bindReserved = (prefix: string) => bindings.set(prefix, native.get(prefix) ?? reserved.get(prefix)!);
		for (const match of value.matchAll(/\S+/g)) {
			const token = match[0];
			const offset = match.index!;
			const pair = /^([A-Za-z_][\w.-]*)=(.+)$/.exec(token);
			if (token === '#standard') {
				FixedNamespaces.standard.forEach(([prefix]) => bindReserved(prefix));
			} else if (native.has(token)) {
				bindings.set(token, native.get(token)!);
			} else if (reserved.has(token)) {
				bindReserved(token);
			} else if (pair) {
				const [, prefix, uri] = pair;
				if (prefix === 'xmlns') {
					problems.push({ token, offset, reason: 'xmlns' });
				} else if ((prefix === 'xml') !== (uri === FixedNamespaces.xmlNamespace)) {
					problems.push({ token, offset, reason: 'xml' });
				} else {
					bindings.set(prefix, uri);
				}
			} else {
				// a URI, e.g. ./package.xsl, for the namespace declarations of its document's outermost element
				const documentPath = HrefPaths.fixedNamespacesPath(token, moduleFile);
				const text = documentPath !== undefined ? readText(documentPath) : undefined;
				const rootTag = text !== undefined ? /<[\w.:-]+[\s/>]/.exec(RecordTypes.blankMarkup(text).replace(/<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/g, (m) => ' '.repeat(m.length))) : null;
				if (text === undefined || !rootTag) {
					problems.push({ token, offset, reason: 'unreadable' });
				} else {
					FixedNamespaces.declarations(text, rootTag.index).forEach((uri, prefix) => bindings.set(prefix, uri));
				}
			}
		}
		return { bindings, problems };
	}

	// for a stylesheet module with a fixed-namespaces attribute: its fixed namespace bindings, with the problems and
	// the offset of the attribute's value in the text - undefined if it has none
	public static forModule(text: string, moduleFile?: string): { bindings: Map<string, string>, problems: FixedNamespacesProblem[], valueOffset: number } | undefined {
		const root = FixedNamespaces.rootOffset(text);
		const value = root !== undefined ? RecordTypes.attributeOfElementAt(text, root + 1, 'fixed-namespaces', true) : undefined;
		const valueOffset = root !== undefined ? RecordTypes.attributeValueOffset(text, root + 1, 'fixed-namespaces') : undefined;
		if (root === undefined || value === undefined || valueOffset === undefined) {
			return undefined;
		}
		return { ...FixedNamespaces.bindings(value, FixedNamespaces.declarations(text, root), moduleFile), valueOffset };
	}

	private static readFile(file: string): string | undefined {
		try {
			return fs.readFileSync(file, 'utf8');
		} catch {
			return undefined;
		}
	}
}
