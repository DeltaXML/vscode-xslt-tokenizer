/**
 * Pins down the current behaviour of the ways the extension turns an href - of an xsl:import, xsl:include or
 * xsl:use-package, or a fixed-namespaces URI - into a file path, for POSIX and Windows paths, relative hrefs, and file:
 * URIs with none, one, two, three or four slashes. These are what the extension does now, not necessarily what's right:
 * the expectations marked 'ISSUE' are ones that look wrong, and are listed in the summary at the end of this file. When
 * the behaviour is fixed, e.g. as the hrefs are consolidated for XML catalog support, the expectations are updated.
 *
 * The Windows cases use path.win32, so they run on any platform.
 */
import { expect } from 'chai';
import * as path from 'path';
import { HrefPaths } from '../../src/hrefPaths';

const posixDocument = '/work/proj/main.xsl';
const windowsDocument = 'C:\\work\\proj\\main.xsl';

// an href and the path it's resolved to - undefined when it's not resolved
type Case = [href: string, expected: string | undefined];

function check(cases: Case[], resolve: (href: string) => string | undefined) {
	cases.forEach(([href, expected]) => {
		it(`${JSON.stringify(href)} → ${JSON.stringify(expected)}`, () => {
			expect(resolve(href)).to.equal(expected);
		});
	});
}

// relative hrefs - the same for all the ways, except fixed-namespaces with no module file
const posixRelative: Case[] = [
	['a.xsl', '/work/proj/a.xsl'],
	['./a.xsl', '/work/proj/a.xsl'],
	['sub/a.xsl', '/work/proj/sub/a.xsl'],
	['../lib/a.xsl', '/work/lib/a.xsl'],
	// a backslash is a file name character on POSIX
	['sub\\a.xsl', '/work/proj/sub\\a.xsl'],
	['my file.xsl', '/work/proj/my file.xsl'],
	// ISSUE 1: a relative href isn't percent-decoded - the file is my%20file.xsl, not 'my file.xsl'
	['my%20file.xsl', '/work/proj/my%20file.xsl'],
	['/abs/a.xsl', '/abs/a.xsl'],
];
const windowsRelative: Case[] = [
	['a.xsl', 'C:\\work\\proj\\a.xsl'],
	['./a.xsl', 'C:\\work\\proj\\a.xsl'],
	['sub/a.xsl', 'C:\\work\\proj\\sub\\a.xsl'],
	['../lib/a.xsl', 'C:\\work\\lib\\a.xsl'],
	['sub\\a.xsl', 'C:\\work\\proj\\sub\\a.xsl'],
	['my file.xsl', 'C:\\work\\proj\\my file.xsl'],
	// ISSUE 1
	['my%20file.xsl', 'C:\\work\\proj\\my%20file.xsl'],
	['\\\\server\\share\\a.xsl', '\\\\server\\share\\a.xsl'],
];

describe('HrefPaths.resolvePath() - XsltSymbolProvider: imported globals and XSLT document links', () => {
	describe('POSIX', () => {
		check([
			...posixRelative,
			['file:a.xsl', '/work/proj/a.xsl'],
			['file:/abs/a.xsl', '/abs/a.xsl'],
			['file:///abs/a.xsl', '/abs/a.xsl'],
			// ISSUE 2: a file: URI isn't percent-decoded, unlike in ImportIndex, hover and fixed-namespaces
			['file:///abs/my%20file.xsl', '/abs/my%20file.xsl'],
			// ISSUE 3: the authority of file://host/path is kept as part of the path - file://localhost/abs/a.xsl is
			// /abs/a.xsl, and file://abs/a.xsl is on host 'abs'
			['file://localhost/abs/a.xsl', '//localhost/abs/a.xsl'],
			['file://abs/a.xsl', '//abs/a.xsl'],
			['file:////server/share/a.xsl', '//server/share/a.xsl'],
			// ISSUE 4: a URI with another scheme becomes a path in the module's folder, so it's reported as missing
			['http://example.com/a.xsl', '/work/proj/http:/example.com/a.xsl'],
			['urn:x:a', '/work/proj/urn:x:a'],
			// Windows paths are relative on POSIX
			['C:\\lib\\a.xsl', '/work/proj/C:\\lib\\a.xsl'],
		], (href) => HrefPaths.resolvePath(href, posixDocument, path.posix));
	});

	describe('Windows', () => {
		check([
			...windowsRelative,
			['C:\\lib\\a.xsl', 'C:\\lib\\a.xsl'],
			// ISSUE 5: an absolute path is returned as it is, not normalized - so it doesn't match the same file's path
			// elsewhere, e.g. C:\lib\a.xsl from ImportIndex or a document's fileName (which VS Code gives with a
			// lower-case drive letter, c:\lib\a.xsl)
			['C:/lib/a.xsl', 'C:/lib/a.xsl'],
			['/abs/a.xsl', '/abs/a.xsl'],
			['file:a.xsl', 'C:\\work\\proj\\a.xsl'],
			// ISSUE 6: the leading '/' of the URI's path is kept before the drive letter - fs reads /C:/lib/a.xsl as
			// C:\C:\lib\a.xsl, so the module's globals aren't found (the document link still works, see linkTarget())
			['file:///C:/lib/a.xsl', '/C:/lib/a.xsl'],
			['file:/C:/lib/a.xsl', '/C:/lib/a.xsl'],
			['file:///abs/a.xsl', '/abs/a.xsl'],
			// ISSUE 2
			['file:///abs/my%20file.xsl', '/abs/my%20file.xsl'],
			// ISSUE 3: a UNC path's URI, file://server/share/a.xsl, gives //server/share/a.xsl - which Windows reads as
			// \\server\share\a.xsl, so it works by chance; file://localhost/... doesn't
			['file://server/share/a.xsl', '//server/share/a.xsl'],
			['file:////server/share/a.xsl', '//server/share/a.xsl'],
			['file://localhost/abs/a.xsl', '//localhost/abs/a.xsl'],
			// ISSUE 4
			['http://example.com/a.xsl', 'C:\\work\\proj\\http:\\example.com\\a.xsl'],
		], (href) => HrefPaths.resolvePath(href, windowsDocument, path.win32));
	});
});

