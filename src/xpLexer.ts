import { Debug } from "./diagnostics";

const tokenTypes = new Map<string, number>();
const tokenModifiers = new Map<string, number>();

const legend = (function () {
    const tokenTypesLegend = [
        'comment', 'string', 'keyword', 'number', 'regexp', 'operator', 'namespace',
        'type', 'struct', 'class', 'interface', 'enum', 'parameterType', 'function',
        'macro', 'variable', 'constant', 'parameter', 'property', 'label'
    ];
    tokenTypesLegend.forEach((tokenType, index) => tokenTypes.set(tokenType, index));

    const tokenModifiersLegend = [
        'declaration', 'documentation', 'member', 'static', 'abstract', 'deprecated',
        'modification', 'async'
    ];
    tokenModifiersLegend.forEach((tokenModifier, index) => tokenModifiers.set(tokenModifier, index));

    //return new vscode.SemanticTokensLegend(tokenTypesLegend, tokenModifiersLegend);
})();

export enum CharLevelState {
    init,// 0 initial state
    lB,  // 1 left bracket
    rB,  // 2 right bracket
    lC,  // 3 left comment
    rC,  // 4 right comment
    lSq, // 5 left single quote
    rSq, // 6 right single quote
    lDq, // 7 left double quote
    rDq, // 8 right double quote
    lBr, // 8 left brace
    rBr, // 10 right brace
    lPr, // 11 left predicate
    rPr, // 12 right predicate
    lWs,  // 13 whitspace char start
    escSq,  // 14 escaped single quote
    escDq,   // 15 escaped double quote
    sep,    // 16 separator
    lUri,    // 17 left braced URI literal
    rUri,   // 18 right braced URI literal
    lNl,    // 20 left numeric literal
    rNl ,    // 21 right numeric literal
    dSep,    // 22 first char of double char separator
    lVar,    // 23 variable start: $var
    exp,     // 24 exponent in numeric literal - allow + or - or digit after it
    lName,   // 25 node-name, function-name or operator like 'is' etc
    lAttr,   // 26 attribute-name
    dSep2,   // 27 2nd char of double char separator
    lEnt,    // 28 left entity ref
    rEnt,    // 29 right entity ref
    lSqEnt,  // 30 left single quote entity
    rSqEnt,  // 31
    rSqEnt2, // 32
    lDqEnt,  // 33
    rDqEnt,  // 34
    rDqEnt2, // 35 
}

export enum TokenLevelState {
    // where name does not correspond to semantic token name
    // the comment shows the adopted name
    // where state is also used in XSLT, (xsl) is shown
    Attribute,    // struct
    Comment,
    Number,
    Unset,       // macro
    Operator,
    Variable,   // (xsl)
    Whitespace, // not used
    String,
    UriLiteral, // constant
    NodeType,   // parameter
    SimpleType, // parameterType
    Axis,       // label
    Name,        // (xsl) class
    Declaration, // (xsl) keyword
    Function,
}

export enum ExitCondition {
    None,
    SingleQuote,
    DoubleQuote,
    CurlyBrace
}

const tokenTypeLookup: [string, string][] = 
[
    ['Attribute', 'struct'],
    ['Comment', 'comment'],
    ['Number', 'number'],
    ['Unset', 'macro'], // not used
    ['Operator', 'operator'],
    ['Variable', 'variable'],
    ['Whitespace', 'whitespace'], // not used
    ['String','string'],
    ['UriLiteral', 'constant'],
    ['NodeType', 'parameter'],
    ['SimpleType', 'parameterType'],
    ['Axis', 'label'],
    ['Name', 'class'],
    ['Declaration', 'keyword'],
    ['Function', 'function']
];

export type TokenTypeStrings = keyof typeof TokenLevelState;

export enum ModifierState {
    UnusedVar = 0,     // declaration
    UnresolvedRef = 1, // documentation
}

class Data {
    public static separators = ['!','*', '+', ',', '-', '.', '/', ':', '<', '=', '>', '?','|'];

    public static doubleSeps = ['!=', '*:', '..', '//', ':*', '::', ':=', '<<', '<=', '=>', '>=', '>>', '||'];

    public static axes = [ "ancestor", "ancestor-or-self", "attribute", "child", "descendant", "descendant-or-self", 
                            "following", "following-sibling", "namespace", "parent", "preceding", "preceding-sibling", "self"];

    public static nodeTypes = [ "attribute", 
                                "comment", "document-node", "element", "empty-sequence", "item", "namespace-node", "node", 
                                "processing-instruction", 
                                "schema-attribute", "schema-element", "text"];                        

