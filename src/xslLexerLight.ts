/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
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
        // default-mode: templates without a mode attribute are in this mode
        let isDefaultModeAttribute = false;
        let isGlobalParameterName = false;
        let isGlobalUsePackageVersion = false;
        let isGlobalInstructionMatch = false;
        let isTypeDeclarationAttribute = false;
        let isParamDefaultSelectAttribute = false;

        let xmlElementStack: number = 0;
        let lCharCount = -1;
        let lineNumber = 0;
        let lineNumberChar = -1;
        let collectParamName = false;
        let pendingParamType: string|undefined;
        let currentParamNamePushed = false;
        let isParamRequiredAttribute = false;
        let pendingParamOptional: boolean | undefined;
        let pendingDeclaredType: string | undefined;
        let isUseAccumulatorsAttribute = false;
        let pendingParamSelect: string|undefined;
        let topLevelParamNamePushed = false;

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
                            pendingParamType = undefined;
                            pendingParamOptional = undefined;
                            pendingDeclaredType = undefined;
                            currentParamNamePushed = false;
                            pendingParamSelect = undefined;
                            topLevelParamNamePushed = false;
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
                                xmlElementStack === 2 && contextGlobalInstructionType === GlobalInstructionType.Function || contextGlobalInstructionType === GlobalInstructionType.Template || contextGlobalInstructionType === GlobalInstructionType.UsePackage ||
                                (xmlElementStack === 1 && isNativeElement) ||
                                // the root element: it isn't known to be native until its xmlns attributes are read
                                (xmlElementStack === 0 && !xmlnsPrefixesOnly)) {
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
                            isDefaultModeAttribute = (isNativeElement || xmlElementStack === 0) && attName === 'default-mode';
                            isGlobalParameterName = false;
                            isParamRequiredAttribute = false;
                            isUseAccumulatorsAttribute = false;
                            isGlobalUsePackageVersion = false;
                            isGlobalInstructionMatch = false;
                            isTypeDeclarationAttribute = false;
                            isParamDefaultSelectAttribute = false;
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
                            } else if (collectParamName && attName === 'required') {
                                isParamRequiredAttribute = true;
                            } else if (isNativeElement && attName === 'use-accumulators') {
                                isUseAccumulatorsAttribute = true;
                            } else if (contextGlobalInstructionType === GlobalInstructionType.UsePackage && attName === 'package-version') {
                                isGlobalUsePackageVersion = true;
                            } else if ((tagGlobalInstructionType === GlobalInstructionType.Function || collectParamName || XslLexer.hasDeclaredType(tagGlobalInstructionType)) && attName === 'as') {
                                isTypeDeclarationAttribute = true;
                            } else if (tagGlobalInstructionType === GlobalInstructionType.Parameter && attName === 'select') {
                                isParamDefaultSelectAttribute = true;
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
                            if (isDefaultModeAttribute) {
                                const defaultMode = tokenChars.join('').trim();
                                if (defaultMode !== '' && defaultMode !== '#unnamed') {
                                    const defaultModeToken: BaseToken = {
                                        line: lineNumber,
                                        length: defaultMode.length,
                                        startCharacter: lineNumberChar - (defaultMode.length + 1),
                                        value: defaultMode,
                                        tokenType: XSLTokenLevelState.attributeValue
                                    };
                                    this.globalModeData.push({type: GlobalInstructionType.ModeTemplate, name: defaultMode, token: defaultModeToken, idNumber: 0, isDefaultMode: true});
                                }
                                isDefaultModeAttribute = false;
                            }
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
                                if (globalType === GlobalInstructionType.ModeTemplate) {
                                    const modeTokens = XslLexer.tokensInsideToken(tkn, attValue);
                                    modeTokens.forEach((modeToken) => targetGlobal.push({type: globalType, name: modeToken.value, token: modeToken, idNumber: 0}));
                                } else {
                                    const newGlobal: GlobalInstructionData = {type: globalType, name: attValue, token: tkn, idNumber: 0};
                                    if (pendingDeclaredType !== undefined) {
                                        newGlobal.declaredType = pendingDeclaredType;
                                        pendingDeclaredType = undefined;
                                    }
                                    if (globalType === GlobalInstructionType.Parameter) {
                                        newGlobal.defaultSelect = pendingParamSelect;
                                        pendingParamSelect = undefined;
                                        topLevelParamNamePushed = true;
                                    }
                                    targetGlobal.push(newGlobal);
                                }
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
                                            gd.memberTypes?.push(pendingParamType);
                                        } else {
                                            gd['memberNames'] = [attValue];
                                            gd['memberTokens'] = [newToken];
                                            gd['memberTypes'] = [pendingParamType];
                                        }
                                        XslLexer.pushParamOptional(gd, pendingParamOptional);
                                        pendingParamOptional = undefined;
                                        gd.idNumber++;
                                        pendingParamType = undefined;
                                        currentParamNamePushed = true;
                                    }
                                }
                            } else if (isParamRequiredAttribute) {
                                const gd = this.globalInstructionData.length > 0 ? this.globalInstructionData[this.globalInstructionData.length - 1] : undefined;
                                pendingParamOptional = XslLexer.recordParamRequired(gd, tokenChars.join(''), currentParamNamePushed);
                                isParamRequiredAttribute = false;
                            } else if (isUseAccumulatorsAttribute) {
                                const valueToken: BaseToken = { line: lineNumber, length: tokenChars.length + 2, startCharacter: lineNumberChar - (tokenChars.length + 2), value: tokenChars.join(''), tokenType: XSLTokenLevelState.attributeValue };
                                XslLexer.recordAccumulatorUses(this.globalInstructionData, valueToken, tokenChars.join(''));
                                isUseAccumulatorsAttribute = false;
                            } else if (isTypeDeclarationAttribute) {
                                const declaredType = tokenChars.join('').trim();
                                if (tagGlobalInstructionType === GlobalInstructionType.Function && this.globalInstructionData.length > 0) {
                                    this.globalInstructionData[this.globalInstructionData.length - 1]['returnType'] = declaredType;
                                } else if (XslLexer.hasDeclaredType(tagGlobalInstructionType)) {
                                    if (tagInstructionNameAdded && this.globalInstructionData.length > 0) {
                                        this.globalInstructionData[this.globalInstructionData.length - 1].declaredType = declaredType;
                                    } else {
                                        pendingDeclaredType = declaredType;
                                    }
                                } else if (collectParamName && this.globalInstructionData.length > 0) {
                                    if (currentParamNamePushed) {
                                        const gd = this.globalInstructionData[this.globalInstructionData.length - 1];
                                        if (gd.memberTypes && gd.memberTypes.length > 0) {
                                            gd.memberTypes[gd.memberTypes.length - 1] = declaredType;
                                        }
                                    } else {
                                        pendingParamType = declaredType;
                                    }
                                }
                            } else if (isParamDefaultSelectAttribute) {
                                const declaredSelect = tokenChars.join('').trim();
                                if (topLevelParamNamePushed && this.globalInstructionData.length > 0) {
                                    const gd = this.globalInstructionData[this.globalInstructionData.length - 1];
                                    if (gd.type === GlobalInstructionType.Parameter) {
                                        gd.defaultSelect = declaredSelect;
                                    }
                                } else {
                                    pendingParamSelect = declaredSelect;
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
                                 || isGlobalInstructionName || isGlobalInstructionMode || isParamDefaultSelectAttribute || isTypeDeclarationAttribute || isUseAccumulatorsAttribute || isDefaultModeAttribute) {
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
