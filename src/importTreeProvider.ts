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
import { ImportIndex, ModuleReference, UsedPackage } from './importIndex';
import { XsltPackages } from './xsltPackages';
import { HrefPaths } from './hrefPaths';

// a module in the import tree: the top-level stylesheet, or a module it imports or includes, directly or indirectly -
// with the modules above it, to stop a cycle of imports
export interface ImportNode {
	path: string;
	isInclude?: boolean;
	ancestors: string[];
	// for a package an xsl:use-package uses: its name, the package-version asked for, and the version found - a package
	// that isn't found has the path 'package:' and its name
	package?: { name: string; versionRange?: string; version?: string; fromSetting?: boolean };
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

	// the references and used packages of modules that aren't in the index, e.g. outside the workspace - until the next
	// refresh
	private scanned = new Map<string, { references: ModuleReference[]; usedPackages: UsedPackage[] }>();

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
		const ancestors = node.ancestors.concat(node.path);
		const { references, usedPackages } = this.moduleInfo(node.path, current);
		return references.map((reference): ImportNode => ({ path: reference.path, isInclude: reference.isInclude, ancestors }))
			.concat(usedPackages.map((used) => this.packageNode(used, ancestors)));
	}

	// the package an xsl:use-package uses - the version XsltPackages.find chooses
	private packageNode(used: UsedPackage, ancestors: string[]): ImportNode {
		const found = XsltPackages.find(XsltPackages.all(), used.name, used.versionRange);
		const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(ancestors[0]);
		const packagePath = found ? HrefPaths.settingsPath(found.path, workspace) : undefined;
		return {
			path: packagePath ?? 'package:' + used.name, ancestors,
			package: { name: used.name, versionRange: used.versionRange, version: found ? found.version ?? '1' : undefined, fromSetting: found?.fromSetting }
		};
	}

	public getTreeItem(node: ImportNode): vscode.TreeItem {
		const index = ImportIndex.instance;
		const current = this.currentDocument();
		const chain = current && ImportIndex.isEnabled() ? index.importChain(current.fileName) : [];
		const isCurrent = node.path === current?.fileName;
		const isCycle = node.ancestors.includes(node.path);
		const exists = fs.existsSync(node.path);
		const info = exists ? this.moduleInfo(node.path, current) : undefined;
		const hasChildren = !isCycle && !!info && info.references.length + info.usedPackages.length > 0;
		// the modules from the top-level stylesheet down to the active module are expanded, to show it
		const isOnChain = chain.indexOf(node.path) > -1 && chain.indexOf(node.path) < chain.length - 1 && node.ancestors.every((ancestor, i) => chain[i] === ancestor);
		const pkg = node.package;
		const item = new vscode.TreeItem(pkg && !exists ? pkg.name : path.basename(node.path),
			!hasChildren ? vscode.TreeItemCollapsibleState.None : isOnChain ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
		// the module's folder, relative to that of the top-level stylesheet, e.g. 'lib'
		const rootPath = node.ancestors[0] ?? node.path;
		const folder = path.relative(path.dirname(rootPath), path.dirname(node.path)).split(path.sep).join('/');
		const notes: string[] = [];
		if (pkg && exists) {
			notes.push(`package ${pkg.name.split(/[/:#]/).filter((part) => part !== '').pop() ?? pkg.name} ${pkg.version}`);
		}
		if (isCurrent) {
			notes.push('current');
		}
		if (node.ancestors.length === 0 && chain.length > 1) {
			notes.push(current && index.isChosen(current.fileName) ? 'chosen top-level stylesheet' : 'inferred top-level stylesheet');
		}
		if (isCycle) {
			notes.push('cycle');
		}
		if (!exists) {
			notes.push('not found');
		}
		item.description = [pkg && !exists ? '' : folder].concat(notes).filter((part) => part !== '').join(' · ');
		const range = pkg?.versionRange && pkg.versionRange !== '*' ? ` package-version="${pkg.versionRange}"` : '';
		const kind = pkg ? `xsl:use-package name="${pkg.name}"${range}` + (exists ? `\nversion ${pkg.version}, from ${pkg.fromSetting ? 'the XSLT.resources.xsltPackages setting' : 'the workspace'}` : '\npackage not found - in the workspace, or the XSLT.resources.xsltPackages setting') :
			node.ancestors.length === 0 ? 'top-level stylesheet' : node.isInclude ? 'xsl:include' : 'xsl:import';
		const otherImporters = index.importersOf(node.path).filter((importer) => importer !== node.ancestors[node.ancestors.length - 1]);
		item.tooltip = (pkg && !exists ? kind : `${node.path}\n${kind}`) + (otherImporters.length > 0 ? `\nalso imported or included by: ${otherImporters.map((p) => vscode.workspace.asRelativePath(p)).join(', ')}` : '');
		item.iconPath = new vscode.ThemeIcon(isCurrent ? 'arrow-right' : node.ancestors.length === 0 ? 'root-folder' : pkg ? 'package' : node.isInclude ? 'file-symlink-file' : 'file-code');
		if (exists) {
			item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(node.path)] };
		}
		item.id = node.ancestors.concat(node.path).join('\n');
		// the top-level stylesheet has a Quick Run action
		item.contextValue = node.ancestors.length === 0 && exists ? 'topLevel' : 'module';
		return item;
	}

	// the references and used packages of the module - for the active document, from its text, which may not be saved
	// yet, and for a module that isn't in the index, from the file
	private moduleInfo(modulePath: string, current: vscode.TextDocument | undefined): { references: ModuleReference[]; usedPackages: UsedPackage[] } {
		if (current && modulePath === current.fileName) {
			const text = current.getText();
			return { references: ImportIndex.moduleReferences(text, modulePath), usedPackages: ImportIndex.usedPackages(text) };
		}
		if (ImportIndex.instance.has(modulePath)) {
			return { references: ImportIndex.instance.referencesOf(modulePath), usedPackages: ImportIndex.instance.usedPackagesOf(modulePath) };
		}
		if (!this.scanned.has(modulePath)) {
			let info = { references: [] as ModuleReference[], usedPackages: [] as UsedPackage[] };
			try {
				const text = fs.readFileSync(modulePath, 'utf8');
				info = { references: ImportIndex.moduleReferences(text, modulePath), usedPackages: ImportIndex.usedPackages(text) };
			} catch {
				// not found: no references
			}
			this.scanned.set(modulePath, info);
		}
		return this.scanned.get(modulePath)!;
	}

	private setMessage(message: string | undefined) {
		if (this.view) {
			this.view.message = message;
		}
	}
}
