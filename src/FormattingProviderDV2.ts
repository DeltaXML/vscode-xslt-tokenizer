import { Dv2Configuration } from "./languageConfigurations";
import type { BaseToken, CharLevelState, TokenLevelState } from "./xpLexer";
import { DocumentTypes, XMLCharState, XslLexer, XSLTokenLevelState } from "./xslLexer";

enum MultiLineState {
    None,
    Start,
    Middle
}

enum HasCharacteristic {
    unknown,
    yes,
    no
}

class TagPosition {
    readonly line: number;
    readonly character: number;
    constructor(line: number, character: number) {
        this.line = line;
        this.character = character;
    }
}

export class FormattingProviderDV2 {

    private static getText(token: BaseToken, line: string) {
        return line.substring(token.startCharacter, token.startCharacter + token.length);
    }

    private static shouldAddNewLine(prevToken: BaseToken | null, token: BaseToken): boolean {
        return prevToken?.line === token.line;
    }

    private static isPrevTokenOnTextOrEndOfStartTag(prevToken: BaseToken | null, index: number, allTokens: BaseToken[]) {
        let prevTokenWasTextOrEndOfStartTag = false;
        if (prevToken) {
            let prevTokenWasText = prevToken.charType === XMLCharState.lText;
            if (prevTokenWasText && index > 2) {
                const prevToken2 = allTokens[index - 2];
                // const debugPrevToken = XsltTokenDiagnostics.getTextForToken(prevToken2.line, prevToken2, document);
                const prevToken2WasEndOfStartTag = prevToken2.charType === XMLCharState.rSt || prevToken2.charType === XMLCharState.rStNoAtt;
                prevTokenWasText = prevToken2WasEndOfStartTag;
            }
            prevTokenWasTextOrEndOfStartTag = prevTokenWasText || prevToken.charType === XMLCharState.rSt || prevToken.charType === XMLCharState.rStNoAtt;
        }
        return prevTokenWasTextOrEndOfStartTag;
    }

    private static firstNonWhitespaceCharacterIndex(text: string) {
        //const trimmedLeft = text.trimStart();
        const trimmedLeft = text.trimLeft();
        const trimLength = text.length - trimmedLeft.length;
        return trimLength;
    }

    private static getCurrentLineWithNewIndent(currentLine: string, indentString: string): string {
        const nonWSPos = this.firstNonWhitespaceCharacterIndex(currentLine);
        return indentString + currentLine.substring(nonWSPos);
    }

    private static getTextPrecedingToken(prevToken: BaseToken | null, currentToken: BaseToken, currentLine: string) {
        if (!prevToken) {
            return currentLine.substring(0, currentToken.startCharacter - 1);
        } else {
            return currentLine.substring(prevToken.startCharacter + prevToken.length, currentToken.startCharacter);
        }
    }

