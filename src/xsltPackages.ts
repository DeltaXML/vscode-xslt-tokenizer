import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { HrefPaths } from './hrefPaths';
import { ImportIndex } from './importIndex';
import type { XsltPackage } from './xsltSymbolProvider';

// The packages that xsl:use-package can use: those in the XSLT.resources.xsltPackages setting, then the xsl:package
// modules found in the workspace (by the ImportIndex) - so a package in the workspace needs no setting. A setting
// entry may have just a path: its name and version are then read from the package's xsl:package element.
export class XsltPackages {
	// the name and version of packages outside the workspace, read for setting entries with only a path
	private static declarations = new Map<string, { name: string; version: string } | undefined>();

	// paths are absolute, or for the setting's, as written - resolved with HrefPaths.settingsPath
	public static all(): XsltPackage[] {
		const configured = vscode.workspace.getConfiguration('XSLT.resources').get<Partial<XsltPackage>[]>('xsltPackages') ?? [];
		const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const fromSetting: XsltPackage[] = [];
		for (const entry of configured) {
			if (typeof entry.path !== 'string') {
				continue;
			}
			if (entry.name) {
				fromSetting.push({ name: entry.name, path: entry.path, version: entry.version });
				continue;
			}
			const filePath = workspace ? HrefPaths.settingsPath(entry.path, workspace) : path.isAbsolute(entry.path) ? entry.path : undefined;
			const declaration = filePath ? XsltPackages.declarationOf(filePath) : undefined;
			if (declaration) {
				fromSetting.push({ name: declaration.name, path: entry.path, version: entry.version ?? declaration.version });
			}
		}
		const found = ImportIndex.isEnabled() ? ImportIndex.instance.packages() : [];
		return fromSetting.concat(found);
	}

	// the package files the stylesheet uses - with xsl:use-package, from any module it imports or includes, and from the
	// packages those use in turn - for Saxon's -lib option. Absolute paths, in the order found
	public static libraryPaths(xsltFsPath: string): string[] {
		const packages = XsltPackages.all();
		const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(xsltFsPath);
		const result: string[] = [];
		const visited = new Set<string>();
		const visit = (file: string) => {
			if (visited.has(file)) {
				return;
			}
			visited.add(file);
			const { usedPackages, references } = XsltPackages.moduleInfo(file);
			for (const name of usedPackages) {
				const pkg = packages.find((p) => p.name === name);
				const pkgPath = pkg ? HrefPaths.settingsPath(pkg.path, workspace) : undefined;
				if (pkgPath && !result.includes(pkgPath)) {
					result.push(pkgPath);
					visit(pkgPath);
				}
			}
			references.forEach((reference) => visit(reference.path));
		};
		visit(path.normalize(xsltFsPath));
		return result;
	}

	// from the index - or for a file it doesn't have, e.g. outside the workspace, from the file's text
	private static moduleInfo(file: string) {
		if (ImportIndex.instance.has(file)) {
			return { usedPackages: ImportIndex.instance.usedPackagesOf(file), references: ImportIndex.instance.referencesOf(file) };
		}
		try {
			const text = fs.readFileSync(file, 'utf8');
			return { usedPackages: ImportIndex.usedPackageNames(text), references: ImportIndex.moduleReferences(text, file) };
		} catch {
			return { usedPackages: [], references: [] };
		}
	}

	private static declarationOf(filePath: string) {
		const indexed = ImportIndex.instance.packages().find((p) => p.path === filePath);
		if (indexed) {
			return indexed;
		}
		if (!XsltPackages.declarations.has(filePath)) {
			let declaration: { name: string; version: string } | undefined;
			try {
				declaration = ImportIndex.packageDeclaration(fs.readFileSync(filePath, 'utf8'));
			} catch {
				declaration = undefined;
			}
			XsltPackages.declarations.set(filePath, declaration);
		}
		return XsltPackages.declarations.get(filePath);
	}
}
