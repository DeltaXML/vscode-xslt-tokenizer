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
import { XmlCatalog } from './xmlCatalog';

// The XSLT.resources.catalog setting: an OASIS XML catalog for resolving the hrefs of xsl:import, xsl:include and
// fixed-namespaces URIs - and passed to Saxon by the XSLT tasks that don't have their own catalogFilenames
export class CatalogSetting {
	public static readonly section = 'XSLT.resources';
	public static readonly setting = 'catalog';

	// the catalog file's path, from the setting's value: relative to the first workspace folder, or with
	// ${workspaceFolder} - undefined when there's no setting, or it's relative and there's no workspace folder
	public static catalogPath(value = vscode.workspace.getConfiguration(CatalogSetting.section).get<string>(CatalogSetting.setting), workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath): string | undefined {
		const trimmed = value?.trim();
		if (!trimmed) {
			return undefined;
		}
		const substituted = workspaceFolder !== undefined ? trimmed.split('${workspaceFolder}').join(workspaceFolder) : trimmed;
		if (substituted.includes('${workspaceFolder}') || (!path.isAbsolute(substituted) && workspaceFolder === undefined)) {
			return undefined;
		}
		return path.resolve(workspaceFolder ?? '', substituted);
	}

	// uses the setting's catalog for hrefs, and again when the setting or a catalog file changes - calling onChange then
	public static activate(context: vscode.ExtensionContext, onChange: () => void) {
		let watchers: vscode.Disposable[] = [];
		const update = (notify: boolean) => {
			watchers.forEach((watcher) => watcher.dispose());
			watchers = [];
			const catalogPath = CatalogSetting.catalogPath();
			HrefPaths.catalog = catalogPath !== undefined ? new XmlCatalog(catalogPath) : undefined;
			if (catalogPath !== undefined) {
				if (!fs.existsSync(catalogPath)) {
					vscode.window.showWarningMessage(`XSLT: the XML catalog of the ${CatalogSetting.section}.${CatalogSetting.setting} setting isn't found: ${catalogPath}`);
				}
				// the catalog file, and those of its nextCatalog entries that are read - when they change, or are saved
				const isCatalogFile = (uri: vscode.Uri) => uri.scheme === 'file' && (uri.fsPath === catalogPath || !!HrefPaths.catalog?.loadedFiles.includes(uri.fsPath));
				const changed = (uri: vscode.Uri) => {
					if (isCatalogFile(uri)) {
						update(true);
					}
				};
				const catalogWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(catalogPath)), path.basename(catalogPath)));
				const workspaceWatcher = vscode.workspace.createFileSystemWatcher('**/*.{xml,cat}');
				[catalogWatcher, workspaceWatcher].forEach((watcher) => {
					watchers.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
				});
				watchers.push(vscode.workspace.onDidSaveTextDocument((document) => changed(document.uri)));
			}
			if (notify) {
				onChange();
			}
		};
		update(false);
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(`${CatalogSetting.section}.${CatalogSetting.setting}`)) {
				update(true);
			}
		}));
		context.subscriptions.push({ dispose: () => watchers.forEach((watcher) => watcher.dispose()) });
	}

	// the workspace state key for 'Don't Ask Again', for offering a workspace catalog
	public static readonly dontOfferKey = 'xslt-xpath.dontOfferWorkspaceCatalog';
	// the name of a catalog file that's offered: in the root of the workspace folder
	public static readonly offeredName = 'catalog.xml';

	// the path of a catalog.xml file in the root of the workspace folder, to offer as the setting's catalog - undefined
	// when the setting has a value (in any scope, even ''), 'Don't Ask Again' was chosen, or the file isn't an OASIS XML
	// catalog
	public static catalogToOffer(workspaceFolder: string | undefined, hasSetting: boolean, dontOffer: boolean, readText = (file: string) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined) {
		if (workspaceFolder === undefined || hasSetting || dontOffer) {
			return undefined;
		}
		const candidate = path.join(workspaceFolder, CatalogSetting.offeredName);
		try {
			const text = readText(candidate);
			return text !== undefined && XmlCatalog.isCatalog(text) ? candidate : undefined;
		} catch {
			return undefined;
		}
	}

	// when there's no setting, and the workspace folder has a catalog.xml that's an XML catalog: offers to use it, once -
	// 'Use' sets the setting for the workspace, and 'Don't Ask Again' is saved for the workspace
	public static async offerWorkspaceCatalog(context: vscode.ExtensionContext) {
		const inspected = vscode.workspace.getConfiguration(CatalogSetting.section).inspect<string>(CatalogSetting.setting);
		const hasSetting = [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue].some((value) => value !== undefined);
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const catalogPath = CatalogSetting.catalogToOffer(workspaceFolder, hasSetting, context.workspaceState.get<boolean>(CatalogSetting.dontOfferKey, false));
		if (catalogPath === undefined) {
			return;
		}
		const use = 'Use';
		const dontAsk = 'Don\'t Ask Again';
		const choice = await vscode.window.showInformationMessage(`This workspace has an XML catalog, ${CatalogSetting.offeredName}. Use it to resolve the hrefs of xsl:import and xsl:include, and pass it to Saxon?`, use, dontAsk);
		if (choice === use) {
			// relative to the workspace folder
			await vscode.workspace.getConfiguration(CatalogSetting.section).update(CatalogSetting.setting, CatalogSetting.offeredName, vscode.ConfigurationTarget.Workspace);
		} else if (choice === dontAsk) {
			await context.workspaceState.update(CatalogSetting.dontOfferKey, true);
		}
	}

	// the -catalog option for a Saxon task that doesn't have its own catalogFilenames - undefined when it has, or
	// there's no catalog setting
	public static taskOption(task: { catalogFilenames?: string }, catalogPath = CatalogSetting.catalogPath()) {
		return task.catalogFilenames === undefined && catalogPath !== undefined ? '-catalog:' + catalogPath : undefined;
	}
}
