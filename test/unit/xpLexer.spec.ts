import { expect } from 'chai';
import { XPathLexer, CharLevelState, TokenLevelState, ExitCondition } from '../../src/xpLexer';

describe('XPathLexer', () => {
    let lexer: XPathLexer;

    beforeEach(() => {
        lexer = new XPathLexer();
    });

    describe('analyse()', () => {
        it('should handle empty input', () => {
            const result = lexer.analyse('', null, {line: 0, startCharacter: 0, documentOffset: 0});
            expect(result).to.be.an('array').that.is.empty;
        });

        it('should tokenize a simple variable reference', () => {
            const result = lexer.analyse('$foo', null, {line: 0, startCharacter: 0, documentOffset: 0});
            
            expect(result.length).equal(1);
            expect(result[0].tokenType).equal(TokenLevelState.variable);
            expect(result[0].value).equal('$foo');
        });

        it('should tokenize string literals', () => {
            const result = lexer.analyse('"test string"', null, {line: 0, startCharacter: 0, documentOffset: 0});
            
            expect(result.length).equal(1);
            expect(result[0].tokenType).equal(TokenLevelState.string);
            expect(result[0].value).equal('"test string"');
        });
        
        it('should tokenize numbers', () => {
            const result = lexer.analyse('123.45', null, {line: 0, startCharacter: 0, documentOffset: 0});
            
            expect(result.length).equal(1);
            expect(result[0].tokenType).equal(TokenLevelState.number);
            expect(result[0].value).equal('123.45');
        });
    });

    describe('reset()', () => {
        it('should reset lexer state', () => {
            lexer.documentText = 'test';
            lexer.documentTokens = [{
                line: 1,
                startCharacter: 0,
                length: 4,
                value: 'test',
                tokenType: TokenLevelState.string
            }];

            lexer.reset();

            expect(lexer.documentText).equal('');
            expect(lexer.documentTokens).to.be.an('array').that.is.empty;
        });
    });
});