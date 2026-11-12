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
		const locals = reference.attribute === 'rule' ? ['rule'] : reference.attribute === 'diagnostics' ? ['diagnostic'] :
			reference.attribute === 'properties' ? ['property'] : ['pattern', 'group'];
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
		let complete = true;
		const seen = new Set<string>();
		const collect = (element: XmlElement, file: string, fileText: string, elementPrefix: string) => {
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
		return { prefix, declared, complete };
	}

	// the references in the schema: active's pattern, is-a, extends' rule, and an assertion's diagnostics and properties
	private static references(text: string, prefix: string): Reference[] {
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		const attributes: { [local: string]: string[] } = {
			active: ['pattern'], pattern: ['is-a'], group: ['is-a'], extends: ['rule'], assert: ['diagnostics', 'properties'], report: ['diagnostics', 'properties']
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
