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
import { ItemTypeSupport } from './itemTypeSupport';
import { ImportIndex } from './importIndex';
import { XsltPackages } from './xsltPackages';

// Whether a stylesheet is run with Saxon's syntax extensions: by "auto" - for tasks, Quick Run, the debugger and XSpec
// tests - only if it needs them, as a module of its compile, i.e. the stylesheet and those it imports, includes or uses,
// is XSLT 4.0, or uses item types or notes. Not otherwise, as with them, Saxon 13 runs a stylesheet before XSLT 4.0 with
// some of 4.0's rules, e.g. the priority of a union pattern
export class SyntaxExtensions {
	// for each module, by path: when it was read, and whether it needs them itself
	private static readonly needsByFile = new Map<string, { mtime: number, needs: boolean }>();

	// a module of the compile of one of the stylesheets needs them
	public static needed(stylesheets: string[]): boolean {
		const visited = new Set<string>();
		const visit = (file: string): boolean => {
			if (visited.has(file) || visited.size > 1000) {
				return false;
			}
			visited.add(file);
			const text = SyntaxExtensions.read(file);
			if (text === undefined) {
				return false;
			}
			if (SyntaxExtensions.moduleNeeds(file, text)) {
				return true;
			}
			return ImportIndex.moduleReferences(text, file).some((reference) => visit(reference.path)) ||
				XsltPackages.libraryPaths(file).some((pkg) => visit(pkg));
		};
		return stylesheets.some(visit);
	}

	// the module's compile needs them, when it's run as a module of each top-level stylesheet that imports or includes
	// it (from the workspace's index), or on its own - with its text, which may have unsaved changes
	public static neededForModule(file: string, text: string): boolean {
		if (ItemTypeSupport.syntaxExtensionsReason(text, true)) {
			return true;
		}
		const topLevel = ImportIndex.isEnabled() && ImportIndex.instance.built ? ImportIndex.instance.topLevelCandidates(file) : [];
		return SyntaxExtensions.needed(topLevel.length > 0 ? topLevel : [file]);
	}

	private static moduleNeeds(file: string, text: string): boolean {
		let mtime = -1;
		try {
			mtime = fs.statSync(file).mtimeMs;
		} catch {
			// not on disk
		}
		const cached = SyntaxExtensions.needsByFile.get(file);
		if (cached && cached.mtime === mtime && !SyntaxExtensions.isOpen(file)) {
			return cached.needs;
		}
		const needs = !!ItemTypeSupport.syntaxExtensionsReason(text, true);
		SyntaxExtensions.needsByFile.set(file, { mtime, needs });
		return needs;
	}

	private static isOpen(file: string) {
		return vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'file' && d.fileName === file && d.isDirty);
	}

	// with any unsaved changes
	private static read(file: string): string | undefined {
		try {
			const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.fileName === file);
			return open ? open.getText() : fs.readFileSync(file, 'utf8');
		} catch {
			return undefined;
		}
	}
}
