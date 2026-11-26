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

export const redHatXmlId = 'redhat.vscode-xml';
// the source of the diagnostics of Red Hat's XML extension
const redHatSource = 'xml';

export type RedHatXmlResult =
	| { status: 'validated', problems: vscode.Diagnostic[], noGrammar: boolean, waitedForNone: boolean }
	| { status: 'not-installed' | 'disabled' | 'stale' };

// Red Hat's XML extension (redhat.vscode-xml): it validates the XML documents VS Code has open - also one opened without
// an editor, e.g. with openTextDocument - against their schema or DTD, and reports their well-formedness problems
export class RedHatXml {

	// it's installed, with validation on
	public static validates() {
		return !!vscode.extensions.getExtension(redHatXmlId) && vscode.workspace.getConfiguration('xml.validation').get<boolean>('enabled', true);
	}

	// its problems for an XML file, once it has validated the text: diskText, the file's text as it is on disk - or, when
	// the file has unsaved edits in an editor, as it is there. VS Code reloads a document from disk only in a workspace
	// folder: for a file outside, changed since it was opened, the problems would be for the old text, so it's 'stale'.
	// There's no event for a validation with no problems: with none reported within quietMs, there are none
	public static async problems(uri: vscode.Uri, diskText: string, quietMs = 1500, coldStartMs = 8000): Promise<RedHatXmlResult> {
		const extension = vscode.extensions.getExtension(redHatXmlId);
		if (!extension) {
			return { status: 'not-installed' };
		}
		if (!RedHatXml.validates()) {
			return { status: 'disabled' };
		}
		const wasActive = extension.isActive;
		const start = Date.now();
		// opening the document is what makes it validate it - and activates the extension, the first time
		const document = await vscode.workspace.openTextDocument(uri);
		const lines = (value: string) => value.replace(/\r\n?/g, '\n');
		// a change on disk is reloaded in a moment, for a file in a workspace folder
		const inSync = () => document.isDirty || lines(document.getText()) === lines(diskText);
		if (!await RedHatXml.waitFor(inSync, 1000)) {
			return { status: 'stale' };
		}
		const found = () => vscode.languages.getDiagnostics(uri).filter((d) => d.source === redHatSource);
		let lastChange = Date.now();
		const listener = vscode.languages.onDidChangeDiagnostics((e) => {
			if (e.uris.some((u) => u.toString() === uri.toString())) {
				lastChange = Date.now();
			}
		});
		try {
			// the first validation, after the extension starts, takes longer
			const limit = wasActive ? quietMs : coldStartMs;
			// problems reported - settled for a moment, in case more come - or none in the time
			await RedHatXml.waitFor(() => (found().length > 0 && Date.now() - lastChange > 300) || Date.now() - start > limit, limit + 1000);
		} finally {
			listener.dispose();
		}
		const all = found();
		// its hint for a file with no schema or DTD: said once, not as a problem
		const isNoGrammar = (d: vscode.Diagnostic) => d.severity === vscode.DiagnosticSeverity.Hint && /^No grammar constraints/.test(d.message);
		return { status: 'validated', problems: all.filter((d) => !isNoGrammar(d)), noGrammar: all.some(isNoGrammar), waitedForNone: all.length === 0 };
	}

	private static async waitFor(condition: () => boolean, timeoutMs: number) {
		const start = Date.now();
		while (!condition()) {
			if (Date.now() - start > timeoutMs) {
				return false;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return true;
	}
}
