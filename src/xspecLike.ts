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
import { XSpecHrefs } from './xspecHrefs';
import { XSpecSourceMap } from './xspecSourceMap';
import { XmlElement, parseXml, localName, descendants, decodeReferences } from './xspecXml';

// x:like, which pulls the scenario with its label into the scenario it's in - resolved as XSpec resolves it
// (src/compiler/base/combine/mode/unshare-scenarios.xsl): the one x:scenario, shared or not, whose label - its x:label's
// string value, or else its label attribute - is the x:like's, in the XSpec files gathered for a run: the file, those it
// imports and, as an imported file is run from the file importing it, those importing it. For completion of the labels,
// going to the scenario, finding the x:like elements using it, and the problems XSpec stops the run for

// an x:variable, or an x:param of x:description or x:scenario: the file it's in, and its element there
export interface XSpecVariableDeclaration {
	file: string;
	element: XmlElement;
}

export interface XSpecLabelled {
	file: string;
	label: string;
	// the offsets of the label's text: the attribute's value, or x:label's content
	start: number;
	end: number;
	// the offsets of the element, for x:like whether it's in the scenario
	elementStart: number;
	elementEnd: number;
	shared: boolean;
	// for a label attribute, its quote - none for x:label
	quote?: string;
}

interface XSpecFile {
	file: string;
	scenarios: XSpecLabelled[];
	likes: XSpecLabelled[];
	// the names of its x:variable elements, and of the x:param elements of x:description and x:scenario
	variables: string[];
	// those elements' names and types, in document order
	declarations: { name: string, as?: string }[];
	imports: string[];
	// whether an x:import isn't found, e.g. a URI an XML catalog maps - so its scenarios aren't known
	importMissing: boolean;
	// the names of x:description's x:variable and x:param elements
	globals: string[];
	root?: XmlElement;
	prefix: string;
}

export class XSpecLike {
	// the XSpec files of each folder searched, listed again after a few seconds
	private static listed = new Map<string, { time: number, files: string[] }>();
	// the XSpec files parsed: an open document's for its version, or a file's for its modification time
	private static parsed = new Map<string, { stamp: string, parsed: XSpecFile }>();

	// the x:like - its label - at the offset
	public static likeAt(text: string, filePath: string, offset: number): XSpecLabelled | undefined {
		return XSpecLike.parse(text, filePath).likes.find((like) => offset >= like.start && offset <= like.end);
	}

	// the scenario whose label is at the offset
	public static scenarioAt(text: string, filePath: string, offset: number): XSpecLabelled | undefined {
		return XSpecLike.parse(text, filePath).scenarios.find((scenario) => offset >= scenario.start && offset <= scenario.end);
	}

	// the scenarios with the label, in the files gathered with the file - those of its own run first
	public static scenariosLabelled(text: string, filePath: string, label: string): XSpecLabelled[] {
		return XSpecLike.all(text, filePath).flatMap((f) => f.scenarios).filter((scenario) => scenario.label === label);
	}

	// the x:like elements with the scenario's label, in the files gathered with the scenario's
	public static likesOf(text: string, filePath: string, label: string): XSpecLabelled[] {
		return XSpecLike.all(text, filePath).flatMap((f) => f.likes).filter((like) => like.label === label);
	}

	// the names of the variables declared in the files gathered with the file: in a shared scenario, those of the
	// scenario using it are in scope, and the other way round
	public static gatheredVariables(text: string, filePath: string | undefined): string[] {
		return filePath ? XSpecLike.all(text, filePath).filter((f) => !XSpecSourceMap.samePath(f.file, filePath)).flatMap((f) => f.variables) : [];
	}

	// whether a variable is in scope at an offset, as XSpec's compiler scopes them (stacked-vardecls in
	// src/compiler/base/main.xsl) once x:like has brought in the scenarios it uses: an x:variable or x:param of
	// x:description, in any file of the run, or one of a scenario that comes before the element the offset is in, or
	// before an ancestor of it. After an x:like, those of the scenario it uses; and in a scenario that x:like uses, those
	// in scope at each x:like. Any is in scope in a scenario whose uses aren't known: a shared one that no x:like uses
	// here - it may be used from a file outside the workspace - or with an x:import that isn't found
	public static scopeChecker(text: string, filePath: string): (name: string, offset: number) => boolean {
		return XSpecLike.scopes(text, filePath).inScope;
	}

