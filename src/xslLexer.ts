import { BaseToken, TokenLevelState, XPathLexer, LexPosition, ExitCondition} from "./xpLexer";

export enum XMLCharState {
    init,// 0 initial state
    lSt,  // 1 left start tag
    rSt,  // 2 right start tag
    rStNoAtt, // no attribute right start tag
    lC,  // 3 left comment
	rC,  // 4 right comment
    lPi, // 5 left processing instruction
    lPi2,
    lPiName,
    rPiName,
    lPiValue,
	rPi, // 6 right processing instruction
	lCd, // 7 left cdata
	rCd, // 8 right cdata
    lSq, // 9 left single quote att
    lDq, // 11 left double quote att
    wsBeforeAttname,
    rSq,
    rDq,
    lDtd, // 8 left dtd declaration
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
    lStWs,
    lsElementNameWs,
    wsAfterAttName,
    lsEqWs,
    lStEq
}

// for compatibility with legend - add count of XPath enums to this
export enum XSLTokenLevelState {
    attributeName, 
    attributeValue,
    elementName,
    elementValue,
    processingInstrName,
    processingInstrValue,
    entityRef,
    xmlComment,
    xslElementName
}

export interface XslToken extends BaseToken {
    line: number;
    startCharacter: number;
    length: number;
    value: string;
    charType?: XMLCharState;
    tokenType: TokenLevelState;
    context?: XslToken|null;
    error?: boolean;
}

interface XmlElement {
    expandText: boolean;
}

export class XslLexer {
    public debug: boolean = false;
    public flatten: boolean = false;
    public timerOn: boolean = false;
    private lineNumber: number = 0;
    private charCount = 0;
    private lineCharCount = 0;
    private static xpathLegend = XPathLexer.getTextmateTypeLegend();
    private static xpathLegendLength = XslLexer.xpathLegend.length;

    public static getTextmateTypeLegend(): string[] {
        // concat xsl legend to xpath legend
        let textmateTypes: string[] = this.xpathLegend;
        let keyCount: number = Object.keys(XSLTokenLevelState).length / 2;
        for (let i = 0; i < keyCount; i++) {
            textmateTypes.push(XSLTokenLevelState[i]);
        }
        return textmateTypes;
    }   

    private isWhitespace (isCurrentCharNewLine: boolean, char: string) {
        return isCurrentCharNewLine || char === ' ' || char == '\t' || char === '\r';
    }

    public static expressionAtts = ['context-item', 'count', 'from', 'group-adjacent', 'group-by', 'group-ending-with', 'group-starting-with', 'from', 'for-each-item', 'for-each-source', 'initial-value', 
    'key', 'match', 'namespace-context', 'select', 'test', 'use', 'use-when', 'value', 'with-params', 'xpath' ];

    public static avtAtts = ['allow-duplicate-names', 'base-uri', 'build-tree', 'byte-order-mark', 'case-order', 'cdata-section-elements', 'collation', 'data-type', 'doctype-public', 'doctype-system', 'encoding', 'error-code',
     'escape-uri-attributes', 'flags', 'format', 'grouping-separator', 'grouping-size', 'href', 'html-version', 'include-context-type', 'indent', 'item-separator', 'json-node-output-method',
     'lang', 'letter-value', 'media-type', 'method', 'name', 'namespace', 'normalization-form', 'omit-xml-declaration', 'order', 'ordinal', 'ordinal-type', 'output-version',
     'parameter-document', 'regex', 'separator', 'schema-aware', 'stable', 'standalone', 'suppress-indentaion', 'terminate', 'undeclar-prefixes', 'start-at'];

    private isAvtAtt(name: string) {
        return XslLexer.avtAtts.indexOf(name) > -1;
    }

    private isExpressionAtt(name: string) {
        return XslLexer.expressionAtts.indexOf(name) > -1;
    }

