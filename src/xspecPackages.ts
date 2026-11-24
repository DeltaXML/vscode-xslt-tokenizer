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
import { GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { XsltPackages } from './xsltPackages';
import { PackageScope } from './packageScope';
import { XdocNotes } from './xdocNote';
import { XsltTokenCompletions } from './xsltTokenCompletions';

// XSpec's x:helper for a package - package-name and package-version, used by the test runner as an xsl:use-package -
// found as an xsl:use-package's package is: in the workspace, or the XSLT.resources.xsltPackages setting. Completion of
// the names and versions, the package's hover and its file for Go to Definition (its components are known to the
// linter, as a stylesheet's are - see XsltSymbolProvider.withPackageComponents)
export class XSpecPackages {
	// the x:helper attribute at the offset: package-name or package-version, with the helper's name and version
	public static attributeAt(text: string, offset: number): { attribute: string, name: string | undefined, version: string | undefined, start: number, end: number } | undefined {
		const tagStart = text.lastIndexOf('<', offset - 1);
		if (tagStart < 0 || text.lastIndexOf('>', offset - 1) > tagStart) {
			return undefined;
		}
		const prefix = /<(?:([\w.-]+):)?description\b/.exec(text)?.[1];
		const tagEnd = text.indexOf('>', tagStart);
		const tag = text.substring(tagStart, tagEnd < 0 ? text.length : tagEnd);
		if (!new RegExp(`^<${prefix ? prefix + ':' : ''}helper[\\s/]`).test(tag)) {
			return undefined;
		}
		const value = (attribute: string) => {
			const match = new RegExp(`\\s${attribute}\\s*=\\s*(["'])([^"']*)\\1`).exec(tag);
			return match ? { value: match[2], start: tagStart + match.index + match[0].length - match[2].length - 1 } : undefined;
		};
		const name = value('package-name');
		const version = value('package-version');
		for (const [attribute, found] of [['package-name', name], ['package-version', version]] as const) {
			if (found && offset >= found.start && offset <= found.start + found.value.length) {
				return { attribute, name: name?.value.trim(), version: version?.value.trim(), start: found.start, end: found.start + found.value.length };
			}
		}
		return undefined;
	}

	public static completions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		if (document.languageId !== 'xspec') {
			return undefined;
		}
		const at = XSpecPackages.attributeAt(document.getText(), document.offsetAt(position));
		return !at ? undefined : at.attribute === 'package-name' ? XsltTokenCompletions.getPackageNameCompletions(document, position) :
			XsltTokenCompletions.getPackageVersionCompletions(document, position);
	}

	// the package of the x:helper at the offset - as an xsl:use-package would use it
	private static usedAt(document: vscode.TextDocument, position: vscode.Position) {
		const at = XSpecPackages.attributeAt(document.getText(), document.offsetAt(position));
		if (!at || at.attribute !== 'package-name' || !at.name) {
			return undefined;
		}
		const usePackage: GlobalInstructionData = { type: GlobalInstructionType.UsePackage, name: at.name, version: at.version, token: { line: 0, startCharacter: 0, length: 0, value: at.name, tokenType: 0 }, idNumber: 0 };
		const used = PackageScope.usedBy(usePackage, XsltPackages.all(), PackageScope.workspaceFolder());
		return used?.path ? { at, used: { ...used, path: used.path } } : undefined;
	}

	public static definition(document: vscode.TextDocument, position: vscode.Position): vscode.Location | undefined {
		const found = XSpecPackages.usedAt(document, position);
		return found ? new vscode.Location(vscode.Uri.file(found.used.path), new vscode.Position(0, 0)) : undefined;
	}

	// the package's note, where it's found, and its public components - those the test runner can use
	public static hover(document: vscode.TextDocument, position: vscode.Position, componentsMarkdown: (components: GlobalInstructionData[]) => string): vscode.Hover | undefined {
		const found = XSpecPackages.usedAt(document, position);
		if (!found) {
			return undefined;
		}
		const { at, used } = found;
		let packageText = '';
		try {
			packageText = vscode.workspace.textDocuments.find((d) => d.fileName === used.path)?.getText() ?? fs.readFileSync(used.path, 'utf8');
		} catch {
			packageText = '';
		}
		const note = packageText ? XdocNotes.moduleNote(packageText) : undefined;
		const from = used.pkg.fromSetting ? 'the XSLT.resources.xsltPackages setting' : 'the workspace';
		const version = used.pkg.version ?? '1';
		const location = `Package \`${used.pkg.name}\` version ${version}, from ${from}: [${vscode.workspace.asRelativePath(used.path)}](${vscode.Uri.file(used.path).toString()})`;
		const markdown = new vscode.MarkdownString(`${note ? XdocNotes.toMarkdown(note) + '\n\n---\n' : ''}${location}\n\n${componentsMarkdown(used.available)}`);
		return new vscode.Hover(markdown, new vscode.Range(document.positionAt(at.start), document.positionAt(at.end)));
	}

	// the files of the packages an XSpec file's x:helper elements use - for the XSpec files testing a package's users
	public static helperPackagePaths(text: string): string[] {
		const prefix = /<(?:([\w.-]+):)?description\b/.exec(text)?.[1];
		const helpers = text.matchAll(new RegExp(`<${prefix ? prefix + ':' : ''}helper\\b[^>]*>`, 'g'));
		const xsltPackages = XsltPackages.all();
		return [...helpers].flatMap((helper) => {
			const name = /\spackage-name\s*=\s*(["'])\s*([^"']*?)\s*\1/.exec(helper[0])?.[2];
			const version = /\spackage-version\s*=\s*(["'])\s*([^"']*?)\s*\1/.exec(helper[0])?.[2];
			if (!name) {
				return [];
			}
			const usePackage: GlobalInstructionData = { type: GlobalInstructionType.UsePackage, name, version, token: { line: 0, startCharacter: 0, length: 0, value: name, tokenType: 0 }, idNumber: 0 };
			const used = PackageScope.usedBy(usePackage, xsltPackages, PackageScope.workspaceFolder());
			return used?.path ? [used.path] : [];
		});
	}
}
