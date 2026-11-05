/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT package overrides
 */
import * as vscode from 'vscode';
import { PackageScope } from './packageScope';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { XSLTConfiguration } from './languageConfigurations';

/**
 * Navigation between XSLT package components and the declarations that override them, with VS Code's standard
 * commands - as Java IDEs navigate between methods and their overrides - whether or not code lenses are shown:
 * - Go to Implementations: from a public or abstract component of a package - its declaration, or a reference to it -
 *   to the declarations in xsl:override that override it, in the workspace
 * - Go to Declaration: from a declaration in xsl:override, or xsl:original within it, to the package component it
 *   overrides
 */
export class PackageNavigationProvider implements vscode.ImplementationProvider, vscode.DeclarationProvider {

	public static location(place: { path: string, line: number, start: number, end: number }) {
		return new vscode.Location(vscode.Uri.file(place.path), new vscode.Range(place.line, place.start, place.line, place.end));
	}

	public async provideImplementation(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Location[] | undefined> {
		if (document.uri.scheme !== 'file') {
			return undefined;
		}
		let overriders = PackageScope.overridersAt(document.fileName, position);
		if (!overriders) {
			// a reference to the component
			const definition = (await new XsltDefinitionProvider(XSLTConfiguration.configuration).seekDefinition(document, position, token))?.definitionLocation;
			overriders = definition && !token.isCancellationRequested ? PackageScope.overridersAt(definition.uri.fsPath, definition.range.start) : undefined;
		}
		return overriders?.map((o) => PackageNavigationProvider.location(PackageScope.nameLocation(o.path, o.declaration)));
	}

	public provideDeclaration(document: vscode.TextDocument, position: vscode.Position): vscode.Location | undefined {
		const original = PackageScope.originalAt(document.getText(), position, PackageNavigationProvider.isOriginalAt(document, position));
		return original?.href ? PackageNavigationProvider.location(PackageScope.nameLocation(original.href, original)) : undefined;
	}

	// xsl:original, e.g. in xsl:original($a), name="xsl:original" or $xsl:original
	private static isOriginalAt(document: vscode.TextDocument, position: vscode.Position) {
		const range = document.getWordRangeAtPosition(position, /[\w.:-]+/);
		return !!range && document.getText(range) === 'xsl:original';
	}
}
