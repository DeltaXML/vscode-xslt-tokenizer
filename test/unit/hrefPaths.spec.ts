/**
 * How the extension turns an href - of an xsl:import, xsl:include or xsl:use-package, or a fixed-namespaces URI - into
 * a file path: HrefPaths.toPath(), used by all of them, for POSIX and Windows paths, relative hrefs, and file: URIs with
 * none, one, two, three or four slashes. An href is a URI reference, resolved against the file: URI of its document, and
 * percent-decoded - its XML references, e.g. &amp;, are decoded before it's resolved (see
 * test/vscode-ext/hrefReferences.test.ts).
 *
 * The Windows cases use path.win32, so they run on any platform.
 */
import { expect } from 'chai';
import * as path from 'path';
import { HrefPaths } from '../../src/hrefPaths';

const posixDocument = '/work/proj/main.xsl';
const windowsDocument = 'C:\\work\\proj\\main.xsl';

// an input and what it's resolved to - undefined when it's not resolved
type Case = [input: string, expected: string | undefined];

function check(cases: Case[], resolve: (input: string) => string | undefined) {
	cases.forEach(([input, expected]) => {
		it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
			expect(resolve(input)).to.equal(expected);
		});
	});
}

describe('HrefPaths.toPath()', () => {
	describe('POSIX: relative hrefs', () => {
		check([
			['a.xsl', '/work/proj/a.xsl'],
			['./a.xsl', '/work/proj/a.xsl'],
			['sub/a.xsl', '/work/proj/sub/a.xsl'],
			['../lib/a.xsl', '/work/lib/a.xsl'],
			['../../../../a.xsl', '/a.xsl'],
			['/abs/a.xsl', '/abs/a.xsl'],
			// the document itself
			['', '/work/proj/main.xsl'],
			// leading and trailing whitespace is removed
			[' a.xsl ', '/work/proj/a.xsl'],
			// a backslash is a '/' in a file: URI (WHATWG URL parsing)
			['sub\\a.xsl', '/work/proj/sub/a.xsl'],
			['my file.xsl', '/work/proj/my file.xsl'],
			['my%20file.xsl', '/work/proj/my file.xsl'],
			// '#' starts a fragment and '?' a query, as for any URI - a file name with them is written %23 or %3F
			['a.xsl#frag', '/work/proj/a.xsl'],
			['a.xsl?q=1', '/work/proj/a.xsl'],
			['a#b.xsl', '/work/proj/a'],
			['a%23b.xsl', '/work/proj/a#b.xsl'],
			// not a file path: an encoded '/', and an invalid percent-encoding
			['a%2Fb.xsl', undefined],
			['a%zz.xsl', undefined],
		], (href) => HrefPaths.toPath(href, posixDocument, path.posix));
	});

	describe('POSIX: URIs', () => {
		check([
			['file:a.xsl', '/work/proj/a.xsl'],
			['file:/abs/a.xsl', '/abs/a.xsl'],
			['file:///abs/a.xsl', '/abs/a.xsl'],
			['FILE:///abs/a.xsl', '/abs/a.xsl'],
			['file:///abs/my%20file.xsl', '/abs/my file.xsl'],
			['file://localhost/abs/a.xsl', '/abs/a.xsl'],
			['file:////server/share/a.xsl', '//server/share/a.xsl'],
			// a host other than localhost isn't a POSIX file
			['file://abs/a.xsl', undefined],
			['file://server/share/a.xsl', undefined],
			['//server/share/a.xsl', undefined],
			['\\\\server\\share\\a.xsl', undefined],
			// C: is a URI scheme on POSIX
			['C:\\lib\\a.xsl', undefined],
			['C:/lib/a.xsl', undefined],
			['file:///C:/lib/a.xsl', '/C:/lib/a.xsl'],
			// another scheme isn't a file
			['http://example.com/a.xsl', undefined],
			['urn:x:a', undefined],
		], (href) => HrefPaths.toPath(href, posixDocument, path.posix));
	});

	describe('Windows: relative hrefs', () => {
		check([
			['a.xsl', 'c:\\work\\proj\\a.xsl'],
			['./a.xsl', 'c:\\work\\proj\\a.xsl'],
			['sub/a.xsl', 'c:\\work\\proj\\sub\\a.xsl'],
			['sub\\a.xsl', 'c:\\work\\proj\\sub\\a.xsl'],
			['../lib/a.xsl', 'c:\\work\\lib\\a.xsl'],
			['../../../../a.xsl', 'c:\\a.xsl'],
			// on the document's drive
			['/abs/a.xsl', 'c:\\abs\\a.xsl'],
			['', 'c:\\work\\proj\\main.xsl'],
			['my file.xsl', 'c:\\work\\proj\\my file.xsl'],
			['my%20file.xsl', 'c:\\work\\proj\\my file.xsl'],
			['a.xsl#frag', 'c:\\work\\proj\\a.xsl'],
			['a%2Fb.xsl', undefined],
		], (href) => HrefPaths.toPath(href, windowsDocument, path.win32));
	});

	describe('Windows: paths and URIs', () => {
		check([
			// a path with a drive letter is a path, not a URI with the scheme C:
			['C:\\lib\\a.xsl', 'c:\\lib\\a.xsl'],
			['C:/lib/a.xsl', 'c:\\lib\\a.xsl'],
			['D:\\lib\\..\\a.xsl', 'd:\\a.xsl'],
			// the drive letter is lower-case, as in VS Code's paths, e.g. a document's fileName - so the paths of a file
			// match when they're compared as strings
			['c:\\lib\\a.xsl', 'c:\\lib\\a.xsl'],
			['file:///C:/lib/a.xsl#1', 'c:\\lib\\a.xsl'],
			['\\\\server\\share\\a.xsl', '\\\\server\\share\\a.xsl'],
			['//server/share/a.xsl', '\\\\server\\share\\a.xsl'],
			['file:a.xsl', 'c:\\work\\proj\\a.xsl'],
			['file:///C:/lib/a.xsl', 'c:\\lib\\a.xsl'],
			['file:/C:/lib/a.xsl', 'c:\\lib\\a.xsl'],
			['file:///c:/lib/my%20a.xsl', 'c:\\lib\\my a.xsl'],
			['file://server/share/a.xsl', '\\\\server\\share\\a.xsl'],
			['file:////server/share/a.xsl', '\\\\server\\share\\a.xsl'],
			// a file: URI with no drive letter is on the document's drive
			['file:/abs/a.xsl', 'c:\\abs\\a.xsl'],
			['file:///abs/a.xsl', 'c:\\abs\\a.xsl'],
			['file:///abs/my%20file.xsl', 'c:\\abs\\my file.xsl'],
			['file://localhost/abs/a.xsl', 'c:\\abs\\a.xsl'],
			['http://example.com/a.xsl', undefined],
			['urn:x:a', undefined],
		], (href) => HrefPaths.toPath(href, windowsDocument, path.win32));
	});

	describe('no document, e.g. an untitled one: only an absolute href is resolved', () => {
		describe('POSIX', () => {
			check([
				['a.xsl', undefined],
				['/abs/a.xsl', undefined],
				['file:///abs/a.xsl', '/abs/a.xsl'],
			], (href) => HrefPaths.toPath(href, undefined, path.posix));
		});
		describe('Windows', () => {
			check([
				['a.xsl', undefined],
				['C:\\lib\\a.xsl', 'c:\\lib\\a.xsl'],
				['file:///C:/lib/a.xsl', 'c:\\lib\\a.xsl'],
				['file:///abs/a.xsl', undefined],
			], (href) => HrefPaths.toPath(href, undefined, path.win32));
		});
	});

	describe('the path of a file: URI from fileUri(), e.g. the href of an inferred top-level stylesheet', () => {
		check([
			['/work/a b#c/x%y?.xsl', '/work/a b#c/x%y?.xsl'],
		], (filePath) => HrefPaths.toPath(HrefPaths.fileUri(filePath, path.posix), posixDocument, path.posix));
		check([
			['c:\\work\\a b#c\\x%y.xsl', 'c:\\work\\a b#c\\x%y.xsl'],
			['\\\\server\\share\\a.xsl', '\\\\server\\share\\a.xsl'],
		], (filePath) => HrefPaths.toPath(HrefPaths.fileUri(filePath, path.win32), windowsDocument, path.win32));
	});
});

