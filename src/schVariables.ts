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

// a name in the text: a variable reference, without its '$', or a declaration's name attribute
interface Occurrence {
	start: number;
	end: number;
	isDeclaration: boolean;
}

// Schematron: Go to Definition, Find All References and Rename for the variables of a schema - in the schema file - as
// SchXslt2 scopes them (see XsltTokenDiagnostics.schVariableAllowances):
// - sch:let and sch:param of the schema, and sch:let of a phase: global
// - sch:let of a pattern or group: in it - of a rule: in it, and in the abstract rules it extends, whose content is
//   copied into it - of an abstract rule: in it, and the rules that extend it
// - the parameters of an abstract pattern, e.g. $ctx: in it, and the sch:param of each pattern with is-a for it
// An inner declaration of the same name hides an outer one, in its scope
export class SchVariables {
	// the attributes that aren't XPath expressions - names, ids, references and URIs
	private static readonly notXPath = new Set(['name', 'id', 'href', 'prefix', 'uri', 'abstract', 'is-a', 'pattern', 'rule', 'diagnostics', 'properties',
		'class', 'icon', 'see', 'fpi', 'queryBinding', 'schemaVersion', 'schematronEdition', 'defaultPhase', 'as', 'xml:lang', 'xml:space']);

	public static definition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
		const found = SchVariables.find(document, position);
		const declarations = found?.occurrences.filter((o) => o.isDeclaration) ?? [];
		return found ? (declarations.length > 0 ? declarations : found.occurrences.slice(0, 1)).map((o) => SchVariables.location(document, o)) : undefined;
	}

	public static references(document: vscode.TextDocument, position: vscode.Position, includeDeclaration: boolean): vscode.Location[] | undefined {
		return SchVariables.find(document, position)?.occurrences.filter((o) => includeDeclaration || !o.isDeclaration).map((o) => SchVariables.location(document, o));
	}

	public static renameRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
		const found = SchVariables.find(document, position);
		return found ? new vscode.Range(document.positionAt(found.at.start), document.positionAt(found.at.end)) : undefined;
	}

	public static rename(document: vscode.TextDocument, position: vscode.Position, newName: string): vscode.WorkspaceEdit | undefined {
		const found = SchVariables.find(document, position);
		if (!found) {
			return undefined;
		}
		const edit = new vscode.WorkspaceEdit();
		const name = newName.replace(/^\$/, '');
		found.occurrences.forEach((o) => edit.replace(document.uri, new vscode.Range(document.positionAt(o.start), document.positionAt(o.end)), name));
		return edit;
	}

	private static location(document: vscode.TextDocument, occurrence: Occurrence) {
		return new vscode.Location(document.uri, new vscode.Range(document.positionAt(occurrence.start), document.positionAt(occurrence.end)));
	}

	// the variable at the position - a reference, or a declaration's name - and its declarations and references
	private static find(document: vscode.TextDocument, position: vscode.Position): { at: Occurrence, occurrences: Occurrence[] } | undefined {
		const text = document.getText();
		const root = parseXml(text);
		if (!root) {
			return undefined;
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const local = (e: XmlElement | undefined) => e && (prefix ? e.name.startsWith(prefix) : !e.name.includes(':')) ? e.name.substring(prefix.length) : undefined;
		const offset = document.offsetAt(position);
		const element = [root, ...descendants(root)].filter((e) => e.start < offset && offset < e.contentStart).pop();
		if (!element) {
			return undefined;
		}
		// the name at the position: a reference in an XPath attribute, or a declaration's name
		let name: string | undefined;
		let at: Occurrence | undefined;
		for (const value of SchVariables.attributeValues(text, element)) {
			if (offset < value.start || offset > value.end) {
				continue;
			}
			if (value.name === 'name' && (local(element) === 'let' || local(element) === 'param')) {
				name = value.value.trim();
				const leading = value.value.length - value.value.trimStart().length;
				at = { start: value.start + leading, end: value.start + leading + name.length, isDeclaration: true };
			} else if (!SchVariables.notXPath.has(value.name)) {
				const reference = SchVariables.referencesIn(value.value, value.start).find((r) => offset >= r.start - 1 && offset <= r.end);
				if (reference) {
					name = text.substring(reference.start, reference.end);
					at = { ...reference, isDeclaration: false };
				}
			}
		}
		if (!name || !at) {
			return undefined;
		}
		const isAbstract = (e: XmlElement | undefined) => !!e && e.attributes.get('abstract')?.trim() === 'true';
		const declares = (e: XmlElement) => e.children.some((c) => (local(c) === 'let' || local(c) === 'param') && c.attributes.get('name')?.trim() === name);
		const ancestors: XmlElement[] = [];
		for (let e: XmlElement | undefined = element; e; e = e.parent) {
			ancestors.push(e);
		}
		const all = [root, ...descendants(root)];
		// an abstract pattern's parameter: in the pattern, and the sch:param of each pattern with is-a for it
		const isInstanceParam = at.isDeclaration && local(element) === 'param' && element.parent?.attributes.has('is-a');
		// - a name it declares, or a pattern with is-a supplies: SchXslt2 replaces only those; another is a variable reference
		const isParameterOf = (pattern: XmlElement) => SchVariables.children(pattern, 'param', local).some((p) => p.attributes.get('name')?.trim() === name) ||
			all.some((p) => local(p) === 'param' && p.attributes.get('name')?.trim() === name && p.parent?.attributes.get('is-a')?.trim() === pattern.attributes.get('id')?.trim());
		const abstractPattern = isInstanceParam ? all.find((p) => (local(p) === 'pattern' || local(p) === 'group') && isAbstract(p) && p.attributes.get('id')?.trim() === element.parent!.attributes.get('is-a')?.trim()) :
			ancestors.find((a) => (local(a) === 'pattern' || local(a) === 'group') && isAbstract(a) && isParameterOf(a));
		if (abstractPattern) {
			const id = abstractPattern.attributes.get('id')?.trim();
			const instanceParams = all.filter((p) => local(p) === 'param' && p.parent?.attributes.get('is-a')?.trim() === id && p.attributes.get('name')?.trim() === name);
			const declared = SchVariables.children(abstractPattern, 'param', local).filter((p) => p.attributes.get('name')?.trim() === name);
			const occurrences = [...declared, ...instanceParams].flatMap((p) => SchVariables.nameOccurrence(text, p)).concat(SchVariables.referencesWithin(text, abstractPattern, name, () => false));
			return { at, occurrences };
		}
		// the declaration: the nearest - in the element's ancestors, a phase, or an abstract rule the element's rule extends
		const declarationIn = (scope: XmlElement) => [...SchVariables.children(scope, 'let', local), ...SchVariables.children(scope, 'param', local)].find((d) => d.attributes.get('name')?.trim() === name);
		let declaration = at.isDeclaration ? element : ancestors.map(declarationIn).find((d) => d);
		const rule = ancestors.find((a) => local(a) === 'rule');
		const extendedIds = (r: XmlElement) => SchVariables.children(r, 'extends', local).map((e) => e.attributes.get('rule')?.trim());
		if (!declaration && rule) {
			const extended = all.filter((r) => local(r) === 'rule' && isAbstract(r) && extendedIds(rule).includes(r.attributes.get('id')?.trim()));
			declaration = extended.map(declarationIn).find((d) => d);
			if (!declaration && isAbstract(rule)) {
				// in an abstract rule, one of a rule that extends it
				declaration = all.filter((r) => local(r) === 'rule' && extendedIds(r).includes(rule.attributes.get('id')?.trim())).map(declarationIn).find((d) => d);
			}
		}
		if (!declaration) {
			declaration = SchVariables.children(root, 'phase', local).map(declarationIn).find((d) => d);
		}
		if (!declaration) {
			return undefined;
		}
		// its scope: the schema, for a global one - else its parent, and the rules that share the content of an abstract rule
		const parent = declaration.parent!;
		const scopes = local(parent) === 'schema' || local(parent) === 'library' || local(parent) === 'phase' ? [root] : [parent];
		if (local(parent) === 'rule') {
			const shared = isAbstract(parent) ? all.filter((r) => local(r) === 'rule' && extendedIds(r).includes(parent.attributes.get('id')?.trim())) :
				all.filter((r) => local(r) === 'rule' && isAbstract(r) && extendedIds(parent).includes(r.attributes.get('id')?.trim()));
			scopes.push(...shared);
		}
		// not where another declaration of the name hides it
		const hidden = (e: XmlElement) => !scopes.includes(e) && e !== parent && declares(e);
		const occurrences = SchVariables.nameOccurrence(text, declaration).concat(scopes.flatMap((scope) => SchVariables.referencesWithin(text, scope, name!, hidden)));
		return { at, occurrences: [...new Map(occurrences.map((o) => [o.start, o])).values()] };
	}

	// the $name references in the XPath attributes of the element and those within it - not within an element hidden
	private static referencesWithin(text: string, scope: XmlElement, name: string, hidden: (e: XmlElement) => boolean): Occurrence[] {
		const result: Occurrence[] = [];
		const visit = (e: XmlElement) => {
			if (hidden(e)) {
				return;
			}
			SchVariables.attributeValues(text, e).filter((v) => !SchVariables.notXPath.has(v.name)).forEach((v) =>
				SchVariables.referencesIn(v.value, v.start).filter((r) => text.substring(r.start, r.end) === name).forEach((r) => result.push({ ...r, isDeclaration: false })));
			e.children.forEach(visit);
		};
		visit(scope);
		return result;
	}

	// the names of the variable references in an XPath expression - after each '$', not within a string literal
	private static referencesIn(value: string, start: number): { start: number, end: number }[] {
		const masked = value.replace(/"[^"]*"|'[^']*'/g, (literal) => ' '.repeat(literal.length));
		return [...masked.matchAll(/\$((?:[\w.-]+:)?[\w.-]+)/g)].map((m) => ({ start: start + m.index! + 1, end: start + m.index! + m[0].length }));
	}

	// the name attribute's value of a declaration
	private static nameOccurrence(text: string, declaration: XmlElement): Occurrence[] {
		const value = SchVariables.attributeValues(text, declaration).find((v) => v.name === 'name');
		if (!value || !value.value.trim()) {
			return [];
		}
		const leading = value.value.length - value.value.trimStart().length;
		return [{ start: value.start + leading, end: value.start + leading + value.value.trim().length, isDeclaration: true }];
	}

	private static children(element: XmlElement, name: string, local: (e: XmlElement | undefined) => string | undefined) {
		return element.children.filter((c) => local(c) === name);
	}

	// the attributes of an element's start tag, as written, with the offsets of their values
	private static attributeValues(text: string, element: XmlElement): { name: string, value: string, start: number, end: number }[] {
		const startTag = text.substring(element.start, element.contentStart);
		return [...startTag.matchAll(/\s([\w.:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map((m) => {
			const start = element.start + m.index! + m[0].length - 1 - m[3].length;
			return { name: m[1], value: m[3], start, end: start + m[3].length };
		});
	}
}
