import * as vscode from 'vscode';
import {Token, XPathLexer} from "./xpLexer";

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
	context.subscriptions.push(vscode.languages.registerSemanticTokensProvider({ language: 'semanticLanguage'}, new SemanticTokensProvider(), legend));
}

class SemanticTokensProvider implements vscode.SemanticTokensProvider {
	private xpLexer = new XPathLexer();

	async provideSemanticTokens(document: vscode.TextDocument, options: vscode.SemanticTokensRequestOptions, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
		const allTokens = this.xpLexer.analyse(document.getText());
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
