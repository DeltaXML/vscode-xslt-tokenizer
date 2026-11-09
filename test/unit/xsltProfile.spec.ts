import { expect } from 'chai';
import { XsltProfile } from '../../src/xsltProfile';

// as written by Saxon PE 13.1 with -TPxsl:xslt-resources/profile/profile-xml.xsl
const profileXml = `<trace t-total="18.475583">
   <fn name="p1" construct="xsl:param" file="file:/work/globals.xsl" count="1" t-sum-net="0.092875" t-avg-net="0.092875" t-sum="0.092875" t-avg="0.092875" line="3"></fn>
   <fn match="document-node()" construct="xsl:template" file="file:/work/globals.xsl" count="1" t-sum-net="4.101583" t-avg-net="4.101583" t-sum="11.409125" t-avg="11.409125" line="5"></fn>
   <fn name="f:x" construct="xsl:function" file="file:/work/globals.xsl" count="1" t-sum-net="0.063667" t-avg-net="0.063667" t-sum="0.063667" t-avg="0.063667" line="8"></fn>
   <fn name="g1" construct="xsl:variable" file="file:/work/globals.xsl" count="1" t-sum-net="7.007875" t-avg-net="7.007875" t-sum="7.007875" t-avg="7.007875" line="2"></fn>
   <fn match="element()[@n &lt; 3]" construct="xsl:template" file="file:/work/globals.xsl" count="2" t-sum-net="0.143125" t-avg-net="0.0715625" t-sum="0.206792" t-avg="0.103396" line="7"></fn>
</trace>`;

// the stylesheet profiled: line 7 is where the template's start tag (from line 6) ends
const stylesheet = [
    '<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="f">',
    '  <xsl:variable name="g1" select="sum(1 to 100000)"/>',
    '  <xsl:param name="p1" select="count(//*)"/>',
    '  <xsl:mode name="m2"/>',
    '  <xsl:template match="/"><r><xsl:value-of select="$g1, $p1"/><xsl:apply-templates select="*" mode="m2"/></r></xsl:template>',
    '  <xsl:template match="*[@n &lt; 3]" mode="m2"',
    '       priority="2"><xsl:sequence select="f:x(1)"/></xsl:template>',
    '  <xsl:function name="f:x"><xsl:param name="a"/><xsl:sequence select="$a"/></xsl:function>',
    '</xsl:stylesheet>'
].join('\n');

