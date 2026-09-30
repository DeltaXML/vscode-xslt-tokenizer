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
import * as url from 'url';
import { HrefPaths } from './hrefPaths';
import { CatalogRange, CatalogReference, XmlCatalog } from './xmlCatalog';

// For an XML catalog open in the editor - a file the catalog of the XSLT.resources.catalog setting reads, or any XML
// file whose root element is a catalog element in the catalog namespace: document links for its uri and nextCatalog
// entries, and warnings for the files and folders of its entries that aren't found
export class CatalogDocumentProvider implements vscode.DocumentLinkProvider {
	private static readonly collection = vscode.languages.createDiagnosticCollection('xml-catalog');

	public static isCatalogDocument(document: vscode.TextDocument) {
		return document.uri.scheme === 'file' && (!!HrefPaths.catalog?.loadedFiles.includes(document.uri.fsPath) || XmlCatalog.isCatalog(document.getText()));
	}

	// the references of a catalog document to files and folders, with their paths - undefined if it isn't a catalog
	private static references(document: vscode.TextDocument): { reference: CatalogReference, filePath: string }[] | undefined {
		if (!CatalogDocumentProvider.isCatalogDocument(document)) {
			return undefined;
		}
		const references = XmlCatalog.parse(document.getText(), url.pathToFileURL(document.uri.fsPath).href).references;
		return references.flatMap((reference) => {
			if (!reference.target.startsWith('file:')) {
				// e.g. an http: URI
				return [];
			}
			try {
				return [{ reference, filePath: url.fileURLToPath(reference.target) }];
			} catch {
				return [];
			}
		});
	}

	private static range(range: CatalogRange) {
		return new vscode.Range(range.startLine, range.startCharacter, range.endLine, range.endCharacter);
	}

	// links for the uri and nextCatalog entries - not for a rewriteURI's rewritePrefix, which is a folder
	public provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
		return (CatalogDocumentProvider.references(document) ?? [])
			.filter(({ reference }) => reference.attribute !== 'rewritePrefix')
			.map(({ reference, filePath }) => new vscode.DocumentLink(CatalogDocumentProvider.range(reference.range), vscode.Uri.file(filePath)));
	}

	// warnings for the files of uri and nextCatalog entries, and the folders of rewritePrefixes, that aren't found
	public static diagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
		return (CatalogDocumentProvider.references(document) ?? []).flatMap(({ reference, filePath }) => {
			const isFolder = reference.attribute === 'rewritePrefix';
			let found: boolean;
			try {
				const stats = fs.statSync(filePath);
				found = isFolder ? stats.isDirectory() : stats.isFile();
			} catch {
				found = false;
			}
			if (found) {
				return [];
			}
			const what = reference.attribute === 'catalog' ? 'catalog file' : isFolder ? 'folder' : 'file';
			const diagnostic = new vscode.Diagnostic(CatalogDocumentProvider.range(reference.range), `XML catalog: the ${what} of this ${reference.attribute} isn't found: ${filePath}`, vscode.DiagnosticSeverity.Warning);
			diagnostic.source = 'xml-catalog';
			return [diagnostic];
		});
	}

	public static update(document: vscode.TextDocument) {
		if (document.languageId !== 'xml' || document.uri.scheme !== 'file') {
			return;
		}
		const diagnostics = CatalogDocumentProvider.diagnostics(document);
		if (diagnostics.length > 0) {
			CatalogDocumentProvider.collection.set(document.uri, diagnostics);
		} else {
			CatalogDocumentProvider.collection.delete(document.uri);
		}
	}

	public static activate(context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'xml', scheme: 'file' }, new CatalogDocumentProvider()));
		context.subscriptions.push(CatalogDocumentProvider.collection);
		context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(CatalogDocumentProvider.update));
		context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => CatalogDocumentProvider.update(e.document)));
		context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(CatalogDocumentProvider.update));
		context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => CatalogDocumentProvider.collection.delete(document.uri)));
		vscode.workspace.textDocuments.forEach(CatalogDocumentProvider.update);
	}
}
