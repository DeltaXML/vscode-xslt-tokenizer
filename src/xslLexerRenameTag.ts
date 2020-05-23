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
import { BaseToken} from "./xpLexer";
import * as vscode from 'vscode';



export class XslLexerRenameTag extends XslLexer {

    public renameTag(xsl: string, renamePos: vscode.Position): vscode.TextEdit|null {
        
        this.globalInstructionData = [];
        this.globalModeData = [];
        let renameStartChar = renamePos.character;
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


        while (lCharCount < xslLength + 1) {
            if (breakLoop) {
                console.log('breaking loop');
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
                    if (lineNumber > renameLine && renameName !== '') {
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
                            console.log('start of the close tag name')
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
                                if (renameName === closeTag) {
                                    console.log('found');
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
        return null;
    }

}
