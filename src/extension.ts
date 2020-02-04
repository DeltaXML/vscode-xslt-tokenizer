import * as vscode from 'vscode';
import {Token, XPathLexer, ExitCondition, LexPosition} from "./xpLexer";
import {XslLexer} from "./xslLexer";

const tokenTypes = new Map<string, number>();
const tokenModifiers = new Map<string, number>();

const legend = (function () {
	const tokenTypesLegend = XPathLexer.getTextmateTypeLegend();

	const tokenModifiersLegend = [
		'declaration', 'documentation', 'member', 'static', 'abstract', 'deprecated',
		'modification', 'async'
	];
	tokenModifiersLegend.forEach((tokenModifier, index) => tokenModifiers.set(tokenModifier, index));

	return new vscode.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
})();

export function activate(context: vscode.ExtensionContext) {
	// context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xpath'}, new XPathSemanticTokensProvider(), legend));
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xsl'}, new XsltSemanticTokensProvider(), legend));
}

class XPathSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	private xpLexer = new XPathLexer();

	constructor() {
		this.xpLexer.flatten = true;
	}

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const lexPosition: LexPosition = {line: 0, startCharacter: 0, documentOffset: 0};
		const allTokens = this.xpLexer.analyse(document.getText(), ExitCondition.None, lexPosition);
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		return new vscode.SemanticTokens(builder.build());
	}

	private _encodeTokenType(tokenType: string): number {
		if (!tokenTypes.has(tokenType)) {
			return 0;
		}
		return tokenTypes.get(tokenType)!;
	}

	private _encodeTokenModifiers(strTokenModifiers: string[]): number {
		let result = 0;
		for (let i = 0; i < strTokenModifiers.length; i++) {
			const tokenModifier = strTokenModifiers[i];
			if (tokenModifiers.has(tokenModifier)) {
				result = result | (1 << tokenModifiers.get(tokenModifier)!);
			}
		}
		return result;
	}
}

class XsltSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	private xslLexer = new XslLexer();

	async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const allTokens = this.xslLexer.analyse(document.getText());
		const builder = new vscode.SemanticTokensBuilder();
		allTokens.forEach((token) => {
			builder.push(token.line, token.startCharacter, token.length, token.tokenType, 0);
		});
		return new vscode.SemanticTokens(builder.build());
	}
}
