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
import { XSpecHrefs } from './xspecHrefs';
import { HrefPaths } from './hrefPaths';
import { SchReferences, Declared } from './schReferences';

// an XSpec expectation of a Schematron test that refers to the schema: its id - an assertion's, report's or rule's - its
// role, or x:expect-rule's context
interface Expectation {
	element: XmlElement;
	local: string;
	// the kind of element its id refers to: assert, report or rule
	kind: string;
	// whether it expects the element not to be reported: x:expect-not-assert and x:expect-not-report
	negative: boolean;
}

// XSpec tests of a Schematron schema - the schematron attribute of x:description - and the schema's assertions, reports
// and rules, in it and the files it includes:
// - auto-completion of an expectation's id - x:expect-assert's from the schema's assertions, x:expect-report's from its
//   reports, x:expect-rule's from its rules - its role, and x:expect-rule's context
// - Go to Definition and hover from an id to what it refers to, and a warning for an id the schema doesn't have
// - from the schema: Find All References and Rename for an assertion's, report's or rule's id include the XSpec files
//   that test it
export class XSpecSchematron {
	private static readonly expectations: { [local: string]: { kind: string, negative: boolean } } = {
		'expect-assert': { kind: 'assert', negative: false }, 'expect-not-assert': { kind: 'assert', negative: true },
		'expect-report': { kind: 'report', negative: false }, 'expect-not-report': { kind: 'report', negative: true },
		'expect-rule': { kind: 'rule', negative: false }
	};

	// the schema an XSpec file tests: x:description's schematron, resolved as XSpec resolves it
	public static schemaPathOf(text: string, xspecPath: string): string | undefined {
		const href = XSpecHrefs.find(text, xspecPath).find((h) => h.element === 'description' && h.attribute === 'schematron');
		return href ? HrefPaths.toPath(href.value, href.basePath) : undefined;
	}