    public static formatXML(xml: string) {
        let result: string = '';
        const minimiseXPathIndents = true;
        const indentString = ' ';
        const indentCharLength = 2;
        const useTabs = false;
        const newLineChar = '\n';
        let isCloseTag = false;
        const lexer = new XslLexer(Dv2Configuration.configuration);
        lexer.provideCharLevelState = true;
        const allTokens = lexer.analyse(xml, false);

        let lineNumber = -1;
        let prevLineNumber = -1;
        let nestingLevel = 0;
        let xpathNestingLevel = 0;
        let newNestingLevel = 0;
        let multiLineState = MultiLineState.None;

        const xmlSpacePreserveStack: boolean[] = [];
        const xmlelementStack: string[] = [];
        let xmlSpaceAttributeValue: boolean | null = null;
        let awaitingXmlSpaceAttributeValue = false;
        let attributeNameOffset = 0;
        let attributeValueOffset = 0;
        let attributeNameOnNewLine = false;
        let isPreserveSpaceElement = false;
        let withinCDATA = false;
        let isXSLTStartTag = false;
        let nameIndentRequired = false;
        let documenthasNewLines: HasCharacteristic = HasCharacteristic.unknown;
        let awaitingSecondTag: HasCharacteristic = HasCharacteristic.unknown;
        let firstStartTagLineNumber = -1;
        let prevToken: BaseToken | null = null;
        let elementName = '';
        const xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
        const xmlLines = xml.split(/\r\n|\n/);
        let absStringPosAtLine = 0;
        let currentLine = '';


        allTokens.forEach((token, index) => {
            let newMultiLineState = MultiLineState.None;
            const stackLength = xmlSpacePreserveStack.length;
            let addNewLine = false;


            lineNumber = token.line;
            let lineNumberDiff = lineNumber - prevLineNumber;
            if (lineNumberDiff > 0) {
                currentLine = xmlLines[token.line];
                absStringPosAtLine = 0;
            }

            const isXMLToken = token.tokenType >= xsltStartTokenNumber;
            let indent = 0;

            if (isXMLToken) {
                xpathNestingLevel = 0;
                const xmlCharType = <XMLCharState>token.charType;
                const xmlTokenType = <XSLTokenLevelState>token.tokenType - xsltStartTokenNumber;
                switch (xmlTokenType) {
                    case XSLTokenLevelState.xslElementName:
                        isXSLTStartTag = true;
                        elementName = this.getText(token, currentLine);
                        isPreserveSpaceElement = elementName === 'xsl:text';
                        break;
                    case XSLTokenLevelState.elementName:
                        isXSLTStartTag = false;
                        elementName = this.getText(token, currentLine);
                        break;
                    case XSLTokenLevelState.dtdEnd:
                        if (awaitingSecondTag === HasCharacteristic.unknown) {
                            firstStartTagLineNumber = lineNumber;
                        } else if (awaitingSecondTag === HasCharacteristic.yes) {
                            documenthasNewLines = lineNumber > firstStartTagLineNumber ? HasCharacteristic.yes : HasCharacteristic.no;
                            awaitingSecondTag = HasCharacteristic.no;
                        }
                        addNewLine = documenthasNewLines === HasCharacteristic.no;
                        break;
                    case XSLTokenLevelState.xmlPunctuation:
                        switch (xmlCharType) {
                            case XMLCharState.lSt:
                                attributeNameOffset = 0;
                                attributeValueOffset = 0;
                                xmlSpaceAttributeValue = null;
                                newNestingLevel++;
                                if (awaitingSecondTag === HasCharacteristic.unknown) {
                                    firstStartTagLineNumber = lineNumber;
                                    awaitingSecondTag = HasCharacteristic.yes;
                                } else if (awaitingSecondTag === HasCharacteristic.yes) {
                                    documenthasNewLines = lineNumber > firstStartTagLineNumber ? HasCharacteristic.yes : HasCharacteristic.no;
                                    awaitingSecondTag = HasCharacteristic.no;
                                }
                                addNewLine = this.shouldAddNewLine(prevToken, token);
                                break;
                            case XMLCharState.rStNoAtt:
                                {
                                    const preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
                                    xmlSpacePreserveStack.push(preserveSpace);
                                    if (isCloseTag) {
                                        xmlelementStack.push(elementName);
                                    }
                                }
                                break;
                            case XMLCharState.rSt:
                                attributeNameOffset = 0;
                                attributeValueOffset = 0;
                                if (xmlSpaceAttributeValue === null) {
                                    const preserveSpace = stackLength > 0 ? xmlSpacePreserveStack[stackLength - 1] : false;
                                    xmlSpacePreserveStack.push(preserveSpace);
                                } else {
                                    xmlSpacePreserveStack.push(xmlSpaceAttributeValue);
                                    xmlSpaceAttributeValue = null;
                                }
                                if (isCloseTag) {
                                    xmlelementStack.push(elementName);
                                }
                                break;
                            case XMLCharState.lCt:
                                // outdent
                                {
                                    indent = -1;
                                    newNestingLevel--;
                                    const prevTokenWasTextOrEndOfStartTag = this.isPrevTokenOnTextOrEndOfStartTag(prevToken, index, allTokens);
                                    addNewLine = (!prevTokenWasTextOrEndOfStartTag) && this.shouldAddNewLine(prevToken, token);
                                }
                                break;
                            case XMLCharState.rSelfCtNoAtt:
                            case XMLCharState.rSelfCt:
                                attributeNameOffset = 0;
                                attributeValueOffset = 0;
                                isPreserveSpaceElement = false;
                                newNestingLevel--;
                                break;
                            case XMLCharState.rCt:
                                attributeNameOffset = 0;
                                attributeValueOffset = 0;
                                isPreserveSpaceElement = false;
                                if (stackLength > 0) {
                                    xmlSpacePreserveStack.pop();
                                }
                                if (isCloseTag && xmlelementStack.length > 0) {
                                    xmlelementStack.pop();
                                }
                                break;
                            case XMLCharState.lPi:
                                // may be xml-declaration:
                                if (awaitingSecondTag === HasCharacteristic.unknown) {
                                    firstStartTagLineNumber = lineNumber;
                                    awaitingSecondTag = HasCharacteristic.yes;
                                }
                                attributeNameOffset = 0;
                                attributeValueOffset = 0;
                                break;
                            case XMLCharState.rPi:
                                indent = 0;
                                break;
                            case XMLCharState.rCdataEnd:
                                withinCDATA = true;
                                break;
                        }
                        break;
                    case XSLTokenLevelState.attributeName:
                    case XSLTokenLevelState.xmlnsName:
                        // test: xml:space
                        {
                            attributeValueOffset = 0;
                            attributeNameOnNewLine = lineNumberDiff > 0;
                            nameIndentRequired = true;
                            if (token.length === 9 || (isXSLTStartTag && minimiseXPathIndents)) {
                                const valueText = this.getText(token, currentLine);
                                awaitingXmlSpaceAttributeValue = (valueText === 'xml:space');
                                nameIndentRequired = false;
                            }

                            const attNameLine = currentLine;
                            if (!nameIndentRequired) {
                                attributeNameOffset = 0;
                            } else if (!attributeNameOnNewLine && attributeNameOffset === 0) {
                                attributeNameOffset = token.startCharacter - this.firstNonWhitespaceCharacterIndex(attNameLine);
                            }
                            if (useTabs) {
                                attributeNameOffset = 1;
                            }
                        }
                        break;
                    case XSLTokenLevelState.attributeValue:
                        {
                            const attValueText = this.getText(token, currentLine);
                            // token constains single/double quotes also
                            const textOnFirstLine = token.length > 1 && attValueText.trim().length > 1;
                            const indentRemainder = attributeNameOffset % indentCharLength;
                            const adjustedIndentChars = attributeNameOffset + (indentCharLength - indentRemainder);

                            let calcOffset = token.startCharacter - this.firstNonWhitespaceCharacterIndex(currentLine);
                            calcOffset = attributeNameOnNewLine ? calcOffset + attributeNameOffset : calcOffset;

                            const newValueOffset = textOnFirstLine ? 1 + calcOffset : adjustedIndentChars;
                            attributeValueOffset = lineNumberDiff > 0 ? attributeValueOffset : newValueOffset;
                            if (awaitingXmlSpaceAttributeValue) {
                                // token includes surrounding quotes.
                                xmlSpaceAttributeValue = attValueText === '\"preserve\"' || attValueText === '\'preserve\'';
                                awaitingXmlSpaceAttributeValue = false;
                            }
                            if (useTabs) {
                                attributeValueOffset = 2;
                            }
                        }
                        break;
                    case XSLTokenLevelState.processingInstrValue:
                    case XSLTokenLevelState.processingInstrName:
                        {
                            attributeNameOffset = 0;
                            newMultiLineState = (multiLineState === MultiLineState.None) ? MultiLineState.Start : MultiLineState.Middle;
                            // TODO: outdent ?> on separate line - when token value is only whitespace
                            const piText = this.getText(token, xmlLines[token.line]);
                            const trimPi = piText.trim();

                            if (newMultiLineState === MultiLineState.Middle && trimPi.length > 0) {
                                indent = 1;
                            }
                        }
                        break;
                    case XSLTokenLevelState.xmlComment:
                        {
                            newMultiLineState = (multiLineState === MultiLineState.None) ? MultiLineState.Start : MultiLineState.Middle;
                            const commentLineText = this.getText(token, xmlLines[token.line]);
                            //const trimLine = commentLineText.trimStart();
                            const trimLine = commentLineText.trimLeft();
                            const doIndent = newMultiLineState === MultiLineState.Middle
                                && token.length > 0 && !trimLine.startsWith('-->') && !trimLine.startsWith('<!--');
                            indent = doIndent ? 1 : 0;
                            attributeNameOffset = doIndent ? 5 : 0;
                            addNewLine = trimLine.startsWith('<!--') && this.shouldAddNewLine(prevToken, token);
                        }
                        break;
                }
            }

            for (let i = 0; i < lineNumberDiff - 1; i++) {
                result += newLineChar;
            }
            const tokenText = this.getText(token, currentLine);

            if (addNewLine || (prevLineNumber > -1 && lineNumberDiff > 0)) {
                let totalAttributeOffset;
                if (!isXMLToken && minimiseXPathIndents) {
                    totalAttributeOffset = 0;
                } else {
                    if (attributeValueOffset > 0) {
                        totalAttributeOffset = attributeValueOffset;
                    } else {
                        totalAttributeOffset = attributeNameOffset;
                    }
                }
                let requiredIndentLength = totalAttributeOffset + (nestingLevel * indentCharLength);
                if (totalAttributeOffset > 0) {
                    indent = -1 + indent;
                }
                requiredIndentLength += (indent * indentCharLength);

                requiredIndentLength = requiredIndentLength < 0 ? 0 : requiredIndentLength;
                console.log({ nestingLevel, indentCharLength, indent });
                let replacementString = indentString.repeat(requiredIndentLength);
                console.log('NEW_LINE_' + requiredIndentLength + '[' + replacementString + '|' + tokenText + ']');
                result += newLineChar + replacementString + tokenText;
            } else {
                // not on a new line so insert characters between this token and the last
                console.log('SAME_LINE[' + this.getTextPrecedingToken(prevToken, token, currentLine) + '|' + tokenText + ']');
                result += this.getTextPrecedingToken(prevToken, token, currentLine) + tokenText;
            }
            withinCDATA = false;
            prevLineNumber = lineNumber;
            nestingLevel = newNestingLevel;
            multiLineState = newMultiLineState;
            prevToken = token;

        });
        isCloseTag = false;
        console.log('formatted:');
        const debugFormatted = result.replace(/ /g, '.');
        console.log(debugFormatted);
        return result;
    }
}