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
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { XSLTReferenceProvider } from './xsltReferenceProvider';
import { DefinitionLocation } from './xsltTokenDefintions';
import { GlobalInstructionType } from './xslLexer';

// Schematron: Go to Definition, Find All References and Rename for a call of an XSLT function - declared in an XSLT
// module the schema includes, or in the schema with xsl:function, or, for a file sch:include brings in, in the schema
// that includes it (see SchIncludes). Its references are found from its declaration, by the XSLT reference provider,
// with the calls in the Schematron files that use its module (see XSLTReferenceProvider.schematronReferences)
export class SchematronFunctions {
	// the declaration of the function called at the position
	public static async declarationAt(provider: XsltDefinitionProvider, document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<DefinitionLocation | undefined> {
		if (!document.getWordRangeAtPosition(position, /Q\{[^}]*\}[\w.-]+|[\w.-]+:[\w.-]+/)) {
			return undefined;
		}
		const definition = await provider.provideDefinition(document, position, token);
		return definition?.instruction?.type === GlobalInstructionType.Function && definition.uri.scheme === 'file' ? definition : undefined;
	}

	public static async definition(provider: XsltDefinitionProvider, document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Location | undefined> {
		const declaration = await SchematronFunctions.declarationAt(provider, document, position, token);
		return declaration ? new vscode.Location(declaration.uri, declaration.range) : undefined;
	}

	public static async references(provider: XsltDefinitionProvider, document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext,
		token: vscode.CancellationToken): Promise<vscode.Location[] | undefined> {
		const declaration = await SchematronFunctions.declarationAt(provider, document, position, token);
		if (!declaration) {
			return undefined;
		}
		const declarationDocument = await vscode.workspace.openTextDocument(declaration.uri);
		const references = await new XSLTReferenceProvider().provideReferences(declarationDocument, declaration.range.start, context, token) ?? [];
		return context.includeDeclaration ? references :
			references.filter((l) => !(l.uri.toString() === declaration.uri.toString() && l.range.intersection(declaration.range)));
	}

	// the range of the function's name at the position, to be renamed - its declaration may prevent it, e.g. one overridden
	public static async prepareRename(provider: XsltDefinitionProvider, document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Range | undefined> {
		const declaration = await SchematronFunctions.declarationAt(provider, document, position, token);
		if (!declaration) {
			return undefined;
		}
		await new XSLTReferenceProvider().prepareRename(await vscode.workspace.openTextDocument(declaration.uri), declaration.range.start, token);
		return document.getWordRangeAtPosition(position, /Q\{[^}]*\}[\w.-]+|[\w.-]+:[\w.-]+/);
	}

	public static async rename(provider: XsltDefinitionProvider, document: vscode.TextDocument, position: vscode.Position, newName: string,
		token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit | undefined> {
		const declaration = await SchematronFunctions.declarationAt(provider, document, position, token);
		if (!declaration) {
			return undefined;
		}
		// renamed from the declaration, as found by prepareRename - which provideRenameEdits uses
		const declarationDocument = await vscode.workspace.openTextDocument(declaration.uri);
		const references = new XSLTReferenceProvider();
		await references.prepareRename(declarationDocument, declaration.range.start, token);
		return references.provideRenameEdits(declarationDocument, declaration.range.start, newName, token);
	}
}
