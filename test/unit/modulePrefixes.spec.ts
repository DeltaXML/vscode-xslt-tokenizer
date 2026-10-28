import { expect } from 'chai';
import { ModulePrefixes } from '../../src/modulePrefixes';
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, LanguageConfiguration, XslLexer } from '../../src/xslLexer';

const stylesheet = (attributes: string, prolog = '') => `${prolog}<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"${attributes}>\n</xsl:stylesheet>`;
const declared = (name: string, bindings: Map<string, string> | undefined, type = GlobalInstructionType.Function): GlobalInstructionData =>
    ({ name, type, token: { line: 0, startCharacter: 0, length: name.length, value: name, tokenType: 0 }, idNumber: 1, prefixBindings: bindings });

// the bindings the lexer finds for the stylesheet, and those of its function f:double
function lexed(xslt: string) {
    const lexer = new XslLexer(config);
    lexer.analyse(xslt);
    return { bindings: lexer.prefixBindings!, declared: lexer.globalInstructionData.find((g) => g.type === GlobalInstructionType.Function)?.prefixBindings };
}
const config: LanguageConfiguration = {
    expressionAtts: ['select'], variableElementNames: ['xsl:variable', 'xsl:param'], nativePrefix: 'xsl', tvtAttributes: [], nonNativeAvts: true, docType: DocumentTypes.XSLT
};
const fn = '<xsl:function name="f:double" xmlns:f="urn:inner"/>';

describe('XslLexer.prefixBindings', () => {
    it('should be the namespace declarations of the outermost element, with xml - not those of an inner element', () => {
        const { bindings, declared } = lexed(stylesheet(' xmlns:f="urn:fns" xmlns="urn:default"').replace('\n', fn + '\n'));
        expect([...bindings.entries()]).to.deep.equal([['xsl', 'http://www.w3.org/1999/XSL/Transform'], ['f', 'urn:fns'], ['xml', 'http://www.w3.org/XML/1998/namespace']]);
        expect(declared).to.equal(bindings);
    });

    it('should skip the XML declaration, comments and a DOCTYPE, and decode references', () => {
        const { bindings } = lexed(stylesheet(' xmlns:f="urn:a&amp;b"', '<?xml version="1.0"?>\n<!-- <x xmlns:f="urn:no"> -->\n<!DOCTYPE xsl:stylesheet [<!ENTITY e "x">]>\n'));
        expect(bindings.get('f')).to.equal('urn:a&b');
    });

    it('should include a prefix with non-ASCII name characters', () => {
        const { bindings } = lexed(stylesheet(' xmlns:fé="urn:fns" xmlns:函数="urn:cjk"'));
        expect(bindings.get('fé')).to.equal('urn:fns');
        expect(bindings.get('函数')).to.equal('urn:cjk');
    });

    it('should be the fixed-namespaces bindings, when there are', () => {
        const { bindings } = lexed(stylesheet(' xmlns:f="urn:fns" xmlns:g="urn:g" fixed-namespaces="f map h=urn:h"'));
        expect(bindings.get('f')).to.equal('urn:fns');
        expect(bindings.get('h')).to.equal('urn:h');
        expect(bindings.get('map')).to.equal('http://www.w3.org/2005/xpath-functions/map');
        // declared, but not fixed
        expect(bindings.has('g')).to.equal(false);
    });
});

describe('ModulePrefixes.nameIn()', () => {
    const lib = new Map([['f', 'urn:fns'], ['o', 'urn:other']]);
    const main = new Map([['my', 'urn:fns'], ['f', 'urn:different'], ['o', 'urn:other']]);

    it('should use the module\'s prefix for the namespace', () => {
        expect(ModulePrefixes.nameIn(declared('f:double', lib), main)).to.equal('my:double');
    });

    it('should keep a prefix that the module binds to the same namespace', () => {
        expect(ModulePrefixes.nameIn(declared('o:x', lib), main)).to.equal('o:x');
    });

    it('should be an EQName when the module binds no prefix to the namespace', () => {
        expect(ModulePrefixes.nameIn(declared('f:double', lib), new Map([['f', 'urn:different']]))).to.equal('Q{urn:fns}double');
    });

    it('should map each name of a list of modes', () => {
        expect(ModulePrefixes.nameIn(declared('f:m o:n plain #default', lib, GlobalInstructionType.ModeTemplate), main)).to.equal('my:m o:n plain #default');
    });

    it('should keep a name without a prefix, an EQName, and a name whose prefix isn\'t bound', () => {
        ['double', 'Q{urn:fns}double', 'u:double'].forEach((name) => expect(ModulePrefixes.nameIn(declared(name, lib), main)).to.equal(name));
    });
});