	// The variables in scope at an offset, for each copy of the element there that XSpec compiles: x:like is replaced
	// by the child elements of the scenario it uses, and a shared scenario is then removed - so an element in a shared
	// scenario is compiled once for each x:like using it, with the variables in scope there, and one in a scenario that
	// isn't shared, in place too. Of a variable reference:
	// - inScope: whether the variable is in scope in any copy - else it's unresolved
	// - inEvery: whether it's in scope in every copy, for completion - any, where the uses aren't known
	// - missingFrom: the labels of the scenarios whose x:like makes a copy where it isn't in scope, where it is in others
	public static scopes(text: string, filePath: string): {
		inScope: (name: string, offset: number) => boolean,
		inEvery: (name: string, offset: number) => boolean,
		missingFrom: (name: string, offset: number) => string[],
		declarationsOf: (name: string, offset: number) => XSpecVariableDeclaration[]
	} {
		const { own, importers } = XSpecLike.contexts(text, filePath);
		const files = XSpecLike.union([own, ...importers]);
		const incomplete = files.some((f) => f.importMissing);
		const isXSpec = (f: XSpecFile, element: XmlElement, ...names: string[]) => names.some((name) => element.name === f.prefix + name);
		const variableName = (element: XmlElement) => XSpecLike.expandedName(element.attributes.get('name')?.trim() ?? '', element);
		// the declarations, by expanded name, each once
		type Declared = Map<string, XSpecVariableDeclaration[]>;
		const add = (declared: Declared, name: string, declarations: XSpecVariableDeclaration[]) => {
			const list = declared.get(name) ?? [];
			declarations.filter((d) => !list.some((e) => e.file === d.file && e.element === d.element)).forEach((d) => list.push(d));
			declared.set(name, list);
		};
		const merge = (...all: Declared[]) => {
			const result: Declared = new Map();
			all.forEach((declared) => declared.forEach((declarations, name) => add(result, name, declarations)));
			return result;
		};
		// x:description's x:variable and x:param elements, in any file of the run
		const globals: Declared = new Map();
		files.forEach((f) => (f.root?.children ?? []).filter((child) => isXSpec(f, child, 'variable', 'param')).forEach((element) => add(globals, variableName(element), [{ file: f.file, element }])));
		const elements = new Map<XSpecFile, Map<number, XmlElement>>();
		const elementAt = (f: XSpecFile, start: number) => {
			if (!elements.has(f)) {
				elements.set(f, new Map(f.root ? descendants(f.root).map((e) => [e.start, e]) : []));
			}
			return elements.get(f)!.get(start);
		};
		// the variables the scenarios with the label declare, for the scenario using one with x:like
		const declaredBy = (label: string, seen: Set<string>): Declared => {
			const result: Declared = new Map();
			if (seen.has(label)) {
				return result;
			}
			seen.add(label);
			files.forEach((f) => f.scenarios.filter((scenario) => scenario.label === label).forEach((scenario) => {
				const element = elementAt(f, scenario.elementStart);
				(element?.children ?? []).forEach((child) => {
					if (isXSpec(f, child, 'variable', 'param')) {
						add(result, variableName(child), [{ file: f.file, element: child }]);
					} else if (isXSpec(f, child, 'like')) {
						declaredBy(f.likes.find((like) => like.elementStart === child.start)?.label ?? '', seen).forEach((declarations, name) => add(result, name, declarations));
					}
				});
			}));
			return result;
		};
		// the elements an offset is in, outermost first
		const ancestorsAt = (f: XSpecFile, offset: number) => {
			const ancestors: XmlElement[] = [];
			for (let e: XmlElement | undefined = f.root; e; e = e.children.find((c) => c.start <= offset && offset < c.end)) {
				ancestors.push(e);
			}
			return ancestors;
		};
		// a copy: the variables in scope in it - any, where they aren't known - and the label of the scenario whose x:like
		// makes it, if one does
		type Copy = { names: Declared | 'any', where?: string };
		const copies = (f: XSpecFile, offset: number, seen: Set<string>): Copy[] => {
			const key = `${f.file}#${offset}`;
			if (seen.has(key) || !f.root) {
				return [{ names: new Map() }];
			}
			seen = new Set(seen).add(key);
			const ancestors = ancestorsAt(f, offset);
			// those declared before the offset, by the scenarios from the ancestor at the index inwards
			const declaredFrom = (from: number) => {
				const names: Declared = new Map();
				for (let i = from + 1; i < ancestors.length; i++) {
					const [parent, child] = [ancestors[i - 1], ancestors[i]];
					if (!isXSpec(f, parent, 'scenario')) {
						continue;
					}
					parent.children.filter((sibling) => sibling.end <= child.start).forEach((sibling) => {
						if (isXSpec(f, sibling, 'variable', 'param')) {
							add(names, variableName(sibling), [{ file: f.file, element: sibling }]);
						} else if (isXSpec(f, sibling, 'like')) {
							declaredBy(f.likes.find((like) => like.elementStart === sibling.start)?.label ?? '', new Set()).forEach((declarations, name) => add(names, name, declarations));
						}
					});
				}
				return names;
			};
			const scenarios = ancestors.map((element, index) => ({ index, scenario: isXSpec(f, element, 'scenario') ? f.scenarios.find((s) => s.elementStart === element.start) : undefined }))
				.filter((s): s is { index: number, scenario: XSpecLabelled } => !!s.scenario);
			// within a shared scenario, only its copies are compiled: those the x:like elements using it - or the scenarios
			// within it that x:like uses - make
			const innermostShared = [...scenarios].reverse().find((s) => s.scenario.shared);
			const result: Copy[] = innermostShared ? [] : [{ names: declaredFrom(0), where: scenarios[scenarios.length - 1]?.scenario.label }];
			if (incomplete) {
				result.push({ names: 'any' });
			}
			scenarios.filter((s) => !innermostShared || s.index >= innermostShared.index).forEach(({ index, scenario }) => {
				const uses = files.flatMap((other) => other.likes.filter((like) => like.label === scenario.label && !XSpecLike.encloses(scenario, like)).map((like) => ({ other, like })));
				if (uses.length === 0 && scenario === innermostShared?.scenario) {
					result.push({ names: 'any' });
				}
				const within = declaredFrom(index);
				uses.forEach(({ other, like }) => {
					const where = [...ancestorsAt(other, like.elementStart)].reverse().map((e) => other.scenarios.find((s) => s.elementStart === e.start && isXSpec(other, e, 'scenario'))).find((s) => s)?.label;
					copies(other, like.elementStart, seen).forEach((copy) =>
						result.push({ names: copy.names === 'any' ? 'any' : merge(copy.names, within), where }));
				});
			});
			return result;
		};
		const cached = new Map<number, Copy[]>();
		const lookup = (name: string, offset: number) => {
			// the name, with the namespace of its prefix where it is
			let element = own[0].root;
			for (let child = element; child; child = child.children.find((c) => c.start <= offset && offset < c.end)) {
				element = child;
			}
			const expanded = element ? XSpecLike.expandedName(name, element) : name;
			if (!cached.has(offset)) {
				cached.set(offset, copies(own[0], offset, new Set()));
			}
			return { expanded, copies: cached.get(offset)! };
		};
		const has = (copy: Copy, name: string) => copy.names === 'any' || copy.names.has(name);
		return {
			inScope: (name, offset) => {
				const { expanded, copies } = lookup(name, offset);
				return globals.has(expanded) || copies.some((copy) => has(copy, expanded));
			},
			inEvery: (name, offset) => {
				const { expanded, copies } = lookup(name, offset);
				return globals.has(expanded) || copies.every((copy) => has(copy, expanded));
			},
			missingFrom: (name, offset) => {
				const { expanded, copies } = lookup(name, offset);
				if (globals.has(expanded) || !copies.some((copy) => has(copy, expanded))) {
					return [];
				}
				return [...new Set(copies.filter((copy) => !has(copy, expanded)).map((copy) => copy.where ?? ''))];
			},
			// the declarations a reference may be to: in any copy - more than one where a shared scenario's x:like elements
			// bring in different ones - or else a global one. Not those of a copy whose variables aren't known
			declarationsOf: (name, offset) => {
				const { expanded, copies } = lookup(name, offset);
				const local = merge(...copies.map((copy) => copy.names === 'any' ? new Map() : copy.names)).get(expanded) ?? [];
				return local.length > 0 ? local : globals.get(expanded) ?? [];
			}
		};
	}

