/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xmlDocumentFormattingProvider
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, LanguageConfiguration} from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken } from './xpLexer';

enum HasCharacteristic {
	unknown,
	yes,
	no
}

export class TokenDiagnostics {

	private static xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();


	public static calculateDiagnostics = (document: vscode.TextDocument, allTokens: BaseToken[]): boolean => {
		let result: vscode.TextEdit[] = [];

		let lineNumber = -1;
		let prevLineNumber = -1;

		let tokenIndex = -1;

		let xmlSpacePreserveStack: boolean[] = [];
		let complexStateStack: [number, number[]][] = [];
		let isXSLTStartTag = false;
		let preThen = false;
		let documenthasNewLines: HasCharacteristic = HasCharacteristic.unknown;
		let prevToken: BaseToken|null = null;

		allTokens.forEach((token) => {
			let stackLength = xmlSpacePreserveStack.length;

			tokenIndex++;
			lineNumber = token.line;

			let isXMLToken = token.tokenType >= TokenDiagnostics.xsltStartTokenNumber;
			if (isXMLToken) {
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - TokenDiagnostics.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						complexStateStack = [[0, []]];
						isXSLTStartTag = true;
						let elementName = TokenDiagnostics.getTextForToken(lineNumber, token, document);
						break;
					case XSLTokenLevelState.elementName:
						complexStateStack = [[0, []]];
						isXSLTStartTag = false;
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:

								break;
							case XMLCharState.rStNoAtt:
								let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
								xmlSpacePreserveStack.push(preserveSpace);
								break;
							case XMLCharState.rSt:
								let preserveSpaceAtt = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
								xmlSpacePreserveStack.push(preserveSpaceAtt);

								break;
							case XMLCharState.lCt:

								break;
							case XMLCharState.rSelfCtNoAtt:
							case XMLCharState.rSelfCt:

								break;
							case XMLCharState.rCt:

								break;
						}
						break;
					case XSLTokenLevelState.attributeName:
						const attNameLine = document.lineAt(lineNumber);
						let attNameText = TokenDiagnostics.getTextForToken(lineNumber, token, document);

						break;
					case XSLTokenLevelState.attributeValue:
						const attValueLine = document.lineAt(lineNumber);
						let attValueText = TokenDiagnostics.getTextForToken(lineNumber, token, document);
						break;
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;
				let currentStateLevel: [number, number[]] = complexStateStack.length > 0? complexStateStack[complexStateStack.length - 1] : [0, []];
				let bracketNesting: number = currentStateLevel[0];
				let ifElseStack: number[] = currentStateLevel[1];
				let ifElseStackLength = ifElseStack.length;

				switch (xpathTokenType) {
					case TokenLevelState.complexExpression:
						let valueText = TokenDiagnostics.getTextForToken(lineNumber, token, document);
						switch (valueText) {
							case 'if':
								preThen = true;
								break;
							case 'every':
							case 'for':
							case 'let':
							case 'some':
								// no-break;
							case 'then':
								preThen = false;
								ifElseStack.push(1);
								break;
							case 'return':
							case 'satisfies':
							case 'else':
								if (ifElseStack.length > 0) {
									ifElseStack.pop();
								}
								break;
						}
						break;
					case TokenLevelState.operator:
						switch (xpathCharType) {
							case CharLevelState.lB:
							case CharLevelState.lPr:
							case CharLevelState.lBr:	
								complexStateStack.push([0, []]);							
								break;
							case CharLevelState.rB:
							case CharLevelState.rPr:
							case CharLevelState.rBr:
								if (complexStateStack.length > 0) {
									complexStateStack.pop();
								} else {
								}
								break;
							case CharLevelState.dSep:
								let valueText = TokenDiagnostics.getTextForToken(lineNumber, token, document);
								if (valueText === ':=') {

								}
								break;
						}
						break;
				}
			}
			prevLineNumber = lineNumber;
			prevToken = token;
		});
		return true;
	}

	private static getTextForToken(lineNumber: number, token: BaseToken, document: vscode.TextDocument) {
		let startPos = new vscode.Position(lineNumber, token.startCharacter);
		let endPos = new vscode.Position(lineNumber, token.startCharacter + token.length);
		const currentLine = document.lineAt(lineNumber);
		let valueRange = currentLine.range.with(startPos, endPos);
		let valueText = document.getText(valueRange);
		return valueText;
	}
}
