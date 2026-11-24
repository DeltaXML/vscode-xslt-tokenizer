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
import { parseXml, descendants, XmlElement } from './xspecXml';
import { HrefPaths } from './hrefPaths';
import { XslLexer } from './xslLexer';

// a file a Schematron file refers to: with sch:include, sch:extends href, xsl:include or xsl:import
export interface SchReference {
	path: string;
	kind: 'sch:include' | 'sch:extends' | 'xsl:include' | 'xsl:import';
}

// Schematron: the files a schema brings in - for the Imports view - and, for a file, the schemas that include it, from an
// index of the workspace's .sch files, built when it's first needed and kept up to date as files change
export class SchIncludes {
	public static readonly instance = new SchIncludes();
	public static readonly chooseCommand = 'xslt-xpath.chooseIncludingSchema';
	private references = new Map<string, SchReference[]>();
	private building: Promise<void> | undefined;
	private isBuilt = false;
	private readonly changed = new vscode.EventEmitter<void>();
	public readonly onDidChange = this.changed.event;
	private watcher: vscode.FileSystemWatcher | undefined;
	// the including schemas chosen: for a schema's tree, the first that includes a file - and for a file alone
	private preferred: string[] = [];
	private moduleChoices = new Map<string, string>();

	// the files the Schematron text refers to, resolved against its file - as SchXslt2 resolves them, with the XML catalog:
	// not those in an XSLT element, e.g. xsl:include in xsl:function, nor in a foreign element
	public static referencesIn(text: string, filePath: string): SchReference[] {
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const xsltPrefix = XslLexer.schXsltPrefix(text) + ':';
		const isSch = (e: XmlElement | undefined) => !!e && (prefix ? e.name.startsWith(prefix) : !e.name.includes(':'));
		const result: SchReference[] = [];
		for (const element of [root, ...descendants(root)]) {
			const local = isSch(element) ? element.name.substring(prefix.length) : element.name.startsWith(xsltPrefix) ? 'xsl:' + element.name.substring(xsltPrefix.length) : undefined;
			const kind = local === 'include' ? 'sch:include' : local === 'extends' ? 'sch:extends' : local === 'xsl:include' || local === 'xsl:import' ? local : undefined;
			const href = element.attributes.get('href')?.trim();
			// an XSLT module's: at the top level, where SchXslt2 copies it
			if (!kind || !href || (kind.startsWith('xsl:') && element.parent !== root)) {
				continue;
			}
			const referencePath = HrefPaths.toPath(href, filePath);
			if (referencePath !== undefined && !result.some((r) => r.path === referencePath && r.kind === kind)) {
				result.push({ path: referencePath, kind });
			}
		}
		return result;
	}

	public get built() {
		return this.isBuilt;
	}

	// builds the index, if it isn't built or being built
	public whenBuilt(): Promise<void> {
		if (!this.building) {
			this.building = this.build();
		}
		return this.building;
	}

	private async build() {
		const uris = await vscode.workspace.findFiles('**/*.sch', '**/node_modules/**', 5000);
		uris.filter((uri) => uri.scheme === 'file').forEach((uri) => this.scan(uri.fsPath));
		if (!this.watcher) {
			this.watcher = vscode.workspace.createFileSystemWatcher('**/*.sch');
			const update = (uri: vscode.Uri) => {
				this.scan(uri.fsPath);
				this.changed.fire();
			};
			this.watcher.onDidCreate(update);
			this.watcher.onDidChange(update);
			this.watcher.onDidDelete((uri) => {
				this.references.delete(uri.fsPath);
				this.changed.fire();
			});
		}
		this.isBuilt = true;
		this.changed.fire();
	}

	// for testing, with no workspace folder: the index of these files
	public buildFrom(paths: string[]) {
		this.references.clear();
		paths.forEach((p) => this.scan(p));
		this.isBuilt = true;
		this.building = Promise.resolve();
		this.changed.fire();
	}