describe('XsltProfile', () => {
    it('reads the total and each entry', () => {
        const profile = XsltProfile.parse(profileXml)!;
        expect(profile.total).to.equal(18.475583);
        expect(profile.entries).to.have.length(5);
        expect(profile.entries[1]).to.deep.equal({
            construct: 'xsl:template', name: undefined, match: 'document-node()', file: 'file:/work/globals.xsl', line: 5,
            count: 1, net: 4.101583, avgNet: 4.101583, gross: 11.409125, avgGross: 11.409125
        });
        expect(profile.entries[4].match).to.equal('element()[@n < 3]');
    });

    it('reads the last run of several, as -repeat writes', () => {
        const second = '<trace t-total="1.5">\n   <fn name="f:x" construct="xsl:function" file="file:/work/globals.xsl" count="1" t-sum-net="0.01" t-avg-net="0.01" t-sum="0.01" t-avg="0.01" line="8"></fn>\n</trace>';
        const profile = XsltProfile.parse(profileXml + '\n' + second)!;
        expect(profile.total).to.equal(1.5);
        expect(profile.entries.map((e) => e.name)).to.deep.equal(['f:x']);
        expect(profile.runs).to.equal(2);
        expect(XsltProfile.parse(profileXml)!.runs).to.equal(1);
    });

    it('shows parameters with the values entered for tasks.json inputs', () => {
        const entered = new Map([['limit', '10']]);
        const settings = XsltProfile.parameterSettings([
            { name: 'title', value: 'Orders' },
            { name: '?limit', value: '${input:xsltParam-limit}' },
            { name: 'mode', value: '${input:xsltParam-mode}' },
            { name: '?when', value: 'current-date()' },
            { name: 'other', value: '${input:someoneElses}' },
        ], 'xsltParam-', (name) => entered.get(name));
        expect(settings).to.deep.equal([
            { label: '$title', value: 'Orders', note: undefined },
            { label: '$limit', value: '10', note: 'entered, XPath' },
            { label: '$mode', value: '${input:xsltParam-mode}', note: undefined },
            { label: '$when', value: 'current-date()', note: 'XPath' },
            { label: '$other', value: '${input:someoneElses}', note: undefined },
        ]);
        expect(XsltProfile.parameterSettings(undefined, 'xsltParam-', () => undefined)).to.deep.equal([]);
    });

    it('is undefined for something else', () => {
        expect(XsltProfile.parse('<html><body>Saxon report</body></html>')).to.equal(undefined);
    });

    it('totals the net times', () => {
        expect(XsltProfile.netTotal(XsltProfile.parse(profileXml)!)).to.be.closeTo(11.409125, 0.000001);
    });

    it('finds a declaration whose start tag ends on the line', () => {
        const declaration = XsltProfile.declarationAt(stylesheet, 'xsl:template', 7)!;
        expect(declaration.line).to.equal(5);
        expect(declaration.character).to.equal(2);
        expect(declaration.attributes.get('match')).to.equal('*[@n < 3]');
        expect(declaration.attributes.get('mode')).to.equal('m2');
        // the match attribute's value
        expect(declaration.selection).to.deep.equal({ line: 5, character: 23, endLine: 5, endCharacter: 35 });
    });

    it('finds a declaration on one line, and selects its name', () => {
        const declaration = XsltProfile.declarationAt(stylesheet, 'xsl:function', 8)!;
        expect(declaration.line).to.equal(7);
        expect(declaration.selection).to.deep.equal({ line: 7, character: 22, endLine: 7, endCharacter: 25 });
    });

    it('finds a declaration with another prefix', () => {
        const text = '<t:transform xmlns:t="http://www.w3.org/1999/XSL/Transform" version="3.0">\n<t:template name="go"/>\n</t:transform>';
        expect(XsltProfile.declarationAt(text, 'xsl:template', 2)?.attributes.get('name')).to.equal('go');
    });

    it('is undefined for a line with no declaration before it', () => {
        expect(XsltProfile.declarationAt(stylesheet, 'xsl:function', 2)).to.equal(undefined);
        expect(XsltProfile.declarationAt(stylesheet, 'xsl:function', 99)).to.equal(undefined);
    });

    it('labels rows from the declaration, else from Saxon', () => {
        const entries = XsltProfile.parse(profileXml)!.entries;
        const matchTemplate = XsltProfile.declarationAt(stylesheet, 'xsl:template', 7);
        expect(XsltProfile.rowLabel(entries[4], matchTemplate)).to.deep.equal({ kind: 'template', label: '*[@n < 3]', mode: 'm2' });
        expect(XsltProfile.rowLabel(entries[4], undefined)).to.deep.equal({ kind: 'template', label: 'element()[@n < 3]', mode: undefined });
        expect(XsltProfile.rowLabel(entries[2], undefined)).to.deep.equal({ kind: 'function', label: 'f:x', mode: undefined });
        expect(XsltProfile.rowLabel(entries[3], undefined)).to.deep.equal({ kind: 'variable', label: '$g1' });
        expect(XsltProfile.rowLabel(entries[0], undefined)).to.deep.equal({ kind: 'param', label: '$p1' });
    });

    it('keys a match template by pattern and mode, anything else by name', () => {
        const key = (construct: string, line: number) => XsltProfile.declarationKey(construct, XsltProfile.declarationAt(stylesheet, construct, line)!.attributes);
        expect(key('xsl:template', 7)).to.equal('match *[@n < 3] mode m2');
        expect(key('xsl:template', 5)).to.equal('match / mode ');
        expect(key('xsl:function', 8)).to.equal('function f:x');
        expect(key('xsl:variable', 2)).to.equal('variable g1');
    });

    it('relocates a declaration after lines are added before it', () => {
        const edited = stylesheet.replace('<xsl:mode name="m2"/>', '<xsl:mode name="m2"/>\n\n  <xsl:template name="added"/>\n');
        const declaration = XsltProfile.relocate(edited, 'xsl:template', 'match *[@n < 3] mode m2', 5)!;
        expect(declaration.line).to.equal(8);
        expect(XsltProfile.relocate(edited, 'xsl:function', 'function f:x', 7)!.line).to.equal(10);
    });

    it('relocates to the nearest declaration with the key, and to none once it is gone', () => {
        const twice = stylesheet.replace('</xsl:stylesheet>', '  <xsl:function name="f:x"><xsl:param name="a"/><xsl:param name="b"/></xsl:function>\n</xsl:stylesheet>');
        expect(XsltProfile.relocate(twice, 'xsl:function', 'function f:x', 7)!.line).to.equal(7);
        expect(XsltProfile.relocate(twice, 'xsl:function', 'function f:x', 9)!.line).to.equal(8);
        expect(XsltProfile.relocate(stylesheet.replace('name="f:x"', 'name="f:y"'), 'xsl:function', 'function f:x', 7)).to.equal(undefined);
    });
});