    public static keywords = [ "and", "array", "as", "div", 
                                "else", "eq", "except",
                                "function", "ge", "gt", "idiv", "if", "in", "intersect", "is", "le",
                                "lt", "map", "mod", "ne", "of", "or", "return", "satisfies",
                                "then", "to", "treat", "union", "&lt;", "&gt;"];

    public static rangeVars = ["every", "for", "let", "some", "return"];
    public static firstParts = [ "cast", "castable", "instance"];
    public static secondParts = ["as", "of"];

    public static nonFunctionConditional = ["if", "then", "else"];
    public static nonFunctionTypes = ["map", "array", "function"];

    public static setAsOperatorIfKeyword(token: Token) {
        if (token.value === 'return' || token.value === 'satisfies') {
            token.tokenType = TokenLevelState.Declaration// TODO: this should be set to Declaration but causes test failures
        } else if (Data.keywords.indexOf(token.value) > -1) {
            token.tokenType = TokenLevelState.Operator;
        }
    }

    public static isPart2andMatchesPart1(part1Token: Token, part2Token: Token): [boolean, boolean] {
        let p1 = part1Token.value;
        let p2 = part2Token.value;
        let isPart2: boolean;
        let matchesPart1: boolean;

        switch (p2) {
            case "else":
                isPart2 = true;
                matchesPart1 = p1 === 'then';
                break;
            case ",":
                matchesPart1 = p1 === 'in' || p1 === ':=';
                // 'then' added here as it must not appear in an if expr:
                isPart2 = p1 === 'then', p1 === 'in' || p1 === ':=';
                break;
            default:
                isPart2 = false;
                matchesPart1 = false;
                break;
        }
        return [isPart2, matchesPart1];
    }
}

export class XPathLexer {

    public debug: boolean = false;
    public flatten: boolean = false;
    public timerOn: boolean = false;
    public entityRefOn: boolean = true;
    public exitCondition = ExitCondition.None;
    private latestRealToken: Token|null = null;
    private lineNumber: number = 0;
    private wsCharNumber: number = 0;
    private tokenCharNumber: number = 0;
    private wsNewLine = false;
    private deferWsNewLine= false;

    public static getTextmateTypeLegend(): string[] {
        let textmateTypes: string[] = [];

        let conversionMap = new Map(tokenTypeLookup);
        let keyCount: number = tokenTypeLookup.length;
        for (let i = 0; i < keyCount; i++) {
            let enumString = TokenLevelState[i];
            let r: string|undefined = conversionMap.get(enumString);
            if (r !== undefined) {
                textmateTypes.push(r);
            }
        }
        return textmateTypes;
    }

    private static isPartOperator(firstPart: string, secondPart: string): boolean {
        let result = false;
        switch (firstPart) {
            case "cast":
            case "castable":
                result = secondPart === "as";
                break;
            case "instance":
                result = secondPart === "of";
                break;
        }
        return result;
    }

