import { expect } from 'chai';
import { RecordTypes } from '../../src/recordTypes';

// a stylesheet module whose prefix for XSLT is another, e.g. xslt in some W3C tests
const stylesheet = (prefix: string) => `<?xml version="1.0"?>\n<!-- <xsl:stylesheet> -->\n<${prefix}:stylesheet xmlns:${prefix}="http://www.w3.org/1999/XSL/Transform" version="3.0">\n` +
    `<${prefix}:template match="/"><${prefix}:iterate select="1"><${prefix}:param name="p"/></${prefix}:iterate></${prefix}:template>\n</${prefix}:stylesheet>`;

describe('RecordTypes: a module\'s prefix for XSLT', () => {
    it('should be the prefix of the outermost element - stylesheet, transform or package', () => {
        expect(RecordTypes.xsltPrefix(stylesheet('xslt'))).to.equal('xslt');
        expect(RecordTypes.xsltPrefix(stylesheet('x'))).to.equal('x');
        expect(RecordTypes.xsltPrefix('<t:transform xmlns:t="http://www.w3.org/1999/XSL/Transform"/>')).to.equal('t');
        expect(RecordTypes.xsltPrefix(stylesheet('xsl'))).to.equal('xsl');
        // a simplified stylesheet, or not a stylesheet
        expect(RecordTypes.xsltPrefix('<html xsl:version="3.0"/>')).to.equal('xsl');
    });

    it('should be quick for an outermost element without a prefix, after a run of whitespace', () => {
        // e.g. markup, with the XML declaration blanked: before the fix, it took exponential time not to match
        const text = ' '.repeat(5000) + '\n<transform xmlns="http://www.w3.org/1999/XSL/Transform" version="3.0"/>';
        const start = Date.now();
        expect(RecordTypes.xsltPrefix(text)).to.equal('xsl');
        expect(Date.now() - start).to.be.below(100);
    });

    it('should give XSLT names with the prefix xsl', () => {
        expect(RecordTypes.xsltName('xslt:template', 'xslt')).to.equal('xsl:template');
        expect(RecordTypes.xsltName('xslt:use-attribute-sets', 'xslt')).to.equal('xsl:use-attribute-sets');
        expect(RecordTypes.xsltName('out:template', 'xslt')).to.equal('out:template');
        expect(RecordTypes.xsltName('xsl:template', 'xsl')).to.equal('xsl:template');
    });

    it('should find XSLT instructions with the module\'s prefix', () => {
        const text = stylesheet('x');
        expect([...text.matchAll(RecordTypes.xsltPattern(/<(xsl:iterate|xsl:param)[\s/>]/g, text))].map((m) => m[1])).to.deep.equal(['x:iterate', 'x:param']);
        // the same pattern, with the prefix xsl
        const pattern = /<xsl:iterate[\s>]/g;
        expect(RecordTypes.xsltPattern(pattern, stylesheet('xsl'))).to.equal(pattern);
        expect(RecordTypes.xsltTag(text, 'iterate')).to.equal('<x:iterate');
    });

    it('should give the open elements and children with XSLT names with the prefix xsl', () => {
        const text = stylesheet('xslt');
        const markup = RecordTypes.blankMarkup(text);
        const param = markup.indexOf('<xslt:param');
        expect(RecordTypes.openElements(markup, param).map((e) => e.name)).to.deep.equal(['xsl:stylesheet', 'xsl:template', 'xsl:iterate']);
        expect(RecordTypes.childElements(text, markup, markup.indexOf('<xslt:iterate'), 'xsl:param')).to.deep.equal([param]);
    });

    it('should insert text with the module\'s prefix', () => {
        expect(RecordTypes.withXsltPrefix('<xsl:when test="$a">\n</xsl:when>', 'xslt')).to.equal('<xslt:when test="$a">\n</xslt:when>');
        expect(RecordTypes.withXsltPrefix('<out xsl:expand-text="yes"/>', 'xslt')).to.equal('<out xslt:expand-text="yes"/>');
        // not a QName with the prefix xsl
        expect(RecordTypes.withXsltPrefix('<my-xsl:x/>', 't')).to.equal('<my-xsl:x/>');
    });
});
