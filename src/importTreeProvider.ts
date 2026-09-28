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
import { ImportIndex } from './importIndex';

// a module in the import tree: the top-level stylesheet, or a module it imports or includes, directly or indirectly -
// with the modules above it, to stop a cycle of imports
export interface ImportNode {
	path: string;
	isInclude?: boolean;
	ancestors: string[];
}

// The 'XSLT Imports' view: for the XSLT module in the active editor, the top-level stylesheet that imports or includes
// it - found from the workspace's XSLT modules (see ImportIndex) - with its tree of imports and includes. The modules
// from the top-level stylesheet down to the active module are expanded, and the active module is marked
export class ImportTreeProvider implements vscode.TreeDataProvider<ImportNode> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
	public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
	public view: vscode.TreeView<ImportNode> | undefined;

	// the active XSLT document - a function, for testing
	public constructor(private readonly currentDocument: () => vscode.TextDocument | undefined = () => {
		const document = vscode.window.activeTextEditor?.document;
		return document?.languageId === 'xslt' && document.uri.scheme === 'file' ? document : undefined;
	}) {
	}

	// the references of modules that aren't in the index, e.g. outside the workspace - until the next refresh
	private scanned = new Map<string, ReturnType<typeof ImportIndex.moduleReferences>>();

	public refresh() {
		this.scanned.clear();
		this.onDidChangeTreeDataEmitter.fire();
	}

	public getChildren(node?: ImportNode): ImportNode[] {
		const index = ImportIndex.instance;
		const current = this.currentDocument();
		if (!node) {
			if (!current) {
				this.setMessage('Open an XSLT module to see its imports and includes');
				return [];
			}
			if (!index.built && ImportIndex.isEnabled()) {
				this.setMessage('Scanning the workspace\'s XSLT modules...');
				index.whenBuilt().then(() => this.refresh());
			} else {
				this.setMessage(undefined);
			}
			return [{ path: ImportIndex.isEnabled() ? index.importChain(current.fileName)[0] : current.fileName, ancestors: [] }];
		}
		if (node.ancestors.includes(node.path)) {
			return [];
		}
		return this.referencesOf(node.path, current).map((reference) => ({ path: reference.path, isInclude: reference.isInclude, ancestors: node.ancestors.concat(node.path) }));
	}

	public getTreeItem(node: ImportNode): vscode.TreeItem {
		const index = ImportIndex.instance;
		const current = this.currentDocument();
		const chain = current && ImportIndex.isEnabled() ? index.importChain(current.fileName) : [];
		const isCurrent = node.path === current?.fileName;
		const isCycle = node.ancestors.includes(node.path);
		const exists = fs.existsSync(node.path);
		const hasChildren = !isCycle && exists && this.referencesOf(node.path, current).length > 0;
		// the modules from the top-level stylesheet down to the active module are expanded, to show it
		const isOnChain = chain.indexOf(node.path) > -1 && chain.indexOf(node.path) < chain.length - 1 && node.ancestors.every((ancestor, i) => chain[i] === ancestor);
		const item = new vscode.TreeItem(path.basename(node.path),
			!hasChildren ? vscode.TreeItemCollapsibleState.None : isOnChain ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
		// the module's folder, relative to that of the top-level stylesheet, e.g. 'lib'
		const rootPath = node.ancestors[0] ?? node.path;
		const folder = path.relative(path.dirname(rootPath), path.dirname(node.path)).split(path.sep).join('/');
		const notes: string[] = [];
		if (isCurrent) {
			notes.push('current');
		}
		if (node.ancestors.length === 0 && chain.length > 1) {
			notes.push('inferred top-level stylesheet');
		}
		if (isCycle) {
			notes.push('cycle');
		}
		if (!exists) {
			notes.push('not found');
		}
		item.description = [folder].concat(notes).filter((part) => part !== '').join(' · ');
		const kind = node.ancestors.length === 0 ? 'top-level stylesheet' : node.isInclude ? 'xsl:include' : 'xsl:import';
		const otherImporters = index.importersOf(node.path).filter((importer) => importer !== node.ancestors[node.ancestors.length - 1]);
		item.tooltip = `${node.path}\n${kind}` + (otherImporters.length > 0 ? `\nalso imported or included by: ${otherImporters.map((p) => vscode.workspace.asRelativePath(p)).join(', ')}` : '');
		item.iconPath = new vscode.ThemeIcon(isCurrent ? 'arrow-right' : node.ancestors.length === 0 ? 'root-folder' : node.isInclude ? 'file-symlink-file' : 'file-code');
		if (exists) {
			item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(node.path)] };
		}
		item.id = node.ancestors.concat(node.path).join('\n');
		return item;
	}

	// the references of the module - for the active document, from its text, which may not be saved yet, and for a
	// module that isn't in the index, from the file
	private referencesOf(modulePath: string, current: vscode.TextDocument | undefined) {
		if (current && modulePath === current.fileName) {
			return ImportIndex.moduleReferences(current.getText(), modulePath);
		}
		if (ImportIndex.instance.has(modulePath)) {
			return ImportIndex.instance.referencesOf(modulePath);
		}
		if (!this.scanned.has(modulePath)) {
			let references: ReturnType<typeof ImportIndex.moduleReferences> = [];
			try {
				references = ImportIndex.moduleReferences(fs.readFileSync(modulePath, 'utf8'), modulePath);
			} catch {
				// not found: no references
			}
			this.scanned.set(modulePath, references);
		}
		return this.scanned.get(modulePath)!;
	}

	private setMessage(message: string | undefined) {
		if (this.view) {
			this.view.message = message;
		}
	}
}