    private calcNewState (isFirstChar: boolean, nesting: number, char: string, nextChar: string, existing: CharLevelState): [CharLevelState, number] {
        let rv: CharLevelState;
        let firstCharOfToken = true;

        switch (existing) {
            case CharLevelState.lNl:
                let charCode = char.charCodeAt(0);
                let nextCharCode = (nextChar)? nextChar.charCodeAt(0): -1;
                if (XPathLexer.isDigit(charCode) || char === '.') {
                    rv = existing;
                } else if (char === 'e' || char === 'E') {
                    if (nextChar === '-' || nextChar === '+' || XPathLexer.isDigit(nextCharCode)) {
                        rv = CharLevelState.exp;
                    } else {
                        rv = existing;
                    }
                } else {
                    ({ rv, nesting } = this.testChar(existing, firstCharOfToken, char, nextChar, nesting));
                }
                break;
            case CharLevelState.exp:
                rv = CharLevelState.lNl;
                break;
            case CharLevelState.rDqEnt:
                rv = existing;
                switch (nesting) {
                    case 0:
                    case 2:
                        nesting++;
                        break;
                    case 1:
                        if (char === 'u' && nextChar === 'o') {
                            nesting++;
                        } else {
                            nesting = 0;
                            rv = CharLevelState.lDq;
                        }
                        break;
                    case 3:
                        if (char === 't') {
                            nesting++;
                        } else {
                            rv = CharLevelState.lDq;
                            nesting = 0;
                        }
                        break;
                    case 4:
                        if (char === ';') {
                            rv = CharLevelState.rDq;
                        } else {
                            rv = CharLevelState.lDq;
                        }
                        nesting = 0;
                        break;
                }
                break;
            case CharLevelState.lWs:
                if (char === ' ' || char === '\t') {
                    rv = existing;
                    this.wsCharNumber++;
                } else if (char === '\n') {
                    rv = existing;
                    this.wsCharNumber = 0;
                    this.wsNewLine = true;
                    this.lineNumber++;
                } else {
                    // we must switch to the new state, depending on the char/nextChar
                    ({ rv, nesting } = this.testChar(existing, firstCharOfToken, char, nextChar, nesting));
                }
                break;
            case CharLevelState.lName:
            case CharLevelState.lVar:
            case CharLevelState.lAttr:
                if (char === '-' || char === '.' || (char === ':' && !(nextChar === ':' || nextChar === '*'))) {
                    rv = existing;
                } else {
                    // we must switch to the new state, depending on the char/nextChar
                    ({ rv, nesting } = this.testChar(existing, isFirstChar, char, nextChar, nesting));
                }
                break;
            case CharLevelState.dSep:
                rv = CharLevelState.dSep2;
                break;
            case CharLevelState.lUri:
                rv = (char === '}')? CharLevelState.rUri : existing;
                break;
            case CharLevelState.lSqEnt:
                rv = (char === '&' && nextChar === 'a')? CharLevelState.rSqEnt: existing;               
                break;
            case CharLevelState.lDqEnt:
                rv = (char === '&' && nextChar === 'q')? CharLevelState.rDqEnt: existing;               
                break;
            case CharLevelState.lSq:
                if (char === '\'' ) {
                    if (nextChar === '\'') {
                        rv = CharLevelState.escSq;
                    } else {
                        rv = CharLevelState.rSq;
                    }
                } else {
                    rv = existing;
                }
                break;
            case CharLevelState.escSq:
                rv = CharLevelState.lSq;
                break;
            case CharLevelState.escDq:
                rv = CharLevelState.lDq;
                break;
            case CharLevelState.lDq:
                if (char === '\"') {
                    if (nextChar === '\"') {
                        rv = CharLevelState.escDq;
                    } else {
                        rv = CharLevelState.rDq;
                    }
                } else {
                    rv = existing;
                }
                break;  
            case CharLevelState.lC:
                if (char === ':' && nextChar === ')') {
                    rv = (nesting === 1)? CharLevelState.rC : existing; 
                    nesting--;
                } else if (char === '(' && nextChar === ':') {
                    rv = existing;
                    nesting++;
                } else {
                    rv = existing;
                }
                break;
            case CharLevelState.lEnt:
                rv = (char === ';')? CharLevelState.rEnt: existing;
                break;
            default:
                ({ rv, nesting } = this.testChar(existing, isFirstChar, char, nextChar, nesting));
        }
        return [rv, nesting];
    }

