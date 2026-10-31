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

        // each token as 'value:type'
        const labels = (xpath: string, isTypeDeclaration = false) => new XPathLexer().analyse(xpath, null, {line: 0, startCharacter: 0, documentOffset: 0}, isTypeDeclaration)
            .map((t) => `${t.value}:${TokenLevelState[t.tokenType]}`);

        it('should take * after an attribute name as multiplication, and after @ as a wildcard', () => {
            expect(labels('@price * @qty')).to.deep.equal(['@price:attributeNameTest', '*:operator', '@qty:attributeNameTest']);
            expect(labels('$i/@val*2')).to.deep.equal(['$i:variable', '/:operator', '@val:attributeNameTest', '*:operator', '2:number']);
            expect(labels('@*')).to.deep.equal(['@*:attributeNameTest']);
        });

        it('should take an EQName after @ or # as one token, with a wildcard', () => {
            expect(labels('@Q{urn:a}b')).to.deep.equal(['@Q{urn:a}b:attributeNameTest']);
            expect(labels('@Q{}*')).to.deep.equal(['@Q{}*:attributeNameTest']);
            expect(labels('#Q{urn:a}b')).to.deep.equal(['#Q{urn:a}b:functionNameTest']);
            expect(labels('@Q{urn:a}b * 2')).to.deep.equal(['@Q{urn:a}b:attributeNameTest', '*:operator', '2:number']);
        });

        it('should take an EQName with the local name of a kind test, before brackets, as a function', () => {
            expect(labels("Q{f}attribute('x')")).to.deep.equal(['Q{f}:uriLiteral', 'attribute:function', '(:operator', "'x':string", '):operator']);
            expect(labels('attribute(a)')).to.deep.equal(['attribute:nodeType', '(:operator', 'a:nodeNameTest', '):operator']);
        });

        it('should take an occurrence indicator after whitespace in a type declaration as part of the type', () => {
            expect(labels('xs:integer *', true)).to.deep.equal(['xs:integer:simpleType', '*:simpleType']);
            expect(labels('xs:string ?', true)).to.deep.equal(['xs:string:simpleType', '?:simpleType']);
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