/**
 * URI resolution with an OASIS XML catalog (XML Catalogs 1.1): the uri, rewriteURI, uriSuffix and nextCatalog entries,
 * in catalog and group elements, with xml:base - and HrefPaths.toPath() using the catalog of the XSLT.resources.catalog
 * setting. The catalog files are read from memory.
 */
import { expect } from 'chai';
import * as path from 'path';
import { XmlCatalog } from '../../src/xmlCatalog';
import { HrefPaths } from '../../src/hrefPaths';

const ns = `xmlns="${XmlCatalog.namespace}"`;

// a catalog read from the files, by path
function catalogOf(files: { [path: string]: string }, catalogPath = '/cat/catalog.xml') {
	const read: string[] = [];
	const catalog = new XmlCatalog(catalogPath, (file) => {
		read.push(file);
		return files[file];
	});
	return { catalog, read };
}

describe('XmlCatalog.resolveURI()', () => {
	const { catalog } = catalogOf({
		'/cat/catalog.xml': `<?xml version="1.0"?>
<!DOCTYPE catalog PUBLIC "-//OASIS//DTD XML Catalogs V1.1//EN" "http://www.oasis-open.org/committees/entity/release/1.1/catalog.dtd">
<catalog ${ns}>
  <!-- <uri name="http://example.com/commented.xsl" uri="no.xsl"/> -->
  <uri name="http://example.com/lib.xsl" uri="lib/lib.xsl"/>
  <uri name="http://example.com/abs.xsl" uri="file:///abs/abs.xsl"/>
  <uri name="http://example.com/a b.xsl" uri="spaced.xsl"/>
  <uri name="http://example.com/q?a=1&amp;b=2" uri="query.xsl"/>
  <uri name="http://example.com/exact/x.xsl" uri="exact.xsl"/>
  <rewriteURI uriStartString="http://example.com/" rewritePrefix="rewritten/"/>
  <rewriteURI uriStartString="http://example.com/longer/" rewritePrefix="/longer/"/>
  <uriSuffix uriSuffix="/common.xsl" uri="suffix/common.xsl"/>
  <uriSuffix uriSuffix="/x/common.xsl" uri="suffix/x-common.xsl"/>
  <group xml:base="file:///grouped/">
    <uri name="urn:grouped" uri="g.xsl"/>
    <uri xml:base="nested/" name="urn:nested" uri="n.xsl"/>
  </group>
  <uri name="urn:after-group" uri="after.xsl"/>
  <other xmlns="urn:other"><uri name="urn:foreign" uri="foreign.xsl"/></other>
</catalog>`,
	});

	const cases: [string, string | undefined][] = [
		// relative to the catalog file
		['http://example.com/lib.xsl', 'file:///cat/lib/lib.xsl'],
		['http://example.com/abs.xsl', 'file:///abs/abs.xsl'],
		// the name's references are decoded, and the URIs normalized: a space is %20
		['http://example.com/q?a=1&b=2', 'file:///cat/query.xsl'],
		['http://example.com/a b.xsl', 'file:///cat/spaced.xsl'],
		['http://example.com/a%20b.xsl', 'file:///cat/spaced.xsl'],
		// an exact uri entry, before a rewriteURI one
		['http://example.com/exact/x.xsl', 'file:///cat/exact.xsl'],
		// the longest uriStartString
		['http://example.com/other/y.xsl', 'file:///cat/rewritten/other/y.xsl'],
		['http://example.com/longer/z.xsl', 'file:///longer/z.xsl'],
		// the longest uriSuffix - rewriteURI entries first
		['urn:a/x/common.xsl', 'file:///cat/suffix/x-common.xsl'],
		['urn:y/common.xsl', 'file:///cat/suffix/common.xsl'],
		['http://example.com/x/common.xsl', 'file:///cat/rewritten/x/common.xsl'],
		// xml:base, of a group and an entry - and the base after the group ends
		['urn:grouped', 'file:///grouped/g.xsl'],
		['urn:nested', 'file:///grouped/nested/n.xsl'],
		['urn:after-group', 'file:///cat/after.xsl'],
		// not in a comment, or an element in another namespace
		['http://example.com/commented.xsl', 'file:///cat/rewritten/commented.xsl'],
		['urn:foreign', undefined],
		['http://other.com/lib.xsl', undefined],
	];
	cases.forEach(([uri, expected]) => {
		it(`${uri} → ${expected}`, () => {
			expect(catalog.resolveURI(uri)).to.equal(expected);
		});
	});
});

