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
		const { own, importers } = XSpecLike.contexts(text, filePath);
		const files = XSpecLike.union([own, ...importers]);
		const globals = new Set(files.flatMap((f) => f.globals));
		const incomplete = files.some((f) => f.importMissing);
		const isXSpec = (f: XSpecFile, element: XmlElement, ...names: string[]) => names.some((name) => element.name === f.prefix + name);
		const variableName = (element: XmlElement) => XSpecLike.expandedName(element.attributes.get('name')?.trim() ?? '', element);
		const elements = new Map<XSpecFile, Map<number, XmlElement>>();
		const elementAt = (f: XSpecFile, start: number) => {
			if (!elements.has(f)) {
				elements.set(f, new Map(f.root ? descendants(f.root).map((e) => [e.start, e]) : []));
			}
			return elements.get(f)!.get(start);
		};
		// the variables the scenarios with the label declare, for the scenario using one with x:like
		const declaredBy = (label: string, seen: Set<string>): string[] => {
			if (seen.has(label)) {
				return [];
			}
			seen.add(label);
			return files.flatMap((f) => f.scenarios.filter((scenario) => scenario.label === label).flatMap((scenario) => {
				const element = elementAt(f, scenario.elementStart);
				return (element?.children ?? []).flatMap((child) => isXSpec(f, child, 'variable', 'param') ? [variableName(child) ?? ''] :
					isXSpec(f, child, 'like') ? declaredBy(f.likes.find((like) => like.elementStart === child.start)?.label ?? '', seen) : []);
			}));
		};
		const visible = (f: XSpecFile, offset: number, seen: Set<string>): { names: Set<string>, any: boolean } => {
			const result = { names: new Set<string>(), any: false };
			const key = `${f.file}#${offset}`;
			if (seen.has(key) || !f.root) {
				return result;
			}
			seen.add(key);
			// the elements the offset is in, outermost first
			const ancestors: XmlElement[] = [];
			for (let e: XmlElement | undefined = f.root; e; e = e.children.find((c) => c.start <= offset && offset < c.end)) {
				ancestors.push(e);
			}
			for (let i = 1; i < ancestors.length; i++) {
				const [parent, child] = [ancestors[i - 1], ancestors[i]];
				if (!isXSpec(f, parent, 'scenario')) {
					continue;
				}
				parent.children.filter((sibling) => sibling.end <= child.start).forEach((sibling) => {
					if (isXSpec(f, sibling, 'variable', 'param')) {
						result.names.add(variableName(sibling) ?? '');
					} else if (isXSpec(f, sibling, 'like')) {
						declaredBy(f.likes.find((like) => like.elementStart === sibling.start)?.label ?? '', new Set()).forEach((name) => result.names.add(name));
					}
				});
			}
			// in a scenario that x:like uses: those in scope at the x:like
			ancestors.filter((e) => isXSpec(f, e, 'scenario')).forEach((element) => {
				const scenario = f.scenarios.find((s) => s.elementStart === element.start);
				if (!scenario) {
					return;
				}
				const uses = files.flatMap((other) => other.likes.filter((like) => like.label === scenario.label && !XSpecLike.encloses(scenario, like)).map((like) => ({ other, like })));
				if (uses.length === 0 && (scenario.shared || incomplete)) {
					result.any = true;
				}
				uses.forEach(({ other, like }) => {
					const atUse = visible(other, like.elementStart, seen);
					atUse.names.forEach((name) => result.names.add(name));
					result.any = result.any || atUse.any;
				});
			});
			return result;
		};
		return (name: string, offset: number) => {
			// the name, with the namespace of its prefix where it is
			let element = own[0].root;
			for (let child = element; child; child = child.children.find((c) => c.start <= offset && offset < c.end)) {
				element = child;
			}
			const expanded = element ? XSpecLike.expandedName(name, element) : name;
			if (globals.has(expanded)) {
				return true;
			}
			const inScope = visible(own[0], offset, new Set());
			return inScope.any || inScope.names.has(expanded);
		};
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
		const element = f.root ? descendants(f.root).find((e) => e.start === scenario.elementStart) : undefined;
		const children = element?.children ?? [];
		const named = (name: string) => children.filter((child) => child.name === f.prefix + name);
		const labelOf = (child: XmlElement) => {
			const labelElement = child.children.find((c) => c.name === f.prefix + 'label');
			return XSpecLike.normalize(labelElement ? descendants(labelElement).reduce((t, e) => t + e.text, labelElement.text) : child.attributes.get('label') ?? '');
		};
		const escape = (value: string) => value.replace(/[\\`*_{}[\]<>()#+\-.!|]/g, '\\$&');
		const lines = [`**${scenario.shared ? 'Shared scenario' : 'Scenario'}** ${escape(XSpecLike.normalize(scenario.label))} — ${escape(XSpecLike.where(scenario, filePath))}`, ''];
		const list = (title: string, items: string[]) => items.length > 0 && lines.push(`${title}: ${items.join(', ')}`, '');
		list('Variables', [...named('variable'), ...named('param')].map((v) => `\`$${v.attributes.get('name')?.trim() ?? ''}\``));
		list('Sets', [...named('context'), ...named('call')].map((c) => `\`${c.name}\``));
		list('Uses', named('like').map((l) => `_${escape(labelOf(l))}_`));
		list('Expectations', children.filter((c) => c.name.startsWith(f.prefix + 'expect')).map((e) => `_${escape(labelOf(e))}_`));
		list('Scenarios', named('scenario').map((s) => `**${escape(labelOf(s))}**`));
		return new vscode.Hover(new vscode.MarkdownString(lines.join('\n').trim()), range);
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
		const result: XSpecFile = { file: filePath, scenarios: [], likes: [], variables: [], imports: [], importMissing: false, globals: [], prefix: '' };
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
