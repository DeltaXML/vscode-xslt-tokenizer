import { CancellationToken, MarkdownString, ParameterInformation, Position, ProviderResult, SignatureHelp, SignatureHelpProvider, SignatureInformation, TextDocument } from "vscode";
import { XPathFunctionDetails } from "./xpathFunctionDetails";
import { BaseToken, CharLevelState, ExitCondition, LexPosition, TokenLevelState, XPathLexer } from "./xpLexer";
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, LanguageConfiguration, XslLexer } from "./xslLexer";
import { XsltDefinitionProvider } from "./xsltDefinitionProvider";
import { RecordTypes } from "./recordTypes";
import { XdocNotes } from "./xdocNote";
import { declarationParamLabels } from "./declarationParams";

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

	// for the global instruction data of imported modules
	constructor(languageConfiguration: LanguageConfiguration, private definitionProvider?: XsltDefinitionProvider) {
		this.isXPath = languageConfiguration.docType === DocumentTypes.XPath;
		if (!this.isXPath) {
			this.xslLexer = new XslLexer(languageConfiguration);
			// no need for charLevelState as we're only interested in xpath charType which is always kept
			this.xslLexer.provideCharLevelState = false;
		}
	}

	async provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp | undefined> {
		const tokens = this.getTokens(document);
		// the declarations in this stylesheet, captured before any await, as the lexer is shared
		const localGlobals = this.xslLexer ? this.xslLexer.globalInstructionData.slice() : [];
		const enclosingCall = XSLTSignatureHelpProvider.findEnclosingCall(tokens, position);
		if (!enclosingCall) {
			// a named template, for an xsl:call-template at the position
			return this.isXPath ? undefined : this.templateSignatureHelp(document, position, localGlobals, token);
		}

		let fnName = enclosingCall.functionName;
		fnName = fnName.startsWith('fn:') ? fnName.substring(3) : fnName;

		const matchingData = this.getFunctionData().find((item) => item.name === fnName);
		const signatureInfo = matchingData ? this.getSignatureInformation(matchingData.name, matchingData.signature, matchingData.description) :
			this.userFunctionSignature(document, enclosingCall.functionName, await this.allGlobals(document, localGlobals, token));
		if (!signatureInfo || token.isCancellationRequested) {
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

	// the declarations in this stylesheet and in the modules it imports or includes
	private async allGlobals(document: TextDocument, localGlobals: GlobalInstructionData[], token: CancellationToken): Promise<GlobalInstructionData[]> {
		if (!this.definitionProvider) {
			return localGlobals;
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { globalInstructionData, allImportedGlobals } = await this.definitionProvider.getImportedGlobals(document, lexPosition);
		return token.isCancellationRequested ? localGlobals : globalInstructionData.concat(allImportedGlobals);
	}

	// a user-defined function, declared in this stylesheet or an imported module, with the descriptions from its
	// documentation note, if any - an xsl:note with format="xdoc-md" - preferring the declaration with the most parameters
	private userFunctionSignature(document: TextDocument, fnName: string, globals: GlobalInstructionData[]): SignatureInformation | undefined {
		const candidates = globals.filter((g) => g.type === GlobalInstructionType.Function && g.name === fnName);
		if (candidates.length === 0) {
			return undefined;
		}
		const declaration = candidates.reduce((best, current) => current.idNumber > best.idNumber ? current : best);
		const signature = (paramList: string) => `${declaration.name}(${paramList})${declaration.returnType ? ' as ' + declaration.returnType : ''}`;
		return XSLTSignatureHelpProvider.declarationSignature(document, declaration, signature);
	}

	// the signature for a function or template declaration, with the descriptions from its documentation note, if any
	private static declarationSignature(document: TextDocument, declaration: GlobalInstructionData, signature: (paramList: string) => string): SignatureInformation {
		const note = XdocNotes.forGlobal(declaration, document.getText());
		// with the defaults of optional parameters, e.g. $scale as xs:double := 1
		const paramLabels = declarationParamLabels(declaration, document.getText());
		const info = new SignatureInformation(signature(paramLabels.join(', ')), note ? new MarkdownString(XdocNotes.toMarkdown(note, false)) : undefined);
		info.parameters = paramLabels.map((label, i) => {
			const paramText = note ? XdocNotes.paramText(note, declaration.memberNames![i]) : undefined;
			return new ParameterInformation(label, paramText ? new MarkdownString(paramText) : undefined);
		});
		return info;
	}

	// for a position within an xsl:call-template - its start tag, its content, or an xsl:with-param within it - the called
	// template's signature: the active parameter is the one for the xsl:with-param at the position, or otherwise the first
	// that no xsl:with-param sets
	private async templateSignatureHelp(document: TextDocument, position: Position, localGlobals: GlobalInstructionData[], token: CancellationToken): Promise<SignatureHelp | undefined> {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const tagStart = offset > 0 ? text.lastIndexOf('<', offset - 1) : -1;
		// within a start tag, if the tag isn't closed before the position
		const tagEnd = tagStart > -1 ? text.indexOf('>', tagStart) : -1;
		const isInTag = tagStart > -1 && (tagEnd === -1 || tagEnd >= offset) && text.charAt(tagStart + 1) !== '/';
		const tagName = isInTag ? /^<([\w.:-]+)/.exec(text.substring(tagStart, tagStart + 30))?.[1] : undefined;
		const contextOffset = isInTag ? tagStart : offset;
		const ancestors = RecordTypes.openElements(RecordTypes.blankMarkup(text.substring(0, contextOffset)), contextOffset);
		const parent = ancestors[ancestors.length - 1];
		let callTemplate: number | undefined;
		let withParam: number | undefined;
		if (tagName === 'xsl:call-template') {
			callTemplate = tagStart;
		} else if (tagName === 'xsl:with-param' && parent?.name === 'xsl:call-template') {
			callTemplate = parent.offset;
			withParam = tagStart;
		} else if (!isInTag && parent?.name === 'xsl:call-template') {
			callTemplate = parent.offset;
		} else if (!isInTag && parent?.name === 'xsl:with-param' && ancestors[ancestors.length - 2]?.name === 'xsl:call-template') {
			callTemplate = ancestors[ancestors.length - 2].offset;
			withParam = parent.offset;
		}
		const templateName = callTemplate !== undefined ? RecordTypes.attributeOfElementAt(text, callTemplate + 1, 'name') : undefined;
		if (callTemplate === undefined || !templateName) {
			return undefined;
		}
		const globals = await this.allGlobals(document, localGlobals, token);
		const template = globals.find((g) => g.type === GlobalInstructionType.Template && g.name === templateName);
		if (!template || token.isCancellationRequested) {
			return undefined;
		}
		const info = XSLTSignatureHelpProvider.declarationSignature(document, template, (paramList) => `template ${templateName}(${paramList})`);
		const paramNames = template.memberNames ?? [];
		const withParamName = withParam !== undefined ? RecordTypes.attributeOfElementAt(text, withParam + 1, 'name') : undefined;
		const passed = RecordTypes.childElements(text, RecordTypes.blankMarkup(text), callTemplate, 'xsl:with-param').map((offset) => RecordTypes.attributeOfElementAt(text, offset + 1, 'name'));
		const withParamIndex = withParamName ? paramNames.indexOf(withParamName) : -1;
		const help = new SignatureHelp();
		help.signatures = [info];
		help.activeSignature = 0;
		help.activeParameter = withParamIndex > -1 ? withParamIndex : Math.max(0, paramNames.findIndex((name) => !passed.includes(name)));
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
