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

    // the DOCTYPE's tokens - up to its dtdEnd - as 'type text'
    const doctype = (xml: string) => {
        const lines = xml.split('\n');
        const all = tokens(xml);
        const end = all.findIndex((t) => t.endsWith(' dtdEnd'));
        return new XslLexer(config).analyse(xml).slice(0, end + 1).map((t, i) => `${all[i].split(' ')[1]} ${lines[t.line].substr(t.startCharacter, t.length)}`);
    };

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
        const xml = '<!DOCTYPE a [\n<!ENTITY e "a > b">\n<!ENTITY f \'<i>\'>\n]>\n<a>x</a>';
        expect(doctype(xml)).to.deep.equal(['dtd <!DOCTYPE a [', 'dtd <!ENTITY ', 'dtdEntityName e', 'dtd  ', 'dtdLiteral "a > b"', 'dtd >',
            'dtd <!ENTITY ', 'dtdEntityName f', 'dtd  ', "dtdLiteral '<i>'", 'dtd >', 'dtdEnd ]>']);
        expect(tokens(xml).slice(-7)).to.deep.equal(element(4));
    });

    it("a literal with '--' in it - not a comment", () => {
        const xml = '<!DOCTYPE a [\n<!ENTITY e "a -- b">\n<!ELEMENT a ANY>\n]>\n<a>x</a>';
        expect(doctype(xml)).to.deep.equal(['dtd <!DOCTYPE a [', 'dtd <!ENTITY ', 'dtdEntityName e', 'dtd  ', 'dtdLiteral "a -- b"', 'dtd >',
            'dtd <!ELEMENT a ANY>', 'dtdEnd ]>']);
        expect(tokens(xml).slice(-7)).to.deep.equal(element(4));
    });

    it("an entity's name and value: tokens of their own - for a parameter entity too, and a value over two lines", () => {
        expect(doctype('<!DOCTYPE a [\n<!ENTITY % chars SYSTEM \'chars.ent\'>\n<!ENTITY e"v">\n<!ENTITY long "one\ntwo">\n]>\n<a/>')).to.deep.equal(
            ['dtd <!DOCTYPE a [', 'dtd <!ENTITY % ', 'dtdEntityName chars', 'dtd  SYSTEM ', "dtdLiteral 'chars.ent'", 'dtd >',
                'dtd <!ENTITY ', 'dtdEntityName e', 'dtdLiteral "v"', 'dtd >',
                'dtd <!ENTITY ', 'dtdEntityName long', 'dtd  ', 'dtdLiteral "one', 'dtdLiteral two"', 'dtd >', 'dtdEnd ]>']);
    });

    it('other declarations: one token for each line, as before', () => {
        expect(doctype('<!DOCTYPE a [\n<!ELEMENT a (#PCDATA)>\n<!ATTLIST a id ID #IMPLIED>\n]>\n<a/>')).to.deep.equal(
            ['dtd <!DOCTYPE a [', 'dtd <!ELEMENT a (#PCDATA)>', 'dtd <!ATTLIST a id ID #IMPLIED>', 'dtdEnd ]>']);
    });

    it("a processing instruction, with '>' in it", () => {
        expect(tokens('<!DOCTYPE a [\n<?pi a > b?>\n<!ELEMENT a ANY>\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 dtd', '1:0 dtd', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
    });

    it('a public identifier, with and without a subset', () => {
        const xml = '<!DOCTYPE a PUBLIC "-//X//DTD Y//EN" "y.dtd">\n<a>x</a>';
        expect(doctype(xml)).to.deep.equal(['dtd <!DOCTYPE a PUBLIC ', 'dtdLiteral "-//X//DTD Y//EN"', 'dtd  ', 'dtdLiteral "y.dtd"', 'dtdEnd >']);
        expect(tokens(xml).slice(-7)).to.deep.equal(element(1));
        const withSubset = '<!DOCTYPE a PUBLIC "-//X//DTD Y//EN" "y.dtd" [\n<!-- c -->\n<!ENTITY e "v">\n]>\n<a>x</a>';
        expect(doctype(withSubset)).to.deep.equal(['dtd <!DOCTYPE a PUBLIC ', 'dtdLiteral "-//X//DTD Y//EN"', 'dtd  ', 'dtdLiteral "y.dtd"', 'dtd  [',
            'xmlComment <!-- c -->', 'dtd <!ENTITY ', 'dtdEntityName e', 'dtd  ', 'dtdLiteral "v"', 'dtd >', 'dtdEnd ]>']);
        expect(tokens(withSubset).slice(-7)).to.deep.equal(element(4));
    });

    it('comments and CDATA outside a DOCTYPE - as before', () => {
        expect(tokens('<!-- c -->\n<!DOCTYPE a [\n<!ELEMENT a ANY>\n]>\n<a>x</a>')).to.deep.equal(
            ['0:0 xmlComment', '1:0 dtd', '2:0 dtd', '3:0 dtdEnd', ...element(4)]);
        expect(tokens('<a><!-- c --><![CDATA[<b>]]></a>')).to.include('0:3 xmlComment');
    });
});
