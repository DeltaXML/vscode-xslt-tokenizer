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
import { XmlElement, parseXml, descendants } from './xspecXml';
import { HrefPaths } from './hrefPaths';

// a Schematron element with an id, in the schema or a file it includes
export interface Declared {
	element: XmlElement;
	local: string;
	file: string;
	text: string;
}

// a reference to an id in an attribute's value, e.g. is-a="table", or a token of diagnostics="d1 d2"
interface Reference {
	element: XmlElement;
	attribute: string;
	id: string;
	start: number;
	end: number;
}

// Schematron: the references between the elements of a schema - in the schema SchXslt2, the Schematron processor bundled
// with XSpec, assembles with the files sch:include and sch:extends href bring in - with Go to Definition from a reference
// to its declaration (see xslt-resources/xspec/lib/schxslt2/transpile.xsl):
// - errors, where SchXslt2 stops: is-a that isn't the id of an abstract pattern - or group, for a group - or that
//   doesn't supply a parameter it declares with no value, and extends whose rule isn't the id of an abstract rule
// - warnings, where it ignores the reference: active for a pattern that isn't declared, or is abstract, diagnostics or
//   properties that aren't declared, and ids that aren't unique (its optional check-assembled-schema reports these)
// A parameter the abstract pattern doesn't declare isn't reported: before ISO Schematron 2025, they weren't declared.
// When a file brought in can't be read, a reference isn't reported as not found, as it may be declared there
export class SchReferences {
	public static readonly code = 'schxslt2-reference';
	// the elements whose ids each attribute refers to
	private static readonly declaredBy: { [attribute: string]: string[] } = {
		'pattern': ['pattern', 'group'], 'is-a': ['pattern', 'group'], 'rule': ['rule'], 'diagnostics': ['diagnostic'], 'properties': ['property'], 'defaultPhase': ['phase']
	};

	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		const schema = SchReferences.schema(document);
		if (!schema) {
			return [];
		}
		const { prefix, declared, complete } = schema;
		const diagnostics: vscode.Diagnostic[] = [];
		const add = (start: number, end: number, message: string, severity = vscode.DiagnosticSeverity.Error) => {
			const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(start), document.positionAt(end)), `SchXslt2: ${message}`, severity);
			diagnostic.code = SchReferences.code;
			diagnostics.push(diagnostic);
		};
		// a file brought in that isn't found - SchXslt2 stops
		if (document.uri.scheme === 'file') {
			SchReferences.hrefs(document).forEach(({ href, start, end }) => {
				const filePath = HrefPaths.toPath(href, document.fileName);
				if (filePath && !fs.existsSync(filePath)) {
					add(start, end, `the file ${href} isn't found`);
				}
			});
		}
		const byId = (id: string, locals: string[]) => declared.filter((d) => d.element.attributes.get('id')?.trim() === id && locals.includes(d.local));
		const isAbstract = (element: XmlElement) => element.attributes.get('abstract')?.trim() === 'true';
		// ids that aren't unique - those in this file
		const counts = new Map<string, number>();
		declared.forEach((d) => counts.set(d.element.attributes.get('id')!.trim(), (counts.get(d.element.attributes.get('id')!.trim()) ?? 0) + 1));
		declared.filter((d) => d.file === document.fileName && counts.get(d.element.attributes.get('id')!.trim())! > 1).forEach((d) => {
			const value = SchReferences.attributeValue(d.text, d.element, 'id');
			if (value) {
				add(value.start, value.end, `the id ${value.value.trim()} isn't unique in the schema`, vscode.DiagnosticSeverity.Warning);
			}
		});
		for (const reference of SchReferences.references(document.getText(), prefix)) {
			const local = reference.element.name.substring(prefix.length);
			if (reference.attribute === 'pattern') {
				const patterns = byId(reference.id, ['pattern', 'group']);
				if (patterns.length === 0 && complete) {
					add(reference.start, reference.end, `no pattern or group has the id ${reference.id} - the phase has no pattern with it`, vscode.DiagnosticSeverity.Warning);
				} else if (patterns.length === 1 && isAbstract(patterns[0].element)) {
					add(reference.start, reference.end, `the ${patterns[0].local} ${reference.id} is abstract - only the patterns with is-a for it are run`, vscode.DiagnosticSeverity.Warning);
				}
			} else if (reference.attribute === 'is-a') {
				const templates = byId(reference.id, ['pattern', 'group']);
				const template = templates.find((t) => t.local === local && isAbstract(t.element));
				if (template) {
					// the parameters it declares with no value, which each pattern with is-a for it must supply
					const params = (element: XmlElement) => element.children.filter((child) => child.name === prefix + 'param');
					const supplied = params(reference.element).map((param) => param.attributes.get('name')?.trim());
					const missing = params(template.element).filter((param) => !param.attributes.has('value')).map((param) => param.attributes.get('name')?.trim())
						.filter((name) => !supplied.includes(name));
					if (missing.length > 0) {
						add(reference.start, reference.end, `the abstract ${local} ${reference.id} declares the parameter${missing.length > 1 ? 's' : ''} ${missing.join(', ')}, with no value - supply ${missing.length > 1 ? 'them' : 'it'} with sch:param`);
					}
				} else if (templates.length > 0) {
					add(reference.start, reference.end, `the ${templates[0].local} ${reference.id} isn't an abstract ${local} - is-a must be the id of one`);
				} else if (complete) {
					add(reference.start, reference.end, `no abstract ${local} has the id ${reference.id}`);
				}
			} else if (reference.attribute === 'rule') {
				const rules = byId(reference.id, ['rule']);
				if (rules.length > 0 && !rules.some((rule) => isAbstract(rule.element))) {
					add(reference.start, reference.end, `the rule ${reference.id} isn't abstract - extends must be the id of an abstract rule`);
				} else if (rules.length === 0 && complete) {
					add(reference.start, reference.end, `no abstract rule has the id ${reference.id}`);
				}
			} else if (reference.attribute === 'defaultPhase') {
				if (complete && byId(reference.id, ['phase']).length === 0 && reference.id !== '#ALL') {
					add(reference.start, reference.end, `no phase has the id ${reference.id} - no pattern is active`, vscode.DiagnosticSeverity.Warning);
				}
			} else if (complete && byId(reference.id, [reference.attribute === 'diagnostics' ? 'diagnostic' : 'property']).length === 0) {
				add(reference.start, reference.end, `no ${reference.attribute === 'diagnostics' ? 'diagnostic' : 'property'} has the id ${reference.id} - it's left out of the report`, vscode.DiagnosticSeverity.Warning);
			}
		}
		return diagnostics;
	}

	// the files sch:include and sch:extends href bring in: a link to each - the file, without any fragment, e.g. #p1
	public static links(document: vscode.TextDocument): vscode.DocumentLink[] {
		return SchReferences.hrefs(document).flatMap(({ href, start, end }) => {
			const target = HrefPaths.linkTarget(href, document.fileName);
			if (target === undefined) {
				return [];
			}
			const link = new vscode.DocumentLink(new vscode.Range(document.positionAt(start), document.positionAt(end)), vscode.Uri.parse(target));
			link.tooltip = HrefPaths.linkTooltip(href, document.fileName);
			return [link];
		});
	}

	// the hrefs of sch:include and sch:extends, as written - without any fragment - with their offsets
	private static hrefs(document: vscode.TextDocument): { href: string, start: number, end: number }[] {
		const text = document.getText();
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		return [root, ...descendants(root)].filter((e) => e.name === prefix + 'include' || e.name === prefix + 'extends').flatMap((element) => {
			const value = SchReferences.attributeValue(text, element, 'href');
			const href = value?.value.trim().replace(/#.*$/, '');
			if (!value || !href) {
				return [];
			}
			const leading = value.value.length - value.value.trimStart().length;
			return [{ href, start: value.start + leading, end: value.start + leading + href.length }];
		});
	}

	// Go to Definition: from a reference to the element with its id
	public static definition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
		const schema = SchReferences.schema(document);
		if (!schema) {
			return undefined;
		}
		const offset = document.offsetAt(position);
		const reference = SchReferences.references(document.getText(), schema.prefix).find((r) => offset >= r.start && offset <= r.end);
		if (!reference) {
			return undefined;
		}
		const locals = SchReferences.declaredBy[reference.attribute];
		return schema.declared.filter((d) => d.element.attributes.get('id')?.trim() === reference.id && locals.includes(d.local)).map((d) => {
			const lines = d.text.substring(0, d.element.start).split('\n');
			const start = new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
			return new vscode.Location(vscode.Uri.file(d.file), new vscode.Range(start, start.translate(0, d.element.name.length + 1)));
		});
	}

	// the schema's prefix for Schematron, the elements with ids in it and in the files it brings in, and whether all those
	// files could be read
	public static schema(document: vscode.TextDocument) {
		const text = document.getText();
		const root = parseXml(text);
		if (!root) {
			return undefined;
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const declared: Declared[] = [];
		const files: { file: string, text: string, prefix: string }[] = [];
		let complete = true;
		const seen = new Set<string>();
		const collect = (element: XmlElement, file: string, fileText: string, elementPrefix: string) => {
			files.push({ file, text: fileText, prefix: elementPrefix });
			const elements = [element, ...descendants(element)];
			elements.filter((e) => e.name.startsWith(elementPrefix) && !e.name.substring(elementPrefix.length).includes(':') && e.attributes.has('id'))
				.forEach((e) => declared.push({ element: e, local: e.name.substring(elementPrefix.length), file, text: fileText }));
			// the files brought in: sch:include, and sch:extends with href
			elements.filter((e) => (e.name === elementPrefix + 'include' || e.name === elementPrefix + 'extends') && e.attributes.has('href')).forEach((e) => {
				const href = e.attributes.get('href')!.trim().replace(/#.*$/, '');
				const filePath = document.uri.scheme === 'file' || file !== document.fileName ? HrefPaths.toPath(href, file) : undefined;
				if (!filePath || seen.has(filePath)) {
					complete = complete && !!filePath;
					return;
				}
				seen.add(filePath);
				try {
					const includedText = fs.readFileSync(filePath, 'utf8');
					const included = parseXml(includedText);
					if (!included) {
						complete = false;
						return;
					}
					const includedColon = included.name.indexOf(':');
					collect(included, filePath, includedText, includedColon > 0 ? included.name.substring(0, includedColon + 1) : '');
				} catch {
					complete = false;
				}
			});
		};
		collect(root, document.fileName, text, prefix);
		return { prefix, declared, complete, files };
	}

	// the references in the schema: active's pattern, is-a, extends' rule, and an assertion's diagnostics and properties
	private static references(text: string, prefix: string): Reference[] {
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		const attributes: { [local: string]: string[] } = {
			active: ['pattern'], pattern: ['is-a'], group: ['is-a'], extends: ['rule'], assert: ['diagnostics', 'properties'], report: ['diagnostics', 'properties'],
			schema: ['defaultPhase']
		};
		const references: Reference[] = [];
		[root, ...descendants(root)].forEach((element) => {
			const local = element.name.startsWith(prefix) ? element.name.substring(prefix.length) : undefined;
			for (const attribute of (local && !local.includes(':') ? attributes[local] : undefined) ?? []) {
				const value = SchReferences.attributeValue(text, element, attribute);
				if (!value) {
					continue;
				}
				// each id in the value - one, or for diagnostics and properties, a list
				for (const match of value.value.matchAll(/\S+/g)) {
					references.push({ element, attribute, id: match[0], start: value.start + match.index!, end: value.start + match.index! + match[0].length });
				}
			}
		});
		return references;
	}

	// the id at the position - in a reference, or an element's id attribute - with the kinds of element that declare it
	private static idAt(document: vscode.TextDocument, position: vscode.Position): { id: string, locals: string[], start: number, end: number } | undefined {
		const text = document.getText();
		const root = parseXml(text);
		if (!root) {
			return undefined;
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const offset = document.offsetAt(position);
		const reference = SchReferences.references(text, prefix).find((r) => offset >= r.start && offset <= r.end);
		if (reference) {
			return { id: reference.id, locals: SchReferences.declaredBy[reference.attribute], start: reference.start, end: reference.end };
		}
		const element = [root, ...descendants(root)].filter((e) => e.start < offset && offset < e.contentStart).pop();
		const local = element?.name.startsWith(prefix) ? element.name.substring(prefix.length) : undefined;
		const value = element && local && ['pattern', 'group', 'rule', 'diagnostic', 'property', 'phase'].includes(local) ? SchReferences.attributeValue(text, element, 'id') : undefined;
		if (!value || offset < value.start || offset > value.end || !value.value.trim()) {
			return undefined;
		}
		const locals = local === 'pattern' || local === 'group' ? ['pattern', 'group'] : [local!];
		return { id: value.value.trim(), locals, start: value.start, end: value.end };
	}

	// the id's declarations - their id attributes - and references, in the schema and the files it brings in
	private static occurrences(document: vscode.TextDocument, id: string, locals: string[]): { location: vscode.Location, isDeclaration: boolean }[] {
		const schema = SchReferences.schema(document);
		if (!schema) {
			return [];
		}
		const location = (file: string, text: string, start: number, end: number) => {
			const position = (offset: number) => {
				const lines = text.substring(0, offset).split('\n');
				return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
			};
			return new vscode.Location(vscode.Uri.file(file), new vscode.Range(position(start), position(end)));
		};
		const declarations = schema.declared.filter((d) => locals.includes(d.local) && d.element.attributes.get('id')?.trim() === id).flatMap((d) => {
			const value = SchReferences.attributeValue(d.text, d.element, 'id');
			if (!value) {
				return [];
			}
			const leading = value.value.length - value.value.trimStart().length;
			return [{ location: location(d.file, d.text, value.start + leading, value.start + leading + id.length), isDeclaration: true }];
		});
		const references = schema.files.flatMap((f) => SchReferences.references(f.text, f.prefix)
			.filter((r) => r.id === id && SchReferences.declaredBy[r.attribute].some((l) => locals.includes(l)))
			.map((r) => ({ location: location(f.file, f.text, r.start, r.end), isDeclaration: false })));
		return declarations.concat(references);
	}

	// Find All References: of the id at the position - its declarations, if asked for, and references
	public static referenceLocations(document: vscode.TextDocument, position: vscode.Position, includeDeclaration: boolean): vscode.Location[] | undefined {
		const at = SchReferences.idAt(document, position);
		if (!at) {
			return undefined;
		}
		return SchReferences.occurrences(document, at.id, at.locals).filter((o) => includeDeclaration || !o.isDeclaration).map((o) => o.location);
	}

	// Rename: the id at the position, in its declarations and references - in the files the schema brings in too
	public static renameRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
		const at = SchReferences.idAt(document, position);
		return at ? new vscode.Range(document.positionAt(at.start), document.positionAt(at.end)) : undefined;
	}

	public static rename(document: vscode.TextDocument, position: vscode.Position, newName: string): vscode.WorkspaceEdit | undefined {
		const at = SchReferences.idAt(document, position);
		if (!at) {
			return undefined;
		}
		const edit = new vscode.WorkspaceEdit();
		SchReferences.occurrences(document, at.id, at.locals).forEach(({ location }) => edit.replace(location.uri, location.range, newName));
		return edit;
	}

	// auto-completion of a reference: the ids of the elements it can refer to - for is-a, the abstract patterns, or groups;
	// for extends, the abstract rules; for active, the patterns and groups that aren't abstract - and in a pattern with
	// is-a, an sch:param's name: the abstract pattern's parameters
	public static completions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		const text = document.getText();
		const root = parseXml(text);
		const schema = root ? SchReferences.schema(document) : undefined;
		if (!root || !schema) {
			return undefined;
		}
		const prefix = schema.prefix;
		const offset = document.offsetAt(position);
		const element = [root, ...descendants(root)].filter((e) => e.start < offset && offset < e.contentStart).pop();
		const local = element?.name.startsWith(prefix) ? element.name.substring(prefix.length) : undefined;
		if (!element || !local) {
			return undefined;
		}
		const attributes: { [local: string]: string[] } = {
			active: ['pattern'], pattern: ['is-a'], group: ['is-a'], extends: ['rule'], assert: ['diagnostics', 'properties'], report: ['diagnostics', 'properties'],
			schema: ['defaultPhase'], param: ['name']
		};
		for (const attribute of attributes[local] ?? []) {
			const value = SchReferences.attributeValue(text, element, attribute);
			if (!value || offset < value.start || offset > value.end) {
				continue;
			}
			// the token being typed: for a list, e.g. diagnostics="d1 d2", just the one at the position
			const before = value.value.substring(0, offset - value.start).replace(/^[\s\S]*\s/, '');
			const after = value.value.substring(offset - value.start).replace(/\s[\s\S]*$/, '');
			const range = new vscode.Range(document.positionAt(offset - before.length), document.positionAt(offset + after.length));
			const isAbstract = (e: XmlElement) => e.attributes.get('abstract')?.trim() === 'true';
			let items: { id: string, detail?: string }[];
			if (attribute === 'name') {
				// a parameter of a pattern with is-a: those its abstract pattern declares, or else refers to
				const isA = element.parent?.attributes.get('is-a')?.trim();
				const template = isA ? schema.declared.find((d) => d.element.attributes.get('id')?.trim() === isA && isAbstract(d.element)) : undefined;
				if (!template) {
					return undefined;
				}
				const templatePrefix = schema.files.find((f) => f.file === template.file)?.prefix ?? prefix;
				const declaredParams = template.element.children.filter((c) => c.name === templatePrefix + 'param').map((p) => p.attributes.get('name')?.trim() ?? '');
				const used = [...template.text.substring(template.element.start, template.element.end).matchAll(/\$([\w.-]+)/g)].map((m) => m[1]);
				const supplied = element.parent!.children.filter((c) => c !== element && c.name === prefix + 'param').map((p) => p.attributes.get('name')?.trim());
				items = [...new Set(declaredParams.length > 0 ? declaredParams : used)].filter((n) => n && !supplied.includes(n)).map((id) => ({ id, detail: `parameter of ${isA}` }));
			} else {
				const kinds = SchReferences.declaredBy[attribute];
				items = schema.declared.filter((d) => kinds.includes(d.local) &&
					(attribute === 'is-a' ? isAbstract(d.element) && d.local === local : attribute === 'rule' ? isAbstract(d.element) : attribute === 'pattern' ? !isAbstract(d.element) : true))
					.map((d) => ({ id: d.element.attributes.get('id')!.trim(), detail: `${isAbstract(d.element) ? 'abstract ' : ''}${d.local}${d.file !== document.fileName ? ` - ${d.file.replace(/^.*[\\/]/, '')}` : ''}` }));
			}
			return [...new Map(items.map((item) => [item.id, item])).values()].map((item) => {
				const completion = new vscode.CompletionItem(item.id, vscode.CompletionItemKind.Reference);
				completion.detail = item.detail;
				completion.range = range;
				return completion;
			});
		}
		return undefined;
	}

	// an attribute's value as written, with its offsets
	public static attributeValue(text: string, element: XmlElement, attribute: string) {
		const startTag = text.substring(element.start, element.contentStart);
		const match = new RegExp(`\\s${attribute.replace(/[.-]/g, '\\$&')}\\s*=\\s*(["'])([^"']*)\\1`).exec(startTag);
		if (!match) {
			return undefined;
		}
		const start = element.start + match.index + match[0].length - 1 - match[2].length;
		return { value: match[2], start, end: start + match[2].length };
	}
}
