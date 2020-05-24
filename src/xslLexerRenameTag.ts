/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XPath/XSLT Lexer/Syntax Highlighter
 */

import { XslLexer, XMLCharState, GlobalInstructionType, XSLTokenLevelState, EntityPosition, GlobalInstructionData} from "./xslLexer";
import * as vscode from 'vscode';


export interface TagRenameEdit {
	range: vscode.Range,
	text: string
}

export interface TagRenamePosition {
	startPosition: vscode.Position,
    endTag: string
    startTag: string
}

export class XslLexerRenameTag extends XslLexer {

    private nonNameRgx = new RegExp(/[\s<>\/]/);
    private hasWsOrCloseRgx = new RegExp(/[\s\/]/);


    public isStartTagChange(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent) {
        let renameRange = change.range;
        let renameChar = renameRange.start.character;
        let text = change.text; 
        let isValid = renameRange.end.line === renameRange.start.line && !this.nonNameRgx.test(change.text);
        if (!isValid) {
            return -1;
        }

        let renameLine = document.lineAt(renameRange.start.line);
        let firstNonWsChar = renameLine.firstNonWhitespaceCharacterIndex;
        if (renameChar <= firstNonWsChar) {
            return -1;
        }
        let posInStartTag = this.scanBefore(renameLine.text, change);
        return posInStartTag;
    }

    private scanBefore(text: string, change: vscode.TextDocumentContentChangeEvent) {
        let startTagPos = text.lastIndexOf('<', change.range.start.character);
        if (startTagPos < 0) {
            return -1;
        }
        let prevEndTagPos = text.lastIndexOf('>', change.range.start.character - 1);
        if (prevEndTagPos > startTagPos) {
            return -1;
        }

        let textBefore = text.substring(startTagPos + 1, change.range.start.character);
        let hasWsOrClose = this.hasWsOrCloseRgx.test(textBefore);
        if (hasWsOrClose) {
            return -1;
        }
        
        return textBefore.length;
    }

    public getEndTagForStartTagChange(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent): TagRenamePosition|null {
        
        this.globalInstructionData = [];
        this.globalModeData = [];
        let xsl = document.getText();
        let renameRange = change.range;
        let renamePos = renameRange.start;
        
        let renameStartChar = renamePos.character;
        let renameEndChar = renameRange.end.character;

        let renameLine = renamePos.line;
        let currentState: XMLCharState = XMLCharState.init;
        let currentChar: string = '';
        let tokenChars: string[] = [];

        let xslLength = xsl.length - 1;
        let storeToken = false;


        let xmlElementStack: number = 0;
        let lCharCount = -1;
        let lineNumber = 0;
        let lineNumberChar = -1;
        let renameName = '';
        let renameStackLength = -1;
        let breakLoop = false;
        let foundStartTag = false;
        let endTagStartPos: TagRenamePosition|null = null;


        while (lCharCount < xslLength + 1) {
            if (breakLoop) {
                break;
            }
            lCharCount++;
            lineNumberChar++;
            let nextState: XMLCharState = XMLCharState.init;
            let nextChar: string = xsl.charAt(lCharCount);

            if (currentChar) {
                let isCurrentCharNewLIne = currentChar === '\n';
                if (isCurrentCharNewLIne) {
                    lineNumberChar = 0;
                    lineNumber++;
                    if (lineNumber > renameLine && (renameName === '')) {
                        breakLoop = true;
                    }
                }

                nextState = this.calcNewState(
                    isCurrentCharNewLIne,
                    currentChar,
                    nextChar,
                    currentState,
                );

                if (nextState === currentState) {
                    if (isCurrentCharNewLIne) {
                        // do nothing
                    } else if (storeToken) {
                        tokenChars.push(currentChar);
                    }
                } else {

                    switch (nextState) {
                        case XMLCharState.lSt:
                            storeToken = renameLine === lineNumber && renameName === '';
                            breakLoop = (renameName === '' && lineNumberChar >= renameStartChar);
                            break;
                        case XMLCharState.rSt:
                            if (storeToken) {
                                if (lineNumberChar < renameStartChar) {
                                    renameName = tokenChars.join('');
                                }
                            }
                            xmlElementStack++;
                            storeToken = false;
                            tokenChars = [];
                            break;
                        case XMLCharState.rSelfCt:
                            break;
                        case XMLCharState.lCtName:
                            if (xmlElementStack > 0) {
                                xmlElementStack--;
                            }
                            if (renameName !== '' && xmlElementStack === renameStackLength) {
                                tokenChars.push(currentChar);
                                storeToken = true;
                            }
                            // console.log('start of the close tag name')
                            break;
                        case XMLCharState.lEn:
                            if (storeToken) {
                                tokenChars.push(currentChar);
                            }
                            break;
                        case XMLCharState.lsElementNameWs:
                        case XMLCharState.rStNoAtt:
                            if (lineNumberChar >= renameStartChar) {
                                if (storeToken) {
                                    renameName = tokenChars.join('');
                                    renameStackLength = xmlElementStack;
                                }                               
                            } else if (renameName === '') {
                                breakLoop = true;
                            }
                            storeToken = false;
                            tokenChars = [];
                            if (nextState === XMLCharState.rStNoAtt) {
                                xmlElementStack++;
                            }
                            break;
                        case XMLCharState.rSelfCtNoAtt:
                            storeToken = false;
                            tokenChars = [];
                            break;
                        case XMLCharState.rCt:
                            if (xmlElementStack === renameStackLength) {
                                let closeTag = tokenChars.join('');
                                if (true) { //(renameName === closeTag) {
                                    endTagStartPos = {startTag: renameName, endTag: closeTag, startPosition: new vscode.Position(lineNumber, lineNumberChar - tokenChars.length)};
                                    breakLoop = true;
                                }
                            }

                            storeToken = false;
                            tokenChars = [];
                            break;

                    }

                } // else ends
                currentState = nextState;
            } 
            currentChar = nextChar;
        } 
        return endTagStartPos;
    }

}