    public analyse(xpath: string): Token[] {

        if (this.timerOn) {
            console.time('xplexer.analyse');
        }
        this.latestRealToken = null;
        this.lineNumber = 0;
        this.wsCharNumber = 0;
        this.tokenCharNumber = 0;
        this.wsNewLine = false;
        this.deferWsNewLine = false;

        let currentState: [CharLevelState, number] = [CharLevelState.init, 0];
        let currentChar: string = '';
        let tokenChars: string[] = [];
        let result: Token[] = [];
        let nestedTokenStack: Token[] = [];
        if (this.debug) {
            console.log("xpath: " + xpath);
            Debug.debugHeading();
        }
    
        for (let i = 0; i < xpath.length + 1; i++) {
            // deconstruct state:
            let [currentLabelState, nestingState] = currentState;
            let nextChar: string = xpath.charAt(i);
            let nextState: [CharLevelState, number];
            let isFirstTokenChar = tokenChars.length === 0;
    
            if (currentChar) {
                nextState = this.calcNewState(
                    isFirstTokenChar,
                    nestingState,
                    currentChar,
                    nextChar, 
                    currentLabelState
                );
                let [nextLabelState] = nextState;
                if (
                    (nextLabelState === currentLabelState
                        && !(this.unChangedStateSignificant(currentLabelState))
                    )
                    || (currentLabelState === CharLevelState.exp && nextLabelState == CharLevelState.lNl)) {
                    // do nothing if state has not changed
                    // or we're within a number with an exponent
                    if (currentChar == '\n' && (currentLabelState === CharLevelState.lSq || currentLabelState === CharLevelState.lDq || currentLabelState === CharLevelState.lC)) {
                        // split multi-line strings or comments - don't include newline char
                        this.update(nestedTokenStack, result, tokenChars, currentLabelState);
                        this.lineNumber++;
                        this.tokenCharNumber = 0;
                    } else {
                        tokenChars.push(currentChar);
                    }
                } else  {
                    // state has changed, so save token and start new token
                    switch (nextLabelState){
                        case CharLevelState.lNl:
                        case CharLevelState.lVar:
                        case CharLevelState.lName:
                        case CharLevelState.lEnt:
                            this.update(nestedTokenStack, result, tokenChars, currentLabelState);
                            tokenChars.push(currentChar);
                            break;
                        case CharLevelState.exp:
                        case CharLevelState.rSqEnt:
                        case CharLevelState.rDqEnt:
                        case CharLevelState.rSqEnt2:
                        case CharLevelState.rDqEnt2:                                                
                            tokenChars.push(currentChar);
                            break;
                        case CharLevelState.dSep:
                            this.update(nestedTokenStack, result, tokenChars, currentLabelState);
                            let bothChars = currentChar + nextChar;
                            this.updateResult(nestedTokenStack, result, new BasicToken(bothChars, nextLabelState));
                            break;
                        case CharLevelState.dSep2:
                            break;
                        case CharLevelState.sep:
                            this.update(nestedTokenStack, result, tokenChars, currentLabelState);
                            this.updateResult(nestedTokenStack, result, new BasicToken(currentChar, nextLabelState));
                            break;
                        case CharLevelState.escSq:
                        case CharLevelState.escDq:
                            tokenChars.push(currentChar); 
                            break;
                        case CharLevelState.rC:
                            tokenChars.push(':)');
                            this.update(nestedTokenStack, result, tokenChars, currentLabelState);
                            break;
                        case CharLevelState.lB:
                        case CharLevelState.lBr:
                        case CharLevelState.lPr:
                            this.update(nestedTokenStack, result, tokenChars, currentLabelState);
                            let currentToken: Token;
                            if (this.flatten) {
                                currentToken = new FlattenedToken(currentChar, nextLabelState, this.latestRealToken);
                            } else {
                                currentToken = new ContainerToken(currentChar, nextLabelState, this.latestRealToken);
                            }

                            this.updateResult(nestedTokenStack, result, currentToken);
                            // add to nesting level
                            nestedTokenStack.push(currentToken);
                            this.latestRealToken = null;                   
                            break;
                        case CharLevelState.rB:
                        case CharLevelState.rBr:
                        case CharLevelState.rPr:
                            if (currentLabelState !== CharLevelState.rC) {
                                let prevToken: Token = new BasicToken(tokenChars.join(''), currentLabelState);
                                this.updateResult(nestedTokenStack, result, prevToken);
                                let newToken: Token = new BasicToken(currentChar, nextLabelState);
                                if (nestedTokenStack.length > 0) {
                                    // remove from nesting level
                                    if (XPathLexer.closeMatchesOpen(nextLabelState, nestedTokenStack)) {
                                        nestedTokenStack.pop();
                                    } else {
                                        newToken['error'] = true;
                                    }
                                } else {
                                    newToken['error'] = true;
                                }
                                this.updateResult(nestedTokenStack, result, newToken);
                                tokenChars = [];
                            }
                            break;
                        case CharLevelState.rEnt:
                            tokenChars.push(currentChar);
                            let ent = tokenChars.join('');
                            if (ent === '&quot;') {
                                nextState = [CharLevelState.lDqEnt, 0];
                            } else if (ent === '&apos') {
                                nextState = [CharLevelState.lSqEnt, 0];
                            } else {
                                let entToken: Token = new BasicToken(ent, CharLevelState.lName);
                                this.updateResult(nestedTokenStack, result, entToken);
                                tokenChars.length = 0;
                            } 
                            break;   
                        case CharLevelState.rSq:
                        case CharLevelState.rDq:
                        case CharLevelState.rUri:
                            tokenChars.push(currentChar);
                            this.update(nestedTokenStack, result, tokenChars, currentLabelState);                      
                            break;
                        case CharLevelState.lSq:
                        case CharLevelState.lDq:
                        case CharLevelState.lC:
                        case CharLevelState.lWs:
                        case CharLevelState.lUri:
                            if (currentLabelState !== CharLevelState.escSq && currentLabelState !== CharLevelState.escDq) {
                                this.update(nestedTokenStack, result, tokenChars, currentLabelState);
                            }
                            tokenChars.push(currentChar);
                            break;              
                        default:
                            if (currentLabelState === CharLevelState.rC) {
                                // in this case, don't include ')' as it is part of last token
                                tokenChars = [];
                            } else if (currentLabelState === CharLevelState.lWs) {
                                // set whitespace token and then initial with currentChar
                                this.update(nestedTokenStack, result, tokenChars, currentLabelState); 
                                tokenChars.push(currentChar);
                            }
                            else {
                                tokenChars.push(currentChar);
                            }
                            break;
                    }
                }
                if (!nextChar && tokenChars.length > 0) {
                    this.update(nestedTokenStack, result, tokenChars, nextLabelState);
                }
                currentState = nextState;
            } // end if(currentChar)
            currentChar = nextChar;
        } // end iteration over chars
        if (this.timerOn) {
            console.timeEnd('xplexer.analyse');
        }
        return result;
    }

