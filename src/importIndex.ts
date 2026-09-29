/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
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

// an xsl:import or xsl:include of a module: its resolved path
export interface ModuleReference {
	path: string;
	isInclude: boolean;
}

// the files limit for scanning a workspace, so that a very large workspace doesn't take too long
const maxFiles = 20000;

// An index of the xsl:import and xsl:include references between the XSLT modules in the workspace, from a text scan of
// each file - without the lexer - so that for a module opened on its own, the top-level stylesheet that imports or
// includes it, directly or indirectly, can be found without that stylesheet being opened first. The index is built in
// the background the first time it's needed, and is updated by a file watcher.
// Only literal hrefs are found: not those from shadow attributes, e.g. _href="{$dir}/a.xsl", or a catalog.
export class ImportIndex {
	public static readonly instance = new ImportIndex();

	// for each module, its imports and includes - and for each module, the modules importing or including it
	private references = new Map<string, ModuleReference[]>();
	private importers = new Map<string, Set<string>>();
	private building: Promise<void> | undefined;
	private isBuilt = false;
	private watcher: vscode.FileSystemWatcher | undefined;
	// the top-level stylesheets chosen for their trees, most recent first - and for a module, a stylesheet chosen for
	// it alone, e.g. one the index has no link from
	private preferred: string[] = [];
	private moduleChoices = new Map<string, string>();
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
	// fired when the index is built, and when it's updated for a changed file
	public readonly onDidChange = this.onDidChangeEmitter.event;

	public static isEnabled() {
		return vscode.workspace.getConfiguration('XSLT.resources').get<boolean>('inferParentFromWorkspace', true);
	}

	// the xsl:import and xsl:include hrefs in the text, resolved against the module's folder - the '-' of an attribute
	// name like xsl:_href or a prefix, e.g. _href, stops a shadow attribute matching
	public static moduleReferences(text: string, modulePath: string): ModuleReference[] {
		const references: ModuleReference[] = [];
		const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '');
		for (const match of withoutComments.matchAll(/<xsl:(import|include)\s[^>]*?(?<![\w.:-])href\s*=\s*(["'])([^"'{}]+)\2/g)) {
			const href = match[3].trim();
			if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('file:')) {
				// a URI with a scheme other than file:, e.g. http:
				continue;
			}
			const hrefPath = href.startsWith('file:') ? decodeURIComponent(href.replace(/^file:(\/\/)?/, '')) : href;
			references.push({ path: path.resolve(path.dirname(modulePath), hrefPath), isInclude: match[1] === 'include' });
		}
		return references;
	}

	// the index is built: a request for the master of a module while it's building returns undefined - use
	// whenBuilt() to wait for it
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

	// the XSLT files in the workspace folders - excluding those of files.exclude, and in node_modules and .git
	private async build() {
		const uris = await vscode.workspace.findFiles('**/*.{xsl,xslt}', undefined, maxFiles);
		await this.buildFrom(uris.filter((uri) => uri.scheme === 'file' && !/[\\/](node_modules|\.git)[\\/]/.test(uri.fsPath)).map((uri) => uri.fsPath));
	}

	// builds the index from the files - public for testing, as the test host has no workspace folder
	public async buildFrom(files: string[]) {
		this.building = this.building ?? Promise.resolve();
		// read in batches, so that many files aren't open at once
		const batchSize = 64;
		for (let i = 0; i < files.length; i += batchSize) {
			await Promise.all(files.slice(i, i + batchSize).map(async (file) => {
				try {
					this.setReferences(file, ImportIndex.moduleReferences(await fs.promises.readFile(file, 'utf8'), file));
				} catch {
					// unreadable: ignore
				}
			}));
		}
		this.isBuilt = true;
		this.watch();
		this.onDidChangeEmitter.fire();
	}

	private watch() {
		if (this.watcher) {
			return;
		}
		this.watcher = vscode.workspace.createFileSystemWatcher('**/*.{xsl,xslt}');
		const update = async (uri: vscode.Uri) => {
			if (uri.scheme !== 'file') {
				return;
			}
			try {
				this.setReferences(uri.fsPath, ImportIndex.moduleReferences(await fs.promises.readFile(uri.fsPath, 'utf8'), uri.fsPath));
			} catch {
				this.setReferences(uri.fsPath, []);
			}
			this.onDidChangeEmitter.fire();
		};
		this.watcher.onDidChange(update);
		this.watcher.onDidCreate(update);
		this.watcher.onDidDelete((uri) => {
			this.setReferences(uri.fsPath, []);
			this.references.delete(uri.fsPath);
			this.onDidChangeEmitter.fire();
		});
	}

	public dispose() {
		this.watcher?.dispose();
	}

	// sets the references of a module, e.g. when it's saved or changed - updating the modules importing each one
	public setReferences(file: string, references: ModuleReference[]) {
		for (const previous of this.references.get(file) ?? []) {
			this.importers.get(previous.path)?.delete(file);
		}
		this.references.set(file, references);
		for (const reference of references) {
			if (!this.importers.has(reference.path)) {
				this.importers.set(reference.path, new Set());
			}
			this.importers.get(reference.path)!.add(file);
		}
	}

	// the module is in the index
	public has(file: string) {
		return this.references.has(file);
	}

	public referencesOf(file: string): ModuleReference[] {
		return this.references.get(file) ?? [];
	}

	public importersOf(file: string): string[] {
		return [...(this.importers.get(file) ?? [])].sort();
	}

	// the chain of modules from the top-level stylesheet that imports or includes the module, directly or indirectly,
	// down to the module - just the module if nothing imports it. A stylesheet chosen for the module is used, or else
	// the route to a chosen top-level stylesheet - otherwise, where a module has more than one importer, the one in the
	// nearest folder is used, then the first by path. A cycle of imports stops the chain
	public importChain(file: string): string[] {
		const moduleChoice = this.moduleChoices.get(file);
		if (moduleChoice) {
			return [moduleChoice, file];
		}
		const candidates = this.topLevelCandidates(file);
		const target = this.preferred.find((stylesheet) => candidates.includes(stylesheet));
		const chain = [file];
		let current = file;
		for (;;) {
			let importers = this.importersOf(current).filter((importer) => !chain.includes(importer));
			if (target && importers.some((importer) => this.reaches(importer, target, chain))) {
				importers = importers.filter((importer) => this.reaches(importer, target, chain));
			}
			if (importers.length === 0) {
				return chain;
			}
			const distance = (importer: string) => path.relative(path.dirname(current), path.dirname(importer)).split(path.sep).filter((part) => part !== '').length;
			current = importers.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best);
			chain.unshift(current);
		}
	}

