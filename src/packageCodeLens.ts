/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT package overrides
 */
import * as vscode from 'vscode';
import { ImportIndex } from './importIndex';
import { PackageScope } from './packageScope';
import { GlobalInstructionData } from './xslLexer';

/**
 * Code lenses for XSLT package overrides, as Java IDEs show overriding methods: on a declaration in an xsl:override,
 * the component of the package it overrides - and on a public or abstract component of a package, the declarations in
 * the workspace that override it.
 */
export class PackageCodeLensProvider implements vscode.CodeLensProvider {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

	constructor() {
		// a module that uses a package is saved, or the workspace's packages change
		ImportIndex.instance.onDidChange(() => this.onDidChangeEmitter.fire());
	}

	public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (document.uri.scheme !== 'file') {
			return [];
		}
		const text = document.getText();
		const lenses: vscode.CodeLens[] = [];
		const range = (declaration: GlobalInstructionData) => new vscode.Range(declaration.token.line, 0, declaration.token.line, 0);
		const location = (path: string, declaration: GlobalInstructionData) =>
			new vscode.Location(vscode.Uri.file(path), new vscode.Position(declaration.token.line, Math.max(0, declaration.token.startCharacter + 1)));
		for (const { override, original } of PackageScope.overrideTargets(text)) {
			const target = location(original.href!, original);
			lenses.push(new vscode.CodeLens(range(override), {
				title: `overrides ${original.packageVisibility} ${PackageScope.label(original, override.prefixBindings)} of package ${original.packageName}`,
				command: 'editor.action.goToLocations',
				arguments: [document.uri, range(override).start, [target], 'goto', 'The package component isn\'t found']
			}));
		}
		if (ImportIndex.packageDeclaration(text)) {
			for (const { component, overrides } of PackageScope.overridesOf(document.fileName)) {
				if (overrides.length === 0) {
					continue;
				}
				const locations = overrides.map((o) => location(o.path, o.declaration));
				const files = new Set(overrides.map((o) => o.path)).size;
				lenses.push(new vscode.CodeLens(range(component), {
					title: `overridden in ${files} ${files === 1 ? 'module' : 'modules'}`,
					command: 'editor.action.showReferences',
					arguments: [document.uri, range(component).start, locations]
				}));
			}
		}
		return lenses;
	}
}
