/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
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
	// for on-type formatting, the line to indent - the new line after Enter, which may be empty
	private onTypeLine = -1;
	private isWholeDocument = false;
	private static xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	// the parts of a string template, or of a string delimited by entities, that can't start a string
	private static readonly stringContinuationCharTypes = [CharLevelState.mBt, CharLevelState.rBt, CharLevelState.rDqEnt, CharLevelState.rSqEnt,
		CharLevelState.rLiteralDqEnt, CharLevelState.rLiteralSqEnt];
	public static currentIndentString: string = '';
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
		if (token.isCancellationRequested) {
			// e.g. superseded by further typing
			this.isCloseTag = false;
			return [];
		}
		if (ch.indexOf('\n') > -1 || this.isCloseTag) {
			const newLine = document.lineAt(pos.line);
			this.onTypeLineEmpty = newLine.text.trim().length === 0;
			// after Enter, the line just finished is indented again too: its indentation was set before its text was
			// typed, e.g. for an 'else' typed on the line after a 'then' clause
			const firstLine = !this.isCloseTag && pos.line > 0 ? document.lineAt(pos.line - 1) : newLine;
			const documentRange = new vscode.Range(firstLine.range.start, newLine.range.end);
			this.onType = true;
			this.onTypeLine = pos.line;
			try {
				return this.provideDocumentRangeFormattingEdits(document, documentRange, options, token);
			} finally {
				// reset even if formatting fails, so later full-document formatting isn't treated as on-type
				this.onType = false;
				this.onTypeLineEmpty = false;
				this.onTypeLine = -1;
			}
		} else {
			return [];
		}
	};

	// whether the text before a position ends within a CDATA section or a comment
	private static isInCDataOrComment(textBefore: string) {
		return textBefore.lastIndexOf('<![CDATA[') > textBefore.lastIndexOf(']]>') || textBefore.lastIndexOf('<!--') > textBefore.lastIndexOf('-->');
	}

	// the indentation for an empty or whitespace-only line, as after Enter - undefined if it has that already, or where
	// whitespace is kept as it is: within xsl:text, a CDATA section or a comment
	public emptyLineIndentation(document: vscode.TextDocument, line: number, options: vscode.FormattingOptions): string | undefined {
		const lineStart = new vscode.Position(line, 0);
		if (XMLDocumentFormattingProvider.isInCDataOrComment(document.getText(new vscode.Range(new vscode.Position(0, 0), lineStart)))) {
			return undefined;
		}
		const edit = this.provideOnTypeFormattingEdits(document, lineStart, '\n', options, new vscode.CancellationTokenSource().token)
			.find((e) => e.range.start.line === line && e.range.start.character === 0);
		return edit && edit.newText.trim() === '' ? edit.newText : undefined;
	}

	// Tab, in an XSLT or XML editor: on an empty or whitespace-only line - e.g. one clicked on, with the cursor at its
	// start - the line is indented for its context, as after Enter, with the cursor at its end; otherwise, or where the
	// line is indented that far already, it's VS Code's Tab
	public static async tabToIndentation(editor: vscode.TextEditor | undefined, formatter: XMLDocumentFormattingProvider) {
		const tab = () => vscode.commands.executeCommand('tab');
		if (!editor || editor.selections.length !== 1 || !editor.selection.isEmpty) {
			return tab();
		}
		const cursor = editor.selection.active;
		const line = editor.document.lineAt(cursor.line);
		if (!line.isEmptyOrWhitespace) {
			return tab();
		}
		const options = { tabSize: Number(editor.options.tabSize) || 4, insertSpaces: editor.options.insertSpaces !== false };
		const indentation = formatter.emptyLineIndentation(editor.document, cursor.line, options);
		if (indentation === undefined || indentation.length <= line.text.length) {
			return tab();
		}
		await editor.edit((builder) => builder.replace(line.range, indentation));
		const end = new vscode.Position(cursor.line, indentation.length);
		editor.selection = new vscode.Selection(end, end);
	}

	public provideDocumentFormattingEdits = (document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[] => {
		const lastLine = document.lineAt(document.lineCount - 1);
		const documentRange = new vscode.Range(document.positionAt(0), lastLine.range.end);
		this.isWholeDocument = true;
		try {
			return this.provideDocumentRangeFormattingEdits(document, documentRange, options, token);
		} finally {
			this.isWholeDocument = false;
		}
	};

	public provideDocumentRangeFormattingEdits = (document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[] => {
		// formatting is synchronous, so the token can't change while it runs - but the request may already be cancelled
		if (token.isCancellationRequested) {
			this.isCloseTag = false;
			return [];
		}
		try {
			return this.formatRange(document, range, options);
		} finally {
			this.isCloseTag = false;
		}
	};

	private formatRange(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions): vscode.TextEdit[] {
		// the end tag of an xsl:note, with the document's prefix for XSLT, e.g. </xslt:note
		const noteEndTag = `</${XsltTokenDiagnostics.xsltPrefixOf(document)}:note`;
		let result: vscode.TextEdit[] = [];
		// on-type formatting stops once the new line is formatted - the line before it may be formatted first. After Enter,
		// that's after the new line's first token, even when its indentation is right already, e.g. from VS Code's own
		// indentation of the new line: the tokens after it may be out of line order, e.g. those of an attribute's lines
		let isOnTypeLineReached = false;
		const isOnTypeLineDone = () => this.onType && (isOnTypeLineReached || result.some((edit) => edit.range.start.line >= this.onTypeLine));
		let indentString = '';
		let useTabs = !(options.insertSpaces);
		let newLineString = (document.eol === vscode.EndOfLine.CRLF) ? "\r\n" : "\n";
		// using non-whitespace for testing only!!
		if (useTabs) {
			indentString = '\t';
		} else {
			indentString = ' ';
		}
		let indentCharLength = useTabs ? 1 : options.tabSize;
		XMLDocumentFormattingProvider.currentIndentString = indentString.repeat(indentCharLength);

		let currentLine = document.lineAt(range.start.line);
		if (range.start.character > currentLine.firstNonWhitespaceCharacterIndex) {
			// don't format pastes / range selections if they don't include the start non-ws char of the line
			return [];
		}

		let startFormattingLineNumber = range.start.line;
		const firstLine = document.lineAt(0);
		const adjustedStartRange = new vscode.Range(firstLine.range.start, range.end);

		let stringForTokens: string;
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
		// the names of the open elements, and the number of them closed by the current close tag: as in the linter, a
		// close tag closes the nearest open element with its name, and any elements still open within it - and none
		// when no element with its name is open, so a missing or stray close tag doesn't shift the indentation after it
		let openElementNames: string[] = [];
		let closedElementCount = 1;
		let xmlSpaceAttributeValue: boolean | null = null;
		let awaitingXmlSpaceAttributeValue = false;
		let attributeNameOffset = 0;
		let attributeValueOffset = 0;
		let attributeNameOnNewLine = false;
		let isPreserveSpaceElement = false;
		let withinCDATA = false;
		let complexStateStack: [number, number[], boolean][] = [];
		let elseLineNumber = -1;
		let isXSLTStartTag = false;
		let nameIndentRequired = false;
		let preThen = false;
		// a document with its first tags on one line, e.g. generated XML, is split into lines - only when the whole
		// document is formatted: not for on-type or range formatting, e.g. after Enter in a line split from it
		let documenthasNewLines: HasCharacteristic = this.isWholeDocument ? HasCharacteristic.unknown : HasCharacteristic.yes;
		let awaitingSecondTag: HasCharacteristic = this.isWholeDocument ? HasCharacteristic.unknown : HasCharacteristic.no;
		let firstStartTagLineNumber = -1;
		let prevToken: BaseToken | null = null;
		let elementName = '';
		let closeTagWithinText = false;
		let closeTagName: string | null = null;
		let emptyStackIsElseBlock = false;
		// the content of an xsl:note is indented as a block: each line keeps its indentation relative to the least
		// indented line, as indentation is significant in Markdown - the note's end tag is indented as usual
		let withinNote = false;
		let isNoteEndTag = false;
		let noteBaseIndent = 0;
		const startNote = (startTagLine: number) => {
			withinNote = true;
			// the least indentation of the note's non-blank content lines, up to the line of its end tag
			noteBaseIndent = Number.MAX_SAFE_INTEGER;
			for (let l = startTagLine + 1; l < document.lineCount; l++) {
				const line = document.lineAt(l);
				if (line.text.trimStart().startsWith(noteEndTag)) {
					break;
				}
				if (!line.isEmptyOrWhitespace) {
					noteBaseIndent = Math.min(noteBaseIndent, line.firstNonWhitespaceCharacterIndex);
				}
			}
			noteBaseIndent = noteBaseIndent === Number.MAX_SAFE_INTEGER ? 0 : noteBaseIndent;
		};

		// for each open string template, the depth of braces within its current enclosed expression: 0 within its text
		let templateBraceDepths: number[] = [];

		if (this.docType === DocumentTypes.XPath) {
			complexStateStack = [[0, [], false]];
			this.xpLexer.reset();
		}

		allTokens.forEach((token) => {
			let newMultiLineState = MultiLineState.None;
			isNoteEndTag = false;
			// the continuation of a string literal or string template on a new line: the lexer splits a string at line
			// breaks, so the continuation starts at the start of the line - it's the middle or right part of a template
			// or a string delimited by entities, or it follows the string's previous part - the lines since the previous
			// token are within the string, so their indentation is part of its value (in an attribute, the XML parser
			// replaces each whitespace character with a space, but doesn't collapse them)
			// A line within a template's text may also start with an enclosed expression, e.g. '{$b}' in `a{$a}⏎{$b}`:
			// there's no string token for the line break, so the line starts with the '{'
			const withinTemplateText = templateBraceDepths.length > 0 && templateBraceDepths[templateBraceDepths.length - 1] === 0;
			const isStringContinuation = token.startCharacter === 0 && ((token.tokenType === TokenLevelState.string &&
				(XMLDocumentFormattingProvider.stringContinuationCharTypes.includes(<CharLevelState>token.charType) ||
					(!!prevToken && prevToken.tokenType === TokenLevelState.string && prevToken.line < token.line))) ||
				(withinTemplateText && !!prevToken && prevToken.line < token.line));
			XMLDocumentFormattingProvider.trackTemplateBraces(token, templateBraceDepths, withinTemplateText);
			let stackLength = xmlSpacePreserveStack.length;
			let addNewLine = false;

			tokenIndex++;
			lineNumber = token.line;
			let lineNumberDiff = lineNumber - prevLineNumber;

			let isXMLToken = token.tokenType >= XMLDocumentFormattingProvider.xsltStartTokenNumber;
			let indent = 0;

			if (isOnTypeLineDone()) {
				// do nothing
			} else if (isXMLToken) {
				xpathNestingLevel = 0;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XMLDocumentFormattingProvider.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						complexStateStack = [[0, [], false]];
						emptyStackIsElseBlock = false;
						isXSLTStartTag = true;
						elementName = XsltTokenDiagnostics.xsltElementName(XsltTokenDiagnostics.getTextForToken(lineNumber, token, document), document);
						isPreserveSpaceElement = elementName === 'xsl:text';
						break;
					case XSLTokenLevelState.elementName:
						complexStateStack = [[0, [], false]];
						emptyStackIsElseBlock = false;
						isXSLTStartTag = false;
						elementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						break;
					case XSLTokenLevelState.dtdEnd:
						if (awaitingSecondTag === HasCharacteristic.unknown) {
							firstStartTagLineNumber = lineNumber;
						} else if (awaitingSecondTag === HasCharacteristic.yes) {
							documenthasNewLines = lineNumber > firstStartTagLineNumber ? HasCharacteristic.yes : HasCharacteristic.no;
							awaitingSecondTag = HasCharacteristic.no;
						}
						addNewLine = documenthasNewLines === HasCharacteristic.no;
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								if (!this.onTypeLineEmpty) {
									attributeNameOffset = 0;
									attributeValueOffset = 0;
									xmlSpaceAttributeValue = null;
								}
									newNestingLevel++;
								if (awaitingSecondTag === HasCharacteristic.unknown) {
									firstStartTagLineNumber = lineNumber;
									awaitingSecondTag = HasCharacteristic.yes;
								} else if (awaitingSecondTag === HasCharacteristic.yes) {
									documenthasNewLines = lineNumber > firstStartTagLineNumber ? HasCharacteristic.yes : HasCharacteristic.no;
									awaitingSecondTag = HasCharacteristic.no;
								}
								addNewLine = this.shouldAddNewLine(documenthasNewLines, prevToken, token);
								break;
							case XMLCharState.rStNoAtt:
								let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
								xmlSpacePreserveStack.push(preserveSpace);
								openElementNames.push(elementName);
								if (!withinNote && isXSLTStartTag && elementName === 'xsl:note') {
									startNote(lineNumber);
								}
								if (this.isCloseTag) {
									xmlelementStack.push(elementName);
								}
								break;
							case XMLCharState.rSt:
								attributeNameOffset = 0;
								attributeValueOffset = 0;
								if (!withinNote && isXSLTStartTag && elementName === 'xsl:note') {
									startNote(lineNumber);
								}
								if (xmlSpaceAttributeValue === null) {
									let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
									xmlSpacePreserveStack.push(preserveSpace);
								} else {
									xmlSpacePreserveStack.push(xmlSpaceAttributeValue);
									xmlSpaceAttributeValue = null;
								}
								openElementNames.push(elementName);
								if (this.isCloseTag) {
									xmlelementStack.push(elementName);
								}
								break;
							case XMLCharState.lCt:
								isNoteEndTag = withinNote && document.lineAt(lineNumber).text.startsWith(noteEndTag, token.startCharacter);
								// outdent, by the number of elements the close tag closes - one, unless its name is still
								// being typed:
								closedElementCount = 1;
								const endTagName = /^[^\s/>]+/.exec(document.lineAt(lineNumber).text.substring(token.startCharacter + 2))?.[0];
								if (endTagName && openElementNames.length > 0) {
									const matchIndex = openElementNames.lastIndexOf(endTagName);
									closedElementCount = matchIndex > -1 ? openElementNames.length - matchIndex : 0;
								}
								indent = -closedElementCount;
								newNestingLevel -= closedElementCount;
								addNewLine = this.shouldAddNewLine(documenthasNewLines, prevToken, token);
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
								xmlSpacePreserveStack.splice(Math.max(0, stackLength - closedElementCount));
								openElementNames.splice(Math.max(0, openElementNames.length - closedElementCount));
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
							nameIndentRequired = !(isXSLTStartTag && attributeNameOnNewLine && this.xslLexer.isExpressionAtt(valueText, ''));
						}
						const attNameLine = document.lineAt(lineNumber);
						if (!nameIndentRequired) {
							attributeNameOffset = 0;
						} else if (!attributeNameOnNewLine && attributeNameOffset === 0) {
							attributeNameOffset = token.startCharacter - attNameLine.firstNonWhitespaceCharacterIndex;
						}
						if (useTabs) {
							attributeNameOffset = 1;
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
						if (useTabs) {
							attributeValueOffset = 2;
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
				let currentStateLevel: [number, number[], boolean] = complexStateStack.length > 0 ? complexStateStack[complexStateStack.length - 1] : [0, [], emptyStackIsElseBlock];
				let bracketNesting: number = currentStateLevel[0];
				let ifElseStack: number[] = currentStateLevel[1];
				let isElseBlock: boolean = currentStateLevel[2];

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
							case 'else':
								isElseBlock = true;
								if (complexStateStack.length === 0) {
									emptyStackIsElseBlock = true;
								} else {
									complexStateStack[complexStateStack.length - 1][2] = true;
								}
							case 'return':
							case 'satisfies':
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
								complexStateStack.push([xpathNestingLevel, [], false]);
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
							case CharLevelState.sep:
								if (token.value === ',') {
									if (isElseBlock) {
										xpathNestingLevel--;
										if (complexStateStack.length === 0) {
											emptyStackIsElseBlock = false;
										} else {
											complexStateStack[complexStateStack.length - 1][2] = false;
										}
									}
								}
								break;
						}
						break;
				}
			}

			if (addNewLine && lineNumberDiff === 0) {
				lineNumberDiff = 1;
			}
			if (isOnTypeLineDone()) {
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
			} else if ((!withinCDATA || withinNote) && lineNumber >= startFormattingLineNumber && lineNumberDiff > 0) {
				// process any skipped lines (text not in tokens):
				for (let i = lineNumberDiff - 1; i > -1 && !isStringContinuation; i--) {
					let loopLineNumber = lineNumber - i;
					const currentLine = document.lineAt(loopLineNumber);
					// token may not be at start of line
					let actualIndentLength = currentLine.firstNonWhitespaceCharacterIndex;
					let preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;

					let totalAttributeOffset;
					if (!isXMLToken && this.minimiseXPathIndents) {
						totalAttributeOffset = 0;
					} else {
						if (attributeValueOffset > 0) {
							totalAttributeOffset = attributeValueOffset;
						} else {
							totalAttributeOffset = attributeNameOffset;
						}
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

					// a line within a note, other than the note's end tag
					const isNoteLine = withinNote && !(i === 0 && isNoteEndTag);
					// a blank line is left empty - except the new line for on-type formatting, which is indented
					const isBlankLine = currentLine.isEmptyOrWhitespace && !(this.onType && loopLineNumber === this.onTypeLine);
					if (isBlankLine && !addNewLine) {
						if (currentLine.text.length > 0 && !(preserveSpace || isPreserveSpaceElement)) {
							result.push(vscode.TextEdit.delete(currentLine.range));
						}
					} else if (isNoteLine && !(preserveSpace || isPreserveSpaceElement)) {
						// the required indentation, plus the line's indentation relative to the note's least indented line
						const currentIndent = currentLine.text.substring(0, currentLine.firstNonWhitespaceCharacterIndex);
						const replacementString = indentString.repeat(requiredIndentLength) + currentIndent.substring(Math.min(noteBaseIndent, currentIndent.length));
						if (currentIndent !== replacementString) {
							result.push(this.getReplaceLineIndentTextEdit(currentLine, replacementString));
						}
					} else if (!(preserveSpace || isPreserveSpaceElement)) {
						if (this.replaceIndendation) {
							if (addNewLine) {
								let editPos = new vscode.Position(loopLineNumber, token.startCharacter);
								let replacementString = newLineString + indentString.repeat(requiredIndentLength);
								result.push(vscode.TextEdit.insert(editPos, replacementString));
							} else {
								let replacementString = indentString.repeat(requiredIndentLength);
								// only where the indentation changes
								if (currentLine.text.substring(0, currentLine.firstNonWhitespaceCharacterIndex) !== replacementString) {
									result.push(this.getReplaceLineIndentTextEdit(currentLine, replacementString));
								}
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
			if (isNoteEndTag) {
				withinNote = false;
			}
			prevLineNumber = lineNumber;
			nestingLevel = newNestingLevel;
			multiLineState = newMultiLineState;
			prevToken = token;
			if (this.onType && !this.isCloseTag && token.line >= this.onTypeLine) {
				isOnTypeLineReached = true;
			}
		});
		return result;
	}

	private shouldAddNewLine(documenthasNewLines: HasCharacteristic, prevToken: BaseToken | null, token: BaseToken): boolean {
		let addNewLine = false;
		
		if (documenthasNewLines === HasCharacteristic.no) {
			if (this.indentMixedContent) {
				addNewLine = true;
			} else {
				// TODO!!! check if prevtoken was a right-close-tag or a self-closing tag or comment????
				let pct = prevToken?.charType;
				addNewLine = pct === XMLCharState.rSelfCt || pct === XMLCharState.rSt || pct === XMLCharState.rCt ||
					pct === XMLCharState.rSelfCtNoAtt || pct === XMLCharState.rStNoAtt ||
					pct === XMLCharState.rComment || pct === XMLCharState.rPi;
			}
		} else if (this.indentMixedContent) {
      // add a new line if we're on the same line
			addNewLine = prevToken?.line === token.line;
		}
		return addNewLine;
	}

	// updates the brace depths for the open string templates with a token: a template starts with its opening part,
	// or ends with its closing part ('sBt' when it has no enclosed expressions, after a line break), and the braces of
	// enclosed expressions - which may have map constructors or other templates within them - are counted
	private static trackTemplateBraces(token: BaseToken, depths: number[], withinTemplateText: boolean) {
		if (token.tokenType >= XMLDocumentFormattingProvider.xsltStartTokenNumber) {
			depths.length = 0;
		} else if (token.tokenType === TokenLevelState.string) {
			const charType = <CharLevelState>token.charType;
			if (charType === CharLevelState.lBt) {
				depths.push(0);
			} else if (charType === CharLevelState.rBt || (charType === CharLevelState.sBt && withinTemplateText)) {
				depths.pop();
			}
		} else if (depths.length > 0 && token.charType === CharLevelState.lBr) {
			depths[depths.length - 1]++;
		} else if (depths.length > 0 && token.charType === CharLevelState.rBr && depths[depths.length - 1] > 0) {
			depths[depths.length - 1]--;
		}
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
	};
}


enum MultiLineState {
	None,
	Start,
	Middle
}
