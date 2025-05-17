import { Console } from 'console';
import { XPathLexer, ExitCondition, LexPosition, TokenLevelState } from '../src/xpLexer';
import * as fs from 'fs';
import * as path from 'path';
import { TestPaths } from './utils/testPaths';
import { TestDataType } from './types';

const testData: TestDataType = JSON.parse(fs.readFileSync(path.join(TestPaths.testDataDir, 'xpInAsAttribute-expected.json'), 'utf8'));
describe(`describe: ${testData.suite}`, () => {
    const lexer = new XPathLexer();
    const position: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };

    testData.tests.forEach((test) => {
        const { label, xpath, tokens } = test;
        // console.log(test);
        it(`${label} : ${xpath}`, () => {
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