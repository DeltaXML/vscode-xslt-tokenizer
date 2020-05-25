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
    private hasWsOrCloseRgx = new RegExp(/[\s\/?!]/);


    public isStartTagChange(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent) {
        if (!change) {
            return -1;
        }
        let renameRange = change.range;
        let renameChar = renameRange.start.character;
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
        let gotRenameName = false;
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
                    if (lineNumber > renameLine && (!gotRenameName)) {
                        console.log('breakloop #1 ');
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
                        // the '<' of the start tag
                        case XMLCharState.lSt:
                            // need to start storing token if line number is the same
                            // it may not be the right token though:
                            storeToken = renameLine === lineNumber && !gotRenameName;
                            // if (storeToken){
                            //     console.log('storetoken');
                            // }
                            breakLoop = ((storeToken && (lineNumberChar > renameStartChar)) || (!gotRenameName && (lineNumber > renameLine)) );
                            // if (breakLoop) {
                            //     console.log('start-tag on line: ' + lineNumber + ' breakloop: ' + breakLoop);
                            // }
                            break;
                        // the '<' of the '</' close tag:
                        case XMLCharState.lCt:
                            if (xmlElementStack > 0) {
                                xmlElementStack--;
                            }
                            break;
                        // start of the close tag name
                        case XMLCharState.lCtName:
                            if (gotRenameName && xmlElementStack === renameStackLength) {
                                // handle empty close tag name
                                if (currentChar !== '>') {
                                    tokenChars.push(currentChar);
                                } else {
                                    if (gotRenameName && xmlElementStack === renameStackLength) {
                                        let closeTag = '';
                                        endTagStartPos = {startTag: renameName, endTag: closeTag, startPosition: new vscode.Position(lineNumber, lineNumberChar - tokenChars.length)};
                                        breakLoop = true;
                                    }
                                }
                                storeToken = true;
                            }
                            break;
                        // start tag element name
                        case XMLCharState.lEn:
                            if (storeToken) {
                                if (currentChar === ' ' || currentChar === '/n' || currentChar === '/t' || currentChar === '/r') {
                                    // where start tag name is empty string
                                    gotRenameName = true;
                                    renameName = '';
                                    renameStackLength = xmlElementStack;
                                    storeToken = false;
                                } else {
                                    tokenChars.push(currentChar);
                                }
                            }
                            break;
                        // whitespace after start tag name
                        case XMLCharState.lsElementNameWs:
                        // the '>' char after start tag name
                        case XMLCharState.rSt:
                        // the '>' char at the end of start tag *with* atts
                        case XMLCharState.rStNoAtt:
                            // we can get the start tag name now
                            if (storeToken) {
                                if (lineNumberChar >= renameStartChar) {
                                    renameName = tokenChars.join('');
                                    gotRenameName = true;
                                    renameStackLength = xmlElementStack;
                                }                               
                            }
                            storeToken = false;
                            tokenChars = [];
                            if (nextState !== XMLCharState.lsElementNameWs) {
                                xmlElementStack++;
                            }
                            break;
                        // the '>' char at the end of start tag *with* atts
                        // we already have the start tag name:
                        case XMLCharState.rSt:
                            if (storeToken) {
                                if (lineNumberChar >= renameStartChar) {
                                    renameName = tokenChars.join('');
                                    gotRenameName = true;
                                }
                            }
                            xmlElementStack++;
                            storeToken = false;
                            tokenChars = [];
                            break;
                        // end of self-closing tag with attributes:
                        case XMLCharState.rSelfCt:
                        // end of self-closing tag with no attributes:
                        case XMLCharState.rSelfCtNoAtt:
                            storeToken = false;
                            tokenChars = [];
                            break;
                        // end of close-tag
                        case XMLCharState.rCt:
                            if (xmlElementStack === renameStackLength) {
                                let closeTag = tokenChars.join('');
                                endTagStartPos = {startTag: renameName, endTag: closeTag, startPosition: new vscode.Position(lineNumber, lineNumberChar - tokenChars.length)};
                                breakLoop = true;
                            }

                            storeToken = false;
                            tokenChars = [];
                            break;
                        case XMLCharState.sqAvt:
                            nextState = XMLCharState.lSq;
                            break;
                        case XMLCharState.dqAvt:
                            nextState = XMLCharState.lDq;
                            break;
                        case XMLCharState.tvt:
                            nextState = XMLCharState.init;
                            break;
                        case XMLCharState.tvtCdata:
                            nextState = XMLCharState.awaitingRcdata;
                            break;
                        case XMLCharState.rEntity:
                            switch (this.entityContext) {
                                case EntityPosition.text:
                                    nextState = XMLCharState.init;
                                    break;
                                case EntityPosition.attrSq:
                                    nextState = XMLCharState.lSq;
                                    break;
                                case EntityPosition.attrDq:
                                    nextState = XMLCharState.lDq;
                                    break;
                            }
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
