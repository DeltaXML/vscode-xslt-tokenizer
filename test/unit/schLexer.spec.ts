import { expect } from 'chai';
import { XslLexer, XSLTokenLevelState } from '../../src/xslLexer';
import { TokenLevelState } from '../../src/xpLexer';
import { SchConfiguration } from '../../src/languageConfigurations';

// The lexer and Schematron's attributes: those SchXslt2 - the Schematron processor bundled with XSpec - evaluates as
// XPath, and those it copies into the SVRL report as attribute value templates (role, flag and severity)
describe('XslLexer: Schematron attributes', () => {
    // XML token types follow the XPath ones
    const xmlStart = Object.keys(TokenLevelState).length / 2;
    // the XPath tokens' text and type
    const xpathTokens = (sch: string) => new XslLexer(SchConfiguration.configuration).analyse(sch)
        .filter((t) => t.tokenType < xmlStart)
        .map((t) => `${sch.split('\n')[t.line].substr(t.startCharacter, t.length)} ${TokenLevelState[t.tokenType]}`);
    const schema = (body: string) => `<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">${body}</schema>`;

    it('XPath: ISO Schematron 2025\'s visit-each, documents, and a phase\'s from and when', () => {
        expect(xpathTokens(schema('<pattern documents="$docs"><rule context="a" visit-each="b"/></pattern>'))).to.include.members(['$docs variable', 'a nodeNameTest', 'b nodeNameTest']);
        expect(xpathTokens(schema('<phase id="p" from="//c" when="$d"/>'))).to.include.members(['c nodeNameTest', '$d variable']);
    });

    it('not XPath: sch:dir\'s value, ltr or rtl - unlike sch:let\'s', () => {
        expect(xpathTokens(schema('<p><dir value="ltr">x</dir></p>'))).to.deep.equal([]);
        expect(xpathTokens(schema('<let name="v" value="ltr"/>'))).to.deep.equal(['ltr nodeNameTest']);
    });

    it('attribute value templates: role, flag and severity - not, e.g., id', () => {
        const tokens = xpathTokens(schema('<pattern><rule context="a"><assert test="1" role="{$r}" flag="{$f}" severity="{$s}" id="{$i}"/></rule></pattern>'));
        expect(tokens).to.include.members(['$r variable', '$f variable', '$s variable']);
        expect(tokens).to.not.include('$i variable');
    });
});