describe('HrefPaths.resolvePathInSettings() - an xsl:use-package package path from XSLT.resources.xsltPackages', () => {
	describe('POSIX', () => {
		check([
			['pkg/a.xsl', '/ws/pkg/a.xsl'],
			['../pkg/a.xsl', '/pkg/a.xsl'],
			['/abs/p.xsl', '/abs/p.xsl'],
			// ISSUE 7: a file: URI in the setting isn't recognised
			['file:///abs/p.xsl', '/ws/file:/abs/p.xsl'],
		], (href) => HrefPaths.resolvePathInSettings(href, '/ws', path.posix));
	});

	describe('Windows', () => {
		check([
			['pkg/a.xsl', 'C:\\ws\\pkg\\a.xsl'],
			['pkg\\a.xsl', 'C:\\ws\\pkg\\a.xsl'],
			['D:\\p.xsl', 'D:\\p.xsl'],
			// ISSUE 5
			['D:/p.xsl', 'D:/p.xsl'],
			// ISSUE 7
			['file:///D:/p.xsl', 'C:\\ws\\file:\\D:\\p.xsl'],
		], (href) => HrefPaths.resolvePathInSettings(href, 'C:\\ws', path.win32));
	});
});

describe('HrefPaths.linkTarget() - the target URI of an XSLT document link, from resolvePath()', () => {
	describe('POSIX', () => {
		check([
			['a.xsl', 'file:///work/proj/a.xsl'],
			['my file.xsl', 'file:///work/proj/my%20file.xsl'],
			['sub#1/a.xsl', 'file:///work/proj/sub%231/a.xsl'],
			// ISSUE 1 and 2: a percent-encoded href is encoded again, so the link is to a file named my%20file.xsl
			['my%20file.xsl', 'file:///work/proj/my%2520file.xsl'],
			['file:///abs/my%20file.xsl', 'file:///abs/my%2520file.xsl'],
			['file:///abs/a.xsl', 'file:///abs/a.xsl'],
			// ISSUE 3
			['file://localhost/abs/a.xsl', 'file:///localhost/abs/a.xsl'],
			// ISSUE 4: a link to a file that doesn't exist
			['http://example.com/a.xsl', 'file:///work/proj/http:/example.com/a.xsl'],
		], (href) => HrefPaths.linkTarget(HrefPaths.resolvePath(href, posixDocument, path.posix), false));
	});

	describe('Windows', () => {
		check([
			['a.xsl', 'file:///C:/work/proj/a.xsl'],
			['sub\\a.xsl', 'file:///C:/work/proj/sub/a.xsl'],
			['C:\\lib\\a.xsl', 'file:///C:/lib/a.xsl'],
			['C:/lib/a.xsl', 'file:///C:/lib/a.xsl'],
			['\\\\server\\share\\a.xsl', 'file://server/share/a.xsl'],
			// the link works, although resolvePath() gives /C:/lib/a.xsl (ISSUE 6)
			['file:///C:/lib/a.xsl', 'file:///C:/lib/a.xsl'],
			['file://server/share/a.xsl', 'file://server/share/a.xsl'],
			// ISSUE 1
			['my%20file.xsl', 'file:///C:/work/proj/my%2520file.xsl'],
			// ISSUE 3: file://abs/a.xsl becomes a link to a UNC share
			['file://abs/a.xsl', 'file://abs/a.xsl/'],
		], (href) => HrefPaths.linkTarget(HrefPaths.resolvePath(href, windowsDocument, path.win32), true));
	});
});

