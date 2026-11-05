/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - import precedence
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ImportIndex } from './importIndex';
import { GlobalInstructionData } from './xslLexer';

/**
 * The import precedence of a stylesheet's modules (XSLT 3.0, 3.11.3): where declarations with the same name are in
 * different modules - e.g. functions - the one in the module of higher precedence is used. An imported module has a
 * lower precedence than the module importing it, and a later import (with all its own imports) a higher precedence
 * than an earlier one. An included module has the precedence of the module including it, and its imports are as
 * if imported by that module at the xsl:include. For example, with main.xsl importing a.xsl (which imports c.xsl) then
 * b.xsl, the order, lowest first, is c, a, b, main.
 */
export class ImportPrecedence {

	// each module's precedence, by path: the higher, the higher the precedence - the top-level module's is highest
	public static ranks(topPath: string, text: (modulePath: string) => string | undefined = ImportPrecedence.moduleText): Map<string, number> {
		// the modules with the same precedence - one, and those it includes - lowest first
		const groups: string[][] = [];
		// the modules being read, to stop at a cycle
		const reading = new Set<string>();
		const read = (modulePath: string, group: string[]) => {
			reading.add(modulePath);
			for (const reference of ImportIndex.moduleReferences(text(modulePath) ?? '', modulePath)) {
				const referenced = path.normalize(reference.path);
				if (reading.has(referenced)) {
					continue;
				}
				if (reference.isInclude) {
					group.push(referenced);
					read(referenced, group);
				} else {
					const imported = [referenced];
					read(referenced, imported);
					groups.push(imported);
				}
			}
			reading.delete(modulePath);
		};
		const top = [path.normalize(topPath)];
		read(top[0], top);
		groups.push(top);
		// a module imported more than once: as its highest
		const ranks = new Map<string, number>();
		groups.forEach((group, rank) => group.forEach((modulePath) => ranks.set(modulePath, rank)));
		return ranks;
	}

	// the declarations from a stylesheet's other modules, highest precedence first, so the first with a name is the one
	// used - each has the path of its module as its href (those not in the import tree, e.g. from packages, last)
	public static sort(globals: GlobalInstructionData[], topPath: string): GlobalInstructionData[] {
		const ranks = ImportPrecedence.ranks(topPath);
		const rank = (global: GlobalInstructionData) => {
			const href = (global as GlobalInstructionData & { href?: string }).href;
			return href !== undefined ? ranks.get(path.normalize(href)) ?? -1 : -1;
		};
		return globals.map((global, index) => ({ global, index, rank: rank(global) }))
			.sort((a, b) => b.rank - a.rank || a.index - b.index).map((g) => g.global);
	}

	// a module's text: from its editor, if it's open (it may have unsaved changes), else from its file
	private static moduleText(modulePath: string): string | undefined {
		const open = vscode.workspace.textDocuments.find((d) => path.normalize(d.uri.fsPath) === modulePath);
		if (open) {
			return open.getText();
		}
		try {
			return fs.readFileSync(modulePath, 'utf8');
		} catch {
			return undefined;
		}
	}
}