    private calcNewState (isCurrentCharNewLine: boolean, char: string, nextChar: string, existing: XMLCharState): XMLCharState {
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
                }
                break;
            case XMLCharState.rPiName:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    // no change
                } else if (char === '?' && nextChar === '>') {
                    rc = XMLCharState.rPi;
                } else {
                    rc = XMLCharState.lPiValue;
                }
                break;
            case XMLCharState.lPiValue:
                if (char === '?' && nextChar === '>') {
                    rc = XMLCharState.rPi;
                }
                break;
            case XMLCharState.lC:
                if (char === '-' && nextChar === '-') {
                    rc = XMLCharState.rC;
                }
                break;
            case XMLCharState.lDtd:
                // assume  <![CDATA[
                if (char === '[' && nextChar === 'C') {
                    rc = XMLCharState.lCd;
                } else if (char === '-' && nextChar === '-') {
                    rc = XMLCharState.lC;
                } else if (char === '>') {
                    rc = XMLCharState.rDtd;
                }
                // TODO: Handle internal DTD subset
                break;
            case XMLCharState.lCd:
                if (char === ']' && nextChar === ']') {
                    rc = XMLCharState.rCd;                   
                }
                break;
            // left-start-tag
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
                }
                break;
            // whitespace after attribute name
            case XMLCharState.wsAfterAttName:
                if (char === '=') {
                    rc = XMLCharState.lStEq;
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
                }
                break; 
            case XMLCharState.escDqAvt:
                rc = XMLCharState.lDq;
                break;
            case XMLCharState.escSqAvt:
                rc = XMLCharState.lSq;
                break;
            default:
                // awaiting a new node
                rc = this.testChar(char, nextChar);
        }
        return rc;
    }

    private testChar (char: string, nextChar: string): XMLCharState {
        let rc: XMLCharState;

        switch (char) {
            case '<':
                switch (nextChar) {
                    case '?':
                        rc = XMLCharState.lPi;
                        break;
                    case '!':
                        rc = XMLCharState.lDtd;
                        break;
                    case '-':
                        rc = XMLCharState.lC;
                        break;
                    case '/':
                        rc = XMLCharState.lCt;
                        break;
                    default:
                        rc = XMLCharState.lSt;                 
                }
                break;
            case '{':
                rc = XMLCharState.tvt;
                break;
            default:
                rc = XMLCharState.init;
                break;
        }
        return rc;
    }

    public analyse(xsl: string): BaseToken[] {
        if (this.timerOn) {
            console.time('xslLexer.analyse');
        }
        this.lineNumber = 0;
        this.lineCharCount = -1;
        this.charCount = -1;

        let currentState: XMLCharState = XMLCharState.init;
        let currentChar: string = '';
        let tokenChars: string[] = [];
        let result: BaseToken[] = [];
        let nestedTokenStack: XslToken[] = [];
        let attName: string = '';

        let xpLexer: XPathLexer = new XPathLexer();
        xpLexer.documentText = xsl;
        xpLexer.documentTokens = result;
        xpLexer.debug = this.debug;
        xpLexer.flatten = true;
        xpLexer.timerOn = this.timerOn;
        let xslLength = xsl.length - 1;
        let storeToken = false;
        let isXslElement = false;
        let isXPathAttribute = false;
        let isExpandTextAttribute = false;
        let expandTextValue: boolean|null = false;
        let xmlElementStack: XmlElement[] = [];
        let tokenStartChar = -1;
        let tokenStartLine = -1;
        
        if (this.debug) {
            console.log("xsl: " + xsl);
        }

        while (this.charCount < xslLength + 1) {
            this.charCount++;
            this.lineCharCount++;
            let nextState: XMLCharState = XMLCharState.init;
            let nextChar: string = xsl.charAt(this.charCount);

            if (currentChar) {
                let isCurrentCharNewLIne = currentChar === '\n';
            
                if (isCurrentCharNewLIne) {
                    this.lineNumber++;
                    this.lineCharCount = 0;
                } 

                nextState = this.calcNewState(
                    isCurrentCharNewLIne,
                    currentChar,
                    nextChar,
                    currentState,
                );

                if (nextState === currentState) {
                    if (isCurrentCharNewLIne) {
                        // do nothing yet
                    } else if (storeToken) {
                        tokenChars.push(currentChar);
                    }
                } else {
                    switch (nextState) {
                        case XMLCharState.lSt:
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
                            isXslElement = this.isXslMatch(tokenChars);

                            if (nextState === XMLCharState.rCt) {
                                if (xmlElementStack.length > 0) {
                                    xmlElementStack.pop();
                                }
                            }

                            storeToken = false;
                            tokenChars = [];

                            let newTokenType = isXslElement? XSLTokenLevelState.xslElementName: XSLTokenLevelState.elementName;
                            this.addNewTokenToResult(tokenStartChar, newTokenType, result);
                            break;
                        case XMLCharState.rPiName:
                            this.addNewTokenToResult(tokenStartChar, XSLTokenLevelState.processingInstrName, result);
                            break;
                        case XMLCharState.lAn:
                            tokenChars.push(currentChar);
                            storeToken = true;
                            break;
                        case XMLCharState.lStEq:
                            if (isXslElement) {
                                attName = tokenChars.join('');
                                if (attName === 'expand-text') {
                                    isXPathAttribute = false;
                                    isExpandTextAttribute = true;
                                } else {
                                    isExpandTextAttribute = false;
                                    isXPathAttribute = this.isExpressionAtt(attName);
                                }
                            }
                            tokenChars = [];
                            storeToken = false;
                            break;
                        case XMLCharState.rSt:
                            expandTextValue = this.addToElementStack(expandTextValue, xmlElementStack);
                            storeToken = false;
                            tokenChars = [];
                            break;
                        case XMLCharState.lCt:
                        case XMLCharState.lCt2:
                            break;
                        case XMLCharState.rSq:
                        case XMLCharState.rDq:
                            if (isExpandTextAttribute) {
                                let attValue = tokenChars.join('');
                                expandTextValue = attValue === 'yes' || attValue === 'true' || attValue === '1';
                            }
                            tokenChars = [];
                            storeToken = false;
                            break;
                        case XMLCharState.lSq:
                        case XMLCharState.lDq:
                            if (isExpandTextAttribute) {
                                storeToken = true;
                            } else if (isXPathAttribute) {
                                let p: LexPosition = {line: this.lineNumber, startCharacter: this.lineCharCount, documentOffset: this.charCount};

                                let exit: ExitCondition;
                                if (nextState === XMLCharState.lSq) {
                                    exit = ExitCondition.SingleQuote;
                                } else {
                                    exit = ExitCondition.DoubleQuote;
                                }

                                xpLexer.analyse('', exit, p);
                                // need to process right double-quote
                                this.lineNumber = p.line;
                                let newCharCount = p.documentOffset - 1;
                                if (newCharCount > this.charCount) {
                                    this.charCount = newCharCount;
                                }
                                this.lineCharCount = p.startCharacter;
                                nextChar = xsl.charAt(this.charCount);
                                isXPathAttribute = false;
                            }
                           break;
                        case XMLCharState.sqAvt:
                        case XMLCharState.dqAvt:
                            let exit;
                            if (isXslElement) {
                                if (exit = attName.startsWith('_')) {
                                    exit = this.isExpressionAtt(attName.substring(1))? ExitCondition.CurlyBrace: ExitCondition.None;
                                } else {
                                    exit = this.isAvtAtt(attName)? ExitCondition.CurlyBrace: ExitCondition.None;
                                }
                            } else {
                                exit = ExitCondition.CurlyBrace;
                            }

                            if (exit !== ExitCondition.None) {
                                let p: LexPosition = {line: this.lineNumber, startCharacter: this.lineCharCount, documentOffset: this.charCount};
                                
                                xpLexer.analyse('', exit, p);
                                // need to process right double-quote
                                this.lineNumber = p.line;
                                let newCharCount = p.documentOffset - 1;
                                if (newCharCount > this.charCount) {
                                    this.charCount = newCharCount;
                                }
                                this.lineCharCount = p.startCharacter;
                                nextChar = xsl.charAt(this.charCount);
                                nextState = nextState === XMLCharState.sqAvt? XMLCharState.lSq: XMLCharState.lDq;
                            }
                            break;
                        case XMLCharState.tvt:
                            let useTvt = xmlElementStack.length > 0 &&
                            xmlElementStack[xmlElementStack.length - 1].expandText;

                            if (useTvt) {
                                let p: LexPosition = {line: this.lineNumber, startCharacter: this.lineCharCount, documentOffset: this.charCount};
                                
                                xpLexer.analyse('', ExitCondition.CurlyBrace, p);
                                // need to process right double-quote
                                this.lineNumber = p.line;
                                let newCharCount = p.documentOffset - 1;
                                if (newCharCount > this.charCount) {
                                    this.charCount = newCharCount;
                                }
                                this.lineCharCount = p.startCharacter;
                                nextChar = xsl.charAt(this.charCount);
                                nextState = XMLCharState.init;
                            }
                            break;                         
                    }
                    tokenStartChar = this.lineCharCount - 1;
                    tokenStartLine = this.lineNumber;
                } // else ends
                currentState = nextState;
            } 
            currentChar = nextChar;


        } 
        if (this.timerOn) {
            console.timeEnd('xslLexer.analyse');
        }
        return result;
    }

    private addNewTokenToResult(tokenStartChar: number, newTokenType: XSLTokenLevelState, result: BaseToken[]) {
        let tkn: BaseToken = {
            line: this.lineNumber,
            length: (this.lineCharCount - 1) - tokenStartChar,
            startCharacter: tokenStartChar,
            value: '',
            tokenType: newTokenType + XslLexer.xpathLegendLength
        };
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

    private isXslMatch(tokenChars: string[]): boolean {
        return (
        tokenChars.length > 4 &&
        tokenChars[0] === 'x' &&
        tokenChars[1] === 's' &&
        tokenChars[2] === 'l' &&
        tokenChars[3] === ':');
    }
}


export interface InnerLexerResult {
    charCount: number;
    lineNumber: number;
    tokens: BaseToken[];       
}
