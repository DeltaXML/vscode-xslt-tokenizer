/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as fs from 'fs';
import * as url from 'url';
import { RecordTypes } from './recordTypes';

// an OASIS XML Catalog (XML Catalogs 1.1) entry for URI resolution: its URIs are absolute - resolved against the base
// URI in effect, from the catalog file's URI and any xml:base attributes
type CatalogEntry =
	{ kind: 'uri', name: string, uri: string } |
	{ kind: 'rewriteURI', uriStartString: string, rewritePrefix: string } |
	{ kind: 'uriSuffix', uriSuffix: string, uri: string };

// the entries of a catalog file, in document order, and the catalog files of its nextCatalog entries
interface CatalogFile {
	entries: CatalogEntry[];
	nextCatalogs: string[];
}

// URI resolution with an OASIS XML catalog, and the catalogs of its nextCatalog entries: the uri, rewriteURI and
// uriSuffix entries, in catalog and group elements, with xml:base. Not the system, public or delegate entries, so a
// catalog is used for the hrefs of xsl:import and xsl:include, for example, but not DTDs.
//
// The catalog files are read when they're first needed, and kept - a new XmlCatalog is made when one changes.
export class XmlCatalog {
	public static readonly namespace = 'urn:oasis:names:tc:entity:xmlns:xml:catalog';
	private readonly files = new Map<string, CatalogFile | undefined>();

	// the catalog file's path, and a function to read a file's text - undefined if it can't be read
	constructor(public readonly catalogPath: string, private readonly readText: (file: string) => string | undefined = XmlCatalog.readFile) {
	}

	// the catalog files read so far: the catalog, and those of nextCatalog entries - to watch for changes
	public get loadedFiles() {
		return [...this.files.keys()];
	}

	// the URI that a URI resolves to - undefined if no entry matches it
	public resolveURI(uri: string): string | undefined {
		return this.resolveIn(this.catalogPath, XmlCatalog.normalize(uri), new Set());
	}

	private resolveIn(catalogPath: string, uri: string, visited: Set<string>): string | undefined {
		if (visited.has(catalogPath)) {
			// a nextCatalog cycle
			return undefined;
		}
		visited.add(catalogPath);
		const catalog = this.load(catalogPath);
		if (!catalog) {
			return undefined;
		}
		const exact = catalog.entries.find((entry) => entry.kind === 'uri' && entry.name === uri);
		if (exact?.kind === 'uri') {
			return exact.uri;
		}
		// the longest match
		let rewrite: { uriStartString: string, rewritePrefix: string } | undefined;
		let suffix: { uriSuffix: string, uri: string } | undefined;
		catalog.entries.forEach((entry) => {
			if (entry.kind === 'rewriteURI' && uri.startsWith(entry.uriStartString) && (!rewrite || entry.uriStartString.length > rewrite.uriStartString.length)) {
				rewrite = entry;
			} else if (entry.kind === 'uriSuffix' && uri.endsWith(entry.uriSuffix) && (!suffix || entry.uriSuffix.length > suffix.uriSuffix.length)) {
				suffix = entry;
			}
		});
		if (rewrite) {
			return rewrite.rewritePrefix + uri.substring(rewrite.uriStartString.length);
		} else if (suffix) {
			return suffix.uri;
		}
		for (const next of catalog.nextCatalogs) {
			const resolved = this.resolveIn(next, uri, visited);
			if (resolved !== undefined) {
				return resolved;
			}
		}
		return undefined;
	}

	private load(catalogPath: string) {
		if (!this.files.has(catalogPath)) {
			const text = this.readText(catalogPath);
			this.files.set(catalogPath, text === undefined ? undefined : XmlCatalog.parse(text, url.pathToFileURL(catalogPath).href));
		}
		return this.files.get(catalogPath);
	}

