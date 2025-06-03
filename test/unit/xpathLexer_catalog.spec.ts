/**
 * Test suite for XPath lexical analysis within attribute contexts
 * 
 * This test suite validates the XPath lexer's ability to correctly tokenize XPath expressions
 * when they appear within XML attributes. It uses test cases from a JSON file containing
 * expected token patterns.
 * 
 * Each test case verifies:
 * 1. The correct number of tokens are generated
 * 2. No error tokens are present in the output
 * 3. Each token's value matches the expected value
 * 4. Each token's type matches the expected token type
 * 
 * @file xpLexerAsAttribute.spec.ts
 * @requires XPathLexer - the target of the test
 * 
 * Origin of the data file: @file xpInAsAttribute-expected.json
 * 1. @file xpInAsAttribute.xsl - the original XSLT source
 * 2. @file as-attributes-to-json-out.json - extracted with @template xslAsAttributesToJson.xsl
 * 3. the data file with expected tokens added by @module xpLexerTestGen.ts
 * 
 */
import { XPathLexer, ExitCondition, LexPosition, TokenLevelState } from '../../src/xpLexer';
import { ExpectedTokenData } from '../../__tests__/types';
import { expect } from 'chai';
import { getCatalogGroup, getDataFromFile } from '../../__tests__/utils/getCatalogGroup';

const catalogGroup = getCatalogGroup(0);

catalogGroup.files.forEach(file => {
    const locadeFileData: ExpectedTokenData = getDataFromFile(file);
    describeTest(locadeFileData);
});

function describeTest(testData: ExpectedTokenData) {
    describe(`${testData.description} (${testData.suite})`, () => {
        const lexer = new XPathLexer();
        // position info for tokens is computed from this start:
        const position: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
        const isTestingAsAttribute = testData.attributeName === 'as';

        testData.tests.forEach((test) => {
            const { label, xpath, tokens } = test;
            it(`${label} : ${xpath}`, () => {
                // the call to the xpLexer.analyse function - the subject of the tests:
                const tokensOut = lexer.analyse(xpath, ExitCondition.None, position, isTestingAsAttribute);
                expect(tokensOut.length).to.equal(tokens.length);
                const errorTokens = tokensOut.filter(t => t.error);
                expect(errorTokens.length).to.equal(0);

                tokensOut.forEach((token, idx) => {
                    const [expectedValue, expectedType] = tokens[idx];
                    expect(token.value).to.equal(expectedValue);
                    expect(TokenLevelState[token.tokenType]).to.equal(expectedType);
                });
            });
        });
    });
}


