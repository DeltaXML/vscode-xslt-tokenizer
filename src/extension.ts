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
	let diagnosticsListener: (param: BaseToken[]) => void = (baseTokens: BaseToken[]) => {
		console.log(baseTokens.length);
	}

	// syntax highlighters
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xslt'}, new XsltSemanticTokensProvider(diagnosticsListener), legend));
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xpath'}, new XPathSemanticTokensProvider(), legend));
	// formatter
	let xsltFormatter = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration);
	let xsltFormatterOnType = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration);
	xsltFormatterOnType.provideOnType = true;

	let xmlFormatter = new XMLDocumentFormattingProvider(XMLConfiguration.configuration);
	let xmlFormatterOnType = new XMLDocumentFormattingProvider(XMLConfiguration.configuration);
	xmlFormatterOnType.provideOnType = true;


	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xslt', 
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xslt', 
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xslt', 
		xsltFormatterOnType, '\n'));

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xml', 
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xml', 
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xml', 
		xmlFormatterOnType, '\n'));

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

	public diagnosticsListener: (param: BaseToken[]) => void;
	private xslLexer: XslLexer;
	private allTokens: BaseToken[] = [];

	public constructor(callback: (param: BaseToken[]) => void) {
		this.diagnosticsListener = callback;
		this.xslLexer = new XslLexer(XSLTConfiguration.configuration, this.diagnosticsListener);
	}


	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		//console.log('xslt: provideDocumentSemanticTokens: ' + document.fileName);

		this.allTokens = this.xslLexer.analyse(document.getText());
		const builder = new vscode.SemanticTokensBuilder();
		this.allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		//console.log('return tokens count: ' + allTokens.length);
		return builder.build();
	}
}