describe('HrefPaths.fileProblem() - why an import\'s href, meant to be a file, has no file path', () => {
	const hostProblem = (host: string, rest: string) => `'${host}' is the URI's host, not a folder - a file: URI for a path has three slashes, e.g. file:///${host}${rest}`;
	const pathProblem = 'it isn\'t a file path - e.g. it has an encoded \'/\' (%2F), or an invalid percent-encoding';
	describe('POSIX', () => {
		check([
			['a.xsl', undefined],
			['file:///private/tmp/a.xsl', undefined],
			['file://localhost/private/tmp/a.xsl', undefined],
			// Saxon reports an I/O error for these
			['file://private/tmp/a.xsl', hostProblem('private', '/tmp/a.xsl')],
			['FILE://server/share/a.xsl', hostProblem('server', '/share/a.xsl')],
			['a%2Fb.xsl', pathProblem],
			['file:///a%zz.xsl', pathProblem],
			// not meant to be files
			['http://example.com/a.xsl', undefined],
			['urn:x:a', undefined],
			['C:\\lib\\a.xsl', undefined],
		], (href) => HrefPaths.fileProblem(href, posixDocument, path.posix));
	});

	describe('Windows', () => {
		check([
			// a UNC share
			['file://server/share/a.xsl', undefined],
			['C:\\lib\\a.xsl', undefined],
			['a%2Fb.xsl', pathProblem],
		], (href) => HrefPaths.fileProblem(href, windowsDocument, path.win32));
	});

	describe('no document: a relative href isn\'t a problem', () => {
		check([
			['a.xsl', undefined],
			['file://private/tmp/a.xsl', hostProblem('private', '/tmp/a.xsl')],
		], (href) => HrefPaths.fileProblem(href, undefined, path.posix));
	});
});

