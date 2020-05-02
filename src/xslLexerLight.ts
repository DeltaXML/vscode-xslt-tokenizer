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
import { BaseToken, XPathLexer } from "./xpLexer";
import * as vscode from 'vscode';



export class XslLexerLight extends XslLexer {
    public analyseLight(xsl: string): GlobalInstructionData[] {

        this.globalInstructionData = [];


        let currentState: XMLCharState = XMLCharState.init;
        let currentChar: string = '';
        let tokenChars: string[] = [];
        let attName: string = '';

        let xpLexer: XPathLexer = new XPathLexer();
        xpLexer.documentText = xsl;
        let xslLength = xsl.length - 1;
        let storeToken = false;
        let isNativeElement = false;
        let tagGlobalInstructionType = GlobalInstructionType.Unknown;
        let contextGlobalInstructionType = GlobalInstructionType.Unknown;
        let isExpandTextAttribute = false;
        let isGlobalInstructionName = false;
        let xmlElementStack: number = 0;
        let attributeNameTokenAdded = false;
        let lCharCount = -1;
        let lineNumber = 0;
        let lineNumberChar = -1;
        

        while (lCharCount < xslLength + 1) {
            lCharCount++;
            lineNumberChar++;
            let nextState: XMLCharState = XMLCharState.init;
            let nextChar: string = xsl.charAt(lCharCount);

            if (currentChar) {
                let isCurrentCharNewLIne = currentChar === '\n';
                if (isCurrentCharNewLIne) {
                    lineNumberChar = 0;
                    lineNumber++;
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
                            break;
                        case XMLCharState.lCtName:
                        case XMLCharState.lEn:
                            if (tokenChars.length < 5) {
                                tokenChars.push(currentChar);
                                storeToken = true;
                            } else {
                                storeToken = false;
                            }
                            break;
                        case XMLCharState.rStNoAtt:
                        case XMLCharState.lsElementNameWs:
                        case XMLCharState.rSelfCtNoAtt:
                        case XMLCharState.rCt:
                            let isCloseTag = nextState === XMLCharState.rCt;
                            let isRootChildStartTag = !isCloseTag && xmlElementStack === 1;
                            let elementProperties = this.getElementProperties(tokenChars, isRootChildStartTag);
                            isNativeElement = elementProperties.isNative;
                            tagGlobalInstructionType = elementProperties.instructionType;
                            if (xmlElementStack === 1) {
                                contextGlobalInstructionType = tagGlobalInstructionType;
                            } else if (xmlElementStack === 2 
                                && contextGlobalInstructionType === GlobalInstructionType.Function
                                && isNativeElement && elementProperties.nativeName === 'param') {
                                if (this.globalInstructionData.length > 0) {
                                    let gd = this.globalInstructionData[this.globalInstructionData.length - 1];
                                    gd.idNumber++;
                                }
                            }

                            if (isCloseTag) {
                                if (xmlElementStack > 0) {
                                    xmlElementStack--;
                                }
                            }

                            storeToken = false;
                            tokenChars = [];
                            break;
                        case XMLCharState.wsAfterAttName:
                        case XMLCharState.syntaxError:
                            storeToken = false;
                            attributeNameTokenAdded = true;
                            break;      
                        case XMLCharState.lAn:
                            tokenChars.push(currentChar);
                            storeToken = true;
                            attributeNameTokenAdded = false;
                            break;
                        case XMLCharState.lStEq:
                            isGlobalInstructionName = false;
                            attName = tokenChars.join('');
                            tokenChars = [];
                            storeToken = false;
                            break;
                        case XMLCharState.rSt:
                            storeToken = false;
                            tokenChars = [];
                            break;

                        case XMLCharState.rSq:
                        case XMLCharState.rDq:
                        case XMLCharState.escDqAvt:
                        case XMLCharState.escSqAvt:
                            if (isGlobalInstructionName) {
                                let attValue = tokenChars.join('');
                                let tkn: BaseToken = {
                                    line: lineNumber,
                                    length: attValue.length,
                                    startCharacter: lineNumberChar - attValue.length,
                                    value: attValue,
                                    tokenType: XSLTokenLevelState.attributeValue
                                };
                                this.globalInstructionData.push({type: tagGlobalInstructionType, name: attValue, token: tkn, idNumber: 0});
                            }
                            tokenChars = [];
                            storeToken = false;
                            break;
                        case XMLCharState.lSq:
                        case XMLCharState.lDq:
                            if (isExpandTextAttribute || isGlobalInstructionName) {
                                storeToken = true;
                            }
                           break;
                        case XMLCharState.sqAvt:
                        case XMLCharState.dqAvt:
                            nextState = nextState === XMLCharState.sqAvt? XMLCharState.lSq: XMLCharState.lDq;
                            break;
                        case XMLCharState.tvt:
                        case XMLCharState.tvtCdata:
                            if (nextState === XMLCharState.tvtCdata) {
                                nextState = XMLCharState.awaitingRcdata;
                            }
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
        return this.globalInstructionData;
    }

}
