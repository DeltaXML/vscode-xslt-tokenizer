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

describe('XmlCatalog.parse(): the references to files and folders, with their ranges', () => {
	const text = `<catalog ${ns}>
  <uri name="urn:a" uri="lib/a&amp;b.xsl"/>
  <rewriteURI uriStartString="http://example.com/" rewritePrefix='vendor/'/>
  <group xml:base="sub/">
    <uriSuffix uriSuffix="/c.xsl" uri="c.xsl"/>
  </group>
  <nextCatalog
      catalog="next.xml"/>
  <other xmlns="urn:other"><uri name="urn:foreign" uri="foreign.xsl"/></other>
</catalog>`;
	const lines = text.split('\n');
	const { references } = XmlCatalog.parse(text, 'file:///cat/catalog.xml');
	// the text of a single-line range
	const rangeText = (range: { startLine: number, startCharacter: number, endCharacter: number }) => lines[range.startLine].substring(range.startCharacter, range.endCharacter);

	it('each uri, rewritePrefix and catalog attribute, with its absolute URI - not those in another namespace', () => {
		expect(references.map((r) => [r.attribute, r.target])).to.deep.equal([
			['uri', 'file:///cat/lib/a&b.xsl'],
			['rewritePrefix', 'file:///cat/vendor/'],
			['uri', 'file:///cat/sub/c.xsl'],
			['catalog', 'file:///cat/next.xml'],
		]);
	});

	it('the range of each attribute value, with its quotes, as it\'s written', () => {
		expect(references.map((r) => rangeText(r.range))).to.deep.equal(['"lib/a&amp;b.xsl"', '\'vendor/\'', '"c.xsl"', '"next.xml"']);
		expect(references[3].range.startLine).to.equal(7);
	});
});

describe('XmlCatalog.resolve(): how a URI is resolved', () => {
	const { catalog } = catalogOf({
		'/cat/catalog.xml': `<catalog ${ns}><uri name="urn:a" uri="a.xsl"/><nextCatalog catalog="one/catalog.xml"/></catalog>`,
		'/cat/one/catalog.xml': `<catalog ${ns}><nextCatalog catalog="two.xml"/></catalog>`,
		'/cat/one/two.xml': `<catalog ${ns}><rewriteURI uriStartString="urn:lib:" rewritePrefix="lib/"/></catalog>`,
	});

	it('an entry in the catalog', () => {
		expect(catalog.resolve('urn:a')).to.deep.equal({ uri: 'file:///cat/a.xsl', entry: { kind: 'uri', name: 'urn:a', uri: 'file:///cat/a.xsl' }, catalogPath: '/cat/catalog.xml', chain: ['/cat/catalog.xml'] });
	});

	it('an entry found through nextCatalog entries: the catalogs it was found through', () => {
		const resolution = catalog.resolve('urn:lib:x.xsl');
		expect(resolution?.uri).to.equal('file:///cat/one/lib/x.xsl');
		expect(resolution?.entry.kind).to.equal('rewriteURI');
		expect(resolution?.catalogPath).to.equal('/cat/one/two.xml');
		expect(resolution?.chain).to.deep.equal(['/cat/catalog.xml', '/cat/one/catalog.xml', '/cat/one/two.xml']);
	});

	it('HrefPaths.catalogResolution(): the href as it\'s written, or its absolute URI', () => {
		HrefPaths.catalog = catalog;
		try {
			expect(HrefPaths.catalogResolution('urn:a', '/work/main.xsl', path.posix)?.catalogPath).to.equal('/cat/catalog.xml');
			expect(HrefPaths.catalogResolution('other.xsl', '/work/main.xsl', path.posix)).to.equal(undefined);
		} finally {
			HrefPaths.catalog = undefined;
		}
	});
});

