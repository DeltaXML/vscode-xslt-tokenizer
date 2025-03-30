/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XPath/XSLT Lexer/Syntax Highlighter
 */

import { BaseToken, TokenLevelState, XPathLexer, LexPosition, ExitCondition, ErrorType} from "./xpLexer";
import { SchemaData } from "./xsltSchema";
import { Snippet} from './xsltSnippets';

export enum DocumentTypes {
    XSLT,
    XSLT40,
    XPath,
	DCP,
    SCH,
	Other
}

export enum XMLCharState {
    init,// 0 initial state
    lSt,  // 1 left start tag
    rSt,  // 2 right start tag
    rStNoAtt, // no attribute right start tag
    lComment,  // 3 left comment
    rComment,  // 4 right comment
    lPi, // 5 left processing instruction
    lPi2,
    lPiName,
    rPiName,
    lPiValue,
    rPi, // 6 right processing instruction
    rPiNameOnly,
    lCd, // 7 left cdata
    lCdataEnd,
    rCd, // 8 right cdata
    rCdataEnd,
    awaitingRcdata,
    lSq, // 9 left single quote att
    lDq, // 11 left double quote att
    wsBeforeAttname,
    rSq,
    rDq,
    lExclam, // 8 left dtd declaration
    rDtd, // 10 right dtd declaration
	lWs,  // 13 whitspace char start
    lCt,  // 1 left close tag
    lCt2,
    lCtName,
    rCt,  // 2 right close tag
    rSelfCtNoAtt, // self-close no att
    rSelfCt, // self-close
	lEn,  // left element-name
	rEn,  // right element-name
	lAn,  // left atrribute-name
	rAn,  // right attribute-name  
    eqA,  // attribute = symbol
    lAb,  // left angle-bracket
    sqAvt,
    dqAvt,
    escDqAvt,  // attribute value template
    escSqAvt,
    tvt,
    tvtCdata,
    escTvt,
    escTvtCdata,
    lsElementNameWs,
    wsAfterAttName,
    syntaxError,
    lsEqWs,
    lStEq,
    lEntity,
    rEntity,
    lText
}

export enum EntityPosition {
    text,
    attrDq,
    attrSq
}

// for compatibility with legend - add count of XPath enums to this
export enum XSLTokenLevelState {
    attributeName,
    attributeEquals,
    attributeValue,
    xmlnsName,
    dtd,
    dtdEnd,
    elementName,
    elementValue,
    processingInstrName,
    processingInstrValue,
    entityRef,
    xmlComment,
    xmlPunctuation,
    xslElementName,
    xmlText
}

export interface XslToken extends BaseToken {
    line: number;
    startCharacter: number;
    length: number;
    value: string;
    charType?: XMLCharState;
    tokenType: TokenLevelState;
    context?: XslToken|null;
    error?: any;
}

interface XmlElement {
    expandText: boolean;
}

export interface LanguageConfiguration {
    expressionAtts: string[];
    variableElementNames: string[];
    linkElementAttrNames?: [string, string];
    avtAtts?: string[];
    nativePrefix: string;
    tvtAttributes: string[];
    nonNativeAvts: boolean;
    schemaData?: SchemaData;
    docType: DocumentTypes;
    resourceNames?: string[];
    featureNames?: string[];
    propertyNames?: string[];
    rootElementSnippets?: Snippet[];
    elementSnippets?: Snippet[];
    isVersion4?: boolean;
}

export interface GlobalInstructionData {
    name: string;
    type: GlobalInstructionType;
    token: BaseToken;
    idNumber: number;
    memberNames?: string[];
    memberTokens?: BaseToken[];
    href?: string;
    version?: string;
}

export class XslLexer {
    public debug: boolean = false;
    public flatten: boolean = false;
    public timerOn: boolean = false;
    public provideCharLevelState = false;
    public globalInstructionData: GlobalInstructionData[] = [];
    public attributeNameTests: string[]|undefined;
    public elementNameTests: string[]|undefined;
    public isXSLT40 = false;
    protected globalModeData: GlobalInstructionData[] = [];
    private lineNumber: number = 0;
    private charCount = 0;
    private lineCharCount = 0;
    private static xpathLegend = XPathLexer.getTextmateTypeLegend();
    protected static xpathLegendLength = XslLexer.xpathLegend.length;
    private commentCharCount = 0;
    private cdataCharCount = 0;
    protected entityContext = EntityPosition.text;
    private languageConfiguration: LanguageConfiguration;
    private skipTokenChar = false;
    private nativeTvtAttributes: string[] = [];
    private genericTvtAttributes: string[] = [];
    private nativePrefixLength = 0;
    private dtdNesting = 0;
    private nonNativeAvts = false;
    private docType: DocumentTypes;
    private static splitModesregexp = /([^\s]+)|(\s+)/g;
    private static startsWithWSRegex = new RegExp('$\s');


    constructor(languageConfiguration: LanguageConfiguration) {
        this.nonNativeAvts = languageConfiguration.nonNativeAvts;
        this.nativePrefixLength = languageConfiguration.nativePrefix.length === 0? 0: languageConfiguration.nativePrefix.length + 1;
        this.languageConfiguration = languageConfiguration;
        this.languageConfiguration.tvtAttributes.forEach(tvtAttribute => {
            this.nativeTvtAttributes.push(this.languageConfiguration.nativePrefix + ':' + tvtAttribute);
        });
        this.genericTvtAttributes = this.languageConfiguration.tvtAttributes;
        this.docType = languageConfiguration.docType;
    }

    public static getTextmateTypeLegend(): string[] {
        // concat xsl legend to xpath legend
        let textmateTypes: string[] = this.xpathLegend.slice(0);
        let keyCount: number = Object.keys(XSLTokenLevelState).length / 2;
        for (let i = 0; i < keyCount; i++) {
            textmateTypes.push(XSLTokenLevelState[i]);
        }
        return textmateTypes;
    }
    
    public static getXsltStartTokenNumber() {
        return this.xpathLegend.length;
    }

