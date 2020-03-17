import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState } from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken } from './xpLexer';

export class XMLDocumentFormattingProvider {

	public replaceIndendation = true;
	public minimiseXPathIndents = true;
	private xslLexer = new XslLexer();
	private static xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();

	constructor() {
		this.xslLexer.provideCharLevelState = true;
	}


	public provideDocumentFormattingEdits = (document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[] => {
		let result: vscode.TextEdit[] = [];
		let indentString = '';
		let useTabs = !(options.insertSpaces);
		// using non-whitespace for testing only!!
		if (useTabs) {
			indentString = '\t';
		} else {
			indentString = ' ';
		}
		let indentCharLength = useTabs ? 1 : options.tabSize;

		let allTokens = this.xslLexer.analyse(document.getText());
		let lineNumber = -1;
		let prevLineNumber = -1;
		let nestingLevel = 0;
		let xpathNestingLevel = 0;
		let newNestingLevel = 0;
		let tokenIndex = -1;
		let multiLineState = MultiLineState.None;

		let xmlSpacePreserveStack: boolean[] = [];
		let xmlSpaceAttributeValue: boolean | null = null;
		let awaitingXmlSpaceAttributeValue = false;
		let attributeNameOffset = 0;
		let attributeValueOffset = 0;
		let attributeNameOnNewLine = false;
		let isPreserveSpaceElement = false;
		let expectedElse = false;
		let elseLineNumber = -1;

		allTokens.forEach((token) => {
			let newMultiLineState = MultiLineState.None;
			let stackLength = xmlSpacePreserveStack.length;

			tokenIndex++;
			lineNumber = token.line;
			let lineNumberDiff = lineNumber - prevLineNumber;

			let isXsltToken = token.tokenType >= XMLDocumentFormattingProvider.xsltStartTokenNumber;
			let indent = 0;
			if (isXsltToken) {
				let expectedElse = false;
				let elseLineNumber = -1;
				xpathNestingLevel = 0;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XMLDocumentFormattingProvider.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						let elementName = this.getTextForToken(lineNumber, token, document);
						isPreserveSpaceElement = elementName === 'xsl:text';
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								xmlSpaceAttributeValue = null;
								newNestingLevel++;
								break;
							case XMLCharState.rStNoAtt:
								let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
								xmlSpacePreserveStack.push(preserveSpace);
								break;
							case XMLCharState.rSt:
								attributeNameOffset = 0;
								attributeValueOffset = 0;
								if (xmlSpaceAttributeValue === null) {
									let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
									xmlSpacePreserveStack.push(preserveSpace);
								} else {
									xmlSpacePreserveStack.push(xmlSpaceAttributeValue);
									xmlSpaceAttributeValue = null;
								}
								break;
							case XMLCharState.lCt:
								// outdent:
								indent = -1;
								newNestingLevel--;
								break;
							case XMLCharState.rSelfCt:
								attributeNameOffset = 0;
								attributeValueOffset = 0;
								isPreserveSpaceElement = false;
								newNestingLevel--;
								break;
							case XMLCharState.rCt:
								attributeNameOffset = 0;
								attributeValueOffset = 0;
								isPreserveSpaceElement = false;
								if (stackLength > 0) {
									xmlSpacePreserveStack.pop();
								}
								break;
						}
						break;
					case XSLTokenLevelState.attributeName:
						// test: xml:space
						attributeValueOffset = 0;
						if (token.length === 9) {
							let valueText = this.getTextForToken(lineNumber, token, document);
							awaitingXmlSpaceAttributeValue = (valueText === 'xml:space');
						}
						const attNameLine = document.lineAt(lineNumber);
						attributeNameOnNewLine = lineNumberDiff > 0;
						if (!attributeNameOnNewLine && attributeNameOffset === 0) {
							attributeNameOffset = token.startCharacter - attNameLine.firstNonWhitespaceCharacterIndex;
						} 
						break;
					case XSLTokenLevelState.attributeValue:
						const attValueLine = document.lineAt(lineNumber);
						let attValueText = this.getTextForToken(lineNumber, token, document);
						// token constains single/double quotes also
						let textOnFirstLine = token.length > 1 && attValueText.trim().length > 1;
						let indentRemainder = attributeNameOffset % indentCharLength;
						let adjustedIndentChars = attributeNameOffset + (indentCharLength - indentRemainder);

						let calcOffset =  token.startCharacter - attValueLine.firstNonWhitespaceCharacterIndex;
						calcOffset = attributeNameOnNewLine? calcOffset + attributeNameOffset: calcOffset;

						let newValueOffset = textOnFirstLine ? 1 + calcOffset : adjustedIndentChars;
						attributeValueOffset = lineNumberDiff > 0 ? attributeValueOffset : newValueOffset;
						break;
					case XSLTokenLevelState.attributeValue:
						if (awaitingXmlSpaceAttributeValue) {
							let preserveToken = this.getTextForToken(lineNumber, token, document);
							// token includes surrounding quotes.
							xmlSpaceAttributeValue = preserveToken === '\"preserve\"' || preserveToken === '\'preserve\'';
							awaitingXmlSpaceAttributeValue = false;
						}
						break;
					case XSLTokenLevelState.processingInstrValue:
					case XSLTokenLevelState.xmlComment:
					case XSLTokenLevelState.processingInstrName:
						newMultiLineState = (multiLineState === MultiLineState.None) ? MultiLineState.Start : MultiLineState.Middle;
						// TODO: outdent ?> on separate line - when token value is only whitespace
						let multiLineToken = this.getTextForToken(lineNumber, token, document);

						if (newMultiLineState === MultiLineState.Middle && token.length > 0 && !multiLineToken.includes('--')) {
							indent = 1;
						}
						break;
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;
				switch (xpathTokenType) {
					case TokenLevelState.complexExpression:
						let valueText = this.getTextForToken(lineNumber, token, document);
						switch (valueText) {
							case 'if':
								if (lineNumber === elseLineNumber) {
									xpathNestingLevel--;
								}
								elseLineNumber = -1;
								break;
							case 'then':
								expectedElse = true;
							case 'in':
							case ':=':
								xpathNestingLevel++;
								break;
							case 'return':
								break;
							case 'else':
								elseLineNumber = lineNumber;
								if (expectedElse) {
									// do nothing
								} else {
									xpathNestingLevel--;
								}
								indent = -1;
								expectedElse = false;
								break;
						}
						break;
					case TokenLevelState.operator:
						switch (xpathCharType) {
							case CharLevelState.lB:
							case CharLevelState.lPr:
							case CharLevelState.lBr:
								expectedElse = false;
								xpathNestingLevel++;
								indent = -1;
								break;
							case CharLevelState.rB:
							case CharLevelState.rPr:
							case CharLevelState.rBr:
								xpathNestingLevel--
								break;
							case CharLevelState.dSep:
								let valueText = this.getTextForToken(lineNumber, token, document);
								if (valueText === ':=') {
									indent = -1;
								}
								break;
						}
						break;
				}
			}

			if (lineNumberDiff > 0) {
				// process any skipped lines (text not in tokens):
				for (let i = lineNumberDiff - 1; i > -1; i--) {
					let loopLineNumber = lineNumber - i;
					const currentLine = document.lineAt(loopLineNumber);
					// token may not be at start of line
					let actualIndentLength = currentLine.firstNonWhitespaceCharacterIndex;
					let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;

					let totalAttributeOffset;
					if (!isXsltToken && this.minimiseXPathIndents) {
						totalAttributeOffset = 0;
					} else {
						totalAttributeOffset = attributeValueOffset > 0? attributeValueOffset: attributeNameOffset;
					}

					let requiredIndentLength = totalAttributeOffset + ((nestingLevel + xpathNestingLevel) * indentCharLength);
					if (totalAttributeOffset > 0) {
						indent = -1 + indent;
					}
					if (i > 0) {
						// on a missed line, ignore outdent
					} else {
						requiredIndentLength += (indent * indentCharLength);
					}

					if (!(preserveSpace || isPreserveSpaceElement)) {
						if (this.replaceIndendation) {
							let replacementString = indentString.repeat(requiredIndentLength);
							result.push(this.getReplaceLineIndentTextEdit(currentLine, replacementString));
						} else if (actualIndentLength !== requiredIndentLength) {
							let indentLengthDiff = requiredIndentLength - actualIndentLength;
							if (indentLengthDiff > 0) {
								result.push(vscode.TextEdit.insert(currentLine.range.start, indentString.repeat(indentLengthDiff)));
							} else {
								let endPos = new vscode.Position(loopLineNumber, 0 - indentLengthDiff);
								let deletionRange = currentLine.range.with(currentLine.range.start, endPos);
								result.push(vscode.TextEdit.delete(deletionRange));
							}
						}
					}
				}
			}
			prevLineNumber = lineNumber;
			nestingLevel = newNestingLevel;
			multiLineState = newMultiLineState;
		});
		return result;
	}

	private getReplaceLineIndentTextEdit = (currentLine: vscode.TextLine, indentString: string): vscode.TextEdit => {
		let startPos = currentLine.range.start;
		if (currentLine.firstNonWhitespaceCharacterIndex === 0) {
			return vscode.TextEdit.insert(startPos, indentString);
		} else {
			let endPos = new vscode.Position(currentLine.lineNumber, currentLine.firstNonWhitespaceCharacterIndex);
			let valueRange = currentLine.range.with(startPos, endPos);
			return vscode.TextEdit.replace(valueRange, indentString)
		}
	}

	private getTextForToken(lineNumber: number, token: BaseToken, document: vscode.TextDocument) {
		let startPos = new vscode.Position(lineNumber, token.startCharacter);
		let endPos = new vscode.Position(lineNumber, token.startCharacter + token.length);
		const currentLine = document.lineAt(lineNumber);
		let valueRange = currentLine.range.with(startPos, endPos);
		let valueText = document.getText(valueRange);
		return valueText;
	}
}

enum MultiLineState {
	None,
	Start,
	Middle
}