	// the top-level stylesheets that import or include the module, directly or indirectly - those that nothing imports
	public topLevelCandidates(file: string): string[] {
		const result = new Set<string>();
		const visited = new Set<string>([file]);
		const visit = (module: string) => {
			const importers = this.importersOf(module).filter((importer) => !visited.has(importer));
			if (importers.length === 0 && module !== file) {
				result.add(module);
			}
			importers.forEach((importer) => {
				visited.add(importer);
				visit(importer);
			});
		};
		visit(file);
		return [...result].sort();
	}

	// the module is the stylesheet, or is imported or included by it, directly or indirectly, other than through the
	// modules to skip
	private reaches(module: string, stylesheet: string, skip: string[]): boolean {
		const visited = new Set<string>(skip);
		const visit = (current: string): boolean => {
			if (current === stylesheet) {
				return true;
			}
			visited.add(current);
			return this.importersOf(current).some((importer) => !visited.has(importer) && visit(importer));
		};
		return visit(module);
	}

	// for a rename or find references in a module: the modules of the tree of each top-level stylesheet that imports or
	// includes it, directly or indirectly - or of its own tree, if nothing does - with each stylesheet's tree first - an
	// empty list if the index isn't enabled, or can't be built as there's no workspace folder
	public static async moduleTrees(document: vscode.TextDocument): Promise<string[][]> {
		if (document.uri.scheme !== 'file' || !ImportIndex.isEnabled()) {
			return [];
		}
		const index = ImportIndex.instance;
		if (!index.built && (vscode.workspace.workspaceFolders?.length ?? 0) > 0) {
			await index.whenBuilt();
		}
		if (!index.built) {
			return [];
		}
		const tree = (stylesheet: string) => {
			const modules: string[] = [];
			const add = (file: string) => {
				if (!modules.includes(file)) {
					modules.push(file);
					index.referencesOf(file).forEach((reference) => add(reference.path));
				}
			};
			add(stylesheet);
			return modules.filter((file) => fs.existsSync(file));
		};
		const topLevel = index.topLevelCandidates(document.fileName);
		return (topLevel.length > 0 ? topLevel : [document.fileName]).map(tree);
	}

	// the top-level stylesheet that imports or includes the module, directly or indirectly - undefined if there isn't
	// one, or the index isn't built yet
	public masterFor(file: string): string | undefined {
		if (!this.isBuilt && !this.moduleChoices.has(file)) {
			return undefined;
		}
		const chain = this.importChain(file);
		return chain.length > 1 ? chain[0] : undefined;
	}

	// the top-level stylesheet for the module is a choice, not the default
	public isChosen(file: string) {
		const chain = this.importChain(file);
		return this.moduleChoices.has(file) || (chain.length > 1 && this.preferred.includes(chain[0]));
	}

	// the choices, for saving - and restoring them
	public get choices(): { preferred: string[], modules: [string, string][] } {
		return { preferred: [...this.preferred], modules: [...this.moduleChoices.entries()] };
	}

	public setChoices(choices: { preferred?: string[], modules?: [string, string][] } | undefined) {
		this.preferred = choices?.preferred ?? [];
		this.moduleChoices = new Map(choices?.modules ?? []);
		this.onDidChangeEmitter.fire();
	}

	// chooses a top-level stylesheet for its tree - it's used for the modules it imports or includes
	public chooseTopLevel(stylesheet: string, file: string) {
		this.moduleChoices.delete(file);
		this.preferred = [stylesheet].concat(this.preferred.filter((p) => p !== stylesheet));
		this.onDidChangeEmitter.fire();
	}

	// chooses a stylesheet for the module alone
	public chooseForModule(file: string, stylesheet: string) {
		this.moduleChoices.set(file, stylesheet);
		this.onDidChangeEmitter.fire();
	}

	// the default for the module: no choice for it, and none for the top-level stylesheets that import it
	public clearChoice(file: string) {
		const candidates = this.topLevelCandidates(file);
		this.moduleChoices.delete(file);
		this.preferred = this.preferred.filter((p) => !candidates.includes(p));
		this.onDidChangeEmitter.fire();
	}

	// clears all the choices, returning how many there were
	public resetChoices(): number {
		const count = this.preferred.length + this.moduleChoices.size;
		this.preferred = [];
		this.moduleChoices.clear();
		this.onDidChangeEmitter.fire();
		return count;
	}
}
