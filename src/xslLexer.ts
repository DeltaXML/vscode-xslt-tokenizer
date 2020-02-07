import { BaseToken, TokenLevelState, XPathLexer, LexPosition, ExitCondition} from "./xpLexer";

export enum XMLCharState {
    init,// 0 initial state
    lSt,  // 1 left start tag
    rSt,  // 2 right start tag
    lC,  // 3 left comment
	rC,  // 4 right comment
	lPi, // 5 left processing instruction
	rPi, // 6 right processing instruction
	lCd, // 7 left cdata
	rCd, // 8 right cdata
    lSq, // 9 left single quote att
    lDq, // 11 left double quote att
    lDtd, // 8 left dtd declaration
    rDtd, // 10 right dtd declaration
	lWs,  // 13 whitspace char start
	lCt,  // 1 left close tag
	rCt,  // 2 right close tag
	lEn,  // left element-name
	rEn,  // right element-name
	lAn,  // left atrribute-name
	rAn,  // right attribute-name  
    eqA,  // attribute = symbol
    lAb,  // left angle-bracket
    lStWs,
    lsElementNameWs,
    lsAttNameWs,
    lsEqWs,
    lStEq
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

export class XslLexer {
    public debug: boolean = false;
    public flatten: boolean = false;
    public timerOn: boolean = false;
    private elementStack: XslToken[] = [];
    private latestRealToken: XslToken|null = null;
    private lineNumber: number = 0;
    private wsCharNumber: number = 0;
    private tokenCharNumber: number = 0;
    private charCount = 0;
    private lineCharCount = 0;
    private wsNewLine = false;
    private deferWsNewLine= false;

    private isWhitespace (isCurrentCharNewLine: boolean, char: string) {
        return isCurrentCharNewLine || char === ' ' || char == '\t' || char === '\r';
    }

    private calcNewState (isFirstChar: boolean, isCurrentCharNewLine: boolean, char: string, nextChar: string, existing: XMLCharState): XMLCharState {
        let rc: XMLCharState = existing;
        let firstCharOfToken = true;

        switch (existing) {
            case XMLCharState.lC:
                if (char === '-' && nextChar === '-') {
                    rc = XMLCharState.rC;
                }
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
            // element name started - or after att-value
            case XMLCharState.lEn:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    rc = XMLCharState.lsElementNameWs;
                } else if (char === '/' && nextChar === '>') {
                    rc = XMLCharState.rCt;
                }
                break;
            // whitespace after element name (or after att-value)
            case XMLCharState.lsElementNameWs:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    // do nothing
                } else if (char === '/' && nextChar === '>') {
                    rc = XMLCharState.rCt;
                } else {
                    rc = XMLCharState.lAn;
                }
                break;
            // attribute name started
            case XMLCharState.lAn:
                if (this.isWhitespace(isCurrentCharNewLine, char)) {
                    rc = XMLCharState.lsAttNameWs;
                } else if (char === '=') {
                    rc = XMLCharState.lStEq;
                }
                break;
            // whitespace after attribute name
            case XMLCharState.lsAttNameWs:
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
                    rc = XMLCharState.lEn;
                }
                break; 
            case XMLCharState.lSq:
                if (char === '\s') {
                    rc = XMLCharState.lEn;
                }
                break; 
            default:
                rc = this.testChar(existing, isFirstChar, char, nextChar);
        }
        return rc;
    }

    private testChar (existing: XMLCharState, isFirstChar: boolean, char: string, nextChar: string): XMLCharState {
        let rc: XMLCharState;

        switch (char) {
            case ' ':
            case '\t':
                rc= XMLCharState.lWs;
                this.wsCharNumber++;
                break;
            case '\r':
                rc = XMLCharState.lWs;
                break;
            case '\n':
                this.deferWsNewLine = true;
                rc = XMLCharState.lWs;
                break;
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
            case '\'':
                rc = XMLCharState.lSq;
                break;
            case '"':
                rc = XMLCharState.lDq;
                break;
            default:
                rc = existing;
        }
        return rc;
    }

    public analyse(xsl: string): BaseToken[] {
        if (this.timerOn) {
            console.time('xslLexer.analyse');
        }
        this.latestRealToken = null;
        this.lineNumber = 0;
        this.lineCharCount = -1;
        this.wsCharNumber = 0;
        this.tokenCharNumber = 0;
        this.wsNewLine = false;
        this.deferWsNewLine = false;
        this.charCount = -1;

        let currentState: XMLCharState = XMLCharState.init;
        let currentChar: string = '';
        let tokenChars: string[] = [];
        let result: BaseToken[] = [];
        let nestedTokenStack: XslToken[] = [];

        let xpLexer: XPathLexer = new XPathLexer();
        xpLexer.documentText = xsl;
        xpLexer.documentTokens = result;
        xpLexer.debug = this.debug;
        xpLexer.flatten = true;
        xpLexer.timerOn = this.timerOn;
        let xslLength = xsl.length - 1;
        
        if (this.debug) {
            console.log("xsl: " + xsl);
        }

        while (this.charCount < xslLength) {
            this.charCount++;
            this.lineCharCount++;
            let nextState: XMLCharState = XMLCharState.init;
            let isFirstTokenChar = this.tokenCharNumber === 0;
            let nextChar: string = xsl.charAt(this.charCount);
            let isCurrentCharNewLIne = currentChar === '\n'

            if (currentChar) {
                nextState = this.calcNewState(
                    isFirstTokenChar,
                    isCurrentCharNewLIne,
                    currentChar,
                    nextChar,
                    currentState,
                );

                if (nextState === currentState) {
                    if (isCurrentCharNewLIne) {
                        this.lineNumber++;
                        this.lineCharCount = -1;
                        this.tokenCharNumber = 0;
                        this.tokenCharNumber++;
                    } else {
                        tokenChars.push(currentChar);
                    }
                } else {
                    switch (nextState) {
                        case XMLCharState.lSt:
                            break;
                        case XMLCharState.rSt:
                            break;
                        case XMLCharState.lCt:
                            break;
                        case XMLCharState.rCt:
                            break;
                        case XMLCharState.lDq:
                            let p: LexPosition = {line: this.lineNumber, startCharacter: this.lineCharCount, documentOffset: this.charCount}
                            xpLexer.analyse('', ExitCondition.DoubleQuote, p);
                            // need to process right double-quote
                            this.lineNumber = p.line;
                            this.charCount = p.documentOffset - 1;
                            this.lineCharCount = p.startCharacter;
                            nextChar = xsl.charAt(this.charCount);                            
                            break;                        
                    }
                }
                currentState = nextState;
            } 
            currentChar = nextChar;


        } 
        if (this.timerOn) {
            console.timeEnd('xslLexer.analyse');
        }
        return result;
    }
}

export interface InnerLexerResult {
    charCount: number;
    lineNumber: number;
    tokens: BaseToken[];       
}