describe('HrefPaths.moduleReferencePath() - ImportIndex: the import tree and a module\'s inferred top-level stylesheet', () => {
	describe('POSIX', () => {
		check([
			...posixRelative,
			['file:a.xsl', '/work/proj/a.xsl'],
			['file:/abs/a.xsl', '/abs/a.xsl'],
			['file:///abs/a.xsl', '/abs/a.xsl'],
			['file:///abs/my%20file.xsl', '/abs/my file.xsl'],
			// ISSUE 3: 'file://' is removed, leaving a relative path - so the host is a folder in the module's folder
			['file://abs/a.xsl', '/work/proj/abs/a.xsl'],
			['file://localhost/abs/a.xsl', '/work/proj/localhost/abs/a.xsl'],
			['file:////server/share/a.xsl', '/server/share/a.xsl'],
			// another scheme is skipped
			['http://example.com/a.xsl', undefined],
			['urn:x:a', undefined],
		], (href) => HrefPaths.moduleReferencePath(href, posixDocument, path.posix));
	});

	describe('Windows', () => {
		check([
			...windowsRelative,
			['/abs/a.xsl', 'C:\\abs\\a.xsl'],
			// ISSUE 8: a drive letter is taken for a URI scheme, so a module imported by an absolute path isn't indexed
			['C:\\lib\\a.xsl', undefined],
			['C:/lib/a.xsl', undefined],
			['file:a.xsl', 'C:\\work\\proj\\a.xsl'],
			// ISSUE 6: the '/' before the drive letter makes the path relative to the current drive's root
			['file:///C:/lib/a.xsl', 'C:\\C:\\lib\\a.xsl'],
			['file:/C:/lib/a.xsl', 'C:\\C:\\lib\\a.xsl'],
			['file:///abs/my%20file.xsl', 'C:\\abs\\my file.xsl'],
			// ISSUE 3: a UNC path's URI is a folder in the module's folder
			['file://server/share/a.xsl', 'C:\\work\\proj\\server\\share\\a.xsl'],
			['file:////server/share/a.xsl', '\\\\server\\share\\a.xsl'],
			['http://example.com/a.xsl', undefined],
		], (href) => HrefPaths.moduleReferencePath(href, windowsDocument, path.win32));
	});
});

describe('HrefPaths.hrefToModulePath() - XsltHoverProvider: the module note of an xsl:import or xsl:include', () => {
	// the same as moduleReferencePath(), except that another scheme isn't skipped
	describe('POSIX', () => {
		check([
			['a.xsl', '/work/proj/a.xsl'],
			['file:///abs/my%20file.xsl', '/abs/my file.xsl'],
			// no module is found at these paths, so there's no hover
			['http://example.com/a.xsl', '/work/proj/http:/example.com/a.xsl'],
		], (href) => HrefPaths.hrefToModulePath(href, posixDocument, path.posix));
	});

	describe('Windows', () => {
		check([
			['a.xsl', 'C:\\work\\proj\\a.xsl'],
			// a drive letter isn't a scheme here - unlike ImportIndex (ISSUE 8)
			['C:\\lib\\a.xsl', 'C:\\lib\\a.xsl'],
			['C:/lib/a.xsl', 'C:\\lib\\a.xsl'],
			// ISSUE 6
			['file:///C:/lib/a.xsl', 'C:\\C:\\lib\\a.xsl'],
			// ISSUE 3
			['file://server/share/a.xsl', 'C:\\work\\proj\\server\\share\\a.xsl'],
		], (href) => HrefPaths.hrefToModulePath(href, windowsDocument, path.win32));
	});
});

