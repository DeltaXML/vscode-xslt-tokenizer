import { Console } from 'console';
import { XPathLexer, ExitCondition, LexPosition, TokenLevelState } from '../src/xpLexer';
import * as fs from 'fs';
import * as path from 'path';

const testDirName = "__tests__";
interface TestDataType {
    suite: string;
    description: string;
    tests: Array<{
        label: string;
        xpath: string;
        tokens: Array<[string, string]>;
    }>;
}

const testData: TestDataType = JSON.parse(fs.readFileSync(path.join(testDirName, 'xpInAsAttribute.json'), 'utf8'));
describe(`Suite: ${testData.suite}`, () => {
    const lexer = new XPathLexer();
    const position: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };

    testData.tests.forEach((test) => {
        const { label, xpath, tokens } = test;
        console.log(test);
        it(`Suite: ${label}`, () => {
            const tokensOut = lexer.analyse(xpath, ExitCondition.None, position, true);
            expect(tokensOut.length).toBeGreaterThan(0);
            const errorTokens = tokensOut.filter(t => t.error);
            expect(errorTokens.length).toBe(0);

            tokensOut.forEach((token, idx) => {
                const [expectedValue, expectedType] = tokens[idx];
                expect(token.value).toBe(expectedValue);
                expect(TokenLevelState[token.tokenType]).toBe(expectedType);
            });
        });
    });
});