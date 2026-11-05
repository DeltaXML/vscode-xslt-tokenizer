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

        it('should take an operator with < or > as a character reference as one operator token, with the length of its text', () => {
            const tokens = (xpath: string) => new XPathLexer().analyse(xpath, null, {line: 0, startCharacter: 0, documentOffset: 0})
                .map((t) => `${t.value}:${TokenLevelState[t.tokenType]}@${t.startCharacter}+${t.length}`);
            expect(tokens('$a =&gt; f()')).to.deep.equal(['$a:variable@0+2', '=>:operator@3+5', 'f:function@9+1', '():operator@10+2']);
            expect(tokens('$a&lt;=1')).to.deep.equal(['$a:variable@0+2', '<=:operator@2+5', '1:number@7+1']);
            expect(tokens('a &gt;&gt; b')).to.deep.equal(['a:nodeNameTest@0+1', '>>:operator@2+8', 'b:nodeNameTest@11+1']);
            expect(tokens('$a =!&gt; f()')).to.deep.equal(['$a:variable@0+2', '=!>:operator@3+6', 'f:function@10+1', '():operator@11+2']);
            expect(tokens('$a &#x3C;= 1')).to.deep.equal(['$a:variable@0+2', '<=:operator@3+7', '1:number@11+1']);
            expect(tokens('$a &#62; 1')).to.deep.equal(['$a:variable@0+2', '>:operator@3+5', '1:number@9+1']);
            // a raw '>' with a reference
            expect(tokens('$a >&gt; $b')).to.deep.equal(['$a:variable@0+2', '>>:operator@3+5', '$b:variable@9+2']);
        });

        it('should label an operator written with a character reference as the operator itself is', () => {
            for (const xpath of ['$a =&gt; f()', '$a =!&gt; f()', '$r =?&gt; area(1)', '$a -&gt; { . }', '$x =&gt; { . &gt; 1 }()', 'map{1:2} =&gt; map:keys()',
                '$a =&gt; (f#1)()', 'a/b[c &gt;= 2] =&gt; count()', 'x &lt;&lt; y', 'if (a &lt;= b) then c else d', '$a =&gt; function($x) { $x }()']) {
                expect(labels(xpath), xpath).to.deep.equal(labels(xpath.replace(/&gt;/g, '>').replace(/&lt;/g, '<')));
            }
        });

        it('should not join an operator across whitespace, nor within a name, string or comment', () => {
            expect(labels('$a &lt; = 1')).to.deep.equal(['$a:variable', '<:operator', '=:operator', '1:number']);
            expect(labels('$a =&lt; 1')).to.deep.equal(['$a:variable', '=:operator', '<:operator', '1:number']);
            // '-' is part of a name, as in $a->f()
            expect(labels('$a-&gt;f()')).to.deep.equal(labels('$a->f()'));
            expect(labels('(: =&gt; :) 1')).to.deep.equal(['(: =&gt; :):comment', '1:number']);
            expect(labels('"=&gt;" =&gt; f()')).to.deep.equal(['"=:string', '&gt;:entityRef', '":string', '=>:operator', 'f:function', '():operator']);
        });

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