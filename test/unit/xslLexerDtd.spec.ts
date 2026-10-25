import { expect } from 'chai';
import { XslLexer, XSLTokenLevelState, DocumentTypes, LanguageConfiguration } from '../../src/xslLexer';
import { TokenLevelState } from '../../src/xpLexer';

// The XML lexer and a DOCTYPE: its internal subset of declarations can have comments, processing instructions, and
// literals with '<', '>' or '--' in them - none of which end the DOCTYPE, or start a comment, early. After the
// DOCTYPE, the document element is lexed as usual
describe('XslLexer: DOCTYPE and internal subset', () => {
    const config: LanguageConfiguration = {
        expressionAtts: [], variableElementNames: [], nativePrefix: 'qz', tvtAttributes: [], nonNativeAvts: false, docType: DocumentTypes.Other
    };
    // XML token types follow the XPath ones
    const xmlStart = Object.keys(TokenLevelState).length / 2;

    // each token as 'line:character type'
    const tokens = (xml: string) => new XslLexer(config).analyse(xml).map((t) =>
        `${t.line}:${t.startCharacter} ${t.tokenType >= xmlStart ? XSLTokenLevelState[t.tokenType - xmlStart] : TokenLevelState[t.tokenType]}`);

    // the tokens of '<a>x</a>' on a line
    const element = (line: number) => [`${line}:0 xmlPunctuation`, `${line}:1 elementName`, `${line}:2 xmlPunctuation`, `${line}:3 xmlText`,
        `${line}:4 xmlPunctuation`, `${line}:6 elementName`, `${line}:7 xmlPunctuation`];

    it('declarations', () => {
        expect(tokens('<!DOCTYPE a [\n<!ELEMENT a ANY>\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 dtd', '2:0 dtdEnd', ...element(3)]);
    });

    it('a comment between declarations', () => {
        expect(tokens('<!DOCTYPE a [\n<!-- note -->\n<!ELEMENT a ANY>\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 xmlComment', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
    });

    it('a comment last in the subset - the DOCTYPE still ends at its ]>', () => {
        expect(tokens('<!DOCTYPE a [\n<!ELEMENT a ANY>\n<!-- last -->\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 dtd', '2:0 xmlComment', '3:0 dtdEnd', ...element(4)]);
        expect(tokens('<!DOCTYPE a [\n<!-- only -->\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 xmlComment', '2:0 dtdEnd', ...element(3)]);
    });

    it("a comment with '<', '>', ']>' or a quote in it", () => {
        for (const comment of ['<!-- 1 < 2 -->', '<!-- a > b -->', '<!-- ends with ]> here -->', "<!-- don't -->"]) {
            expect(tokens(`<!DOCTYPE a [\n${comment}\n<!ELEMENT a ANY>\n]>\n<a>x</a>`), comment).to.deep.equal(
                ['0:0 dtd', '1:0 xmlComment', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
        }
    });

    it('a comment on the same line as the DOCTYPE and a declaration', () => {
        expect(tokens('<!DOCTYPE a [ <!-- c --> <!ELEMENT a ANY> ]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '0:14 xmlComment', '0:24 dtdEnd', ...element(1)]);
    });

    it("a literal with '>' or '<' in it", () => {
        expect(tokens('<!DOCTYPE a [\n<!ENTITY e "a > b">\n<!ENTITY f \'<i>\'>\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 dtd', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
    });

    it("a literal with '--' in it - not a comment", () => {
        expect(tokens('<!DOCTYPE a [\n<!ENTITY e "a -- b">\n<!ELEMENT a ANY>\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 dtd', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
    });

    it("a processing instruction, with '>' in it", () => {
        expect(tokens('<!DOCTYPE a [\n<?pi a > b?>\n<!ELEMENT a ANY>\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 dtd', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
    });

    it('a public identifier, with and without a subset', () => {
        expect(tokens('<!DOCTYPE a PUBLIC "-//X//DTD Y//EN" "y.dtd">\n<a>x</a>')).to.deep.equal(['0:0 dtdEnd', ...element(1)]);
        expect(tokens('<!DOCTYPE a PUBLIC "-//X//DTD Y//EN" "y.dtd" [\n<!-- c -->\n<!ENTITY e "v">\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 xmlComment', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
    });

    it('comments and CDATA outside a DOCTYPE - as before', () => {
        expect(tokens('<!-- c -->\n<!DOCTYPE a [\n<!ELEMENT a ANY>\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 xmlComment', '1:0 dtd', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
        expect(tokens('<a><!-- c --><![CDATA[<b>]]></a>')).to.include('0:3 xmlComment');
    });
});