	private scan(filePath: string) {
		try {
			this.references.set(filePath, SchIncludes.referencesIn(fs.readFileSync(filePath, 'utf8'), filePath));
		} catch {
			this.references.delete(filePath);
		}
	}

	public referencesOf(filePath: string): SchReference[] | undefined {
		return this.references.get(filePath);
	}

	// the indexed Schematron files that include the file - with sch:include or sch:extends href, or xsl:include or
	// xsl:import for an XSLT module
	public includersOf(filePath: string): string[] {
		return [...this.references].filter(([, references]) => references.some((r) => r.path === filePath)).map(([file]) => file);
	}

	// the indexed Schematron files that use one of the XSLT modules: those that include or import one - or are one, e.g. a
	// schema with an xsl:function - and the files they bring in with sch:include and sch:extends href, directly or not
	public usersOf(modules: string[]): string[] {
		const users = new Set([...this.references].filter(([file, references]) => modules.includes(file) ||
			references.some((r) => (r.kind === 'xsl:include' || r.kind === 'xsl:import') && modules.includes(r.path))).map(([file]) => file));
		const visit = (file: string) => (this.references.get(file) ?? []).filter((r) => r.kind === 'sch:include' || r.kind === 'sch:extends').forEach((r) => {
			if (!users.has(r.path) && fs.existsSync(r.path)) {
				users.add(r.path);
				visit(r.path);
			}
		});
		[...users].forEach(visit);
		return [...users];
	}