describe('HrefPaths.fixedNamespacesPath() - FixedNamespaces: a document URI in a fixed-namespaces attribute', () => {
	describe('POSIX', () => {
		check([
			...posixRelative,
			['file:///abs/a.xsl', '/abs/a.xsl'],
			['file:///abs/my%20file.xsl', '/abs/my file.xsl'],
			// ISSUE 9: a file: URI isn't resolved against the module - a relative one, or one with a host, is relative
			// to the extension host's working folder
			['file:a.xsl', 'a.xsl'],
			['file://abs/a.xsl', 'abs/a.xsl'],
			['file://localhost/abs/a.xsl', 'localhost/abs/a.xsl'],
			['file:////server/share/a.xsl', '//server/share/a.xsl'],
			['http://example.com/ns.xml', undefined],
		], (token) => HrefPaths.fixedNamespacesPath(token, posixDocument, path.posix));
	});

	describe('Windows', () => {
		check([
			...windowsRelative,
			['/abs/a.xsl', 'C:\\abs\\a.xsl'],
			// ISSUE 8: reported as an unreadable document
			['C:\\lib\\ns.xml', undefined],
			['C:/lib/ns.xml', undefined],
			// ISSUE 6: fs reads /C:/lib/ns.xml as C:\C:\lib\ns.xml
			['file:///C:/lib/ns.xml', '/C:/lib/ns.xml'],
			// ISSUE 9
			['file://server/share/ns.xml', 'server/share/ns.xml'],
		], (token) => HrefPaths.fixedNamespacesPath(token, windowsDocument, path.win32));
	});

	describe('no module file (an untitled document)', () => {
		check([
			['a.xsl', undefined],
			['file:///abs/a.xsl', '/abs/a.xsl'],
		], (token) => HrefPaths.fixedNamespacesPath(token, undefined, path.posix));
	});
});

describe('HrefPaths.resolveAgainstDocument() - DCP and Schematron document links, DCP missing file checks, included item types', () => {
	describe('POSIX', () => {
		check([
			...posixRelative,
			// ISSUE 10: a file: URI isn't recognised
			['file:a.xsl', '/work/proj/file:a.xsl'],
			['file:///abs/a.xsl', '/work/proj/file:/abs/a.xsl'],
			['http://example.com/a.xsl', '/work/proj/http:/example.com/a.xsl'],
		], (href) => HrefPaths.resolveAgainstDocument(href, posixDocument, path.posix));
	});

	describe('Windows', () => {
		check([
			...windowsRelative,
			['/abs/a.xsl', 'C:\\abs\\a.xsl'],
			['C:\\lib\\a.xsl', 'C:\\lib\\a.xsl'],
			['C:/lib/a.xsl', 'C:\\lib\\a.xsl'],
			// ISSUE 10
			['file:///C:/lib/a.xsl', 'C:\\work\\proj\\file:\\C:\\lib\\a.xsl'],
		], (href) => HrefPaths.resolveAgainstDocument(href, windowsDocument, path.win32));
	});
});

/*
 * ISSUES
 *
 *  1. A relative href isn't percent-decoded anywhere: my%20file.xsl is looked for as 'my%20file.xsl', not 'my file.xsl',
 *     and its XSLT document link is encoded again (my%2520file.xsl).
 *  2. resolvePath() doesn't percent-decode a file: URI, while ImportIndex, the hover and fixed-namespaces do.
 *  3. The authority of a file: URI isn't handled: file://localhost/abs/a.xsl should be /abs/a.xsl, and
 *     file://server/share/a.xsl is \\server\share\a.xsl on Windows. resolvePath() gives //localhost/abs/a.xsl;
 *     ImportIndex and the hover remove 'file://', so the host becomes a folder in the module's folder.
 *  4. resolvePath() turns an http: (or other scheme) href into a path in the module's folder, so the import is
 *     reported as a missing file, and its document link is to a file that doesn't exist.
 *  5. On Windows, resolvePath() and resolvePathInSettings() return an absolute path as it is, e.g. C:/lib/a.xsl, not
 *     normalized - so it doesn't match the same file's path from path.resolve() (C:\lib\a.xsl), or a VS Code
 *     document's fileName (c:\lib\a.xsl, with a lower-case drive letter). Matching by string comparison, e.g. the
 *     hover's workspace.textDocuments.find((d) => d.fileName === modulePath), fails for a differently cased drive.
 *  6. On Windows, file:///C:/lib/a.xsl keeps the '/' before the drive letter: resolvePath() and fixed-namespaces give
 *     /C:/lib/a.xsl, and ImportIndex and the hover give C:\C:\lib\a.xsl - so the module isn't read or indexed. Only
 *     the XSLT document link works, as it passes the file: URI through.
 *  7. resolvePathInSettings() doesn't recognise a file: URI in the XSLT.resources.xsltPackages setting.
 *  8. ImportIndex and fixed-namespaces take a Windows drive letter for a URI scheme (/^[a-z][a-z0-9+.-]*:/i), so
 *     C:\lib\a.xsl is skipped by the index and reported as an unreadable fixed-namespaces document.
 *  9. fixed-namespaces doesn't resolve a file: URI against the module: file:a.xsl and file://host/a.xsl are relative
 *     to the extension host's working folder.
 * 10. resolveAgainstDocument() doesn't recognise file: URIs at all. Also, FullDocumentLinkProvider passes its path to
 *     vscode.Uri.parse(), not vscode.Uri.file() - a Windows path, C:\work\a.xsl, parses with the scheme 'c', and a '#'
 *     or '?' in a POSIX path starts a fragment or query.
 */