    private static closeMatchesOpen(close: CharLevelState, stack: Token[]): boolean {
        let open: CharLevelState|undefined = stack[stack.length - 1].charType;
        let result: boolean = false;
        switch (close) {
            case CharLevelState.rB:
                result = open === CharLevelState.lB;
                break;
            case CharLevelState.rBr:
                result = open === CharLevelState.lBr;
                break;
            case CharLevelState.rPr:
                result = open === CharLevelState.lPr;
        }
        return result;
    }

    private update(stack: Token[], result: Token[], tokenChars: string[], charState: CharLevelState) {
        if (tokenChars.length > 0) {
            this.updateResult(stack, result, new BasicToken(tokenChars.join(''), charState ));
        }
        tokenChars.length = 0;
    }

    private unChangedStateSignificant(charState: CharLevelState): boolean {
        let 
        result: boolean = false;
        switch (charState) {
            case CharLevelState.lB:
            case CharLevelState.lBr:
            case CharLevelState.lPr:
            case CharLevelState.rB:
            case CharLevelState.rBr:
            case CharLevelState.rPr:
            case CharLevelState.sep:
                result = true;
        }
        return result;
    }

    private updateResult(stack: Token[], result: Token[], newToken: Token) {
        let cachedRealToken = this.latestRealToken;
        let state = newToken.charType;
        let newTokenValue = newToken.value;

        if (newTokenValue !== '') {

            newToken.length = newTokenValue.length;
            newToken.line = this.lineNumber;
            newToken.startCharacter = this.tokenCharNumber;

            let isWhitespace = newToken.charType === CharLevelState.lWs;

            if (this.deferWsNewLine) {
                if (isWhitespace) {
                    this.lineNumber++;
                    newToken.line = this.lineNumber;
                    this.tokenCharNumber = this.wsCharNumber;
                } else {
                    this.tokenCharNumber = 0; 
                    this.lineNumber++; 
                    this.wsNewLine = true;
                }
                this.deferWsNewLine = false;        
            } else if (this.wsNewLine) {
                this.tokenCharNumber = this.wsCharNumber;
                this.wsNewLine = false;
            } else {
                this.tokenCharNumber += newTokenValue.length;
            }
            this.wsCharNumber = 0;

            let addStackTokens =  !this.flatten && stack.length > 0;
            if (!isWhitespace) {
                let targetArray: Token[];
                if (addStackTokens) {
                    let initToken: Token|undefined = stack[stack.length - 1];
                    targetArray = initToken.children? initToken.children: result;
                } else {
                    targetArray = result;
                }
                targetArray.push(newToken);
            }

            let prevToken = this.latestRealToken;
            this.setLabelForLastTokenOnly(prevToken, newToken);
            this.setLabelsUsingCurrentToken(prevToken, newToken);
            if (XPathLexer.isTokenTypeEqual(newToken, TokenLevelState.Operator) || XPathLexer.isTokenTypeEqual(newToken, TokenLevelState.Declaration)) {
                if (newTokenValue === 'then' || newTokenValue === 'in' || newTokenValue === ':=' || newTokenValue === 'return' || newTokenValue === 'satisfies') {
                    if (!this.flatten) {
                        newToken.children = [];
                    }
                    stack.push(newToken);
                } else {
                    this.conditionallyPopStack(stack, newToken);
                }
            }

            if (!(state === CharLevelState.lC || state === CharLevelState.lWs)) {
                this.latestRealToken = newToken;
            } 

            if (this.debug) {
                Debug.printDebugOutput(cachedRealToken, newToken, newToken.line, newToken.startCharacter);
            }
        }
    }

    private conditionallyPopStack(stack: Token[], token: Token) {
        if (stack.length > 0) {
            let [isPart2, matchesPart1] = Data.isPart2andMatchesPart1(stack[stack.length - 1], token);
            const initStackVal = stack.length > 0? stack[stack.length - 1].value: '';
            if ((initStackVal === 'return' || initStackVal === 'satisfies') && token.value === ',') {
                stack.pop();
                let validStackValue = null;
                let init = true;
                while (stack.length > 0) {
                    if (init) {
                        init = false;
                        let v = stack[stack.length - 1].value;
                        if (v === ':=' || v === 'in') {
                            validStackValue = v;
                            stack.pop();
                        }                        
                    } else if (stack[stack.length - 1].value === validStackValue) {
                        stack.pop();
                    } else {
                        break;
                    }
                }
            } else if (isPart2) {if (matchesPart1) {stack.pop();} else token['error'] = true;}
        }
    }