	// the variables in scope at an offset, for completion where XPath is expected: those in scope in every copy that
	// XSpec compiles of the element there (see scopes) - of this file and the others gathered with it - by their names
	// as declared, each once, with its type if it has one
	public static variablesInScope(text: string, filePath: string, offset: number): { name: string, as?: string }[] {
		const { inEvery } = XSpecLike.scopes(text, filePath);
		const result = new Map<string, { name: string, as?: string }>();
		XSpecLike.all(text, filePath).flatMap((f) => f.declarations).forEach((declaration) => {
			if (!result.has(declaration.name) && inEvery(declaration.name, offset)) {
				result.set(declaration.name, declaration);
			}
		});
		return [...result.values()];
	}

	// the XSpec files gathered with the file - for any run it may be in, its own first - with their texts: an open
	// document's, which may not be saved
	public static gatheredFiles(text: string, filePath: string): { file: string, text: string }[] {
		const open = XSpecLike.openDocuments();
		return XSpecLike.all(text, filePath).map((f) => ({ file: f.file, text: XSpecSourceMap.samePath(f.file, filePath) ? text : XSpecLike.text(f.file, open) }));
	}

	// a variable's name as Q{uri}local, with the namespace its prefix is bound to on the element or an ancestor - a name
	// with a prefix that isn't bound is kept as it is
	private static expandedName(name: string, element: XmlElement): string {
		if (name.startsWith('Q{')) {
			return name;
		}
		const colon = name.indexOf(':');
		const attribute = colon > 0 ? `xmlns:${name.substring(0, colon)}` : undefined;
		if (!attribute) {
			return `Q{}${name}`;
		}
		for (let e: XmlElement | undefined = element; e; e = e.parent) {
			const uri = e.attributes.get(attribute);
			if (uri !== undefined) {
				return `Q{${uri}}${name.substring(colon + 1)}`;
			}
		}
		return name;
	}