describe('HrefPaths.fromAttribute() - the href of an attribute value, with its XML references decoded', () => {
	check([
		['a.xsl', 'a.xsl'],
		['a&amp;b.xsl', 'a&b.xsl'],
		['a&apos;b.xsl', 'a\'b.xsl'],
		['a&#x20;b.xsl', 'a b.xsl'],
		['a&#32;b.xsl', 'a b.xsl'],
		['sub&#x2F;a.xsl', 'sub/a.xsl'],
		// decoded to %20, which toPath() percent-decodes
		['a&#x25;20b.xsl', 'a%20b.xsl'],
		// not a reference
		['a&b;c.xsl', 'a&b;c.xsl'],
	], (value) => HrefPaths.fromAttribute(value));
});

describe('HrefPaths.settingsPath() - an xsl:use-package package path from XSLT.resources.xsltPackages', () => {
	describe('POSIX', () => {
		check([
			['pkg/a.xsl', '/ws/pkg/a.xsl'],
			['../pkg/a.xsl', '/pkg/a.xsl'],
			['/abs/p.xsl', '/abs/p.xsl'],
			// a file path, not a URI
			['my%20p.xsl', '/ws/my%20p.xsl'],
			['file:///abs/p.xsl', '/abs/p.xsl'],
		], (value) => HrefPaths.settingsPath(value, '/ws', path.posix));
	});

	describe('Windows', () => {
		check([
			['pkg/a.xsl', 'c:\\ws\\pkg\\a.xsl'],
			['pkg\\a.xsl', 'c:\\ws\\pkg\\a.xsl'],
			['D:\\p.xsl', 'd:\\p.xsl'],
			['D:/p.xsl', 'd:\\p.xsl'],
			['file:///D:/p.xsl', 'd:\\p.xsl'],
		], (value) => HrefPaths.settingsPath(value, 'C:\\ws', path.win32));
	});
});

describe('HrefPaths.linkTarget() - the target URI of a document link', () => {
	describe('POSIX', () => {
		check([
			['a.xsl', 'file:///work/proj/a.xsl'],
			['my file.xsl', 'file:///work/proj/my%20file.xsl'],
			['my%20file.xsl', 'file:///work/proj/my%20file.xsl'],
			['a%23b.xsl', 'file:///work/proj/a%23b.xsl'],
			['file:///abs/my%20file.xsl', 'file:///abs/my%20file.xsl'],
			['file://localhost/abs/a.xsl', 'file:///abs/a.xsl'],
			// an http: or https: URI is linked to as it is
			['http://example.com/a.xsl', 'http://example.com/a.xsl'],
			['https://example.com/a.xsl', 'https://example.com/a.xsl'],
			// no link
			['urn:x:a', undefined],
			['file://abs/a.xsl', undefined],
		], (href) => HrefPaths.linkTarget(href, posixDocument, path.posix));
	});

	describe('Windows', () => {
		check([
			['a.xsl', 'file:///c:/work/proj/a.xsl'],
			['sub\\a.xsl', 'file:///c:/work/proj/sub/a.xsl'],
			['C:\\lib\\a.xsl', 'file:///c:/lib/a.xsl'],
			['C:/lib/a.xsl', 'file:///c:/lib/a.xsl'],
			['\\\\server\\share\\a.xsl', 'file://server/share/a.xsl'],
			['file:///C:/lib/a.xsl', 'file:///c:/lib/a.xsl'],
			['file://server/share/a.xsl', 'file://server/share/a.xsl'],
			['my%20file.xsl', 'file:///c:/work/proj/my%20file.xsl'],
			['http://example.com/a.xsl', 'http://example.com/a.xsl'],
		], (href) => HrefPaths.linkTarget(href, windowsDocument, path.win32));
	});
});

/*
 * Not handled:
 *
 * - The paths are compared as strings, e.g. to find an open document, or an already imported module - so a module
 *   with a symbolic link to it is two modules, as is one imported with a differently cased path on Windows or macOS
 *   (other than the drive letter).
 * - An XML catalog, e.g. for an http: href.
 */
