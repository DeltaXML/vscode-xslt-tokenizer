import { CancellationToken, MarkdownString, ParameterInformation, Position, ProviderResult, SignatureHelp, SignatureHelpProvider, SignatureInformation, TextDocument } from "vscode";
import { XPathFunctionDetails } from "./xpathFunctionDetails";
import { BaseToken, CharLevelState, ExitCondition, LexPosition, TokenLevelState, XPathLexer } from "./xpLexer";
import { DocumentTypes, LanguageConfiguration, XslLexer } from "./xslLexer";

interface EnclosingCall {
	functionName: string;
	activeParameter: number;
}

export class XSLTSignatureHelpProvider implements SignatureHelpProvider {

	private signatureCache = new Map<string, SignatureInformation>();
	private static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	private readonly isXPath: boolean;
	private readonly xslLexer: XslLexer | undefined;

	constructor(languageConfiguration: LanguageConfiguration) {
		this.isXPath = languageConfiguration.docType === DocumentTypes.XPath;
		if (!this.isXPath) {
			this.xslLexer = new XslLexer(languageConfiguration);
			// no need for charLevelState as we're only interested in xpath charType which is always kept
			this.xslLexer.provideCharLevelState = false;
		}
	}

	provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<SignatureHelp> {
		const tokens = this.getTokens(document);
		const enclosingCall = XSLTSignatureHelpProvider.findEnclosingCall(tokens, position);
		if (!enclosingCall) {
			return undefined;
		}

		let fnName = enclosingCall.functionName;
		fnName = fnName.startsWith('fn:') ? fnName.substring(3) : fnName;

		const matchingData = this.getFunctionData().find((item) => item.name === fnName);
		if (!matchingData) {
			return undefined;
		}

		const signatureInfo = this.getSignatureInformation(matchingData.name, matchingData.signature, matchingData.description);
		const help = new SignatureHelp();
		help.signatures = [signatureInfo];
		help.activeSignature = 0;
		const paramCount = signatureInfo.parameters.length;
		help.activeParameter = paramCount === 0 ? 0 : Math.min(enclosingCall.activeParameter, paramCount - 1);
		return help;
	}

	private getSignatureInformation(name: string, signature: string, description: string): SignatureInformation {
		// keyed by signature, as the XPath 3.1 and 4.0 function lists may have different signatures for the same name
		const cached = this.signatureCache.get(signature);
		if (cached) {
			return cached;
		}

		const info = new SignatureInformation(signature, new MarkdownString(description));
		const openParenIndex = signature.indexOf('(');

		if (openParenIndex > -1) {
			let depth = 0;
			let closeParenIndex = -1;
			for (let i = openParenIndex; i < signature.length; i++) {
				const ch = signature[i];
				if (ch === '(') {
					depth++;
				} else if (ch === ')') {
					depth--;
					if (depth === 0) {
						closeParenIndex = i;
						break;
					}
				}
			}

			if (closeParenIndex > -1) {
				const paramsText = signature.substring(openParenIndex + 1, closeParenIndex).trim();
				if (paramsText.length > 0) {
					const paramLabels = this.splitTopLevelParams(paramsText);
					info.parameters = paramLabels.map((label) => new ParameterInformation(label));
				}
			}
		}

		this.signatureCache.set(signature, info);
		return info;
	}

	private splitTopLevelParams(paramsText: string): string[] {
		const params: string[] = [];
		let depth = 0;
		let start = 0;

		for (let i = 0; i < paramsText.length; i++) {
			const ch = paramsText[i];
			if (ch === '(' || ch === '[' || ch === '{') {
				depth++;
			} else if (ch === ')' || ch === ']' || ch === '}') {
				depth--;
			} else if (ch === ',' && depth === 0) {
				params.push(paramsText.substring(start, i).trim());
				start = i + 1;
			}
		}
		params.push(paramsText.substring(start).trim());
		return params;
	}

	// call after getTokens(), which sets the lexer's isXSLT40 property
	private getFunctionData() {
		if (this.isXPath) {
			return XPathFunctionDetails.xpathData;
		}
		return this.xslLexer!.isXSLT40 ? XPathFunctionDetails.dataPlusIxslPlus40 : XPathFunctionDetails.dataPlusIxsl;
	}

	private getTokens(document: TextDocument): BaseToken[] {
		if (this.isXPath) {
			const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
			return new XPathLexer().analyse(document.getText(), ExitCondition.None, lexPosition);
		}
		return this.xslLexer!.analyse(document.getText());
	}

	// walk back through the XPath tokens preceding the cursor: string literals, string template fixed
	// parts and comments are single tokens, so any ',' within them is never counted as a separator
	public static findEnclosingCall(tokens: BaseToken[], position: Position): EnclosingCall | null {
		let cursorIndex = -1;
		for (let i = tokens.length - 1; i > -1; i--) {
			const t = tokens[i];
			if (t.line < position.line || (t.line === position.line && t.startCharacter < position.character)) {
				cursorIndex = i;
				break;
			}
		}

		let depth = 0;
		let commaCount = 0;
		for (let i = cursorIndex; i > -1; i--) {
			const t = tokens[i];
			if (t.tokenType >= XSLTSignatureHelpProvider.xsltStartTokenNumber) {
				// an XML token marks the start of the XPath expression
				return null;
			}
			switch (t.charType) {
				case CharLevelState.rB:
				case CharLevelState.rPr:
				case CharLevelState.rBr:
					depth++;
					break;
				case CharLevelState.lB:
				case CharLevelState.lPr:
				case CharLevelState.lBr:
					if (depth === 0) {
						return t.charType === CharLevelState.lB ? XSLTSignatureHelpProvider.functionCall(tokens[i - 1], commaCount) : null;
					}
					depth--;
					break;
				case CharLevelState.dSep:
					// cursor between the brackets of '()', '[]' or '{}'
					if (i === cursorIndex && t.line === position.line && t.startCharacter + 1 === position.character) {
						return t.value === '()' ? XSLTSignatureHelpProvider.functionCall(tokens[i - 1], 0) : null;
					}
					break;
				case CharLevelState.sep:
					if (depth === 0 && t.value === ',') {
						commaCount++;
					}
					break;
			}
		}
		return null;
	}

	private static functionCall(nameToken: BaseToken | undefined, activeParameter: number): EnclosingCall | null {
		if (nameToken && nameToken.tokenType === TokenLevelState.function) {
			return { functionName: nameToken.value, activeParameter };
		}
		return null;
	}
}
