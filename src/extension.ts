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
import {XPathLexer, ExitCondition, LexPosition} from './xpLexer';
import {XMLDocumentFormattingProvider} from './xmlDocumentFormattingProvider';
import {SaxonTaskProvider} from './saxonTaskProvider';
import {XSLTConfiguration, XMLConfiguration, XSLTLightConfiguration} from './languageConfigurations';
import { XsltSymbolProvider } from './xsltSymbolProvider';
import { XslLexer } from './xslLexer';
import {DocumentChangeHandler} from './documentChangeHandler'
import { on } from 'process';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { DocumentLinkProvider } from './documentLinkProvider';


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
	const xsltDiagnosticsCollection = vscode.languages.createDiagnosticCollection('xslt');
	const xsltSymbolProvider = new XsltSymbolProvider(XSLTConfiguration.configuration, xsltDiagnosticsCollection);
	const xsltDefintiionProvider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	const xsltLinkProvider = new DocumentLinkProvider(XSLTLightConfiguration.configuration);

	const xmlDiagnosticsCollection = vscode.languages.createDiagnosticCollection('xml');
	const xmlSymbolProvider = new XsltSymbolProvider(XMLConfiguration.configuration, xmlDiagnosticsCollection);
	const docChangeHandler = new DocumentChangeHandler();
	let activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		docChangeHandler.registerXMLEditor(activeEditor);
	}

	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		docChangeHandler.registerXMLEditor(editor);
	}));

	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'xslt'}, xsltSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'xml'}, xmlSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'xslt'}, xsltDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xslt'}, xsltDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'xslt'}, xsltLinkProvider));

	// syntax highlighters
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xslt'}, new XsltSemanticTokensProvider(), legend));
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xpath'}, new XPathSemanticTokensProvider(), legend));
	// formatter
	let xsltFormatter = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration);
	let xmlFormatter = new XMLDocumentFormattingProvider(XMLConfiguration.configuration);


	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xslt', 
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xslt', 
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xslt', 
		xsltFormatter, '\n', '/'));

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xml', 
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xml', 
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xml', 
		xmlFormatter, '\n', '/'));

	let workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}
	customTaskProvider = vscode.tasks.registerTaskProvider(SaxonTaskProvider.SaxonBuildScriptType, new SaxonTaskProvider(workspaceRoot));

}


class XPathSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	private xpLexer = new XPathLexer();

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const lexPosition: LexPosition = {line: 0, startCharacter: 0, documentOffset: 0};
		this.xpLexer.documentTokens = [];
		const allTokens = this.xpLexer.analyse(document.getText(), ExitCondition.None, lexPosition);
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		return builder.build();
	}
}

export class XsltSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {

	private xslLexer: XslLexer;

	public constructor() {
		this.xslLexer = new XslLexer(XSLTConfiguration.configuration);
		this.xslLexer.provideCharLevelState = true;
	}

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		// console.log('provideDocumentSemanticTokens');
		const allTokens = this.xslLexer.analyse(document.getText());
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		return builder.build();
	}
}