describe('XmlCatalog.isCatalog() - a file that\'s an OASIS XML catalog', () => {
	const cases: [string, boolean][] = [
		[`<catalog ${ns}/>`, true],
		[`<?xml version="1.0"?>\n<!-- master -->\n<!DOCTYPE catalog PUBLIC "-//OASIS//DTD XML Catalogs V1.1//EN" "catalog.dtd">\n<catalog ${ns}>\n</catalog>`, true],
		[`<cat:catalog xmlns:cat="${XmlCatalog.namespace}"></cat:catalog>`, true],
		[`<catalog xmlns='${XmlCatalog.namespace}' prefer="public">`, true],
		// another kind of catalog.xml
		['<catalog><product id="1"/></catalog>', false],
		['<catalog xmlns="urn:products"/>', false],
		[`<cat:catalog xmlns="${XmlCatalog.namespace}" xmlns:cat="urn:other"/>`, false],
		[`<products><catalog ${ns}/></products>`, false],
		[`<catalogue ${ns}/>`, false],
		['not XML', false],
	];
	cases.forEach(([text, expected]) => {
		it(`${JSON.stringify(text.length > 60 ? text.substring(0, 57) + '...' : text)} → ${expected}`, () => {
			expect(XmlCatalog.isCatalog(text)).to.equal(expected);
		});
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

	it('an href that the catalog doesn\'t map to a file: a warning for http:, which Saxon fetches, and an error for urn:', () => {
		useCatalog();
		expect(HrefPaths.importProblem('http://example.com/other.xsl', '/work/proj/main.xsl', path.posix)).to.deep.equal({
			message: 'Included/imported URI \'http://example.com/other.xsl\' isn\'t resolved to a file by the XML catalog catalog.xml - its declarations aren\'t known, and Saxon will fetch it, if it can',
			warning: true,
			catalogPath: '/cat/catalog.xml',
		});
		expect(HrefPaths.importProblem('urn:x:missing', '/work/proj/main.xsl', path.posix)).to.deep.equal({
			message: 'Included/imported URI \'urn:x:missing\' isn\'t resolved to a file by the XML catalog catalog.xml',
			warning: false,
			catalogPath: '/cat/catalog.xml',
		});
		// mapped to a URI that isn't a file
		expect(HrefPaths.importProblem('http://example.com/remote.xsl', '/work/proj/main.xsl', path.posix)?.warning).to.equal(true);
		// resolved
		expect(HrefPaths.importProblem('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.equal(undefined);
		expect(HrefPaths.importProblem('a.xsl', '/work/proj/main.xsl', path.posix)).to.equal(undefined);
	});

	it('an href that the catalog doesn\'t map to a file: its document link opens the catalog', () => {
		useCatalog();
		expect(HrefPaths.linkTarget('http://example.com/other.xsl', '/work/proj/main.xsl', path.posix)).to.equal('file:///cat/catalog.xml');
		expect(HrefPaths.linkTooltip('http://example.com/other.xsl', '/work/proj/main.xsl', path.posix)).to.equal('Not resolved to a file by the XML catalog catalog.xml - open the catalog');
		expect(HrefPaths.linkTarget('urn:x:missing', '/work/proj/main.xsl', path.posix)).to.equal('file:///cat/catalog.xml');
		expect(HrefPaths.linkTooltip('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.equal(undefined);
	});

	it('with no catalog, an href that isn\'t a file: a warning or error suggesting a catalog, and no link to one', () => {
		expect(HrefPaths.importProblem('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.deep.equal({
			message: 'Included/imported URI \'http://example.com/lib.xsl\' isn\'t a file - its declarations aren\'t known, and Saxon will fetch it, if it can - an XML catalog can map it to a local file (the XSLT.resources.catalog setting)',
			warning: true,
		});
		expect(HrefPaths.importProblem('urn:x:a', '/work/proj/main.xsl', path.posix)?.warning).to.equal(false);
		// a file problem is an error
		expect(HrefPaths.importProblem('file://private/a.xsl', '/work/proj/main.xsl', path.posix)?.message).to.match(/^Included\/imported file 'file:\/\/private\/a.xsl' can't be resolved: 'private' is the URI's host/);
		expect(HrefPaths.linkTarget('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.equal('http://example.com/lib.xsl');
		expect(HrefPaths.linkTarget('urn:x:a', '/work/proj/main.xsl', path.posix)).to.equal(undefined);
		expect(HrefPaths.linkTooltip('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.equal(undefined);
	});

	it('with no catalog, an http: href isn\'t a file', () => {
		expect(HrefPaths.toPath('http://example.com/lib.xsl', '/work/proj/main.xsl', path.posix)).to.equal(undefined);
	});
});
