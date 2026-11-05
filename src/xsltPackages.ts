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
	// packages known otherwise, e.g. from a W3C test case's environment (see test/w3c-suite/w3cLint.test.ts)
	public static additional: XsltPackage[] = [];

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
				fromSetting.push({ name: entry.name, path: entry.path, version: entry.version, fromSetting: true });
				continue;
			}
			const filePath = workspace ? HrefPaths.settingsPath(entry.path, workspace) : path.isAbsolute(entry.path) ? entry.path : undefined;
			const declaration = filePath ? XsltPackages.declarationOf(filePath) : undefined;
			if (declaration) {
				fromSetting.push({ name: declaration.name, path: entry.path, version: entry.version ?? declaration.version, fromSetting: true });
			}
		}
		const found = ImportIndex.isEnabled() ? ImportIndex.instance.packages() : [];
		return fromSetting.concat(XsltPackages.additional, found);
	}

	// the package an xsl:use-package uses: of those with the name, the highest version that its package-version (default
	// '*') matches - the first, the setting's before those found in the workspace, for the same version
	public static find(packages: XsltPackage[], name: string, versionRange?: string): XsltPackage | undefined {
		const range = versionRange?.replace(/^\s*["']|["']\s*$/g, '');
		let found: XsltPackage | undefined;
		for (const pkg of packages) {
			if (pkg.name === name && XsltPackages.versionMatches(pkg.version ?? '1', range)
				&& (!found || XsltPackages.compareVersions(pkg.version ?? '1', found.version ?? '1') > 0)) {
				found = pkg;
			}
		}
		return found;
	}

	// XSLT 3.0 section 3.5.1: a version is a numeric part, e.g. 1.2.0, with an optional '-' and name part - numeric parts
	// are compared as integers, a missing one counting as 0, and with equal numeric parts, a version with no name part
	// is the higher, else the name parts are compared as strings
	public static compareVersions(a: string, b: string): number {
		const parse = (version: string) => {
			const match = version.trim().match(/^([\d.]*)(?:-(.*))?$/);
			return { numbers: (match?.[1] ?? '').split('.').filter((n) => n !== '').map((n) => parseInt(n, 10)), name: match?.[2] };
		};
		const va = parse(a);
		const vb = parse(b);
		for (let i = 0; i < Math.max(va.numbers.length, vb.numbers.length); i++) {
			const difference = (va.numbers[i] ?? 0) - (vb.numbers[i] ?? 0);
			if (difference !== 0) {
				return difference;
			}
		}
		if (va.name === vb.name) {
			return 0;
		}
		return va.name === undefined ? 1 : vb.name === undefined ? -1 : va.name < vb.name ? -1 : 1;
	}

	// whether the version is in an xsl:use-package package-version range: '*', or ranges separated by commas, each a
	// version (equal to it), 'V.*' (with V's numeric parts as a prefix), 'V+' (V or higher), 'V to W', or 'to W'
	public static versionMatches(version: string, range: string | undefined): boolean {
		if (range === undefined || range.trim() === '' || range.trim() === '*') {
			return true;
		}
		return range.split(',').map((r) => r.trim()).some((r) => {
			let match: RegExpMatchArray | null;
			if ((match = r.match(/^([\d.]+)\.\*$/))) {
				const prefix = match[1].split('.').map((n) => parseInt(n, 10));
				const numbers = version.trim().split('-')[0].split('.').map((n) => parseInt(n, 10));
				return prefix.every((n, i) => numbers[i] === n);
			}
			if ((match = r.match(/^(.+)\+$/))) {
				return XsltPackages.compareVersions(version, match[1]) >= 0;
			}
			if ((match = r.match(/^(.*?)\s*\bto\s+(.+)$/))) {
				return (match[1] === '' || XsltPackages.compareVersions(version, match[1]) >= 0) && XsltPackages.compareVersions(version, match[2]) <= 0;
			}
			return XsltPackages.compareVersions(version, r) === 0;
		});
	}

	// the version for a new package that a package-version range asks for: the version, or the lowest of 'V+', 'V.*' or
	// 'V to W' - undefined for '*' or another range, so the package has the default version
	public static lowestVersion(range: string | undefined): string | undefined {
		const match = range?.trim().match(/^([\d.]+(?:-\S+)?)(?:\+|\.\*|\s+to\s+.+)?$/);
		return match?.[1];
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
			for (const used of usedPackages) {
				const pkg = XsltPackages.find(packages, used.name, used.versionRange);
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
			return { usedPackages: ImportIndex.usedPackages(text), references: ImportIndex.moduleReferences(text, file) };
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