describe('XmlCatalog: catalog files', () => {
	it('a catalog with a prefix for the catalog namespace', () => {
		const { catalog } = catalogOf({ '/cat/catalog.xml': `<cat:catalog xmlns:cat="${XmlCatalog.namespace}"><cat:uri name="urn:a" uri="a.xsl"/><uri name="urn:b" uri="b.xsl"/></cat:catalog>` });
		expect(catalog.resolveURI('urn:a')).to.equal('file:///cat/a.xsl');
		// not in the catalog namespace
		expect(catalog.resolveURI('urn:b')).to.equal(undefined);
	});

	it('the nextCatalog entries, in order, when the catalog has no match - read when they\'re needed', () => {
		const { catalog, read } = catalogOf({
			'/cat/catalog.xml': `<catalog ${ns}><uri name="urn:a" uri="a.xsl"/><nextCatalog catalog="one/catalog.xml"/><nextCatalog catalog="/two/catalog.xml"/></catalog>`,
			'/cat/one/catalog.xml': `<catalog ${ns}><uri name="urn:b" uri="b.xsl"/></catalog>`,
			'/two/catalog.xml': `<catalog ${ns}><uri name="urn:b" uri="not-this.xsl"/><uri name="urn:c" uri="c.xsl"/></catalog>`,
		});
		expect(catalog.resolveURI('urn:a')).to.equal('file:///cat/a.xsl');
		expect(read).to.deep.equal(['/cat/catalog.xml']);
		expect(catalog.resolveURI('urn:b')).to.equal('file:///cat/one/b.xsl');
		expect(catalog.resolveURI('urn:c')).to.equal('file:///two/c.xsl');
		expect(catalog.loadedFiles).to.deep.equal(['/cat/catalog.xml', '/cat/one/catalog.xml', '/two/catalog.xml']);
	});

	it('a nextCatalog cycle, and a missing catalog file', () => {
		const { catalog } = catalogOf({
			'/cat/catalog.xml': `<catalog ${ns}><nextCatalog catalog="missing.xml"/><nextCatalog catalog="other.xml"/></catalog>`,
			'/cat/other.xml': `<catalog ${ns}><nextCatalog catalog="catalog.xml"/><uri name="urn:a" uri="a.xsl"/></catalog>`,
		});
		expect(catalog.resolveURI('urn:a')).to.equal('file:///cat/a.xsl');
		expect(catalog.resolveURI('urn:none')).to.equal(undefined);
		expect(catalogOf({}).catalog.resolveURI('urn:a')).to.equal(undefined);
	});
});

describe('XmlCatalog.normalize()', () => {
	const cases: [string, string][] = [
		['http://example.com/a b.xsl', 'http://example.com/a%20b.xsl'],
		// unreserved characters are decoded, and other percent-encodings upper-cased
		['http://example.com/%7euser/%2fa', 'http://example.com/~user/%2Fa'],
		['urn:café', 'urn:caf%C3%A9'],
		[' urn:a ', 'urn:a'],
	];
	cases.forEach(([uri, expected]) => {
		it(`${uri} → ${expected}`, () => {
			expect(XmlCatalog.normalize(uri)).to.equal(expected);
		});
	});
});

describe('HrefPaths.toPath() with an XML catalog', () => {
	afterEach(() => HrefPaths.catalog = undefined);
	const useCatalog = () => HrefPaths.catalog = catalogOf({
		'/cat/catalog.xml': `<catalog ${ns}>
  <uri name="http://example.com/lib.xsl" uri="lib/lib.xsl"/>
  <uri name="shared.xsl" uri="/shared/shared.xsl"/>
  <rewriteURI uriStartString="file:///work/proj/vendor/" rewritePrefix="file:///vendor/"/>
  <uri name="http://example.com/remote.xsl" uri="http://mirror.example.com/remote.xsl"/>
</catalog>`,
	}).catalog;

	const cases: [string, string | undefined][] = [
		['http://example.com/lib.xsl', '/cat/lib/lib.xsl'],
		// the href as it's written
		['shared.xsl', '/shared/shared.xsl'],
		// the absolute URI of a relative href
		['vendor/v.xsl', '/vendor/v.xsl'],
		['a.xsl', '/work/proj/a.xsl'],
		// mapped to a URI that isn't a file
		['http://example.com/remote.xsl', undefined],
		['http://example.com/other.xsl', undefined],
	];
	cases.forEach(([href, expected]) => {
		it(`${href} → ${expected}`, () => {
			useCatalog();
			expect(HrefPaths.toPath(href, '/work/proj/main.xsl', path.posix)).to.equal(expected);
		});
	});

	it('an http: href mapped to a file is a document link to the file, and isn\'t a problem', () => {
		useCatalog();
		expect(HrefPaths.linkTarget('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.equal('file:///cat/lib/lib.xsl');
		expect(HrefPaths.fileProblem('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.equal(undefined);
	});

	it('with no catalog, an http: href isn\'t a file', () => {
		expect(HrefPaths.toPath('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.equal(undefined);
	});
});
