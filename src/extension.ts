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
import { XPathLexer, ExitCondition, LexPosition, Token } from './xpLexer';
import { XMLDocumentFormattingProvider } from './xmlDocumentFormattingProvider';
import { SaxonTaskProvider } from './saxonTaskProvider';
import { SaxonJsTaskProvider } from './saxonJsTaskProvider';
import { XSLTConfiguration, XPathConfiguration, XMLConfiguration, XSLTLightConfiguration, DCPConfiguration } from './languageConfigurations';
import { XsltSymbolProvider } from './xsltSymbolProvider';
import { XslLexer, LanguageConfiguration, DocumentTypes } from './xslLexer';
import { DocumentChangeHandler } from './documentChangeHandler';
import { on } from 'process';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { DocumentLinkProvider } from './documentLinkProvider';
import { FullDocumentLinkProvider } from './fullDocumentLinkProvider';

import { DCPSymbolProvider } from './dcpSymbolProvider';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';


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

export function activate(context: vscode.ExtensionContext) {
	const xsltDiagnosticsCollection = vscode.languages.createDiagnosticCollection('xslt');
	const xsltSymbolProvider = new XsltSymbolProvider(XSLTConfiguration.configuration, xsltDiagnosticsCollection);
	const dcpDiagnosticsCollection = vscode.languages.createDiagnosticCollection('dcp');
	const dcpSymbolProvider = new DCPSymbolProvider(DCPConfiguration.configuration, dcpDiagnosticsCollection);
	const dcpDefintiionProvider = new XsltDefinitionProvider(DCPConfiguration.configuration);
	const xmlDefinitionProvider = new XsltDefinitionProvider(XMLConfiguration.configuration);


	const xsltDefintiionProvider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
	const xsltLinkProvider = new DocumentLinkProvider(XSLTLightConfiguration.configuration);
	const dcpLinkProvider = new FullDocumentLinkProvider(DCPConfiguration.configuration);

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

	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'xslt' }, xsltSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'dcp' }, dcpSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: 'xml' }, xmlSymbolProvider));
	context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: 'xslt' }, xsltDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xslt' }, xsltDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'dcp' }, dcpDefintiionProvider));
	context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xml' }, xmlDefinitionProvider));
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'xslt' }, xsltLinkProvider));
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: 'dcp' }, dcpLinkProvider));


	// syntax highlighters
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xslt' }, new XsltSemanticTokensProvider(XSLTConfiguration.configuration), legend));
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'dcp' }, new XsltSemanticTokensProvider(DCPConfiguration.configuration), legend));
	const xpathDiagnosticsCollection = vscode.languages.createDiagnosticCollection('xpath');
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xpath' }, new XPathSemanticTokensProvider(xpathDiagnosticsCollection), legend));
	// formatter
	let xsltFormatter = new XMLDocumentFormattingProvider(XSLTConfiguration.configuration);
	let xmlFormatter = new XMLDocumentFormattingProvider(XMLConfiguration.configuration);
	let dcpFormatter = new XMLDocumentFormattingProvider(DCPConfiguration.configuration);

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(['xslt', 'xpath'],
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider(['xslt', 'xpath'],
		xsltFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider(['xslt', 'xpath'],
		xsltFormatter, '\n', '/'));

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('xml',
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('xml',
		xmlFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('xml',
		xmlFormatter, '\n', '/'));

	context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('dcp',
		dcpFormatter));
	context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider('dcp',
		dcpFormatter));
	context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider('dcp',
		dcpFormatter, '\n', '/'));

	let workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}

	let xsltTaskEnabled = vscode.workspace.getConfiguration('XSLT.tasks.java').get('enabled');
	if (xsltTaskEnabled) {
		let xsltTaskProvider = vscode.tasks.registerTaskProvider(SaxonTaskProvider.SaxonBuildScriptType, new SaxonTaskProvider(workspaceRoot));
		context.subscriptions.push(xsltTaskProvider);
	}

	let xsltJsTaskEnabled = vscode.workspace.getConfiguration('XSLT.tasks.js').get('enabled');
	if (xsltJsTaskEnabled) {
		let xsltjsTaskProvider = vscode.tasks.registerTaskProvider(SaxonJsTaskProvider.SaxonBuildScriptType, new SaxonJsTaskProvider(workspaceRoot));
		context.subscriptions.push(xsltjsTaskProvider);
	}

}

class XPathSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	private xpLexer = new XPathLexer();
	private collection: vscode.DiagnosticCollection;
	public constructor(collection: vscode.DiagnosticCollection) {
		this.collection = collection;
	}

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		this.xpLexer.documentTokens = [];
		const allTokens = this.xpLexer.analyse(document.getText(), ExitCondition.None, lexPosition);
		setTimeout(() => this.reportProblems(allTokens, document), 0);
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		return builder.build();
	}

	private reportProblems(allTokens: Token[], document: vscode.TextDocument) {
		let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XPathConfiguration.configuration, DocumentTypes.XPath, document, allTokens, [], [], []);
		if (diagnostics.length > 0) {
			this.collection.set(document.uri, diagnostics);
		} else {
			this.collection.clear();
		};
	}
}

export class XsltSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {

	private xslLexer: XslLexer;

	public constructor(languageConfig: LanguageConfiguration) {
		this.xslLexer = new XslLexer(languageConfig);
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
