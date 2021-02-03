/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xmlDocumentFormattingProvider
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, LanguageConfiguration, DocumentTypes } from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken, XPathLexer, ExitCondition, LexPosition } from './xpLexer';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';

enum HasCharacteristic {
	unknown,
	yes,
	no
}

export class XMLDocumentFormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider, vscode.OnTypeFormattingEditProvider {

	public replaceIndendation = true;
	public minimiseXPathIndents = true;
	public indentMixedContent = false;
	private xslLexer: XslLexer;
	private xpLexer: XPathLexer;
	private docType: DocumentTypes;
	private onType = false;
	private onTypeLineEmpty = false;
	private static xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	private isCloseTag = false;
	private closeTagLine: vscode.TextLine | null = null;
	private closeTagPos: vscode.Position | null = null;

	constructor(xsltConfiguration: LanguageConfiguration) {
		this.xslLexer = new XslLexer(xsltConfiguration);
		this.docType = xsltConfiguration.docType;
		this.xpLexer = new XPathLexer();
		this.xslLexer.provideCharLevelState = true;
	}

	public provideOnTypeFormattingEdits = (document: vscode.TextDocument, pos: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[] => {
		this.isCloseTag = ch.indexOf('/') > -1;
		if (this.isCloseTag && pos.character > 1) {
			let tLine = document.lineAt(pos.line);
			this.closeTagLine = tLine;
			this.closeTagPos = pos;
			let chBefore = tLine.text.charAt(pos.character - 2);
			this.isCloseTag = chBefore === '<';
		}
		if (ch.indexOf('\n') > -1 || this.isCloseTag) {
			//const prevLine = document.lineAt(pos.line - 1);
			const newLine = document.lineAt(pos.line);
			this.onTypeLineEmpty = newLine.text.trim().length === 0;
			const documentRange = new vscode.Range(newLine.range.start, newLine.range.end);
			this.onType = true;
			let formatEdit = this.provideDocumentRangeFormattingEdits(document, documentRange, options, token);
			this.onType = false;
			return formatEdit;
		} else {
			return [];
		}
	}

	public provideDocumentFormattingEdits = (document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[] => {
		const lastLine = document.lineAt(document.lineCount - 1);
		const documentRange = new vscode.Range(document.positionAt(0), lastLine.range.end);
		return this.provideDocumentRangeFormattingEdits(document, documentRange, options, token);
	}

	public provideDocumentRangeFormattingEdits = (document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[] => {
		let result: vscode.TextEdit[] = [];
		let indentString = '';
		let useTabs = !(options.insertSpaces);
		let newLineString = (document.eol === vscode.EndOfLine.CRLF) ? "\r\n" : "\n"
		// using non-whitespace for testing only!!
		if (useTabs) {
			indentString = '\t';
		} else {
			indentString = ' ';
		}
		let indentCharLength = useTabs ? 1 : options.tabSize;

		let currentLine = document.lineAt(range.start.line);
		if (range.start.character > currentLine.firstNonWhitespaceCharacterIndex) {
			// don't format pastes / range selections if they don't include the start non-ws char of the line
			return [];
		}

		let startFormattingLineNumber = range.start.line;
		const firstLine = document.lineAt(0);
		const adjustedStartRange = new vscode.Range(firstLine.range.start, range.end);

		let stringForTokens: string
		if (this.onTypeLineEmpty) {
			// add extra char to make token on newline - so it can be indented
			stringForTokens = document.getText(adjustedStartRange) + '< ';
		} else {
			stringForTokens = document.getText(adjustedStartRange);
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		let allTokens = this.docType === DocumentTypes.XPath ?
			this.xpLexer.analyse(document.getText(), ExitCondition.None, lexPosition) :
			this.xslLexer.analyse(stringForTokens);

		let lineNumber = -1;
		let prevLineNumber = -1;
		let nestingLevel = 0;
		let xpathNestingLevel = 0;
		let newNestingLevel = 0;
		let tokenIndex = -1;
		let multiLineState = MultiLineState.None;

		let xmlSpacePreserveStack: boolean[] = [];
		let xmlelementStack: string[] = [];
		let xmlSpaceAttributeValue: boolean | null = null;
		let awaitingXmlSpaceAttributeValue = false;
		let attributeNameOffset = 0;
		let attributeValueOffset = 0;
		let attributeNameOnNewLine = false;
		let isPreserveSpaceElement = false;
		let withinCDATA = false;
		let complexStateStack: [number, number[]][] = [];
		let elseLineNumber = -1;
		let isXSLTStartTag = false;
		let nameIndentRequired = false;
		let preThen = false;
		let documenthasNewLines: HasCharacteristic = HasCharacteristic.unknown;
		let awaitingSecondTag: HasCharacteristic = HasCharacteristic.unknown;
		let firstStartTagLineNumber = -1;
		let prevToken: BaseToken | null = null;
		let elementName = '';
		let closeTagWithinText = false;
		let closeTagName: string | null = null;

		if (this.docType === DocumentTypes.XPath) {
			complexStateStack = [[0, []]];
		}

		allTokens.forEach((token) => {
			let newMultiLineState = MultiLineState.None;
			let stackLength = xmlSpacePreserveStack.length;
			let addNewLine = false;

			tokenIndex++;
			lineNumber = token.line;
			let lineNumberDiff = lineNumber - prevLineNumber;

			let isXMLToken = token.tokenType >= XMLDocumentFormattingProvider.xsltStartTokenNumber;
			let indent = 0;

			if (this.onType && result.length > 0) {
				// do nothing
			} else if (isXMLToken) {
				xpathNestingLevel = 0;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XMLDocumentFormattingProvider.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						complexStateStack = [[0, []]];
						isXSLTStartTag = true;
						elementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						isPreserveSpaceElement = elementName === 'xsl:text';
						break;
					case XSLTokenLevelState.elementName:
						complexStateStack = [[0, []]];
						isXSLTStartTag = false;
						elementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								attributeNameOffset = 0;
								attributeValueOffset = 0;
								xmlSpaceAttributeValue = null;
								newNestingLevel++;
								if (awaitingSecondTag === HasCharacteristic.unknown) {
									firstStartTagLineNumber = lineNumber;
									awaitingSecondTag = HasCharacteristic.yes;
								} else if (awaitingSecondTag === HasCharacteristic.yes) {
									documenthasNewLines = lineNumber > firstStartTagLineNumber ? HasCharacteristic.yes : HasCharacteristic.no;
									awaitingSecondTag = HasCharacteristic.no;
								}
								addNewLine = this.shouldAddNewLine(documenthasNewLines, prevToken);
								break;
							case XMLCharState.rStNoAtt:
								let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
								xmlSpacePreserveStack.push(preserveSpace);
								if (this.isCloseTag) {
									xmlelementStack.push(elementName);
								}
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
								if (this.isCloseTag) {
									xmlelementStack.push(elementName);
								}
								break;
							case XMLCharState.lCt:
								// outdent:
								indent = -1;
								newNestingLevel--;
								addNewLine = this.shouldAddNewLine(documenthasNewLines, prevToken);
								if (this.isCloseTag) {
									closeTagWithinText = this.closeTagPos?.line === token.line &&
										this.closeTagPos.character >= token.startCharacter &&
										this.closeTagPos.character <= token.startCharacter + token.length;
									if (closeTagWithinText && xmlelementStack.length > 0) {
										closeTagName = xmlelementStack[xmlelementStack.length - 1];
									}
								}
								break;
							case XMLCharState.rSelfCtNoAtt:
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
								if (this.isCloseTag && xmlelementStack.length > 0) {
									xmlelementStack.pop();
								}
								break;
							case XMLCharState.lPi:
								// may be xml-declaration:
								if (awaitingSecondTag === HasCharacteristic.unknown) {
									firstStartTagLineNumber = lineNumber;
									awaitingSecondTag = HasCharacteristic.yes;
								}
								attributeNameOffset = 0;
								attributeValueOffset = 0;
								break;
							case XMLCharState.rPi:
								indent = 0;
								break;
							case XMLCharState.rCdataEnd:
								withinCDATA = true;
								break;
						}
						break;
					case XSLTokenLevelState.attributeName:
					case XSLTokenLevelState.xmlnsName:
						// test: xml:space
						attributeValueOffset = 0;
						attributeNameOnNewLine = lineNumberDiff > 0;
						nameIndentRequired = true;
						if (token.length === 9 || (isXSLTStartTag && this.minimiseXPathIndents)) {
							let valueText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							awaitingXmlSpaceAttributeValue = (valueText === 'xml:space');
							nameIndentRequired = !(isXSLTStartTag && attributeNameOnNewLine && this.xslLexer.isExpressionAtt(valueText));
						}
						const attNameLine = document.lineAt(lineNumber);
						if (!nameIndentRequired) {
							attributeNameOffset = 0;
						} else if (!attributeNameOnNewLine && attributeNameOffset === 0) {
							attributeNameOffset = token.startCharacter - attNameLine.firstNonWhitespaceCharacterIndex;
						}
						break;
					case XSLTokenLevelState.attributeValue:
						const attValueLine = document.lineAt(lineNumber);
						let attValueText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						// token constains single/double quotes also
						let textOnFirstLine = token.length > 1 && attValueText.trim().length > 1;
						let indentRemainder = attributeNameOffset % indentCharLength;
						let adjustedIndentChars = attributeNameOffset + (indentCharLength - indentRemainder);

						let calcOffset = token.startCharacter - attValueLine.firstNonWhitespaceCharacterIndex;
						calcOffset = attributeNameOnNewLine ? calcOffset + attributeNameOffset : calcOffset;

						let newValueOffset = textOnFirstLine ? 1 + calcOffset : adjustedIndentChars;
						attributeValueOffset = lineNumberDiff > 0 ? attributeValueOffset : newValueOffset;
						if (awaitingXmlSpaceAttributeValue) {
							// token includes surrounding quotes.
							xmlSpaceAttributeValue = attValueText === '\"preserve\"' || attValueText === '\'preserve\'';
							awaitingXmlSpaceAttributeValue = false;
						}
						break;
					case XSLTokenLevelState.processingInstrValue:
					case XSLTokenLevelState.processingInstrName:
						attributeNameOffset = 0;
						newMultiLineState = (multiLineState === MultiLineState.None) ? MultiLineState.Start : MultiLineState.Middle;
						// TODO: outdent ?> on separate line - when token value is only whitespace
						let piText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let trimPi = piText.trim();

						if (newMultiLineState === MultiLineState.Middle && trimPi.length > 0) {
							indent = 1;
						}
						break;
					case XSLTokenLevelState.xmlComment:
						newMultiLineState = (multiLineState === MultiLineState.None) ? MultiLineState.Start : MultiLineState.Middle;
						let commentLineText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let trimLine = commentLineText.trimLeft();

						let doIndent = newMultiLineState === MultiLineState.Middle
							&& token.length > 0 && !trimLine.startsWith('-->') && !trimLine.startsWith('<!--');
						indent = doIndent ? 1 : 0;
						attributeNameOffset = doIndent ? 5 : 0;
						break;
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;
				let currentStateLevel: [number, number[]] = complexStateStack.length > 0 ? complexStateStack[complexStateStack.length - 1] : [0, []];
				let bracketNesting: number = currentStateLevel[0];
				let ifElseStack: number[] = currentStateLevel[1];
				let ifElseStackLength = ifElseStack.length;

				switch (xpathTokenType) {
					case TokenLevelState.complexExpression:
						let valueText = token.value;
						switch (valueText) {
							case 'if':
								if (lineNumber === elseLineNumber) {
									xpathNestingLevel--;
								}
								elseLineNumber = -1;
								preThen = true;
								break;
							case 'every':
							case 'for':
							case 'let':
							case 'some':
								indent = -1;
							// no-break;
							case 'then':
								preThen = false;
								xpathNestingLevel++;
								ifElseStack.push(xpathNestingLevel);
								break;
							case 'return':
							case 'satisfies':
							case 'else':
								elseLineNumber = lineNumber;
								xpathNestingLevel = ifElseStackLength > 0 ? ifElseStack[ifElseStackLength - 1] : 0;
								if (ifElseStack.length > 0) {
									ifElseStack.pop();
								}
								indent = -1;
								break;
						}
						break;
					case TokenLevelState.operator:
						switch (xpathCharType) {
							case CharLevelState.lB:
							case CharLevelState.lPr:
							case CharLevelState.lBr:
								complexStateStack.push([xpathNestingLevel, []]);
								xpathNestingLevel++;
								indent = -1;
								break;
							case CharLevelState.rB:
							case CharLevelState.rPr:
							case CharLevelState.rBr:
								if (complexStateStack.length > 0) {
									xpathNestingLevel = bracketNesting;
									complexStateStack.pop();
								} else {
									xpathNestingLevel = 0;
								}
								break;
							case CharLevelState.dSep:
								let valueText = token.value;
								if (valueText === ':=') {
									indent = -1;
								}
								break;
						}
						break;
				}
			}

			if (addNewLine && lineNumberDiff === 0) {
				lineNumberDiff = 1;
			}
			if (this.onType && result.length > 0) {
			} else if (this.isCloseTag) {
				if (nestingLevel > 0 && closeTagName !== null && this.closeTagPos !== null) {
					let nonWsStart = this.closeTagLine ? this.closeTagLine.firstNonWhitespaceCharacterIndex : 0;
					let replacementString = '';
					let edit: vscode.TextEdit;
					if ((nonWsStart + 2) === this.closeTagPos.character) {
						let requiredIndentLength = ((nestingLevel - 1) * indentCharLength);
						replacementString = indentString.repeat(requiredIndentLength);
						replacementString += '</' + closeTagName + '>';
						let startPos = new vscode.Position(this.closeTagPos.line, 0);
						let endPos = new vscode.Position(this.closeTagPos.line, token.startCharacter + 2);
						edit = vscode.TextEdit.replace(new vscode.Range(startPos, endPos), replacementString);
					} else {
						edit = vscode.TextEdit.insert(this.closeTagPos, closeTagName + '>');
					}
					closeTagName = null;
					result.push(edit);

				}
			} else if (!withinCDATA && lineNumber >= startFormattingLineNumber && lineNumberDiff > 0) {
				// process any skipped lines (text not in tokens):
				for (let i = lineNumberDiff - 1; i > -1; i--) {
					let loopLineNumber = lineNumber - i;
					const currentLine = document.lineAt(loopLineNumber);
					// token may not be at start of line
					let actualIndentLength = currentLine.firstNonWhitespaceCharacterIndex;
					let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;

					let totalAttributeOffset;
					if (!isXMLToken && this.minimiseXPathIndents) {
						totalAttributeOffset = 0;
					} else {
						totalAttributeOffset = attributeValueOffset > 0 ? attributeValueOffset : attributeNameOffset;
					}

					let indentExtraAsNoNameIndent = (!nameIndentRequired && !isXMLToken) && this.docType !== DocumentTypes.XPath ? 1 : 0;
					// guard against attempt to indent negative:
					let guardedNestingLevel = xpathNestingLevel > -1 ? xpathNestingLevel : 0;
					let requiredIndentLength = totalAttributeOffset + ((nestingLevel + guardedNestingLevel + indentExtraAsNoNameIndent) * indentCharLength);
					if (totalAttributeOffset > 0) {
						indent = -1 + indent;
					}
					if (i > 0) {
						// on a missed line, ignore outdent
					} else {
						requiredIndentLength += (indent * indentCharLength);
					}
					requiredIndentLength = requiredIndentLength < 0 ? 0 : requiredIndentLength;
					console.log('line:', lineNumber, 'requiredIndentLength:', requiredIndentLength, 'val:', token.value, 'tao', totalAttributeOffset, 'indent:', indent);

					if (!(preserveSpace || isPreserveSpaceElement)) {
						if (this.replaceIndendation) {
							if (addNewLine) {
								let editPos = new vscode.Position(loopLineNumber, token.startCharacter);
								let replacementString = newLineString + indentString.repeat(requiredIndentLength);
								result.push(vscode.TextEdit.insert(editPos, replacementString));
							} else {
								let replacementString = indentString.repeat(requiredIndentLength);
								result.push(this.getReplaceLineIndentTextEdit(currentLine, replacementString));
							}
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
			withinCDATA = false;
			prevLineNumber = lineNumber;
			nestingLevel = newNestingLevel;
			multiLineState = newMultiLineState;
			prevToken = token;
		});
		this.isCloseTag = false;
		return result;
	}

	private shouldAddNewLine(documenthasNewLines: HasCharacteristic, prevToken: BaseToken | null): boolean {
		let result = false
		if (documenthasNewLines === HasCharacteristic.no) {
			if (this.indentMixedContent) {
				result = true;
			} else {
				// TODO!!! check if prevtoken was a right-close-tag or a self-closing tag or comment????
				let pct = prevToken?.charType;
				result = pct === XMLCharState.rSelfCt || pct === XMLCharState.rSt || pct === XMLCharState.rCt ||
					pct === XMLCharState.rSelfCtNoAtt || pct === XMLCharState.rStNoAtt ||
					pct === XMLCharState.rComment || pct === XMLCharState.rPi
			}
		}
		return result;
	}

	private getReplaceLineIndentTextEdit = (currentLine: vscode.TextLine, indentString: string): vscode.TextEdit => {
		let startPos = currentLine.range.start;
		if (currentLine.firstNonWhitespaceCharacterIndex === 0) {
			return vscode.TextEdit.insert(startPos, indentString);
		} else {
			let endPos = new vscode.Position(currentLine.lineNumber, currentLine.firstNonWhitespaceCharacterIndex);
			let valueRange = currentLine.range.with(startPos, endPos);
			return vscode.TextEdit.replace(valueRange, indentString);
		}
	}
}


enum MultiLineState {
	None,
	Start,
	Middle
}