    private updateTokenBeforeBrackets(prevToken: Token) {
        if (prevToken.tokenType === TokenLevelState.Declaration){
            // keep
        } else if (Data.nonFunctionConditional.indexOf(prevToken.value) > -1) {
            prevToken.tokenType = TokenLevelState.Operator;
        } else if (Data.nonFunctionTypes.indexOf(prevToken.value) > -1) {
            prevToken.tokenType = TokenLevelState.SimpleType;
        } else if (Data.nodeTypes.indexOf(prevToken.value) > -1) {
            prevToken.tokenType = TokenLevelState.NodeType;
        } else {
            prevToken.tokenType = TokenLevelState.Function;
        }
    }

    private setLabelForLastTokenOnly(prevToken: Token|null, currentToken: Token) {
        let currentState = currentToken.charType;

        if (prevToken) {
            if (XPathLexer.isCharTypeEqual(prevToken, CharLevelState.lName)) {
                switch (currentState) {
                    case CharLevelState.lVar:
                        if (Data.rangeVars.indexOf(prevToken.value) > -1) {
                                // every, for, let, some
                                prevToken.tokenType = TokenLevelState.Declaration;
                        }
                        break;
                    case CharLevelState.lB:
                        this.updateTokenBeforeBrackets(prevToken);
                        break;
                    case CharLevelState.dSep:
                        if (currentToken.value === '::' && Data.axes.indexOf(prevToken.value) > -1) {
                            prevToken.tokenType = TokenLevelState.Axis;
                        } else if (currentToken.value === '()') {
                            this.updateTokenBeforeBrackets(prevToken);
                        }
                        break;
                    case CharLevelState.lPr:
                        if (prevToken.value ===  'array') {
                            prevToken.tokenType = TokenLevelState.Operator;
                        }
                        break;
                    case CharLevelState.lBr:
                        if (prevToken.value === 'map' || prevToken.value === 'array') {
                            prevToken.tokenType = TokenLevelState.Operator;
                        }
                        break;
                }
            }
        }
    }

    private setLabelsUsingCurrentToken(prevToken: Token|null, currentToken: Token) {
        if (!(prevToken)) {
            prevToken = new BasicToken(',', CharLevelState.sep);
            prevToken.tokenType = TokenLevelState.Operator;
        }
        let currentValue = currentToken.value;

        switch (currentToken.charType) {
            case CharLevelState.lName:
                // token is a 'name' that needs resolving:
                // a Name cannot follow a Name -- unless it's like 'instance of'
                switch (prevToken.charType) {
                    case CharLevelState.lName:
                        // previous token was lName and current token is lName
                        if (Data.secondParts.indexOf(currentValue) > -1 && XPathLexer.isPartOperator(prevToken.value, currentValue)) {
                            // castable as etc.
                            prevToken.tokenType = TokenLevelState.Operator;
                            currentToken.tokenType = TokenLevelState.Operator;                               
                        } else if (XPathLexer.isTokenTypeEqual(prevToken, TokenLevelState.Operator)) {
                            // don't set to name because it may be a function etc.
                            //currentToken.tokenType = TokenLevelState.Name;
                            if (prevToken.value === 'as' || prevToken.value === 'of') {
                                // e.g. castable as xs:integer
                                // TODO: check if value equals xs:integer or element?
                                currentToken.tokenType = TokenLevelState.SimpleType;
                            }
                        } else if (XPathLexer.isTokenTypeEqual(prevToken, TokenLevelState.Name) || XPathLexer.isTokenTypeAType(prevToken)) {
                            Data.setAsOperatorIfKeyword(currentToken);
                        } 
                        break;
                    case CharLevelState.rB:
                    case CharLevelState.rBr:
                    case CharLevelState.rPr:
                    case CharLevelState.lAttr:
                    case CharLevelState.lNl:
                    case CharLevelState.lVar:
                    case CharLevelState.lSq:
                    case CharLevelState.lDq:
                    case CharLevelState.rDqEnt:
                    case CharLevelState.rSqEnt:
                        Data.setAsOperatorIfKeyword(currentToken);
                        break;
                    case CharLevelState.sep:
                        if (prevToken.value === '.') {
                            Data.setAsOperatorIfKeyword(currentToken);
                        }
                        break;
                    case CharLevelState.dSep:
                        if (prevToken.value === '()' || prevToken.value === '..') {
                            Data.setAsOperatorIfKeyword(currentToken);
                        }
                        break;
                    default: // current token is an lName but previous token was not

                        if (XPathLexer.isTokenTypeUnset(prevToken)
                             && Data.keywords.indexOf(currentValue) > -1) {
                            currentToken.tokenType = TokenLevelState.Operator;
                        } else if (XPathLexer.isCharTypeEqual(prevToken, CharLevelState.dSep) 
                                    && prevToken.value === '()' 
                                    && Data.keywords.indexOf(currentValue) > -1) {
                            currentToken.tokenType = TokenLevelState.Operator;
                        } else if (XPathLexer.isTokenTypeEqual(prevToken, TokenLevelState.Operator) && 
                            (prevToken.value === 'as' || prevToken.value === 'of')) {
                            currentToken.tokenType = TokenLevelState.SimpleType;
                        }
                        break;
                }
                break;
            case CharLevelState.sep:
                if (currentToken.value === '*' && 
                (
                    XPathLexer.isTokenTypeEqual(prevToken, TokenLevelState.Operator) ||
                    XPathLexer.isTokenTypeEqual(prevToken, TokenLevelState.UriLiteral)
                )) {
                    currentToken.charType = CharLevelState.lName;
                    currentToken.tokenType = TokenLevelState.NodeType;
                }
                break;
            case CharLevelState.dSep:
                if (currentToken.value === ':*') {
                    currentToken.charType = CharLevelState.lName;
                    currentToken.tokenType = TokenLevelState.NodeType;
                }
                break;
        }
    }

