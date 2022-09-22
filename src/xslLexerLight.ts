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
    public analyseLight(xsl: string, xmlnsPrefixesOnly?: boolean): GlobalInstructionData[] {

        this.globalInstructionData = [];
        this.globalModeData = [];

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
        let tagInstructionNameAdded = false;
        let tagMatchToken: BaseToken|null = null;
        let contextGlobalInstructionType = GlobalInstructionType.Unknown;
        let isGlobalInstructionName = false;
        let isGlobalInstructionMode = false;
        let isGlobalParameterName = false;
        let isGlobalUsePackageVersion = false;
        let isGlobalInstructionMatch = false;

        let xmlElementStack: number = 0;
        let lCharCount = -1;
        let lineNumber = 0;
        let lineNumberChar = -1;
        let collectParamName = false;

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
                        case XMLCharState.lCtName:
                            break;
                        case XMLCharState.lEn:
                            if (xmlElementStack === 1 || xmlElementStack === 2 && tokenChars.length < 5) {
                                tokenChars.push(currentChar);
                                storeToken = true;
                            } else {
                                storeToken = false;
                            }
                            break;
                        case XMLCharState.rStNoAtt:
                            xmlElementStack++;
                        case XMLCharState.lsElementNameWs:
                        case XMLCharState.rSelfCtNoAtt:
                        case XMLCharState.rCt:
                            let isCloseTag = nextState === XMLCharState.rCt;
                            let isRootChildStartTag = !isCloseTag && xmlElementStack === 1;
                            let elementProperties = this.getElementProperties(tokenChars, isRootChildStartTag);
                            isNativeElement = elementProperties.isNative;
                            tagGlobalInstructionType = elementProperties.instructionType;
                            tagInstructionNameAdded = false;
                            tagMatchToken = null;
                            collectParamName = false;
                            if (xmlElementStack === 1) {
                                contextGlobalInstructionType = tagGlobalInstructionType;
                            } else if (xmlElementStack === 2 
                                && (contextGlobalInstructionType === GlobalInstructionType.Function || contextGlobalInstructionType === GlobalInstructionType.Template)
                                && isNativeElement && elementProperties.nativeName === 'param') {
                                    collectParamName = true;
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
                            break;      
                        case XMLCharState.lAn:
                            if ((xmlElementStack === 1 && tagGlobalInstructionType !== GlobalInstructionType.Unknown) ||
                                xmlElementStack === 2 && contextGlobalInstructionType === GlobalInstructionType.Function || contextGlobalInstructionType === GlobalInstructionType.Template || contextGlobalInstructionType === GlobalInstructionType.UsePackage) {
                                tokenChars.push(currentChar);
                                storeToken = true;
                            } else if (xmlElementStack < 3 && xmlnsPrefixesOnly) {
                                tokenChars.push(currentChar);
                                storeToken = true;
                            }
                            break;
                        case XMLCharState.lStEq:
                            attName = tokenChars.join('');
                            isGlobalInstructionName = false;
                            isGlobalInstructionMode = false;
                            isGlobalParameterName = false;
                            isGlobalUsePackageVersion = false;
                            isGlobalInstructionMatch = false;
                            if ((tagGlobalInstructionType === GlobalInstructionType.Include || tagGlobalInstructionType === GlobalInstructionType.Import)
                             && attName === 'href') {
                                isGlobalInstructionName = true;
                            } else if (tagGlobalInstructionType !== GlobalInstructionType.Unknown && attName === 'name') {
                                isGlobalInstructionName = true;
                            } else if (attName === 'mode') {
                                isGlobalInstructionMode = true; 
                            } else if (tagGlobalInstructionType == GlobalInstructionType.Template && attName === 'match') {
                                isGlobalInstructionMatch = true;
                            } else if (collectParamName && attName === 'name') {
                                isGlobalParameterName = true;
                            } else if (contextGlobalInstructionType === GlobalInstructionType.UsePackage && attName === 'package-version') {
                                isGlobalUsePackageVersion = true;
                            } else if (xmlnsPrefixesOnly && attName.startsWith('xmlns:')) {
                                let xmlnsTkn: BaseToken = {
                                    line: lineNumber,
                                    length: attName.length,
                                    startCharacter: lineNumberChar,
                                    value: attName,
                                    tokenType: XSLTokenLevelState.attributeName
                                };
                                const gData: GlobalInstructionData = {
                                    idNumber: 0,
                                    name: attName.substring(6),
                                    token: xmlnsTkn,
                                    type: GlobalInstructionType.RootXMLNS
                                };
                                this.globalInstructionData.push(gData);
                            }
                            tokenChars = [];
                            storeToken = false;
                            break;
                        case XMLCharState.rSt:
                            if (tagGlobalInstructionType === GlobalInstructionType.Template && !tagInstructionNameAdded && tagMatchToken) {
                                this.globalInstructionData.push({type: GlobalInstructionType.TemplateMatch, name: `${tagMatchToken.value}#${this.globalInstructionData.length}`, token: tagMatchToken, idNumber: 0});
                            }
                            xmlElementStack++;
                            storeToken = false;
                            tokenChars = [];
                            break;

                        case XMLCharState.rSq:
                        case XMLCharState.rDq:
                        case XMLCharState.escDqAvt:
                        case XMLCharState.escSqAvt:
                            if (isGlobalInstructionName || isGlobalInstructionMode) {
                                let attValue = tokenChars.join('');
                                const modeNames = attValue.split(/\s+/);
                                let tkn: BaseToken = {
                                    line: lineNumber,
                                    length: attValue.length + 2,
                                    startCharacter: lineNumberChar - (attValue.length + 2),
                                    value: attValue,
                                    tokenType: XSLTokenLevelState.attributeValue
                                };
                                let globalType = isGlobalInstructionMode? GlobalInstructionType.Mode: tagGlobalInstructionType;
                                let targetGlobal = isGlobalInstructionMode? this.globalModeData: this.globalInstructionData;
                                if (isGlobalInstructionMode) {
                                    globalType = (xmlElementStack === 1) ? GlobalInstructionType.ModeTemplate : GlobalInstructionType.Mode;
                                    targetGlobal = this.globalModeData;
                                } else {
                                    targetGlobal = this.globalInstructionData;
                                    tagInstructionNameAdded = true;
                                }
                                modeNames.forEach((modeName) => targetGlobal.push({type: globalType, name: modeName, token: tkn, idNumber: 0}));
                                isGlobalInstructionName = false;
                                // fix bug where function arity was added to by following template params
                                //tagGlobalInstructionType = GlobalInstructionType.Unknown;
                            } else if (isGlobalParameterName || isGlobalUsePackageVersion) {
                                let attValue = tokenChars.join('');
                                if (this.globalInstructionData.length > 0) {
                                    let gd = this.globalInstructionData[this.globalInstructionData.length - 1];
                                    if (isGlobalUsePackageVersion) {
                                        gd['version'] = attValue;
                                    } else {
                                        let newToken: BaseToken = {
                                            line: lineNumber,
                                            length: attValue.length + 2,
                                            startCharacter: lineNumberChar - (attValue.length + 2),
                                            value: attValue,
                                            tokenType: XSLTokenLevelState.attributeValue
                                        };
                                        if (gd.memberNames) {
                                            gd.memberNames.push(attValue);
                                            gd.memberTokens?.push(newToken);
                                        } else {
                                            gd['memberNames'] = [attValue];
                                            gd['memberTokens'] = [newToken];
                                        }
                                        gd.idNumber++;
                                    }
                                }
                            } else if (isGlobalInstructionMatch) {
                                let attValue = tokenChars.join('');
                                let tkn: BaseToken = {
                                    line: lineNumber,
                                    length: attValue.length,
                                    startCharacter: lineNumberChar - attValue.length,
                                    value: attValue,
                                    tokenType: XSLTokenLevelState.attributeValue
                                };
                                tagMatchToken = tkn;
                                tagMatchToken.value = attValue;
                            }
                            tokenChars = [];
                            storeToken = false;
                            break;
                        case XMLCharState.lSq:
                        case XMLCharState.lDq:
                            if (contextGlobalInstructionType === GlobalInstructionType.Function || contextGlobalInstructionType === GlobalInstructionType.Template || contextGlobalInstructionType === GlobalInstructionType.UsePackage
                                 || isGlobalInstructionName || isGlobalInstructionMode) {
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
        return this.globalInstructionData.concat(this.globalModeData);
    }

}
