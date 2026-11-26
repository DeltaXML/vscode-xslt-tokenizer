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
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';

// hover over a key of a built-in function's options map, e.g. 'liberal' in parse-json($json, map { 'liberal': true() }), or
// over a system-property() name, e.g. 'xsl:version' - from those the linter found when it last checked the document
export class FunctionOptionsHover {
	private static readonly languages = ['xslt', 'xpath', 'xspec', 'sch'];

	public static activate(context: vscode.ExtensionContext) {
		const selector = FunctionOptionsHover.languages.map((language) => ({ language }));
		context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
			provideHover: (document, position) => FunctionOptionsHover.hover(document, position)
		}));
	}

	public static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const references = XsltTokenDiagnostics.optionReferences.get(document.uri.toString()) ?? [];
		const reference = references.find((r) => r.token.line === position.line && r.token.startCharacter <= position.character &&
			position.character < r.token.startCharacter + r.token.length);
		if (!reference) {
			return undefined;
		}
		const { token } = reference;
		return new vscode.Hover(new vscode.MarkdownString(reference.markdown), new vscode.Range(token.line, token.startCharacter, token.line, token.startCharacter + token.length));
	}
}