    private isWhitespace (isCurrentCharNewLine: boolean, char: string) {
        return isCurrentCharNewLine || char === ' ' || char == '\t' || char === '\r';
    }

    public isAvtAtt(name: string) {
        return this.languageConfiguration.avtAtts? this.languageConfiguration.avtAtts.indexOf(name) > -1: false;
    }

    public isExpressionAtt(name: string, parentElement: string) {
        if (name === 'use' && (parentElement === 'context-item' || parentElement === 'global-context-item')) {
            return false;
        } else {
            return this.languageConfiguration.expressionAtts ? this.languageConfiguration.expressionAtts.indexOf(name) > -1 : false;
        }
    }

    protected calcNewState (isCurrentCharNewLine: boolean, char: string, nextChar: string, existing: XMLCharState): XMLCharState {
        let rc: XMLCharState = existing;
        let firstCharOfToken = true;

        switch (existing) {
            case XMLCharState.lCt:
                rc = XMLCharState.lCt2;
                break;
            case XMLCharState.lCt2:
                rc = XMLCharState.lCtName;
                break;
            case XMLCharState.lCtName:
                if (char === '>') {
                    rc = XMLCharState.rCt;
                }
                break;
            case XMLCharState.lPi:
                rc = XMLCharState.lPi2;
                break;
            case XMLCharState.lPi2:
                rc = XMLCharState.lPiName;
                break;
            case XMLCharState.lPiName:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    rc = XMLCharState.rPiName;
                } else if (char === '?' && nextChar === '>') {
                    rc = XMLCharState.rPiNameOnly;
                    this.skipTokenChar = true;
                }
                break;
            case XMLCharState.rPiName:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    // no change
                } else if (char === '?' && nextChar === '>') {
                    rc = XMLCharState.rPi;
                    this.skipTokenChar = true;
                } else {
                    rc = XMLCharState.lPiValue;
                }
                break;
            case XMLCharState.lPiValue:
                if (char === '?' && nextChar === '>') {
                    rc = XMLCharState.rPi;
                    this.skipTokenChar = true;
                }
                break;
            case XMLCharState.rPi:
            case XMLCharState.rPiNameOnly:
            case XMLCharState.rSelfCt:
            case XMLCharState.rSelfCtNoAtt:
                if (this.skipTokenChar) {
                    this.skipTokenChar = false;
                } else {
                    rc = this.testChar(char, nextChar, false);
                }
                break;
            case XMLCharState.lComment:
                if (this.commentCharCount === 0) {
                    // char === '-' we've already processed <!-
                    this.commentCharCount++;
                } else if (this.commentCharCount === 1) {
                    // if commendCharCount === 1 then we're just in the comment value
                    if (char === '-' && nextChar === '-') {
                        this.commentCharCount++;
                    }
                } else if (this.commentCharCount === 2) {
                    // we're on the second '-' at comment end
                    this.commentCharCount++;
                } else if (this.commentCharCount === 3) {
                    // we're expecting the '>' at the comment end
                    if (char === '>') {
                        rc = XMLCharState.rComment;
                    }
                    // stop checking as '--' already encountered without '>'
                    this.commentCharCount = 4;
                }
                break;
            case XMLCharState.lExclam:
                // assume  <![CDATA[
                if (char === '[' && nextChar === 'C') {
                    this.cdataCharCount = 0;
                    rc = XMLCharState.lCd;
                } else if (char === '-' && nextChar === '-') {
                    rc = XMLCharState.lComment;
                    this.commentCharCount = 0;
                } else if (char === '>') {
                    this.dtdNesting--;
                    if (this.dtdNesting < 0) {
                        this.dtdNesting = 0;
                        rc = XMLCharState.rDtd;
                    }
                } else if (char === '<') {
                    this.dtdNesting++;
                }
                // TODO: Handle internal DTD subset
                break;
            case XMLCharState.lCd:
                switch (this.cdataCharCount) {
                    case 0:
                        // [C  of <![CDATA[ already checked
                    case 2:
                        // DA already checked
                    case 4:
                        // TA already checked
                        this.cdataCharCount++;
                        break;
                    case 1:
                        if (char === 'D' && nextChar === 'A') {
                            this.cdataCharCount++;
                        } else {
                            rc = XMLCharState.init;
                        }
                        break;
                    case 3:
                        if (char === 'T' && nextChar === 'A') {
                            this.cdataCharCount++;
                        } else {
                            rc = XMLCharState.init;
                        }
                        break;
                    case 5:
                        if (char === '[') {
                            this.cdataCharCount = 0;
                            rc = XMLCharState.lCdataEnd;
                        } else {
                            rc = XMLCharState.init;
                        }
                        break;                    
                }
                break;
            case XMLCharState.lCdataEnd:
            case XMLCharState.awaitingRcdata:
                if (char === ']' && nextChar === ']') {
                    this.cdataCharCount = 0;
                    rc = XMLCharState.rCd;
                } else if (char === '{') {
                    if (nextChar === '{') {
                        rc = XMLCharState.escTvtCdata;
                    } else {
                        rc = XMLCharState.tvtCdata;
                    }
                }
                break;
                // otherwise continue awaiting ]]>
            case XMLCharState.rCd:
                if (this.cdataCharCount === 0) {
                    this.cdataCharCount++;
                } else if (char === '>') {
                    this.cdataCharCount = 0;
                    rc = XMLCharState.rCdataEnd;
                } else {
                    // TODO: ]] not permited on its own in CDATA, show error
                    this.cdataCharCount = 0;
                    rc = XMLCharState.init;
                }
                break;
            case XMLCharState.lSt:
                if (char === '>') {
                    // error for: '<>'
                    rc = XMLCharState.rSt;
                } else {
                    // TODO: check first char of element name is oK
                    rc = XMLCharState.lEn;
                }
                break;
            // element name started
            case XMLCharState.lEn:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    rc = XMLCharState.lsElementNameWs;
                } else if (char === '>') {
                    rc = XMLCharState.rStNoAtt;                
                } else if (char === '/' && nextChar === '>') {
                    rc = XMLCharState.rSelfCtNoAtt;
                    this.skipTokenChar = true;
                }
                break;
            // whitespace after element name (or after att-value)
            case XMLCharState.lsElementNameWs:
            case XMLCharState.rSq:
            case XMLCharState.rDq:
            case XMLCharState.wsBeforeAttname:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    if (existing !== XMLCharState.lsElementNameWs)  {
                        rc = XMLCharState.wsBeforeAttname;
                    }
                } else if (char === '>') {
                    rc = XMLCharState.rSt;
                } else if (char === '/' && nextChar === '>') {
                    rc = XMLCharState.rSelfCt;
                    this.skipTokenChar = true;
                } else {
                    rc = XMLCharState.lAn;
                }
                break;
            // attribute name started
            case XMLCharState.lAn:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    rc = XMLCharState.wsAfterAttName;
                } else if (char === '=') {
                    rc = XMLCharState.lStEq;
                } else {
                    const charState = this.testAttNameChar(char, nextChar);
                    if (charState !== XMLCharState.lText) {
                        rc = charState;
                    }
                }
                break;
            // whitespace after attribute name
            case XMLCharState.wsAfterAttName:
                if (char === '=') {
                    rc = XMLCharState.lStEq;
                } else if (!this.isWhitespace(isCurrentCharNewLine, char)) {
                    // TODO: force error - guessing intended end of start tag
                    rc = XMLCharState.syntaxError;
                }
                break;
            // '=' char after attribute name or
            // whitespace after attname and '=' char
            case XMLCharState.lStEq:
            case XMLCharState.lsEqWs:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    rc = XMLCharState.lsEqWs;
                } else if (char === '"') {
                    rc = XMLCharState.lDq;
                } else if (char === '\'') {
                    rc = XMLCharState.lSq;
                } else {
                    rc = XMLCharState.syntaxError;
                }
                break;
            case XMLCharState.lDq:
                if (char === '"') {
                    rc = XMLCharState.rDq;
                } else if (char === '{') {
                    if (nextChar === '{') {
                        rc = XMLCharState.escDqAvt;
                    } else {
                        rc = XMLCharState.dqAvt;
                    }
                } else if (char === '&') {
                    rc = XMLCharState.lEntity;
                    this.entityContext = EntityPosition.attrDq;
                } else {
                    const charState = this.testAttValueChar(char, nextChar);
                    if (charState !== XMLCharState.lText) {
                        rc = charState;
                    }
                }
                break; 
            case XMLCharState.lSq:
                if (char === '\'') {
                    rc = XMLCharState.rSq;
                } else if (char === '{') {
                    if (nextChar === '{') {
                        rc = XMLCharState.escSqAvt;
                    } else {
                        rc = XMLCharState.sqAvt;
                    }
                } else if (char === '&') {
                    rc = XMLCharState.lEntity;
                    this.entityContext = EntityPosition.attrSq;
                } else {
                    const charState = this.testAttValueChar(char, nextChar);
                    if (charState !== XMLCharState.lText) {
                        rc = charState;
                    }
                }
                break; 
            case XMLCharState.escDqAvt:
                rc = XMLCharState.lDq;
                break;
            case XMLCharState.escSqAvt:
                rc = XMLCharState.lSq;
                break;
            case XMLCharState.escTvt:
                rc = XMLCharState.init;
                break;
            case XMLCharState.escTvtCdata:
                rc = XMLCharState.awaitingRcdata;
                break;
            case XMLCharState.lEntity:
                 if (char === ';') {
                    rc = XMLCharState.rEntity;
                } else if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    rc = this.testChar(char, nextChar, false);
                }
                break;
            case XMLCharState.lText:
                rc = this.testChar(char, nextChar, true);
                break;
            default:
                // awaiting a new node
                rc = this.testChar(char, nextChar, false);
        }
        return rc;
    }

    private testAttNameChar (char: string, nextChar: string): XMLCharState {
        let rc: XMLCharState;

        switch (char) {
            case '<':
                switch (nextChar) {
                    case '?':
                        rc = XMLCharState.lPi;
                        break;
                    case '!':
                        rc = XMLCharState.lExclam;
                        break;
                    case '/':
                        rc = XMLCharState.lCt;
                        break;
                    default:
                        rc = XMLCharState.lSt;                 
                }
                break;
            case '{':
                if (nextChar === '{') {
                    rc = XMLCharState.escTvt;
                } else {
                    rc = XMLCharState.tvt;
                }
                break;
            case '&':
                // TODO: check next char is not ';'
                rc = XMLCharState.lEntity;
                this.entityContext = EntityPosition.text;
                break;
            case '/':
            case '>':
                rc = XMLCharState.syntaxError;
                break;
            default:
                rc = XMLCharState.lText;
                break;
        }
        return rc;
    }

    private testAttValueChar (char: string, nextChar: string): XMLCharState {
        let rc: XMLCharState;

        switch (char) {
            case '<':
                switch (nextChar) {
                    case '?':
                        rc = XMLCharState.lPi;
                        break;
                    case '!':
                        rc = XMLCharState.lExclam;
                        break;
                    case '/':
                        rc = XMLCharState.lCt;
                        break;
                    default:
                        rc = XMLCharState.lSt;                 
                }
                break;
            case '/':                
                rc = nextChar === '>'? XMLCharState.syntaxError: XMLCharState.lText;
                break;
            default:
                rc = XMLCharState.lText;
                break;
        }
        return rc;
    }

    private testChar (char: string, nextChar: string, isText: boolean): XMLCharState {
        let rc: XMLCharState;

        switch (char) {
            case ' ':
            case '\t':
            case '\r':
                if (isText) {
                    rc = XMLCharState.lText;
                } else {
                    rc = XMLCharState.lWs;
                }
                break;
            case '\n':
                rc = XMLCharState.lWs;
                break;
            case '<':
                switch (nextChar) {
                    case '?':
                        rc = XMLCharState.lPi;
                        break;
                    case '!':
                        rc = XMLCharState.lExclam;
                        break;
                    case '/':
                        rc = XMLCharState.lCt;
                        break;
                    default:
                        rc = XMLCharState.lSt;                 
                }
                break;
            case '{':
                if (nextChar === '{') {
                    rc = XMLCharState.escTvt;
                } else {
                    rc = XMLCharState.tvt;
                }
                break;
            case '&':
                // TODO: check next char is not ';'
                rc = XMLCharState.lEntity;
                this.entityContext = EntityPosition.text;
                break;
            default:
                rc = XMLCharState.lText;
                break;
        }
        return rc;
    }

    public analyse(xsl: string, keepNameTests?: boolean): BaseToken[] {
        if (this.timerOn) {
            console.time('xslLexer.analyse');
        }
        this.globalInstructionData.length = 0;
        this.globalModeData.length = 0;
        this.lineNumber = 0;
        this.lineCharCount = -1;
        this.charCount = -1;
        if (keepNameTests) {
            this.attributeNameTests = [];
            this.elementNameTests = [];
        } else {
            this.attributeNameTests = undefined;
            this.elementNameTests = undefined;
        }
        

        let currentState: XMLCharState = XMLCharState.init;
        let currentChar: string = '';
        let tokenChars: string[] = [];
        let result: BaseToken[] = [];
        let attName: string = '';
        let avtExit = false;

        let xpLexer: XPathLexer = new XPathLexer();
        xpLexer.elementNameTests = this.elementNameTests;
        xpLexer.attributeNameTests = this.attributeNameTests;

        xpLexer.documentText = xsl;
        xpLexer.documentTokens = result;
        xpLexer.debug = this.debug;
        xpLexer.timerOn = this.timerOn;
        let xslLength = xsl.length;
        let storeToken = false;
        let isNativeElement = false;
        let tagElementName = '';
        let tagGlobalInstructionType = GlobalInstructionType.Unknown;
        let tagInstructionNameAdded = false;
        let tagMatchToken: BaseToken|null = null;
        let contextGlobalInstructionType = GlobalInstructionType.Unknown;
        let isGlobalVersion = false;
        let isXPathAttribute = false;
        let isExpandTextAttribute = false;
        let isGlobalInstructionName = false;
        let isGlobalInstructionMode = false;
        let isGlobalParameterName = false;
        let isGlobalUsePackageVersion = false;
        let isGlobalInstructionMatch = false;

        let expandTextValue: boolean|null = false;
        let xmlElementStack: XmlElement[] = [];
        let tokenStartChar = -1;
        let tokenStartLine = -1;
        let attributeNameTokenAdded = false;
        let collectParamName = false;
        let xpathEnded = false;
        
        if (this.debug) {
            console.log("xsl:\n" + xsl);
        }

        if (xslLength === 0) {
            return [];
        }

        while (this.charCount < xslLength) {
            this.charCount++;
            this.lineCharCount++;
            let nextState: XMLCharState = XMLCharState.init;
            let nextChar: string = xsl.charAt(this.charCount);
            const isLastChar: boolean = this.charCount === xslLength;
            const resultLengthAtLastChar = isLastChar? result.length: -1;

            if (currentChar) {
                let isCurrentCharNewLIne = currentChar === '\n';

                nextState = this.calcNewState(
                    isCurrentCharNewLIne,
                    currentChar,
                    nextChar,
                    currentState,
                );

                if (nextState === currentState) {
                    if (isCurrentCharNewLIne || isLastChar) {
                        // we must split multi-line tokens:
                        let addToken: XSLTokenLevelState|null = null;
                        switch (nextState) {
                            case XMLCharState.lPiValue:
                                addToken = XSLTokenLevelState.processingInstrValue;
                                this.addNewTokenToResult(tokenStartChar, addToken, result, nextState);
                                break;
                            case XMLCharState.lComment:
                                addToken = XSLTokenLevelState.xmlComment;
                                tokenStartChar = tokenStartChar === 0? tokenStartChar: tokenStartChar - 2;
                                break;
                            case XMLCharState.lDq:
                            case XMLCharState.lSq:
                                addToken = XSLTokenLevelState.attributeValue;
                                break;
                            case XMLCharState.lExclam:
                                addToken = XSLTokenLevelState.dtd;
                                break;
                        }
                        if (addToken !== null) {
                            this.addNewTokenToResult(tokenStartChar, addToken, result, nextState);
                            tokenStartChar = 0;
                        } else if (isLastChar) {
                            let alreadyDone = result.length > 0 && result[result.length - 1].startCharacter === tokenStartChar;
                            if (!alreadyDone) {
                                this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.xmlText, result, nextState);
                            }
                        }
                    } else if (storeToken) {
                        tokenChars.push(currentChar);
                    }
                } else {
                    if (currentState === XMLCharState.lText) {
                        if (nextState === XMLCharState.escTvt) {
                            this.addCharTokenToResult(tokenStartChar, this.lineCharCount - tokenStartChar, XSLTokenLevelState.xmlText, result, currentState);
                        } else {
                            this.addCharTokenToResult(tokenStartChar, (this.lineCharCount - 1) - tokenStartChar, XSLTokenLevelState.xmlText, result, currentState);
                        }
                    } else if (currentState === XMLCharState.escTvt) {
                        this.addCharTokenToResult(tokenStartChar, 2, XSLTokenLevelState.xmlText, result, currentState);
                    }
                    if (currentState === XMLCharState.lEntity && nextState !== XMLCharState.rEntity) {
                        // recover from syntax error:
                        this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.entityRef, result, nextState);
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
                    }
                    switch (nextState) {
                        case XMLCharState.lSt:
                            this.addCharTokenToResult(this.lineCharCount - 1, 1, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            break;
                        case XMLCharState.lCtName:
                        case XMLCharState.lEn:
                            expandTextValue = null;
                            if (tokenChars.length < 5) {
                                tokenChars.push(currentChar);
                                storeToken = true;
                            } else {
                                storeToken = false;
                            }
                            break;
                        case XMLCharState.rStNoAtt:
                            expandTextValue = this.addToElementStack(expandTextValue, xmlElementStack);
                            // cascade, so no-break intentional
                        case XMLCharState.lsElementNameWs:
                        case XMLCharState.rSelfCtNoAtt:
                        case XMLCharState.rCt:
                            let isCloseTag = nextState === XMLCharState.rCt;
                            let isRootChildStartTag = !isCloseTag && xmlElementStack.length === 1;
                            let elementProperties = this.getElementProperties(tokenChars, isRootChildStartTag);
                            isNativeElement = elementProperties.isNative;
                            tagGlobalInstructionType = elementProperties.instructionType;
                            tagElementName = elementProperties.nativeName;
                            tagInstructionNameAdded = false;
                            tagMatchToken = null;
                            collectParamName = false;
                            if (xmlElementStack.length === 0 && tokenChars.length > 5) {
                                tagGlobalInstructionType = GlobalInstructionType.RootXSLT;
                            } if (xmlElementStack.length === 1) {
                                contextGlobalInstructionType = tagGlobalInstructionType;
                            } else if (xmlElementStack.length === 2 
                                && (contextGlobalInstructionType === GlobalInstructionType.Function || contextGlobalInstructionType === GlobalInstructionType.Template)
                                && isNativeElement && elementProperties.nativeName === 'param') {
                                    collectParamName = true;
                            }

                            if (isCloseTag) {
                                if (xmlElementStack.length > 0) {
                                    xmlElementStack.pop();
                                }
                            }

                            storeToken = false;
                            tokenChars = [];

                            let newTokenType = isNativeElement? XSLTokenLevelState.xslElementName: XSLTokenLevelState.elementName;
                            this.addNewTokenToResult(tokenStartChar, newTokenType, result, nextState);
                            if (nextState !== XMLCharState.lsElementNameWs) {
                                let punctuationLength = nextState === XMLCharState.rCt || nextState === XMLCharState.rStNoAtt? 1: 2;
                                this.addCharTokenToResult(this.lineCharCount - 1, punctuationLength, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            }
                            break;
                        case XMLCharState.rDtd:
                            this.addCharTokenToResult(tokenStartChar, this.lineCharCount - tokenStartChar, XSLTokenLevelState.dtdEnd, result, currentState);
                            break;
                        case XMLCharState.rPiName:
                            this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.processingInstrName, result, nextState);
                            break;
                        case XMLCharState.rPi:
                            this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.processingInstrValue, result, currentState);
                            this.addCharTokenToResult(this.lineCharCount - 1, 2, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            break;
                        case XMLCharState.rPiNameOnly:
                            this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.processingInstrName, result, currentState);
                            this.addCharTokenToResult(this.lineCharCount - 1, 2, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            break;
                        case XMLCharState.rComment:
                            let startChar = tokenStartChar > 0? tokenStartChar -2: 0;
                            this.addNewTokenToResult(startChar, XSLTokenLevelState.xmlComment, result, nextState); 
                            break;
                        case XMLCharState.wsAfterAttName:
                        case XMLCharState.syntaxError:
                            storeToken = false;
                            this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.attributeName, result, nextState);
                            attributeNameTokenAdded = true;
                            break;      
                        case XMLCharState.lAn:
                            tokenChars.push(currentChar);
                            storeToken = true;
                            attributeNameTokenAdded = false;
                            break;
                        case XMLCharState.lStEq:
                            let isXMLNSattribute = false;
                            isGlobalInstructionName = false;
                            isGlobalInstructionMode = false;
                            isGlobalParameterName = false;
                            isGlobalInstructionMatch = false;
                            isGlobalUsePackageVersion = false;
                            isGlobalVersion = false;
                            attName = tokenChars.join('');
                            let attributeNameToken = XSLTokenLevelState.attributeName;
                            if (isNativeElement) {
                                // if (attName === 'as') {
                                //     isXPathAttribute = true;
                                // } 
                                if (attName === 'saxon:options') {
                                    isXPathAttribute = true;
                                } else if (this.genericTvtAttributes.indexOf(attName) > -1) {
                                    isXPathAttribute = false;
                                    isExpandTextAttribute = true;
                                } else if (attName.startsWith('xmlns')) {
                                    isExpandTextAttribute = false;
                                    isXMLNSattribute = true;
                                    attributeNameToken = XSLTokenLevelState.xmlnsName;
                                } else if (tagGlobalInstructionType === GlobalInstructionType.RootXSLT && attName === 'version') {
                                    isExpandTextAttribute = false;
                                    isGlobalVersion = true;
                                } else if ((tagGlobalInstructionType === GlobalInstructionType.Include || tagGlobalInstructionType === GlobalInstructionType.Import)
                                     && (attName === 'href' || (this.languageConfiguration.docType === DocumentTypes.DCP && this.languageConfiguration.linkElementAttrNames && attName === this.languageConfiguration?.linkElementAttrNames[1]))) {
                                    isExpandTextAttribute = false;
                                    isGlobalInstructionName = true;
                                } else if (tagGlobalInstructionType !== GlobalInstructionType.Unknown && attName === 'name') {
                                    isExpandTextAttribute = false;
                                    isGlobalInstructionName = true;
                                } else if (attName === 'mode') {
                                    isExpandTextAttribute = false;
                                    isGlobalInstructionMode = true;
                                } else if (tagGlobalInstructionType === GlobalInstructionType.Template && attName === 'match') {
                                    isExpandTextAttribute = false;
                                    isGlobalInstructionMatch = true;
                                    isXPathAttribute = true;
                                } else if (collectParamName && attName === 'name') {
                                    isGlobalParameterName = true;
                                } else if (contextGlobalInstructionType === GlobalInstructionType.UsePackage && attName === 'package-version') {
                                    isExpandTextAttribute = false;
                                    isGlobalUsePackageVersion = true;
                                } else {
                                    isExpandTextAttribute = false;
                                    isXPathAttribute = this.isExpressionAtt(attName, tagElementName);
                                }
                            } else {
                                if (this.nativeTvtAttributes.indexOf(attName) > -1) {
                                    isExpandTextAttribute = true;
                                } else if (attName.startsWith('xmlns')) {
                                    isExpandTextAttribute = false;
                                    isXMLNSattribute = true;
                                    attributeNameToken = XSLTokenLevelState.xmlnsName;
                                } else {
                                    isExpandTextAttribute = false;
                                }
                            }
                            if (!attributeNameTokenAdded) {
                                this.addNewTokenToResult(tokenStartChar, attributeNameToken, result, nextState);
                            } else if (isXMLNSattribute) {
                                result[result.length - 1].tokenType = XslLexer.xpathLegendLength + attributeNameToken;
                            }
                            this.addCharTokenToResult(this.lineCharCount - 1, 1, XSLTokenLevelState.attributeEquals, result, nextState);
                            tokenChars = [];
                            storeToken = false;
                            break;
                        case XMLCharState.rSt:
                            if (tagGlobalInstructionType === GlobalInstructionType.Template && !tagInstructionNameAdded && tagMatchToken) {
                                this.globalInstructionData.push({type: GlobalInstructionType.TemplateMatch, name: `${tagMatchToken.value}#${this.globalInstructionData.length}`, token: tagMatchToken, idNumber: 0});
                            }
                            expandTextValue = this.addToElementStack(expandTextValue, xmlElementStack);
                            this.addCharTokenToResult(this.lineCharCount - 1, 1, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            storeToken = false;
                            tokenChars = [];
                            break;
                        case XMLCharState.lCt:
                        case XMLCharState.lPi:
                            this.addCharTokenToResult(this.lineCharCount - 1, 2, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            break;
                        case XMLCharState.rSelfCt:
                            this.addCharTokenToResult(this.lineCharCount - 1, 2, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            break;
                        case XMLCharState.lCt2:
                            break;
                        case XMLCharState.rSq:
                        case XMLCharState.rDq:
                        case XMLCharState.escDqAvt:
                        case XMLCharState.escSqAvt:
                            if (isExpandTextAttribute) {
                                let attValue = tokenChars.join('');
                                expandTextValue = attValue === 'yes' || attValue === 'true' || attValue === '1';
                            }
                            if (xpathEnded) {
                                tokenStartChar++;
                                xpathEnded = false;
                            }
                            let newToken = this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.attributeValue, result, nextState);
                            if (isGlobalInstructionName || isGlobalInstructionMode) {
                                let attValue = tokenChars.join('');                               
                                let newTokenCopy = Object.assign({}, newToken);
                                let globalType = tagGlobalInstructionType;
                                let targetGlobal;
                                if (isGlobalInstructionMode) {
                                    globalType = (xmlElementStack.length === 1) ? GlobalInstructionType.ModeTemplate : GlobalInstructionType.Mode;
                                    targetGlobal = this.globalModeData;
                                } else {
                                    targetGlobal = this.globalInstructionData;
                                    tagInstructionNameAdded = true;
                                }
                                if (globalType === GlobalInstructionType.ModeTemplate) {
                                    const modeTokens = XslLexer.tokensInsideToken(newToken, attValue);
                                    modeTokens.forEach((modeToken) => targetGlobal.push({type: globalType, name: modeToken.value, token: modeToken, idNumber: 0}));
                                } else {
                                    const idNumber = globalType === GlobalInstructionType.Variable ? result.length : 0;
                                    targetGlobal.push({type: globalType, name: attValue, token: newTokenCopy, idNumber: idNumber});
                                }
                            } else if (isGlobalParameterName) {
                                let attValue = tokenChars.join('');
                                if (this.globalInstructionData.length > 0) {
                                    let gd = this.globalInstructionData[this.globalInstructionData.length - 1];
                                    if (gd.memberNames) {
                                        if (gd.memberNames.indexOf(attValue) > -1) {
                                            newToken['error'] = ErrorType.DuplicateParameterName;
                                            newToken.value = attValue;
                                        }
                                        gd.memberNames.push(attValue);
                                        gd.memberTokens?.push({...newToken});
                                    } else {
                                        gd['memberNames'] = [attValue];
                                        gd['memberTokens'] = [{...newToken}];
                                    }
                                    gd.idNumber++;
                                }
                            } else if (isGlobalUsePackageVersion) {
                                let attValue = tokenChars.join('');
                                if (this.globalInstructionData.length > 0) {
                                    let gd = this.globalInstructionData[this.globalInstructionData.length - 1];
                                    gd['version'] = attValue;
                                }
                            } else if (isGlobalInstructionMatch) {
                                let attValue = tokenChars.join('');
                                tagMatchToken = newToken;
                                tagMatchToken.value = attValue;
                            } else if (isGlobalVersion) {
                                let attValue = tokenChars.join('');
                                this.isXSLT40 = attValue === '4.0';
                                isGlobalVersion = false;
                            }
                            tokenChars = [];
                            storeToken = false;
                            break;
                        case XMLCharState.lSq:
                        case XMLCharState.lDq:
                            if (contextGlobalInstructionType === GlobalInstructionType.Function || contextGlobalInstructionType === GlobalInstructionType.Template || contextGlobalInstructionType === GlobalInstructionType.UsePackage || tagGlobalInstructionType === GlobalInstructionType.RootXSLT) {
                                storeToken = true;
                            }
                            if (isExpandTextAttribute || isGlobalInstructionName || isGlobalInstructionMode) {
                                storeToken = true;
                            } else if (isXPathAttribute) {
                                this.addCharTokenToResult(this.lineCharCount - 1, 1, XSLTokenLevelState.attributeValue, result, nextState);
                                let p: LexPosition = {line: this.lineNumber, startCharacter: this.lineCharCount, documentOffset: this.charCount};

                                let exit: ExitCondition;
                                if (nextState === XMLCharState.lSq) {
                                    exit = ExitCondition.SingleQuote;
                                } else {
                                    exit = ExitCondition.DoubleQuote;
                                }

                                xpLexer.analyse('', exit, p);
                                this.updateNames(result);
                                // need to process right double-quote/single-quote
                                this.lineNumber = p.line;
                                let newCharCount = p.documentOffset - 1;
                                if (newCharCount > this.charCount) {
                                    this.charCount = newCharCount;
                                }
                                xpathEnded = true;
                                this.lineCharCount = p.startCharacter;
                                nextChar = xsl.charAt(this.charCount);
                                isXPathAttribute = false;
                            }
                           break;
                        case XMLCharState.sqAvt:
                        case XMLCharState.dqAvt:
                            let exit;
                            if (isNativeElement) {
                                if (this.docType === DocumentTypes.DCP) {
                                    exit = ExitCondition.CurlyBrace;
                                } else if (exit = attName.startsWith('_')) {
                                    exit = ExitCondition.CurlyBrace;
                                } else {
                                    if (tagElementName === 'merge-source') {
                                        exit = ExitCondition.None;
                                    } else {
                                        exit = this.isAvtAtt(attName)? ExitCondition.CurlyBrace: ExitCondition.None;
                                    }
                                }
                            } else if (this.nonNativeAvts) {
                                exit = ExitCondition.CurlyBrace;
                            } else {
                                exit =ExitCondition.None;
                            }

                            if (exit !== ExitCondition.None) {
                                this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.attributeValue, result, nextState);

                                let p: LexPosition = {line: this.lineNumber, startCharacter: this.lineCharCount, documentOffset: this.charCount};
                                
                                xpLexer.analyse('', exit, p);
                                this.updateNames(result);

                                // need to process right double-quote
                                this.lineNumber = p.line;
                                let newCharCount = p.documentOffset - 1;
                                if (newCharCount > this.charCount) {
                                    this.charCount = newCharCount;
                                }
                                // fix issue with last char of xpath
                                this.lineCharCount = p.startCharacter;
                                nextChar = xsl.charAt(this.charCount);
                                avtExit = true;
                            }
                            nextState = nextState === XMLCharState.sqAvt? XMLCharState.lSq: XMLCharState.lDq;
                            break;
                        case XMLCharState.tvt:
                            this.addCharTokenToResult(this.lineCharCount - 1, 1, XSLTokenLevelState.xmlText, result, currentState);
                        case XMLCharState.tvtCdata:
                            let useTvt = xmlElementStack.length > 0 &&
                            xmlElementStack[xmlElementStack.length - 1].expandText;

                            if (useTvt) {
                                let p: LexPosition = {line: this.lineNumber, startCharacter: this.lineCharCount, documentOffset: this.charCount};
                                
                                xpLexer.analyse('', ExitCondition.CurlyBrace, p);
                                this.updateNames(result);
                                // need to process right double-quote
                                this.lineNumber = p.line;
                                let newCharCount = p.documentOffset - 1;
                                if (newCharCount > this.charCount) {
                                    this.charCount = newCharCount;
                                }
                                this.lineCharCount = p.startCharacter;
                                nextChar = xsl.charAt(this.charCount);
                                if (nextState === XMLCharState.tvtCdata) {
                                    nextState = XMLCharState.awaitingRcdata;
                                } else {
                                    nextState = XMLCharState.init;
                                }
                            } else if (nextState === XMLCharState.tvtCdata) {
                                nextState = XMLCharState.awaitingRcdata;
                            }
                            break;
                        case XMLCharState.lEntity:
                            if (this.entityContext !== EntityPosition.text) {
                                this.addCharTokenToResult(tokenStartChar, (this.lineCharCount - 1) - tokenStartChar,
                                    XSLTokenLevelState.attributeValue, result, nextState);
                            }
                            break;
                        case XMLCharState.rEntity:
                            this.addCharTokenToResult(tokenStartChar, this.lineCharCount - tokenStartChar,
                                                         XSLTokenLevelState.entityRef, result, nextState);
                            switch (this.entityContext) {
                                case EntityPosition.text:
                                    nextState = XMLCharState.init;
                                    break;
                                case EntityPosition.attrSq:
                                    nextState = XMLCharState.lSq;
                                    avtExit = true;
                                    break;
                                case EntityPosition.attrDq:
                                    nextState = XMLCharState.lDq;
                                    avtExit = true;
                                    break;
                            }
                            break;
                        case XMLCharState.lCdataEnd:
                            this.addCharTokenToResult(tokenStartChar - 2, 9, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            break;
                        case XMLCharState.rCdataEnd:
                            this.addCharTokenToResult(tokenStartChar, 3, XSLTokenLevelState.xmlPunctuation, result, nextState);
                            break;

                    }
                    tokenStartChar = this.lineCharCount > 0? this.lineCharCount - 1: 0;
                    if (avtExit) {
                        avtExit = false;
                        tokenStartChar++;
                    }
                    tokenStartLine = this.lineNumber;
                } // else ends
                if (isCurrentCharNewLIne) {
                    tokenStartChar = 0;
                    tokenStartLine = 0;
                    this.lineNumber++;
                    this.lineCharCount = 0;
                } 
                currentState = nextState;
            } 
            currentChar = nextChar;

            if (isLastChar && resultLengthAtLastChar === result.length && !(nextState === XMLCharState.lWs || nextState === XMLCharState.lsEqWs)) {
                let alreadyDone = result.length > 0 && result[result.length - 1].startCharacter === tokenStartChar;
                if (!alreadyDone) {
                    this.addCharTokenToResult(tokenStartChar, this.lineCharCount - tokenStartChar, XSLTokenLevelState.xmlText, result, currentState);                        
                }
            }
        } 
        if (this.timerOn) {
            console.timeEnd('xslLexer.analyse');
        }
        this.globalInstructionData = this.globalInstructionData.concat(this.globalModeData);
        return result;
    }

    private updateNames(result: BaseToken[]) {
        if (this.elementNameTests && this.attributeNameTests && result.length > 0) {
            let prevToken = result[result.length - 1];
            if (prevToken.tokenType === TokenLevelState.nodeNameTest) {
                if (this.elementNameTests.indexOf(prevToken.value) < 0) {
                    this.elementNameTests.push(prevToken.value);
                }
            } else if (prevToken.tokenType === TokenLevelState.attributeNameTest) {
                if (this.attributeNameTests.indexOf(prevToken.value) < 0) {
                    this.attributeNameTests.push(prevToken.value);
                }
            }
        }
    }

    public static tokensInsideToken(token: BaseToken, attValue: string) {

        const tokenValues = attValue.match(this.splitModesregexp);
        if (!tokenValues) {
            return [];
        }
        const result: BaseToken[] = [];
        const tokenType = -1; // not a standard token

        let isWhitespace = false;
        // attValue startwith a " character so offset by one:
        let partPosition = token.startCharacter + 1;
        tokenValues.forEach((value, index) => {
            if (index === 0) {
                isWhitespace = this.startsWithWSRegex.test(tokenValues[index]);
            } else {
                // tokenValues isWhiteSpace alternates: 
                // eg: "mode1 mode2" => ["mode1", " ", "mode2"]
                isWhitespace = !isWhitespace;
            }
            const valueLength = value.length;
            if (!isWhitespace) {
                let tkn: BaseToken = {
                    line: token.line,
                    length: valueLength,
                    startCharacter: partPosition,
                    value: value,
                    tokenType: tokenType
                };
                result.push(tkn);
            }
            partPosition += valueLength;
        });
        return result;
    }

    private addNewTokenToResult(tokenStartChar: number, newTokenType: XSLTokenLevelState, result: BaseToken[], charLevelState: XMLCharState): BaseToken {
        let tokenLength = (this.lineCharCount - 1) - tokenStartChar;
        let localTokenStartChar = tokenStartChar;
        if (newTokenType === XSLTokenLevelState.xmlComment || newTokenType === XSLTokenLevelState.attributeValue) {
            tokenLength++;
        }
        let tkn: BaseToken = {
            line: this.lineNumber,
            length: tokenLength,
            startCharacter: localTokenStartChar,
            value: '',
            tokenType: newTokenType + XslLexer.xpathLegendLength
        };
        if (this.provideCharLevelState) {
            tkn['charType'] = charLevelState;
        }
        result.push(tkn);
        return tkn;
    }

    private addCharTokenToResult(tokenStartChar: number, tokenLength: number, newTokenType: XSLTokenLevelState, result: BaseToken[], charLevelState: XMLCharState) {

        let tkn: BaseToken = {
            line: this.lineNumber,
            length: tokenLength,
            startCharacter: tokenStartChar,
            value: '',
            tokenType: newTokenType + XslLexer.xpathLegendLength
        };
        if (this.provideCharLevelState) {
            tkn['charType'] = charLevelState;
        }
        result.push(tkn);
    }

    private addToElementStack(expandTextValue: boolean | null, xmlElementStack: XmlElement[]) {
        if (expandTextValue === null) {
            if (xmlElementStack.length > 0) {
                expandTextValue = xmlElementStack[xmlElementStack.length - 1].expandText;
            }
            else {
                expandTextValue = false;
            }
        }
        xmlElementStack.push({ "expandText": expandTextValue });
        return expandTextValue;
    }

    protected getElementProperties(tokenChars: string[], isRootChild: boolean): ElementProperties {
        let elementName= tokenChars.join('');
        let isNative = (this.nativePrefixLength === 0 && elementName.indexOf(':') === -1) || (tokenChars.length > this.nativePrefixLength && elementName.startsWith(this.languageConfiguration.nativePrefix + ':'));
        let instructionType = GlobalInstructionType.Unknown;
        let nativeName = '';

        if (this.languageConfiguration.docType === DocumentTypes.DCP) {
            if (this.languageConfiguration.variableElementNames && this.languageConfiguration.variableElementNames.indexOf(elementName) !== -1) {
                instructionType = GlobalInstructionType.Variable;
            }
            if (instructionType === GlobalInstructionType.Unknown && this.languageConfiguration.linkElementAttrNames && this.languageConfiguration.linkElementAttrNames[0] === elementName) {
                instructionType = GlobalInstructionType.Import;
            }
        } else if (isNative) {
            nativeName = elementName.substring(this.nativePrefixLength);
            if (isRootChild) {
                switch (nativeName) {
                    case 'variable':
                        instructionType = GlobalInstructionType.Variable;
                        break;
                    case 'param':
                        instructionType = GlobalInstructionType.Parameter;
                        break;
                    case 'function':
                        instructionType = GlobalInstructionType.Function;
                        break;
                    case 'template':
                        instructionType = GlobalInstructionType.Template;
                        break;
                    case 'key':
                        instructionType = GlobalInstructionType.Key;
                        break;
                    case 'import':
                        instructionType = GlobalInstructionType.Import;
                        break;
                    case 'include':
                        instructionType = GlobalInstructionType.Include;
                        break;
                    case 'accumulator':
                        instructionType = GlobalInstructionType.Accumulator;
                        break;
                    case 'mode':
                        instructionType = GlobalInstructionType.ModeInstruction;
                        break;
                    case 'attribute-set':
                        instructionType = GlobalInstructionType.AttributeSet;
                        break;
                    case 'use-package':
                        instructionType = GlobalInstructionType.UsePackage;
                        break;
                }
            }
        }
        return {isNative: isNative, instructionType: instructionType, nativeName: nativeName};
    }
// class ends
}


export interface ElementProperties {
    isNative: boolean;
    instructionType: GlobalInstructionType;
    nativeName: string;
}

export enum GlobalInstructionType {
    Variable,
    Parameter,
    Function,
    Mode,
    ModeInstruction,
    ModeTemplate,
    Accumulator,
    AttributeSet,
    Key,
    Template,
    TemplateMatch,
    Include,
    Import,
    UsePackage,
    RootXMLNS,
    RootXSLT,
    Unknown
}



export interface InnerLexerResult {
    charCount: number;
    lineNumber: number;
    tokens: BaseToken[];       
}