	// at an x:import's href: the file - its scenarios, the shared ones x:like can use, and the files it imports
	public static importHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const at = XSpecHrefs.hrefAt(document, document.offsetAt(position));
		if (!at || at.href.element !== 'import') {
			return undefined;
		}
		const imported = XSpecLike.parseFile(at.filePath, XSpecLike.openDocuments());
		const shared = imported.scenarios.filter((s) => s.shared);
		const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
		const lines = [`**XSpec file** ${path.relative(path.dirname(document.fileName), at.filePath).replace(/\\/g, '/')}`, '',
			`${plural(imported.scenarios.length - shared.length, 'scenario')}, run with this file's - and ${plural(shared.length, 'shared scenario')}${shared.length > 0 ? ' for x:like: ' + shared.slice(0, 10).map((s) => `_${XSpecLike.normalize(s.label).replace(/[\\`*_{}[\]<>]/g, '\\$&')}_`).join(', ') + (shared.length > 10 ? ', …' : '') : ''}`];
		if (imported.imports.length > 0) {
			lines.push('', `Imports ${imported.imports.map((i) => path.basename(i)).join(', ')}`);
		}
		const start = document.positionAt(at.href.start);
		return new vscode.Hover(new vscode.MarkdownString(lines.join('\n')), new vscode.Range(start, document.positionAt(at.href.end)));
	}

	// at x:like's label: the scenario it uses - where it is, and what it brings into the scenario using it
	public static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		if (document.uri.scheme !== 'file') {
			return undefined;
		}
		const text = document.getText();
		const filePath = document.fileName;
		const like = XSpecLike.likeAt(text, filePath, document.offsetAt(position));
		if (!like) {
			return undefined;
		}
		const range = new vscode.Range(document.positionAt(like.start), document.positionAt(like.end));
		const found = XSpecLike.all(text, filePath).flatMap((f) => f.scenarios.filter((s) => s.label === like.label).map((scenario) => ({ f, scenario })));
		if (found.length !== 1) {
			// the problem is reported
			return undefined;
		}
		const { f, scenario } = found[0];
		return new vscode.Hover(new vscode.MarkdownString(XSpecLike.summaryLines(f, scenario, filePath).join('\n').trim()), range);
	}

	// at an x:scenario's name in its start or end tag, or at its label attribute's value: a summary of the scenario - what
	// it runs, with what it inherits from the scenarios it's in, and what it has - then XSpec's description of x:scenario
	// at: the element's name - with XSpec's description, given - or its label (see XSLTHoverProvider for the other)
	public static scenarioHover(document: vscode.TextDocument, position: vscode.Position, at: 'name' | 'label', description?: string): vscode.Hover | undefined {
		if (document.uri.scheme !== 'file') {
			return undefined;
		}
		const text = document.getText();
		const filePath = document.fileName;
		const offset = document.offsetAt(position);
		const f = XSpecLike.parse(text, filePath);
		if (!f.root) {
			return undefined;
		}
		const scenarioName = f.prefix + 'scenario';
		const element = descendants(f.root).find((e) => e.name === scenarioName && (
			(offset > e.start && offset <= e.start + 1 + e.name.length) ||
			(e.contentEnd < e.end && offset > e.contentEnd + 1 && offset <= e.contentEnd + 2 + e.name.length)));
		if ((at === 'name') !== !!element) {
			return undefined;
		}
		const labelled = element ? f.scenarios.find((s) => s.elementStart === element.start) : XSpecLike.scenarioAt(text, filePath, offset);
		const scenarioElement = element ?? (labelled ? descendants(f.root).find((e) => e.start === labelled.elementStart) : undefined);
		if (!scenarioElement) {
			return undefined;
		}
		const range = element ? new vscode.Range(document.positionAt(offset > element.contentEnd ? element.contentEnd + 2 : element.start + 1),
			document.positionAt((offset > element.contentEnd ? element.contentEnd + 2 : element.start + 1) + element.name.length)) :
			new vscode.Range(document.positionAt(labelled!.start), document.positionAt(labelled!.end));
		const summary = labelled ? XSpecLike.summaryLines(f, labelled, filePath, true) : ['**Scenario** — no label', ''];
		const markdown = new vscode.MarkdownString(summary.join('\n').trim());
		if (description) {
			markdown.appendMarkdown('\n\n---\n\n' + XSpecLike.escapeMarkdown(description));
		}
		return new vscode.Hover(markdown, range);
	}

	// text as markdown, escaped - not with appendText, which writes each space as &nbsp;, so a long line doesn't wrap
	public static escapeMarkdown(text: string): string {
		return text.replace(/[\\`*_{}[\]<>()#+\-.!|]/g, '\\$&');
	}

	// a scenario's summary, as markdown lines: its label and where it is, then what it has - with, for its own hover
	// (full), whether it's shared, pending or focused, what it runs, and the x:like elements using it
	private static summaryLines(f: XSpecFile, scenario: XSpecLabelled, filePath: string, full = false): string[] {
		const element = f.root ? descendants(f.root).find((e) => e.start === scenario.elementStart) : undefined;
		const children = element?.children ?? [];
		const named = (name: string) => children.filter((child) => child.name === f.prefix + name);
		const labelOf = (child: XmlElement) => {
			const labelElement = child.children.find((c) => c.name === f.prefix + 'label');
			return XSpecLike.normalize(labelElement ? descendants(labelElement).reduce((t, e) => t + e.text, labelElement.text) : child.attributes.get('label') ?? '');
		};
		const escape = (value: string) => value.replace(/[\\`*_{}[\]<>()#+\-.!|]/g, '\\$&');
		const status: string[] = [];
		if (full && element) {
			const pending = element.attributes.get('pending');
			const inPending = (() => {
				for (let e = element.parent; e; e = e.parent) {
					if (e.name === f.prefix + 'pending' || (e.name === f.prefix + 'scenario' && e.attributes.has('pending'))) {
						return true;
					}
				}
				return false;
			})();
			if (pending !== undefined) {
				status.push(`_pending${pending.trim() ? ': ' + escape(XSpecLike.normalize(pending)) : ''}_`);
			} else if (inPending) {
				status.push('_pending, within a pending scenario_');
			}
			if (element.attributes.has('focus')) {
				status.push(`_focus${element.attributes.get('focus')!.trim() ? ': ' + escape(XSpecLike.normalize(element.attributes.get('focus')!)) : ''}_`);
			}
		}
		const lines = [`**${scenario.shared ? 'Shared scenario' : 'Scenario'}** ${escape(XSpecLike.normalize(scenario.label))} — ${escape(XSpecLike.where(scenario, filePath))}${status.length > 0 ? ' — ' + status.join(', ') : ''}`, ''];
		const list = (title: string, items: string[]) => items.length > 0 && lines.push(`${title}: ${items.join(', ')}`, '');
		if (full && element) {
			XSpecLike.runs(f, element).forEach((line) => lines.push(line, ''));
		}
		list('Variables', [...named('variable'), ...named('param')].map((v) => `\`$${v.attributes.get('name')?.trim() ?? ''}\``));
		if (!full) {
			list('Sets', [...named('context'), ...named('call')].map((c) => `\`${c.name}\``));
		}
		list('Uses', named('like').map((l) => `_${escape(labelOf(l))}_`));
		list('Expectations', children.filter((c) => c.name.startsWith(f.prefix + 'expect')).map((e) => `_${escape(labelOf(e))}_`));
		list('Scenarios', named('scenario').map((s) => `**${escape(labelOf(s))}**`));
		if (full && scenario.shared) {
			const text = XSpecLike.text(f.file, XSpecLike.openDocuments());
			const users = XSpecLike.likesOf(text, f.file, scenario.label).filter((like) => !XSpecLike.encloses(scenario, like));
			lines.push(users.length > 0 ? `Used by x:like at: ${users.map((like) => escape(XSpecLike.where(like, filePath))).join(', ')}` : 'Not used by an x:like in the workspace', '');
		}
		return lines;
	}

	// what a scenario runs, as XSpec merges the x:call and x:context elements of the scenarios it's in with its own: the
	// function or template called, with its parameters - the inner replacing the outer, by position for a function and
	// by name for a template - or the context, and the scenario they're from, when it's an enclosing one
	private static runs(f: XSpecFile, element: XmlElement): string[] {
		const chain: XmlElement[] = [];
		for (let e: XmlElement | undefined = element; e && e !== f.root; e = e.parent) {
			if (e.name === f.prefix + 'scenario') {
				chain.unshift(e);
			}
		}
		const labelOf = (scenario: XmlElement) => XSpecLike.normalize(scenario.attributes.get('label') ?? '');
		const value = (param: XmlElement) => {
			const select = param.attributes.get('select');
			const shown = select !== undefined ? XSpecLike.normalize(select) : param.children.length > 0 || param.text.trim() !== '' ? '…' : param.attributes.has('href') ? `href: ${param.attributes.get('href')}` : '()';
			return shown.length > 40 ? shown.substring(0, 39) + '…' : shown;
		};
		let attributes = new Map<string, string>();
		let calledIn: XmlElement | undefined;
		const byPosition = new Map<number, string>();
		const byName = new Map<string, string>();
		let context: { element: XmlElement, scenario: XmlElement } | undefined;
		for (const scenario of chain) {
			const call = scenario.children.find((child) => child.name === f.prefix + 'call');
			if (call) {
				attributes = new Map([...attributes, ...call.attributes]);
				if (call.attributes.has('function') || call.attributes.has('template')) {
					calledIn = scenario;
				}
				call.children.filter((child) => child.name === f.prefix + 'param').forEach((param, index) => {
					const name = param.attributes.get('name')?.trim();
					byPosition.set(Number(param.attributes.get('position')?.trim() || index + 1), value(param));
					if (name) {
						byName.set(name, value(param));
					}
				});
			}
			const ownContext = scenario.children.find((child) => child.name === f.prefix + 'context');
			if (ownContext) {
				context = { element: ownContext, scenario };
			}
		}
		const from = (scenario: XmlElement | undefined) => scenario && scenario !== element ? ` — from _${labelOf(scenario).replace(/[\\`*_{}[\]<>()#+\-.!|]/g, '\\$&')}_` : '';
		const lines: string[] = [];
		const fn = attributes.get('function')?.trim();
		const template = attributes.get('template')?.trim();
		if (fn) {
			const args = [...byPosition].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
			lines.push(`Calls: \`${fn}(${args.join(', ')})\`${from(calledIn)}`);
		} else if (template) {
			lines.push(`Calls: \`${template}\`${byName.size > 0 ? ' with ' + [...byName].map(([n, v]) => `\`$${n}\`: \`${v}\``).join(', ') : ''}${from(calledIn)}`);
		}
		if (context) {
			const parts = ['mode', 'select', 'href'].filter((name) => context!.element.attributes.has(name)).map((name) => `${name}="${XSpecLike.normalize(context!.element.attributes.get(name)!)}"`);
			const hasContent = context.element.children.some((child) => child.name !== f.prefix + 'param') || context.element.text.trim() !== '';
			lines.push(`Context: \`${[`${f.prefix}context`, ...parts].join(' ')}\`${hasContent ? ' with content' : ''}${from(context.scenario)}`);
		}
		return lines;
	}

	// a scenario's label, or an x:like's: the label - renamed in the scenarios with it and the x:like elements using them
	public static prepareRename(document: vscode.TextDocument, position: vscode.Position): { range: vscode.Range, placeholder: string } | undefined {
		if (document.uri.scheme !== 'file') {
			return undefined;
		}
		const text = document.getText();
		const offset = document.offsetAt(position);
		const at = XSpecLike.scenarioAt(text, document.fileName, offset) ?? XSpecLike.likeAt(text, document.fileName, offset);
		return at && (at.quote || !/[<&]/.test(text.substring(at.start, at.end))) ? { range: new vscode.Range(document.positionAt(at.start), document.positionAt(at.end)), placeholder: at.label } : undefined;
	}

	public static renameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string): vscode.WorkspaceEdit | undefined {
		if (!XSpecLike.prepareRename(document, position)) {
			return undefined;
		}
		const text = document.getText();
		const filePath = document.fileName;
		const offset = document.offsetAt(position);
		const at = (XSpecLike.scenarioAt(text, filePath, offset) ?? XSpecLike.likeAt(text, filePath, offset))!;
		if (newName !== at.label && XSpecLike.scenariosLabelled(text, filePath, newName).length > 0) {
			throw new Error(`A scenario has the label '${newName}' already`);
		}
		const edit = new vscode.WorkspaceEdit();
		for (const labelled of [...XSpecLike.scenariosLabelled(text, filePath, at.label), ...XSpecLike.likesOf(text, filePath, at.label)]) {
			const escaped = newName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(labelled.quote === '"' ? /"/g : labelled.quote === '\'' ? /'/g : /(?!)/g, labelled.quote === '"' ? '&quot;' : '&apos;');
			const location = XSpecLike.location(labelled, document);
			edit.replace(location.uri, location.range, escaped);
		}
		return edit;
	}

	private static normalize(text: string) {
		return text.replace(/\s+/g, ' ').trim();
	}

	public static completions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		if (document.languageId !== 'xspec') {
			return undefined;
		}
		const text = document.getText();
		const offset = document.offsetAt(position);
		const filePath = document.uri.scheme === 'file' ? document.fileName : document.uri.toString();
		const like = XSpecLike.likeAt(text, filePath, offset);
		if (!like) {
			return undefined;
		}
		const range = new vscode.Range(document.positionAt(like.start), document.positionAt(like.end));
		const seen = new Set<string>();
		return XSpecLike.all(text, filePath).flatMap((f) => f.scenarios)
			// not the scenario the x:like is in, or one enclosing it - XSpec stops for the loop
			.filter((scenario) => !XSpecLike.encloses(scenario, like) && !seen.has(scenario.label) && seen.add(scenario.label) && scenario.label !== '')
			.map((scenario) => {
				const item = new vscode.CompletionItem(scenario.label, scenario.shared ? vscode.CompletionItemKind.Reference : vscode.CompletionItemKind.Class);
				item.range = range;
				item.detail = `${scenario.shared ? 'shared scenario' : 'scenario'}${XSpecSourceMap.samePath(scenario.file, filePath) ? '' : ' in ' + path.basename(scenario.file)}`;
				// the shared scenarios first, as x:like is usually for one of them
				item.sortText = `${scenario.shared ? '0' : '1'}${scenario.label}`;
				return item;
			});
	}

	public static definition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
		const text = document.getText();
		const filePath = document.fileName;
		const like = document.uri.scheme === 'file' ? XSpecLike.likeAt(text, filePath, document.offsetAt(position)) : undefined;
		return like ? XSpecLike.scenariosLabelled(text, filePath, like.label).map((scenario) => XSpecLike.location(scenario, document)) : undefined;
	}

	// at a scenario's label, or an x:like's: the x:like elements using the scenario - and the scenario, if wanted
	public static references(document: vscode.TextDocument, position: vscode.Position, includeDeclaration: boolean): vscode.Location[] | undefined {
		if (document.uri.scheme !== 'file') {
			return undefined;
		}
		const text = document.getText();
		const filePath = document.fileName;
		const offset = document.offsetAt(position);
		const at = XSpecLike.scenarioAt(text, filePath, offset) ?? XSpecLike.likeAt(text, filePath, offset);
		if (!at) {
			return undefined;
		}
		const scenarios = includeDeclaration ? XSpecLike.scenariosLabelled(text, filePath, at.label) : [];
		return [...scenarios, ...XSpecLike.likesOf(text, filePath, at.label)].map((labelled) => XSpecLike.location(labelled, document));
	}

	// the problems XSpec stops the run for: an x:like with no scenario with its label, or more than one, or one that
	// encloses it. A run of the file gathers it and the files it imports; a file of shared scenarios may be run only from
	// those importing it - each a separate run, so a label found in one of them is enough
	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		if (document.uri.scheme !== 'file') {
			return [];
		}
		const text = document.getText();
		const filePath = document.fileName;
		if (XSpecLike.parse(text, filePath).likes.length === 0) {
			return [];
		}
		const { own, importers } = XSpecLike.contexts(text, filePath);
		const ownScenarios = own.flatMap((f) => f.scenarios);
		const importerScenarios = importers.map((run) => run.flatMap((f) => f.scenarios));
		// with an x:import that isn't found, e.g. a URI an XML catalog maps, the scenario may be in it
		const complete = ![own, ...importers].some((run) => run.some((f) => f.importMissing));
		return own[0].likes.flatMap((like) => {
			const found = ownScenarios.filter((scenario) => scenario.label === like.label);
			const inImporter = importerScenarios.some((scenarios) => scenarios.some((scenario) => scenario.label === like.label));
			const message = found.length === 0 ? (inImporter || !complete ? undefined : `XSpec: no scenario has the label '${like.label}', for x:like - in this file, the XSpec files it imports or those importing it`) :
				found.length > 1 ? `XSpec: ${found.length} scenarios have the label '${like.label}', for x:like - it must be one: ${found.map((s) => XSpecLike.where(s, filePath)).join(', ')}` :
				XSpecLike.encloses(found[0], like) ? `XSpec: x:like uses the scenario '${like.label}' that it's in - a loop` : undefined;
			const start = document.positionAt(like.start);
			return message ? [new vscode.Diagnostic(new vscode.Range(start, like.end > like.start ? document.positionAt(like.end) : start.translate(0, 1)), message, vscode.DiagnosticSeverity.Error)] : [];
		});
	}

	private static where(scenario: XSpecLabelled, filePath: string) {
		const line = XSpecLike.text(scenario.file, XSpecLike.openDocuments()).substring(0, scenario.elementStart).split('\n').length;
		return XSpecSourceMap.samePath(scenario.file, filePath) ? `line ${line}` : `${path.basename(scenario.file)}:${line}`;
	}

	private static encloses(scenario: XSpecLabelled, like: XSpecLabelled) {
		return XSpecSourceMap.samePath(scenario.file, like.file) && scenario.elementStart < like.elementStart && scenario.elementEnd >= like.elementEnd;
	}

	private static location(labelled: XSpecLabelled, document: vscode.TextDocument) {
		const open = XSpecSourceMap.samePath(labelled.file, document.fileName) ? document : XSpecLike.openDocuments().get(path.normalize(labelled.file));
		if (open) {
			return new vscode.Location(open.uri, new vscode.Range(open.positionAt(labelled.start), open.positionAt(labelled.end)));
		}
		const text = XSpecLike.text(labelled.file, new Map());
		const position = (offset: number) => {
			const before = text.substring(0, offset);
			return new vscode.Position(before.split('\n').length - 1, offset - before.lastIndexOf('\n') - 1);
		};
		return new vscode.Location(vscode.Uri.file(labelled.file), new vscode.Range(position(labelled.start), position(labelled.end)));
	}

	// the open XSpec documents, by their normalized paths
	private static openDocuments(): Map<string, vscode.TextDocument> {
		return new Map(vscode.workspace.textDocuments.filter((d) => d.uri.scheme === 'file' && d.languageId === 'xspec').map((d) => [path.normalize(d.fileName), d]));
	}

	// the file's text - an open document's, which may not be saved
	private static text(filePath: string, open: Map<string, vscode.TextDocument>) {
		const document = open.get(path.normalize(filePath));
		if (document) {
			return document.getText();
		}
		try {
			return fs.readFileSync(filePath, 'utf8');
		} catch {
			return '';
		}
	}

	// the files gathered for a run of the file - it, and those it imports, recursively - and for a run of each file
	// importing it, directly or not
	private static contexts(text: string, filePath: string): { own: XSpecFile[], importers: XSpecFile[][] } {
		const open = XSpecLike.openDocuments();
		const closure = (start: XSpecFile) => {
			const files = new Map<string, XSpecFile>();
			const visit = (f: XSpecFile) => {
				const key = path.normalize(f.file);
				if (!files.has(key)) {
					files.set(key, f);
					f.imports.forEach((imported) => visit(XSpecLike.parseFile(imported, open)));
				}
			};
			visit(start);
			return [...files.values()];
		};
		const own = closure(XSpecLike.parse(text, filePath));
		// the files importing each file, of those that import any
		const importedBy = new Map<string, XSpecFile[]>();
		for (const other of XSpecLike.workspaceXSpecFiles(filePath, open)) {
			const parsed = XSpecLike.parseFile(other, open);
			parsed.imports.forEach((imported) => {
				const key = path.normalize(imported);
				importedBy.set(key, [...(importedBy.get(key) ?? []), parsed]);
			});
		}
		const importers = new Map<string, XSpecFile>();
		const queue = [path.normalize(filePath)];
		while (queue.length > 0) {
			for (const importer of importedBy.get(queue.shift()!) ?? []) {
				const key = path.normalize(importer.file);
				if (!importers.has(key) && key !== path.normalize(filePath)) {
					importers.set(key, importer);
					queue.push(key);
				}
			}
		}
		return { own, importers: [...importers.values()].map(closure) };
	}

	// the files of all the runs the file may be in, its own first
	private static all(text: string, filePath: string): XSpecFile[] {
		const { own, importers } = XSpecLike.contexts(text, filePath);
		return XSpecLike.union([own, ...importers]);
	}

	private static union(runs: XSpecFile[][]): XSpecFile[] {
		const files = new Map<string, XSpecFile>();
		runs.flat().forEach((f) => files.set(path.normalize(f.file), files.get(path.normalize(f.file)) ?? f));
		return [...files.values()];
	}

	// the XSpec files of the workspace, and those open - each folder listed again after a few seconds. For a file outside
	// the workspace folders, those of the folder above its own, e.g. a test folder with a subfolder of shared scenarios
	private static workspaceXSpecFiles(filePath: string, open: Map<string, vscode.TextDocument>): string[] {
		const now = Date.now();
		const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file').map((folder) => folder.uri.fsPath);
		const within = (folder: string) => {
			const relative = path.relative(folder, filePath);
			return !relative.startsWith('..') && !path.isAbsolute(relative);
		};
		const roots = folders.some(within) ? folders : [path.dirname(path.dirname(filePath))];
		const files = new Set<string>();
		for (const root of roots) {
			let listed = XSpecLike.listed.get(root);
			if (!listed || now - listed.time > 5000) {
				listed = { time: now, files: [] };
				const walk = (dir: string, depth: number) => {
					let entries: fs.Dirent[];
					try {
						entries = fs.readdirSync(dir, { withFileTypes: true });
					} catch {
						return;
					}
					for (const entry of entries) {
						if (entry.isDirectory() && depth < 8 && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
							walk(path.join(dir, entry.name), depth + 1);
						} else if (entry.isFile() && entry.name.endsWith('.xspec')) {
							listed!.files.push(path.normalize(path.join(dir, entry.name)));
						}
					}
				};
				walk(root, 0);
				XSpecLike.listed.set(root, listed);
			}
			listed.files.forEach((f) => files.add(f));
		}
		open.forEach((_document, key) => files.add(key));
		return [...files];
	}

	// a file's text parsed: an open document's, or the file's - kept until it changes
	private static parseFile(filePath: string, open: Map<string, vscode.TextDocument>): XSpecFile {
		const key = path.normalize(filePath);
		const document = open.get(key);
		let stamp: string;
		if (document) {
			stamp = `${document.uri.toString()}#${document.version}`;
		} else {
			try {
				stamp = `${fs.statSync(filePath).mtimeMs}`;
			} catch {
				return XSpecLike.parse('', filePath);
			}
		}
		const cached = XSpecLike.parsed.get(key);
		if (cached && cached.stamp === stamp) {
			return cached.parsed;
		}
		const parsed = XSpecLike.parse(XSpecLike.text(filePath, open), filePath);
		XSpecLike.parsed.set(key, { stamp, parsed });
		return parsed;
	}

	private static parse(text: string, filePath: string): XSpecFile {
		const result: XSpecFile = { file: filePath, scenarios: [], likes: [], variables: [], declarations: [], imports: [], importMissing: false, globals: [], prefix: '' };
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return result;
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		result.root = root;
		result.prefix = prefix;
		const isXSpec = (element: XmlElement, name: string) => element.name === prefix + name;
		// resolved against the base URI, which xml:base may change
		XSpecHrefs.find(text, filePath).filter((href) => href.element === 'import' && href.attribute === 'href').forEach((href) => {
			const imported = HrefPaths.toPath(href.value, href.basePath);
			if (imported !== undefined && fs.existsSync(imported)) {
				result.imports.push(imported);
			} else {
				result.importMissing = true;
			}
		});
		for (const element of descendants(root)) {
			if (isXSpec(element, 'variable') || (isXSpec(element, 'param') && element.parent && (element.parent === root || isXSpec(element.parent, 'scenario')))) {
				const name = element.attributes.get('name')?.trim();
				if (name) {
					result.variables.push(name);
					result.declarations.push({ name, as: element.attributes.get('as')?.trim() || undefined });
					if (element.parent === root) {
						result.globals.push(XSpecLike.expandedName(name, element));
					}
				}
			} else if (isXSpec(element, 'scenario') || isXSpec(element, 'like')) {
				const labelled = XSpecLike.labelOf(text, element, prefix);
				if (labelled) {
					const shared = ['yes', 'true', '1'].includes(element.attributes.get('shared')?.trim() ?? '');
					(isXSpec(element, 'like') ? result.likes : result.scenarios).push({ file: filePath, ...labelled, elementStart: element.start, elementEnd: element.end, shared });
				}
			}
		}
		return result;
	}

	// as XSpec's x:label(): x:label's string value, or else the label attribute's value - the attribute's after XML's
	// normalization of its whitespace characters to spaces
	private static labelOf(text: string, element: XmlElement, prefix: string): { label: string, start: number, end: number, quote?: string } | undefined {
		const labelElement = element.children.find((child) => child.name === prefix + 'label');
		if (labelElement) {
			// XML's line ends are newlines, and references are replaced - after
			const content = text.substring(labelElement.contentStart, labelElement.contentEnd).replace(/\r\n?/g, '\n');
			const label = content.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map((part) => part.startsWith('<![CDATA[') ? part.slice(9, -3) :
				decodeReferences(part.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]*>/g, ''))).join('');
			return { label, start: labelElement.contentStart, end: labelElement.contentEnd };
		}
		const match = /\slabel\s*=\s*(["'])/.exec(text.substring(element.start, element.contentStart));
		if (!match) {
			return undefined;
		}
		const start = element.start + match.index + match[0].length;
		const end = text.indexOf(match[1], start);
		const raw = end < 0 ? '' : text.substring(start, end);
		// a whitespace character is a space - not one from a character reference, e.g. &#x0A;
		return { label: decodeReferences(raw.replace(/\r\n|[\t\n\r]/g, ' ')), start, end: end < 0 ? start : end, quote: match[1] };
	}
}