	// the schema, with the files it includes - its text with any unsaved changes
	private static schema(document: vscode.TextDocument) {
		const schemaPath = document.uri.scheme === 'file' ? XSpecSchematron.schemaPathOf(document.getText(), document.fileName) : undefined;
		const open = schemaPath ? vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.fileName === schemaPath) : undefined;
		const text = open ? open.getText() : schemaPath && fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : undefined;
		return schemaPath && text !== undefined ? SchReferences.schemaOf(text, schemaPath) : undefined;
	}

	// the Schematron expectations of an XSpec file
	private static expectationsOf(text: string): Expectation[] {
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		return descendants(root).flatMap((element) => {
			const local = element.name.startsWith(prefix) ? element.name.substring(prefix.length) : '';
			const expectation = XSpecSchematron.expectations[local];
			return expectation ? [{ element, local, ...expectation }] : [];
		});
	}

	// the expectation and attribute value at the position
	private static at(document: vscode.TextDocument, position: vscode.Position) {
		const text = document.getText();
		const offset = document.offsetAt(position);
		for (const expectation of XSpecSchematron.expectationsOf(text)) {
			if (offset < expectation.element.start || offset > expectation.element.contentStart) {
				continue;
			}
			for (const attribute of ['id', 'role', 'context']) {
				const value = SchReferences.attributeValue(text, expectation.element, attribute);
				if (value && offset >= value.start && offset <= value.end) {
					return { expectation, attribute, value };
				}
			}
		}
		return undefined;
	}

	// the assertions, reports or rules of the schema with the id
	private static declared(declared: Declared[], kind: string, id: string) {
		return declared.filter((d) => d.local === kind && d.element.attributes.get('id')?.trim() === id);
	}

	public static completions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		const at = XSpecSchematron.at(document, position);
		const schema = at ? XSpecSchematron.schema(document) : undefined;
		if (!at || !schema) {
			return undefined;
		}
		const { expectation, attribute, value } = at;
		const range = new vscode.Range(document.positionAt(value.start), document.positionAt(value.end));
		const ofKind = schema.declared.filter((d) => d.local === expectation.kind);
		const all = schema.files.flatMap((f) => {
			const root = parseXml(f.text);
			return root ? [root, ...descendants(root)].filter((e) => e.name === f.prefix + expectation.kind || (attribute === 'role' && (e.name === f.prefix + 'assert' || e.name === f.prefix + 'report'))) : [];
		});
		const values: [string, string][] = attribute === 'id' ? ofKind.map((d) => [d.element.attributes.get('id')!.trim(), XSpecSchematron.summary(d.element, expectation.kind)]) :
			attribute === 'role' ? all.map((e) => [e.attributes.get('role')?.trim() ?? '', 'a role in the schema']) :
				expectation.kind === 'rule' ? all.map((e) => [e.attributes.get('context')?.replace(/\s+/g, ' ').trim() ?? '', 'a rule\'s context']) : [];
		return [...new Map(values.filter(([v]) => v)).entries()].map(([label, detail]) => {
			const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Reference);
			item.detail = detail;
			item.range = range;
			return item;
		});
	}

	public static definition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
		const at = XSpecSchematron.at(document, position);
		const schema = at?.attribute === 'id' ? XSpecSchematron.schema(document) : undefined;
		return at && schema ? XSpecSchematron.declared(schema.declared, at.expectation.kind, at.value.value.trim()).map((d) => XSpecSchematron.location(d)) : undefined;
	}

	public static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const at = XSpecSchematron.at(document, position);
		const schema = at?.attribute === 'id' ? XSpecSchematron.schema(document) : undefined;
		const target = at && schema ? XSpecSchematron.declared(schema.declared, at.expectation.kind, at.value.value.trim())[0] : undefined;
		if (!at || !target) {
			return undefined;
		}
		const kind = at.expectation.kind;
		const markdown = new vscode.MarkdownString();
		markdown.appendCodeblock(XSpecSchematron.summary(target.element, kind), 'xml');
		const message = XSpecSchematron.text(target);
		if (message) {
			markdown.appendMarkdown(message.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, '\\$&') + '\n\n');
		}
		const details = ['severity', 'role', 'flag'].filter((a) => target.element.attributes.has(a)).map((a) => `${a}: \`${target.element.attributes.get(a)}\``);
		markdown.appendMarkdown(`${kind === 'rule' ? 'Rule' : kind === 'assert' ? 'Assertion' : 'Report'} in ${target.file.replace(/^.*[\\/]/, '')}${details.length > 0 ? ` - ${details.join(', ')}` : ''}`);
		return new vscode.Hover(markdown, new vscode.Range(document.positionAt(at.value.start), document.positionAt(at.value.end)));
	}

	// an id the schema doesn't have: the expectation always fails - or, for x:expect-not-assert and x:expect-not-report,
	// always passes. Not when a file the schema brings in can't be read
	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		const schema = document.uri.scheme === 'file' ? XSpecSchematron.schema(document) : undefined;
		if (!schema || !schema.complete) {
			return [];
		}
		const text = document.getText();
		return XSpecSchematron.expectationsOf(text).flatMap((expectation) => {
			const value = SchReferences.attributeValue(text, expectation.element, 'id');
			const id = value?.value.trim();
			if (!value || !id || XSpecSchematron.declared(schema.declared, expectation.kind, id).length > 0) {
				return [];
			}
			const what = expectation.kind === 'assert' ? 'assertion' : expectation.kind;
			const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(value.start), document.positionAt(value.end)),
				`XSpec: the schema has no ${what} with the id ${id} - this expectation always ${expectation.negative ? 'passes' : 'fails'}`, vscode.DiagnosticSeverity.Warning);
			return [diagnostic];
		});
	}

	// from the schema: the id of an assertion, report or rule at the position - and its occurrences in the XSpec files of
	// the workspace that test the schema, or one that includes it
	public static schemaIdAt(document: vscode.TextDocument, position: vscode.Position): { id: string, kind: string, range: vscode.Range } | undefined {
		const text = document.getText();
		const root = parseXml(text);
		if (!root) {
			return undefined;
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const offset = document.offsetAt(position);
		const element = [root, ...descendants(root)].filter((e) => e.start < offset && offset < e.contentStart).pop();
		const kind = element && ['assert', 'report', 'rule'].find((k) => element.name === prefix + k);
		const value = element && kind ? SchReferences.attributeValue(text, element, 'id') : undefined;
		if (!kind || !value || offset < value.start || offset > value.end || !value.value.trim()) {
			return undefined;
		}
		const leading = value.value.length - value.value.trimStart().length;
		const id = value.value.trim();
		return { id, kind, range: new vscode.Range(document.positionAt(value.start + leading), document.positionAt(value.start + leading + id.length)) };
	}

	// the XSpec files to look in: the workspace's - for testing, others
	public static xspecFiles = () => vscode.workspace.findFiles('**/*.xspec', '**/node_modules/**', 2000);

	public static async xspecReferences(schemaPath: string, kind: string, id: string): Promise<vscode.Location[]> {
		const files = await XSpecSchematron.xspecFiles();
		const locations: vscode.Location[] = [];
		for (const file of files) {
			const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === file.toString());
			let text: string;
			try {
				text = open ? open.getText() : fs.readFileSync(file.fsPath, 'utf8');
			} catch {
				continue;
			}
			const tested = /\sschematron\s*=/.test(text) ? XSpecSchematron.schemaPathOf(text, file.fsPath) : undefined;
			if (!tested) {
				continue;
			}
			// the schema - or one that includes it
			const testsIt = tested === schemaPath || (fs.existsSync(tested) && !!SchReferences.schemaOf(fs.readFileSync(tested, 'utf8'), tested)?.files.some((f) => f.file === schemaPath));
			if (!testsIt) {
				continue;
			}
			for (const expectation of XSpecSchematron.expectationsOf(text).filter((e) => e.kind === kind)) {
				const value = SchReferences.attributeValue(text, expectation.element, 'id');
				if (value && value.value.trim() === id) {
					const leading = value.value.length - value.value.trimStart().length;
					const position = (o: number) => {
						const before = text.substring(0, o).split('\n');
						return new vscode.Position(before.length - 1, before[before.length - 1].length);
					};
					locations.push(new vscode.Location(file, new vscode.Range(position(value.start + leading), position(value.start + leading + id.length))));
				}
			}
		}
		return locations;
	}

	// an assertion's or report's test, or a rule's context, on one line
	private static summary(element: XmlElement, kind: string) {
		const value = (kind === 'rule' ? element.attributes.get('context') : element.attributes.get('test'))?.replace(/\s+/g, ' ').trim() ?? '';
		return `${kind} ${kind === 'rule' ? 'context' : 'test'}="${value}"`;
	}

	// an assertion's or report's message, on one line
	private static text(declared: Declared) {
		const content = declared.text.substring(declared.element.contentStart, declared.element.contentEnd);
		return content.replace(/<!--[\s\S]*?-->/g, '').replace(/<[\w.:-]*value-of\s[^>]*?select\s*=\s*(["'])([^"']*)\1[^>]*>/g, '{$2}').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
	}

	private static location(declared: Declared) {
		const before = declared.text.substring(0, declared.element.start).split('\n');
		const start = new vscode.Position(before.length - 1, before[before.length - 1].length);
		return new vscode.Location(vscode.Uri.file(declared.file), new vscode.Range(start, start.translate(0, declared.element.name.length + 1)));
	}
}
