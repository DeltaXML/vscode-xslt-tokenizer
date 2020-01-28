import { Token, TokenLevelState} from "./xpLexer";

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
    rSq, // 10 right single quote att
    lDq, // 11 left double quote att
    rDq, // 12 right double quote att
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
}

export interface XslToken {
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

    private calcNewState (isFirstChar: boolean, char: string, nextChar: string, existing: XMLCharState): XMLCharState {
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
                }
            case '\'':
                rc = XMLCharState.lSq;
                break;
            case '"':
                rc = XMLCharState.lDtd;
                break;
            default:
                rc = existing;
        }
        return rc;
    }

    public analyse(xsl: string): Token[]|XslToken[] {
        if (this.timerOn) {
            console.time('xslLexer.analyse');
        }
        this.latestRealToken = null;
        this.lineNumber = 0;
        this.lineCharCount = 0;
        this.wsCharNumber = 0;
        this.tokenCharNumber = 0;
        this.wsNewLine = false;
        this.deferWsNewLine = false;
        this.charCount = -1;

        let currentState: XMLCharState = XMLCharState.init;
        let currentChar: string = '';
        let tokenChars: string[] = [];
        let result: Token[] = [];
        let nestedTokenStack: Token[] = []; 
        
        if (this.debug) {
            console.log("xsl: " + xsl);
        }

        while (this.charCount < xsl.length) {
            this.charCount++;
            let nextState: XMLCharState = XMLCharState.init;
            let isFirstTokenChar = this.tokenCharNumber === 0;
            let nextChar: string = xsl.charAt(this.charCount);

            if (currentChar) {
                nextState = this.calcNewState(
                    isFirstTokenChar,
                    currentChar,
                    nextChar,
                    currentState,
                );

                if (nextState === currentState) {
                    if (currentChar == '\n') {
                        this.lineNumber++;
                        this.tokenCharNumber = 0;
                        this.charCount = 0;
                        this.tokenCharNumber++;
                    } 

                    tokenChars.push(currentChar);
                    this.charCount++;

                } else {
                    switch (nextState) {
                        
                    }
                }
                currentState = nextState;
            } 
            currentChar = nextChar;

            if (this.timerOn) {
                console.timeEnd('xslLexer.analyse');
            }
        } 
        return result;
    }
}

export interface InnerLexerResult {
    charCount: number;
    lineNumber: number;
    tokens: Token[];       
}