    testChar(existingState: CharLevelState, isFirstChar: boolean, char: string, nextChar: string, nesting: number) {
        let rv: CharLevelState;
        switch (char) {
            case 'Q':
                rv = (nextChar === '{')? CharLevelState.lUri : CharLevelState.lName;
                break;
            case '(':
                if (nextChar === ':') {
                    rv = CharLevelState.lC;
                    nesting++;
                } else if (nextChar == ')') {
                    rv = CharLevelState.dSep;
                }
                else {
                    rv = CharLevelState.lB;
                }
                break;
            case '{':
                if (nextChar === '}') {
                    rv = CharLevelState.dSep;
                } else {
                    rv = CharLevelState.lBr;
                }
                break;
            case '[':
                if (nextChar === ']') {
                    rv = CharLevelState.dSep;
                } else {
                    rv = CharLevelState.lPr;
                }
                break;
            case ')':
                rv = CharLevelState.rB;
                break;
            case ']':
                rv = CharLevelState.rPr;
                break;
            case '}':
                rv = CharLevelState.rBr;
                break;
            case '\'':
                rv = CharLevelState.lSq;
                break;
            case '\"':
                rv = CharLevelState.lDq;
                break;
            case ' ':
            case '\t':
                rv = CharLevelState.lWs;
                this.wsCharNumber++;
                break;
            case '\r':
                rv = CharLevelState.lWs;
                break;
            case '\n':
                this.deferWsNewLine = true;
                rv = CharLevelState.lWs;
                break;
            case '+':
            case '-':
                rv = CharLevelState.sep;
                break;
            case '&':
                rv = (this.entityRefOn)? CharLevelState.lEnt: existingState;
                break;
            default:
                let doubleChar = char + nextChar;
                if ((nextChar) && Data.doubleSeps.indexOf(doubleChar) > -1) {
                    rv = CharLevelState.dSep;
                    break;
                } else if (Data.separators.indexOf(char) > -1) {
                    if (char === '.' && !!(nextChar) && XPathLexer.isDigit(nextChar.charCodeAt(0))) {
                        rv = CharLevelState.lNl;
                    } else {
                        rv = CharLevelState.sep;
                    }
                } else if (isFirstChar) {
                    let charCode = char.charCodeAt(0);
                    let nextCharCode = (nextChar)? nextChar.charCodeAt(0): -1;
                    // check 'dot' char:
                    if (charCode === 46) {
                        if (nextCharCode === 46) {
                            // '..' parent axis
                            rv = CharLevelState.dSep;
                        } else {
                            rv = XPathLexer.isDigit(nextCharCode)? CharLevelState.lNl : CharLevelState.sep;
                        }
                    } else if (XPathLexer.isDigit(charCode)) {
                        rv = CharLevelState.lNl;
                    } else if (char === '$') {
                        rv = CharLevelState.lVar;
                    } else if (char === '@') {
                        rv = CharLevelState.lAttr;
                    } else {
                        rv = CharLevelState.lName;
                    }
                } else {
                    rv = existingState;
                }
        }
        return { rv, nesting };
    }

