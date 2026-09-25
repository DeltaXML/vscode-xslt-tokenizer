import { expect } from 'chai';
import { RecordTypes } from '../../src/recordTypes';

describe('RecordTypes.resolve()', () => {
    const itemTypes = new Map<string, string>([
        ['cx:complex', 'record(r as xs:double, i as xs:double)'],
        ['point', 'record(x, y)'],
        ['alias', 'cx:complex'],
        ['loop', 'loop'],
        ['text', 'xs:string'],
    ]);

    it('should parse a record type with typed fields', () => {
        const record = RecordTypes.resolve('record(r as xs:double, i as xs:double)', itemTypes);
        expect(record?.fields).to.deep.equal([
            { name: 'r', optional: false, type: 'xs:double' },
            { name: 'i', optional: false, type: 'xs:double' }
        ]);
    });

    it('should parse quoted, optional and untyped field names', () => {
        const record = RecordTypes.resolve("record('first name', b? as xs:integer, \"c d\"?, e)", itemTypes);
        expect(record?.fields).to.deep.equal([
            { name: 'first name', optional: false, type: undefined },
            { name: 'b', optional: true, type: 'xs:integer' },
            { name: 'c d', optional: true, type: undefined },
            { name: 'e', optional: false, type: undefined }
        ]);
    });

    it('should keep nested and choice field types whole', () => {
        const record = RecordTypes.resolve('record(a as record(b as xs:integer, c), d as (xs:string | xs:integer)*)', itemTypes);
        expect(record?.fields.map((f) => f.type)).to.deep.equal(['record(b as xs:integer, c)', '(xs:string | xs:integer)*']);
    });

    it('should resolve named item types, with an occurrence indicator', () => {
        expect(RecordTypes.resolve('cx:complex*', itemTypes)?.name).to.equal('cx:complex');
        expect(RecordTypes.resolve('point?', itemTypes)?.fields.map((f) => f.name)).to.deep.equal(['x', 'y']);
        expect(RecordTypes.resolve('alias', itemTypes)?.fields.map((f) => f.name)).to.deep.equal(['r', 'i']);
        expect(RecordTypes.resolve('(cx:complex)', itemTypes)?.name).to.equal('cx:complex');
    });

    it('should parse an empty record type', () => {
        expect(RecordTypes.resolve('record()', itemTypes)?.fields).to.deep.equal([]);
    });

    it('should return undefined for types that are not record types', () => {
        ['xs:string', 'map(*)', 'text', 'undeclared', 'loop', '(cx:complex | xs:string)', 'record(*)', 'record(a, *)', 'element(a)'].forEach((type) => {
            expect(RecordTypes.resolve(type, itemTypes), type).to.be.undefined;
        });
    });
});

describe('RecordTypes.attributeOfElementAt()', () => {
    const text = `<xsl:variable select="$a > 1" name="v" as="cx:complex"/>\n<xsl:param name="p" as='record(a as xs:string)'/>\n<xsl:variable name="w"/>`;

    it('should find an attribute after the offset, where an earlier value contains >', () => {
        expect(RecordTypes.attributeOfElementAt(text, text.indexOf('"v"'), 'as')).to.equal('cx:complex');
    });

    it('should find an attribute in apostrophes', () => {
        expect(RecordTypes.attributeOfElementAt(text, text.indexOf('"p"'), 'as')).to.equal('record(a as xs:string)');
    });

    it('should return undefined when the element has no such attribute', () => {
        expect(RecordTypes.attributeOfElementAt(text, text.indexOf('"w"'), 'as')).to.be.undefined;
    });
});