	// the entries of a catalog file's text, with the file's URI - its elements are in the catalog namespace, by default
	// or with a prefix, and elements in other namespaces are ignored, with their descendants
	public static parse(text: string, catalogUri: string): CatalogFile {
		const entries: CatalogEntry[] = [];
		const nextCatalogs: string[] = [];
		// the base URI, and namespace prefixes, of each open element
		const stack: { base: string, namespaces: Map<string, string>, ignored: boolean }[] = [{ base: catalogUri, namespaces: new Map(), ignored: false }];
		const tagRgx = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<\/[^>]*>|<([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
		for (const match of text.matchAll(tagRgx)) {
			const [tag, name, attributeText, selfClosing] = match;
			if (tag.startsWith('</')) {
				if (stack.length > 1) {
					stack.pop();
				}
				continue;
			} else if (!name) {
				continue;
			}
			const parent = stack[stack.length - 1];
			const attributes = new Map<string, string>();
			for (const attribute of (attributeText ?? '').matchAll(/([\w.:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
				attributes.set(attribute[1], RecordTypes.decodeReferences(attribute[3] ?? attribute[4]).text);
			}
			const namespaces = new Map(parent.namespaces);
			attributes.forEach((value, attributeName) => {
				if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) {
					namespaces.set(attributeName.substring(6), value);
				}
			});
			const colon = name.indexOf(':');
			const localName = name.substring(colon + 1);
			const ignored = parent.ignored || namespaces.get(colon < 0 ? '' : name.substring(0, colon)) !== XmlCatalog.namespace;
			const xmlBase = attributes.get('xml:base');
			const base = xmlBase !== undefined ? XmlCatalog.absolute(xmlBase, parent.base) ?? parent.base : parent.base;
			if (!ignored) {
				const absolute = (attributeName: string) => {
					const value = attributes.get(attributeName);
					return value === undefined ? undefined : XmlCatalog.absolute(value, base);
				};
				const uri = absolute('uri');
				switch (localName) {
					case 'uri': {
						const entryName = attributes.get('name');
						if (entryName !== undefined && uri !== undefined) {
							entries.push({ kind: 'uri', name: XmlCatalog.normalize(entryName), uri });
						}
						break;
					}
					case 'rewriteURI': {
						const uriStartString = attributes.get('uriStartString');
						const rewritePrefix = absolute('rewritePrefix');
						if (uriStartString !== undefined && rewritePrefix !== undefined) {
							entries.push({ kind: 'rewriteURI', uriStartString: XmlCatalog.normalize(uriStartString), rewritePrefix });
						}
						break;
					}
					case 'uriSuffix': {
						const uriSuffix = attributes.get('uriSuffix');
						if (uriSuffix !== undefined && uri !== undefined) {
							entries.push({ kind: 'uriSuffix', uriSuffix: XmlCatalog.normalize(uriSuffix), uri });
						}
						break;
					}
					case 'nextCatalog': {
						const catalog = absolute('catalog');
						if (catalog?.startsWith('file:')) {
							try {
								nextCatalogs.push(url.fileURLToPath(catalog));
							} catch {
								// not a file path
							}
						}
						break;
					}
				}
			}
			if (!selfClosing) {
				stack.push({ base, namespaces, ignored });
			}
		}
		return { entries, nextCatalogs };
	}

	// the text is an OASIS XML catalog: its root element is a catalog element in the catalog namespace - e.g. not
	// another kind of file named catalog.xml
	public static isCatalog(text: string) {
		const withoutProlog = text.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>/g, '');
		const root = /<([\w.-]+:)?catalog((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/.exec(withoutProlog);
		if (!root || withoutProlog.substring(0, root.index).trim() !== '') {
			return false;
		}
		const prefix = root[1] ? root[1].substring(0, root[1].length - 1) : '';
		const declaration = new RegExp(`\\s${prefix ? 'xmlns:' + prefix : 'xmlns'}\\s*=\\s*(["'])([^"']*)\\1`).exec(root[2]);
		return declaration !== null && RecordTypes.decodeReferences(declaration[2]).text === XmlCatalog.namespace;
	}

	// a URI reference made absolute against a base URI - undefined if it isn't a URI
	private static absolute(reference: string, base: string) {
		try {
			return new URL(reference, base).href;
		} catch {
			return undefined;
		}
	}

	// a URI normalized for comparison, as in XML Catalogs 1.1, section 6.3 - characters that aren't allowed in a URI,
	// e.g. spaces, are percent-encoded, and percent-encoded characters that don't need to be are decoded
	public static normalize(uri: string) {
		return uri.trim().replace(/%([0-9a-fA-F]{2})|[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/gu, (match, hex: string | undefined) => {
			if (hex !== undefined) {
				const char = String.fromCharCode(parseInt(hex, 16));
				return /[A-Za-z0-9\-._~]/.test(char) ? char : match.toUpperCase();
			}
			return [...Buffer.from(match, 'utf8')].map((byte) => '%' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
		});
	}

	private static readFile(file: string): string | undefined {
		try {
			return fs.readFileSync(file, 'utf8');
		} catch {
			return undefined;
		}
	}
}