    private static isDigit(charCode: number) {
        return charCode > 47 && charCode < 58;
    }

    public static isCharTypeEqual(token: Token|null, type2: CharLevelState): boolean {
        return token? token.charType === type2: false;
    }

    private static isTokenTypeEqual(token: Token, type2: TokenLevelState): boolean {
        return token.tokenType === type2;
    }

    private static isTokenTypeAType(token: Token): boolean {
        return token.tokenType === TokenLevelState.SimpleType ||
                token.tokenType=== TokenLevelState.NodeType;
    }

    private static isTokenTypeUnset(token: Token): boolean {
        return token.tokenType.valueOf() === TokenLevelState.Unset.valueOf();
    }
}

export interface Token {
    line: number;
    startCharacter: number;
    length: number;
    value: string;
    charType?: CharLevelState;
    tokenType: TokenLevelState;
    context?: Token|null;
    children?: Token[];
    error?: boolean;
}

export interface TokenLight {
    line?: number;
    startCharacter?: number;
    length?: number;
    value: string;
    charType?: CharLevelState;
    tokenType: TokenLevelState;
    context?: TokenLight|null;
    children?: TokenLight[];
    error?: boolean;
}

export class Utilities {

    public static minimiseTokens(tokens: Token[]): Token[] {
        let r: Token[] = new Array();
        for (let token of tokens) {
            if (token.charType !== CharLevelState.lWs) {
                delete token.charType;
                delete token.context;
                delete token.line;
                delete token.length;
                delete token.startCharacter;
                r.push(token);
            }
            if (token.children) {
                token.children = this.minimiseTokens(token.children);
            }
        }
        return r;
    }

    public static minimiseTokens2(tokens: Token[]): Token[] {
        let r: Token[] = new Array();
        for (let token of tokens) {
            if (token.charType !== CharLevelState.lWs) {
                delete token.charType;
                delete token.context;
                r.push(token);
            }
            if (token.children) {
                token.children = this.minimiseTokens2(token.children);
            }
        }
        return r;
    }
}

class BasicToken implements Token {
    line = 0;
    startCharacter = 0 ;
    length = 0;
    value: string;
    charType: CharLevelState;
    tokenType: TokenLevelState;

    constructor(value: string, type: CharLevelState) {
        this.value = value;
        this.charType = type;
        switch (type) {
            case CharLevelState.lWs:
                this.tokenType = TokenLevelState.Whitespace;
                break;
            case CharLevelState.lName:
                this.tokenType = TokenLevelState.Name;
                break;
            case CharLevelState.dSep:
            case CharLevelState.sep:
            case CharLevelState.lB:
            case CharLevelState.lBr:
            case CharLevelState.lPr:
            case CharLevelState.rB:
            case CharLevelState.rBr:
            case CharLevelState.rPr:
                this.tokenType = TokenLevelState.Operator;
                break;
            case CharLevelState.lAttr:
                this.tokenType = TokenLevelState.Attribute;
                break;
            case CharLevelState.lNl:
                this.tokenType = TokenLevelState.Number;
                break;
            case CharLevelState.lVar:
                this.tokenType = TokenLevelState.Variable;
                break;
            case CharLevelState.lSq:
            case CharLevelState.lDq:
            case CharLevelState.rDqEnt:
            case CharLevelState.rSqEnt:
                this.tokenType = TokenLevelState.String;
                break;
            case CharLevelState.lUri:
                this.tokenType = TokenLevelState.UriLiteral;
                break;
            case CharLevelState.lC:
                this.tokenType = TokenLevelState.Comment;
                break;
            default:
                this.tokenType = TokenLevelState.Unset;
                break;
        }
    }
}

class FlattenedToken implements Token {
    line = 0;
    startCharacter = 0 ;
    length = 0;
    value: string;
    charType: CharLevelState;
    tokenType: TokenLevelState;
    context: Token|null;

    constructor(value: string, type: CharLevelState, context: Token|null) {
        this.value = value;
        this.charType = type;
        this.tokenType = TokenLevelState.Operator;
        this.context = context;
    }
}

class ContainerToken implements Token {
    line = 0;
    startCharacter = 0 ;
    length = 0;
    value: string;
    charType: CharLevelState;
    children: Token[];
    tokenType: TokenLevelState;
    context: Token|null;

    constructor(value: string, type: CharLevelState, context: Token|null) {
        this.children = [];
        this.value = value;
        this.charType = type;
        this.tokenType = TokenLevelState.Operator;
        this.context = context;
    }
}
