import * as path from 'path';
import * as url from 'url';

// path.posix or path.win32 - the path module is one of them
type PathApi = typeof path.posix;

// The ways the extension currently turns the href of an xsl:import, xsl:include, xsl:use-package (from the
// XSLT.resources.xsltPackages setting) or a fixed-namespaces URI into a file path. They differ - e.g. in their handling
// of file: URIs, percent-encoding and Windows drive letters - and are kept as they were, so the tests pin down the
// current behaviour before they're consolidated.
//
// The path module is a parameter so that the tests can check the Windows behaviour (path.win32) on any platform.
export class HrefPaths {

	// XsltSymbolProvider: an xsl:import or xsl:include href, for the imported globals, and the XSLT document links
	public static resolvePath(href: string, documentPath: string, p: PathApi = path) {
		if (p.isAbsolute(href)) {
			return href;
		} else if (href.startsWith('file:///')) {
			return href.substring(7);
		} else if (href.startsWith('file:/')) {
			return href.substring(5);
		} else {
			href = href.startsWith('file:') ? href.substring(5) : href;
			let basePath = p.dirname(documentPath);
			let joinedPath = p.join(basePath, href);
			return p.normalize(joinedPath);
		}
	}

	// XsltSymbolProvider: the path of an xsl:use-package package, from the XSLT.resources.xsltPackages setting
	public static resolvePathInSettings(href: string, workspace: string, p: PathApi = path) {
		if (p.isAbsolute(href)) {
			return href;
		} else {
			let joinedPath = p.join(workspace, href);
			return p.normalize(joinedPath);
		}
	}

	// DocumentLinkProvider: the target of an XSLT document link, from a resolvePath() or resolvePathInSettings() result
	// - windows is for the tests; it's the platform's convention when it's undefined
	public static linkTarget(resolvedPath: string, windows?: boolean) {
		if (resolvedPath.startsWith('file:/')) {
			return resolvedPath;
		}
		return (windows === undefined ? url.pathToFileURL(resolvedPath) : url.pathToFileURL(resolvedPath, { windows })).toString();
	}

	// ImportIndex: the path of an xsl:import or xsl:include href - undefined for a URI with a scheme other than file:,
	// e.g. http:
	public static moduleReferencePath(href: string, modulePath: string, p: PathApi = path) {
		if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('file:')) {
			return undefined;
		}
		return HrefPaths.hrefToModulePath(href, modulePath, p);
	}

	// XsltHoverProvider (and ImportIndex): the path of an xsl:import or xsl:include href
	public static hrefToModulePath(href: string, documentPath: string, p: PathApi = path) {
		return p.resolve(p.dirname(documentPath), href.startsWith('file:') ? decodeURIComponent(href.replace(/^file:(\/\/)?/, '')) : href);
	}

	// FixedNamespaces: the path of a URI token in a fixed-namespaces attribute - undefined when it's relative and
	// there's no module file, or has a scheme other than file:
	public static fixedNamespacesPath(token: string, moduleFile: string | undefined, p: PathApi = path) {
		return moduleFile && !/^[a-z][a-z0-9+.-]*:/i.test(token) ? p.resolve(p.dirname(moduleFile), token) :
			token.startsWith('file:') ? decodeURIComponent(token.replace(/^file:(\/\/)?/, '')) : undefined;
	}

	// FullDocumentLinkProvider (DCP and Schematron links), DCPSymbolProvider (missing file checks) and
	// XsltTokenDiagnostics (included item types): an href resolved against its document's folder
	public static resolveAgainstDocument(href: string, documentPath: string, p: PathApi = path) {
		return p.resolve(p.dirname(documentPath), href);
	}
}
