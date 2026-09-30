import * as path from 'path';
import * as url from 'url';
import { RecordTypes } from './recordTypes';

// path.posix or path.win32 - the path module is one of them
type PathApi = typeof path.posix;

// How the extension turns the href of an xsl:import, xsl:include or xsl:use-package, or a fixed-namespaces URI, into a
// file path: all of them use toPath(), as a URI reference resolved against the file: URI of the document it's in.
//
// The path module is a parameter so that the tests can check the Windows behaviour (path.win32) on any platform.
export class HrefPaths {

	// an href as it's written in an attribute value, e.g. a&amp;b.xsl, with its XML references decoded: a&b.xsl
	public static fromAttribute(value: string) {
		return value.includes('&') ? RecordTypes.decodeReferences(value).text : value;
	}

	// the file path of an href - a URI reference, with its XML references decoded - resolved against the path of its
	// document. It's percent-decoded, and may be a file: URI, e.g. file:///C:/lib/a.xsl or file://server/share/a.xsl,
	// or on Windows a path with a drive letter, e.g. C:\lib\a.xsl. Undefined when it's a URI with another scheme, e.g.
	// http:, when it's relative and there's no document, or when it isn't a valid file path, e.g. a%2Fb.xsl
	public static toPath(href: string, documentPath: string | undefined, p: PathApi = path): string | undefined {
		const windows = p === path.win32;
		if (windows && /^[a-z]:[\\/]/i.test(href)) {
			// a path, not a URI with the scheme C:
			return HrefPaths.lowerCaseDrive(p.normalize(href));
		}
		try {
			const base = documentPath !== undefined ? url.pathToFileURL(documentPath, { windows }) : undefined;
			// a backslash is a '/' in a file: URI, so \\server\share\a.xsl is file://server/share/a.xsl
			let resolved = new URL(href, base);
			if (resolved.protocol !== 'file:') {
				return undefined;
			}
			if (windows && base && resolved.host === '' && !/^\/[a-z]:/i.test(resolved.pathname)) {
				// a file: URI with no drive letter, e.g. file:///lib/a.xsl, is on the document's drive, as a path would be -
				// and file:////server/share/a.xsl is file://server/share/a.xsl
				resolved = new URL(resolved.pathname, base);
			}
			const filePath = url.fileURLToPath(resolved, { windows });
			return windows ? HrefPaths.lowerCaseDrive(filePath) : filePath;
		} catch {
			// a relative href with no document, or an invalid file: URI, e.g. with a host on POSIX or an encoded '/'
			return undefined;
		}
	}

	// why an href that's meant to be a file, i.e. a relative href or a file: URI, has no file path - undefined when it has
	// one, or when it's a URI with another scheme, e.g. http:, or relative with no document
	public static fileProblem(href: string, documentPath: string | undefined, p: PathApi = path): string | undefined {
		const trimmed = href.trim();
		const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1];
		if ((scheme !== undefined && scheme.toLowerCase() !== 'file') || (scheme === undefined && documentPath === undefined) ||
			HrefPaths.toPath(href, documentPath, p) !== undefined) {
			return undefined;
		}
		const host = /^file:\/\/([^/?#]+)/i.exec(trimmed)?.[1];
		if (host !== undefined && host.toLowerCase() !== 'localhost') {
			return `'${host}' is the URI's host, not a folder - a file: URI for a path has three slashes, e.g. file:///${trimmed.substring('file://'.length)}`;
		}
		return 'it isn\'t a file path - e.g. it has an encoded \'/\' (%2F), or an invalid percent-encoding';
	}

	// the path of an xsl:use-package package, from the XSLT.resources.xsltPackages setting: a file path, relative to the
	// workspace folder, or a file: URI
	public static settingsPath(value: string, workspace: string, p: PathApi = path): string | undefined {
		if (value.startsWith('file:')) {
			return HrefPaths.toPath(value, undefined, p);
		}
		const resolved = p.resolve(workspace, value);
		return p === path.win32 ? HrefPaths.lowerCaseDrive(resolved) : resolved;
	}

	// a Windows path with a lower-case drive letter, e.g. c:\lib\a.xsl, as VS Code gives it (a document's fileName and a
	// Uri's fsPath) - the paths are compared as strings, e.g. to find an open document or a module that's already imported
	private static lowerCaseDrive(windowsPath: string) {
		return /^[A-Z]:/.test(windowsPath) ? windowsPath.charAt(0).toLowerCase() + windowsPath.substring(1) : windowsPath;
	}

	// the file: URI of a file path
	public static fileUri(filePath: string, p: PathApi = path) {
		return url.pathToFileURL(filePath, { windows: p === path.win32 }).toString();
	}

	// the target of a document link for an href: the file: URI of its path, or an http: or https: URI as it is -
	// undefined for another href that isn't a file
	public static linkTarget(href: string, documentPath: string | undefined, p: PathApi = path): string | undefined {
		const filePath = HrefPaths.toPath(href, documentPath, p);
		if (filePath !== undefined) {
			return HrefPaths.fileUri(filePath, p);
		}
		return /^https?:\/\//i.test(href.trim()) ? href.trim() : undefined;
	}
}
