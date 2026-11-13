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
	private references = new Map<string, SchReference[]>();
	private building: Promise<void> | undefined;
	private isBuilt = false;
	private readonly changed = new vscode.EventEmitter<void>();
	public readonly onDidChange = this.changed.event;
	private watcher: vscode.FileSystemWatcher | undefined;

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

	// the file's chain of includers, from the schema that includes it, directly or not, down to the file - its first
	// includer at each step, not in a cycle. Just the file, when nothing includes it
	public chain(filePath: string): string[] {
		const chain = [filePath];
		for (let includers = this.includersOf(filePath); includers.length > 0;) {
			const next = includers.find((includer) => !chain.includes(includer));
			if (!next) {
				break;
			}
			chain.unshift(next);
			includers = this.includersOf(next);
		}
		return chain;
	}

	public dispose() {
		this.watcher?.dispose();
		this.changed.dispose();
	}
}
