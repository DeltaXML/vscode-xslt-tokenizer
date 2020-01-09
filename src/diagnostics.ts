import {CharLevelState, TokenLevelState, Token, XPathLexer} from "./xpLexer";

export class Debug {

    public static printResultTokens(tokens: Token[]) {
        tokens.forEach(Debug.showTokens);
    }

    public static printSerializedTokens(testTitle: string, testXpath: string, tokens: Token[]) {
        let preamble: string = `
        
        test('${testTitle}', () => {
        let l: XPathLexer = new XPathLexer();
        let r: Token[] = l.analyse('${testXpath}');
        let ts: Token[] = `;
        let postamble: string = `
        expect (r).toEqual(ts);
    });`
        let r = tokens.reduce(this.serializeTokens, '');
        let result = '[' + r + ']';

        console.log(preamble + result + postamble);
    }

    private static serializeTokens = function(accumulator: any, token: Token|null): any {
        if (!token) {
            return accumulator;
        }
        let err = (token.error)? ', error' : '\"\"';
        let value = token.value;
        let tokenType = 'TokenLevelState.' + Debug.tokenStateToString(token.tokenType);
        let charType = 'CharLevelState.' + Debug.charStateToString(token.charType);
        let childrenString: string = '';
        if (token.children) {
            childrenString = ',\nchildren:';
            childrenString += '[' + token.children.reduce(Debug.serializeTokens, '') + ']';
        }
        let objectString = 
        `
{value: "${value}",
charType: ${charType},
tokenType: ${tokenType + childrenString}
},`;
         return accumulator + objectString;
    }


    public static printMinSerializedTokens(testTitle: string, testXpath: string, tokens: Token[]) {
        let preamble: string = `
        
        test(\`${testTitle}\`, () => {
        let l: XPathLexer = new XPathLexer();
        l.flatten = true;
        let rx: Token[] = l.analyse(\`${testXpath}\`);
        let r: Token[] = Utilities.minimiseTokens2(rx);
        let ts: Token[] = `;
        let postamble: string = `
        expect (r).toEqual(ts);
    });`
        let r = tokens.reduce(this.minSerializeTokens, '');
        let result = '[' + r + ']';

        console.log(preamble + result + postamble);
    }

    private static minSerializeTokens = function(accumulator: any, token: Token|null): any {
        if (!token || XPathLexer.isCharTypeEqual(token, CharLevelState.lWs)) {
            return accumulator;
        } else {
            let err = (token.hasOwnProperty('error'))? "\nerror: true," : '';
            let value = token.value;
            let tokenType = 'TokenLevelState.' + Debug.tokenStateToString(token.tokenType);
            let childrenString: string = '';
            if (token.children) {
                childrenString = ',\nchildren:';
                childrenString += '[' + token.children.reduce(Debug.minSerializeTokens, '') + ']';
            }
            let objectString = `
    {value: \`${value}\`,${err}
    tokenType: ${tokenType + childrenString},
    line: ${token.line},
    length: ${token.length},
    startCharacter: ${token.startCharacter}
    },`;
            return accumulator + objectString;
        }   
    }


    private static showTokens = function(token: Token) {
        let err = (token.error)? ' error' : '';
        let tokenValue = token.value + '';
        let charState: string = Debug.charStateToString(token.charType);
        console.log(Debug.padString(tokenValue) + Debug.padString(charState) + Debug.tokenStateToString(token.tokenType) + err);
        if (token.children) {
            console.log('--- children-start---');
            token.children.forEach(Debug.showTokens);
            console.log('--- children-end ----');
        }
    }

    public static printDebugOutput(cachedRealToken: Token|null, newValue: Token, lineNumber: number, startCharacter: number) {
        if (newValue.value !== '') {
            let showWhitespace = true;
            let cachedRealTokenString: string = cachedRealToken? this.getTokenDebugString(cachedRealToken): '';
            let newT: string =  this.getTokenDebugString(newValue);
            let posString: string = lineNumber + ':' + startCharacter;
            let posPadding: string = this.padColumns(newT.length);

            let cachedTpadding: string = this.padColumns(cachedRealTokenString.length);
            if (newValue.charType === CharLevelState.lWs && !(showWhitespace)) {
                // show nothing
            } else {
                console.log(cachedRealTokenString + cachedTpadding +  newT + posPadding + posString);
            }
        }
    }

    public static printStateOuput(prevRealToken: Token, currentLabelState: CharLevelState, nextLabelState: CharLevelState, token: string ) {
        console.log('============STATE CHANGE ===========================');
        let prevType: string;
        let prevToken: string = '';
        if (prevRealToken === null) {
            prevType = 'NULL';
        } else {
            prevType = Debug.charStateToString(prevRealToken.charType);
            prevToken = prevRealToken.value;
        }
        console.log('prevReal: ' + prevType + '[' + prevToken + ']');
        console.log("from: " + Debug.charStateToString(currentLabelState));
        console.log("to:   " + Debug.charStateToString(nextLabelState)) + "[" + token + "]";
    }

    public static getTokenDebugString(lrt: Token) {
        let prevType: string;
        let prevToken: string = '';
        if (lrt === null) {
            prevType = 'NULL';
        }
        else {
            prevType = this.charStateToString(lrt.charType);
            prevToken = lrt.value;
        }
        let prevTypeLength = (prevType)? prevType.length : 0;
        let oldT: string = prevType + this.padParts(prevTypeLength) +  prevToken + '_';
        return oldT;
    }

    private static padString(text: string): string {
        return text + this.padParts(text.length);
    }

    private static padStringDots(padLength: number): string {
        let padding = '';
        for (let i = 0;  i < 16 - padLength; i++) {
            padding += '.';
        }
        return padding;
    }

    private static padColumns(padLength: number): string {
        let padding = '';
        for (let i = 0;  i < 50 - padLength; i++) {
            padding += ' ';
        }
        return padding;
    }

    private static padParts(padLength: number): string {
        let padding = '';
        for (let i = 0;  i < 16 - padLength; i++) {
            padding += ' ';
        }
        return padding;
    }

    public static debugHeading() {
        let cachedT: string = 'Cached Real Token';
        let newT: string =  'New Token';
        let oldT: string = 'New Real Token';
        let paddingCached: string = this.padColumns(cachedT.length);
        let padding: string = this.padColumns(newT.length);
        console.log('===============================================================================================================');
        console.log(cachedT + paddingCached + newT);
        console.log('===============================================================================================================');
    }

    public static tokenStateToString (resolvedState: TokenLevelState) : string {
        return TokenLevelState[resolvedState];
    }

    public static charStateToString (stringCommentState: CharLevelState|undefined) : string {
        return stringCommentState? CharLevelState[stringCommentState]: '';
    }
}