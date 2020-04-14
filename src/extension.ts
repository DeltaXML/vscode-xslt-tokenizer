/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XPath/XSLT Lexer/Syntax Highlighter
 */
import * as vscode from 'vscode';
import {XPathLexer, ExitCondition, LexPosition, BaseToken} from './xpLexer';
import {XslLexer} from './xslLexer';
import {XMLDocumentFormattingProvider} from './xmlDocumentFormattingProvider'
import {SaxonTaskProvider} from './saxonTaskProvider';
import {XSLTConfiguration, XMLConfiguration} from './languageConfigurations';
import {XsltTokenDiagnostics} from './xsltTokenDiagnostics';

const tokenModifiers = new Map<string, number>();

const legend = (function () {
	const tokenTypesLegend = XslLexer.getTextmateTypeLegend();

	const tokenModifiersLegend = [
		'declaration', 'documentation', 'member', 'static', 'abstract', 'deprecated',
		'modification', 'async'
	];
	tokenModifiersLegend.forEach((tokenModifier, index) => tokenModifiers.set(tokenModifier, index));

	return new vscode.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
})();

let customTaskProvider: vscode.Disposable | undefined;


export function activate(context: vscode.ExtensionContext) {

	const collection = vscode.languages.createDiagnosticCollection('xslt');
	let diagnosticsListener = (document: vscode.TextDocument, allTokens: BaseToken[]) => {
		let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(document, allTokens);
		if (diagnostics.length > 0) {
			collection.set(document.uri, diagnostics);
		} else {
			collection.clear();
		}

	}

	// syntax highlighters
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xslt'}, new XsltSemanticTokensProvider(diagnosticsListener), legend));
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xpath'}, new XPathSemanticTokensProvider(), legend));
	// formatter
	let xsltFormatter = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration);
	let xmlFormatter = new XMLDocumentFormattingProvider(XMLConfiguration.configuration);


	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xslt', 
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xslt', 
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xslt', 
		xsltFormatter, '\n'));

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xml', 
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xml', 
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xml', 
		xmlFormatter, '\n'));

	let workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}
	customTaskProvider = vscode.tasks.registerTaskProvider(SaxonTaskProvider.SaxonBuildScriptType, new SaxonTaskProvider(workspaceRoot));

	// context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(e => {
	// 	console.log('onDidOpenTextDocument: ' + e.fileName);

	// }));
}

class XPathSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	private xpLexer = new XPathLexer();

	constructor() {
		this.xpLexer.flatten = true;
	}

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const lexPosition: LexPosition = {line: 0, startCharacter: 0, documentOffset: 0};
		this.xpLexer.documentTokens = [];
		const allTokens = this.xpLexer.analyse(document.getText(), ExitCondition.None, lexPosition);
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		builder
		return builder.build();
	}
}

export class XsltSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {

	private xslLexer: XslLexer;
	private callback: (document: vscode.TextDocument, tokens: BaseToken[]) => void

	public constructor(callback: (document: vscode.TextDocument, tokens: BaseToken[]) => void) {
		this.callback = callback;
		this.xslLexer = new XslLexer(XSLTConfiguration.configuration);
		this.xslLexer.provideCharLevelState = true;
	}

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const allTokens = this.xslLexer.analyse(document.getText());
		// delay callback to allow rendering of semantic tokens first:
		setTimeout(() => {
			this.callback(document, allTokens);
		}, 5);
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		return builder.build();
	}
}
