import { CancellationToken, MarkdownString, ParameterInformation, Position, ProviderResult, SignatureHelp, SignatureHelpProvider, SignatureInformation, TextDocument } from "vscode";
import { XPathFunctionDetails } from "./xpathFunctionDetails";
import { BaseToken, CharLevelState, ExitCondition, LexPosition, TokenLevelState, XPathLexer } from "./xpLexer";
import { DocumentTypes, GlobalInstructionType, LanguageConfiguration, XslLexer } from "./xslLexer";
import { XdocNotes } from "./xdocNote";

interface EnclosingCall {
	functionName: string;
	activeParameter: number;
	// XPath 4.0 keyword argument at the cursor, e.g. 'length' for subsequence($s, length := |
	keyword?: string;
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
		const signatureInfo = matchingData ? this.getSignatureInformation(matchingData.name, matchingData.signature, matchingData.description) :
			this.userFunctionSignature(document, enclosingCall.functionName);
		if (!signatureInfo) {
			return undefined;
		}
		const help = new SignatureHelp();
		help.signatures = [signatureInfo];
		help.activeSignature = 0;
		const paramCount = signatureInfo.parameters.length;
		const keywordIndex = enclosingCall.keyword ? signatureInfo.parameters.findIndex((p) => typeof p.label === 'string' && (p.label === '$' + enclosingCall.keyword || p.label.startsWith('$' + enclosingCall.keyword + ' '))) : -1;
		help.activeParameter = keywordIndex > -1 ? keywordIndex : paramCount === 0 ? 0 : Math.min(enclosingCall.activeParameter, paramCount - 1);
		return help;
	}

	// a user-defined function declared in this stylesheet, with the descriptions from its documentation note, if any -
	// an xsl:note with format="xdoc-md" - preferring the declaration with the most parameters
	private userFunctionSignature(document: TextDocument, fnName: string): SignatureInformation | undefined {
		const candidates = (this.xslLexer?.globalInstructionData ?? []).filter((g) => g.type === GlobalInstructionType.Function && g.name === fnName);
		if (candidates.length === 0) {
			return undefined;
		}
		const declaration = candidates.reduce((best, current) => current.idNumber > best.idNumber ? current : best);
		const text = document.getText();
		const tagStart = text.lastIndexOf('<', document.offsetAt(new Position(declaration.token.line, declaration.token.startCharacter)));
		const note = tagStart > -1 ? XdocNotes.forDeclaration(text, tagStart) : undefined;
		const paramLabels = (declaration.memberNames ?? []).map((name, i) => declaration.memberTypes?.[i] ? `$${name} as ${declaration.memberTypes[i]}` : `$${name}`);
		const signature = `${declaration.name}(${paramLabels.join(', ')})${declaration.returnType ? ' as ' + declaration.returnType : ''}`;
		const info = new SignatureInformation(signature, note ? new MarkdownString(XdocNotes.toMarkdown(note, false)) : undefined);
		info.parameters = paramLabels.map((label, i) => {
			const paramText = note ? XdocNotes.paramText(note, declaration.memberNames![i]) : undefined;
			return new ParameterInformation(label, paramText ? new MarkdownString(paramText) : undefined);
		});
		return info;
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
			return XPathFunctionDetails.xpathDataPlus40;
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
		let keyword: string | undefined;
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
						const call = t.charType === CharLevelState.lB ? XSLTSignatureHelpProvider.functionCall(tokens, i - 1, commaCount) : null;
						if (call && keyword) {
							call.keyword = keyword;
						}
						return call;
					}
					depth--;
					break;
				case CharLevelState.dSep:
					// cursor between the brackets of '()', '[]' or '{}'
					if (i === cursorIndex && t.line === position.line && t.startCharacter + 1 === position.character) {
						return t.value === '()' ? XSLTSignatureHelpProvider.functionCall(tokens, i - 1, 0) : null;
					}
					break;
				case CharLevelState.sep:
					if (depth === 0 && t.value === ',') {
						commaCount++;
					}
					break;
				case CharLevelState.lName:
					if (depth === 0 && commaCount === 0 && t.tokenType === TokenLevelState.mapKey && tokens[i + 1]?.value === ':=') {
						// keyword argument
						keyword = t.value;
					}
					break;
			}
		}
		return null;
	}

	private static functionCall(tokens: BaseToken[], nameIndex: number, commaCount: number): EnclosingCall | null {
		const nameToken = nameIndex > -1 ? tokens[nameIndex] : undefined;
		if (nameToken && nameToken.tokenType === TokenLevelState.function) {
			// with the arrow operators '=>' and '=!>' the first argument is supplied by the left-hand operand
			const arrowToken = nameIndex > 0 ? tokens[nameIndex - 1] : undefined;
			const isArrowCall = !!arrowToken && arrowToken.charType === CharLevelState.dSep && (arrowToken.value === '=>' || arrowToken.value === '=!>');
			return { functionName: nameToken.value, activeParameter: isArrowCall ? commaCount + 1 : commaCount };
		}
		return null;
	}
}