	// the file's chain of includers, from the schema that includes it, directly or not, down to the file. As for an XSLT
	// module's top-level stylesheet (see ImportIndex.importChain): the schema chosen for the file, else at each step the
	// includer nearest its folder - of those that lead to a schema preferred for its tree, if one does. Not in a cycle.
	// Just the file, when nothing includes it
	public chain(filePath: string): string[] {
		const choice = this.moduleChoices.get(filePath);
		const chosen = choice ? this.pathFrom(choice, filePath) : undefined;
		if (chosen) {
			return chosen;
		}
		const target = this.preferred.find((schema) => this.topLevelCandidates(filePath).includes(schema));
		const chain = [filePath];
		for (let current = filePath; ;) {
			let includers = this.includersOf(current).filter((includer) => !chain.includes(includer));
			if (target && includers.some((includer) => this.reaches(includer, target, chain))) {
				includers = includers.filter((includer) => this.reaches(includer, target, chain));
			}
			if (includers.length === 0) {
				return chain;
			}
			const distance = (includer: string) => path.relative(path.dirname(current), path.dirname(includer)).split(path.sep).filter((part) => part !== '').length;
			current = includers.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best);
			chain.unshift(current);
		}
	}

	// whether the target is the includer, or includes it, directly or not - not through the files to avoid
	private reaches(includer: string, target: string, avoid: string[]): boolean {
		const visited = new Set(avoid);
		const visit = (file: string): boolean => {
			if (file === target) {
				return true;
			}
			visited.add(file);
			return this.includersOf(file).some((next) => !visited.has(next) && visit(next));
		};
		return visit(includer);
	}

	// the files from the schema down to the file it includes, directly or not - undefined if it doesn't
	private pathFrom(schema: string, filePath: string): string[] | undefined {
		const previous = new Map<string, string>();
		const queue = [schema];
		const seen = new Set([schema]);
		while (queue.length > 0) {
			const file = queue.shift()!;
			if (file === filePath) {
				const result = [file];
				for (let f = file; previous.has(f);) {
					f = previous.get(f)!;
					result.unshift(f);
				}
				return result.length > 1 ? result : undefined;
			}
			(this.references.get(file) ?? []).forEach((r) => {
				if (!seen.has(r.path)) {
					seen.add(r.path);
					previous.set(r.path, file);
					queue.push(r.path);
				}
			});
		}
		return undefined;
	}

	// the schemas that include the file, directly or not, that nothing includes
	public topLevelCandidates(filePath: string): string[] {
		const result = new Set<string>();
		const visited = new Set<string>([filePath]);
		const visit = (file: string) => {
			const includers = this.includersOf(file).filter((includer) => !visited.has(includer));
			if (this.includersOf(file).length === 0 && file !== filePath) {
				result.add(file);
			}
			includers.forEach((includer) => {
				visited.add(includer);
				visit(includer);
			});
		};
		visit(filePath);
		return [...result];
	}

	// the including schema for the file is a choice, not the nearest
	public isChosen(filePath: string): boolean {
		const chain = this.chain(filePath);
		return (this.moduleChoices.has(filePath) && chain[0] === this.moduleChoices.get(filePath)) || (chain.length > 1 && this.preferred.includes(chain[0]));
	}

	// the choices, for saving - and restoring them
	public get choices(): { preferred: string[], files: [string, string][] } {
		return { preferred: [...this.preferred], files: [...this.moduleChoices.entries()] };
	}

	public setChoices(choices: { preferred?: string[], files?: [string, string][] } | undefined) {
		this.preferred = choices?.preferred ?? [];
		this.moduleChoices = new Map(choices?.files ?? []);
		this.changed.fire();
	}

	// chooses a schema for its tree - it's used for the files it includes
	public chooseSchema(schema: string, filePath: string) {
		this.moduleChoices.delete(filePath);
		this.preferred = [schema].concat(this.preferred.filter((p) => p !== schema));
		this.changed.fire();
	}

	// chooses a schema for the file alone
	public chooseForFile(filePath: string, schema: string) {
		this.moduleChoices.set(filePath, schema);
		this.changed.fire();
	}

	// the nearest for the file: no choice for it, nor for the schemas that include it
	public clearChoice(filePath: string) {
		const candidates = this.topLevelCandidates(filePath);
		this.moduleChoices.delete(filePath);
		this.preferred = this.preferred.filter((p) => !candidates.includes(p));
		this.changed.fire();
	}

	// clears all the choices, returning how many there were
	public resetChoices(): number {
		const count = this.preferred.length + this.moduleChoices.size;
		this.preferred = [];
		this.moduleChoices.clear();
		this.changed.fire();
		return count;
	}

	// for a file sch:include brings in - or sch:extends href - what's in scope where it's included, as SchXslt2 has it in
	// the schema it assembles: the sch:ns prefixes of the schemas that include it, and the variables - the sch:let and
	// sch:param of the elements that contain the sch:include, and of the phases, which are global. Undefined if nothing
	// includes it
	public contextOf(filePath: string): { namespaces: Map<string, string>, variables: Set<string> } | undefined {
		const chain = this.chain(filePath);
		if (chain.length < 2) {
			return undefined;
		}
		const namespaces = new Map<string, string>();
		const variables = new Set<string>();
		for (let i = 0; i < chain.length - 1; i++) {
			const text = SchIncludes.textOf(chain[i]);
			const root = text !== undefined ? parseXml(text) : undefined;
			if (!root) {
				continue;
			}
			XslLexer.schNamespaces(text!).forEach((uri, prefix) => namespaces.set(prefix, uri));
			const colon = root.name.indexOf(':');
			const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
			const local = (e: XmlElement) => (prefix ? e.name.startsWith(prefix) : !e.name.includes(':')) ? e.name.substring(prefix.length) : undefined;
			const declarations = (e: XmlElement) => e.children.filter((c) => local(c) === 'let' || local(c) === 'param').forEach((c) => {
				const name = c.attributes.get('name')?.trim();
				if (name) {
					variables.add(name);
				}
			});
			root.children.filter((c) => local(c) === 'phase').forEach(declarations);
			// the sch:include of the next file in the chain
			const include = descendants(root).find((e) => (local(e) === 'include' || local(e) === 'extends') && e.attributes.has('href') &&
				HrefPaths.toPath(e.attributes.get('href')!.trim(), chain[i]) === chain[i + 1]);
			for (let e = include?.parent; e; e = e.parent) {
				declarations(e);
			}
		}
		return { namespaces, variables };
	}

	// for a file sch:include brings in, the declaration of a variable it uses but doesn't declare: in scope where it's
	// included - the nearest, from the sch:include outwards, and then the phases of that schema, and so on up the files
	// that include it. The file, and the offsets of the name in its name attribute
	public declarationOf(filePath: string, name: string): { file: string, start: number, end: number } | undefined {
		const chain = this.chain(filePath);
		for (let i = chain.length - 2; i >= 0; i--) {
			const text = SchIncludes.textOf(chain[i]);
			const root = text !== undefined ? parseXml(text) : undefined;
			if (!root) {
				continue;
			}
			const colon = root.name.indexOf(':');
			const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
			const local = (e: XmlElement) => (prefix ? e.name.startsWith(prefix) : !e.name.includes(':')) ? e.name.substring(prefix.length) : undefined;
			const declarationIn = (e: XmlElement) => e.children.find((c) => (local(c) === 'let' || local(c) === 'param') && c.attributes.get('name')?.trim() === name);
			const include = descendants(root).find((e) => (local(e) === 'include' || local(e) === 'extends') && e.attributes.has('href') &&
				HrefPaths.toPath(e.attributes.get('href')!.trim(), chain[i]) === chain[i + 1]);
			let declaration: XmlElement | undefined;
			for (let e = include?.parent; e && !declaration; e = e.parent) {
				declaration = declarationIn(e);
			}
			declaration = declaration ?? root.children.filter((c) => local(c) === 'phase').map(declarationIn).find((d) => d);
			if (declaration) {
				const startTag = text!.substring(declaration.start, declaration.contentStart);
				const match = /\sname\s*=\s*(["'])\s*([^"']*?)\s*\1/.exec(startTag);
				if (match) {
					const start = declaration.start + match.index + match[0].indexOf(match[2], match[0].indexOf(match[1]) + 1);
					return { file: chain[i], start, end: start + match[2].length };
				}
			}
		}
		return undefined;
	}

	// the names of the variables referred to in the files the Schematron file brings in with sch:include or sch:extends
	// href, directly or not - e.g. a schema's global sch:let, used only in a pattern it includes
	public namesUsedIn(filePath: string): Set<string> {
		const names = new Set<string>();
		const visited = new Set<string>([filePath]);
		const visit = (file: string) => {
			const references = this.references.get(file) ?? (() => {
				const text = SchIncludes.textOf(file);
				return text !== undefined ? SchIncludes.referencesIn(text, file) : [];
			})();
			references.filter((r) => r.kind === 'sch:include' || r.kind === 'sch:extends').forEach((r) => {
				if (visited.has(r.path)) {
					return;
				}
				visited.add(r.path);
				const text = SchIncludes.textOf(r.path);
				if (text !== undefined) {
					[...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\$((?:[\w.-]+:)?[\w.-]+)/g)].forEach((m) => names.add(m[1]));
				}
				visit(r.path);
			});
		};
		visit(filePath);
		return names;
	}

	// the module's prefix bindings, with those of the schemas that include it - for a file sch:include brings in, whose
	// XPath uses their sch:ns prefixes, e.g. for a function of the XSLT module a schema includes. Its own come first
	public static withContext(document: vscode.TextDocument, bindings: Map<string, string> | undefined): Map<string, string> | undefined {
		const context = document.languageId === 'sch' && document.uri.scheme === 'file' ? SchIncludes.instance.contextOf(document.fileName) : undefined;
		if (!context) {
			return bindings;
		}
		const withContext = bindings ?? new Map<string, string>();
		context.namespaces.forEach((uri, prefix) => {
			if (!withContext.has(prefix)) {
				withContext.set(prefix, uri);
			}
		});
		return withContext;
	}

	// the text of the file: an open document's, which may not be saved yet, else the file's
	public static textOf(filePath: string): string | undefined {
		const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.fileName === filePath);
		if (open) {
			return open.getText();
		}
		try {
			return fs.readFileSync(filePath, 'utf8');
		} catch {
			return undefined;
		}
	}

	public dispose() {
		this.watcher?.dispose();
		this.changed.dispose();
	}
}
