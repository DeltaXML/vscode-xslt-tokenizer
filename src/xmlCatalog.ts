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
import { BaseToken } from './xpLexer';
import { DocumentTypes, LanguageConfiguration, XslLexer, XSLTokenLevelState } from './xslLexer';

// the range of an attribute value in a catalog file, with its quotes - lines and characters from 0
export interface CatalogRange {
	startLine: number;
	startCharacter: number;
	endLine: number;
	endCharacter: number;
}

// an OASIS XML Catalog (XML Catalogs 1.1) entry for URI resolution: its URIs are absolute - resolved against the base
// URI in effect, from the catalog file's URI and any xml:base attributes
export type CatalogEntry =
	{ kind: 'uri', name: string, uri: string } |
	{ kind: 'rewriteURI', uriStartString: string, rewritePrefix: string } |
	{ kind: 'uriSuffix', uriSuffix: string, uri: string };

// an attribute of a catalog file's entry that refers to a file or folder: a uri, a rewriteURI's rewritePrefix, or a
// nextCatalog's catalog - with its absolute URI, and its range, e.g. for a document link
export interface CatalogReference {
	attribute: 'uri' | 'rewritePrefix' | 'catalog';
	target: string;
	range: CatalogRange;
}

// the entries of a catalog file, in document order, the catalog files of its nextCatalog entries, and its references
export interface CatalogFile {
	entries: CatalogEntry[];
	nextCatalogs: string[];
	references: CatalogReference[];
}

// how a URI was resolved: the URI, the entry, the catalog file with the entry, and the catalog files it was found
// through, from the catalog of the setting to that file
export interface CatalogResolution {
	uri: string;
	entry: CatalogEntry;
	catalogPath: string;
	chain: string[];
}

// URI resolution with an OASIS XML catalog, and the catalogs of its nextCatalog entries: the uri, rewriteURI and
// uriSuffix entries, in catalog and group elements, with xml:base. Not the system, public or delegate entries, so a
// catalog is used for the hrefs of xsl:import and xsl:include, for example, but not DTDs.
//
// The catalog files are read when they're first needed, and kept - a new XmlCatalog is made when one changes.
export class XmlCatalog {
	public static readonly namespace = 'urn:oasis:names:tc:entity:xmlns:xml:catalog';
	// the XSLT lexer, for XML - as XMLConfiguration in languageConfigurations.ts, which can't be imported here without
	// vscode, and with no snippets
	private static readonly lexerConfiguration: LanguageConfiguration = {
		expressionAtts: [],
		variableElementNames: [],
		nativePrefix: 'qz',
		tvtAttributes: [],
		nonNativeAvts: false,
		docType: DocumentTypes.Other
	};
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
		return this.resolve(uri)?.uri;
	}

	// how a URI resolves - undefined if no entry matches it
	public resolve(uri: string): CatalogResolution | undefined {
		return this.resolveIn(this.catalogPath, XmlCatalog.normalize(uri), []);
	}

	private resolveIn(catalogPath: string, uri: string, chain: string[]): CatalogResolution | undefined {
		if (chain.includes(catalogPath)) {
			// a nextCatalog cycle
			return undefined;
		}
		chain = chain.concat(catalogPath);
		const catalog = this.load(catalogPath);
		if (!catalog) {
			return undefined;
		}
		const found = (entry: CatalogEntry, resolved: string): CatalogResolution => ({ uri: resolved, entry, catalogPath, chain });
		const exact = catalog.entries.find((entry) => entry.kind === 'uri' && entry.name === uri);
		if (exact?.kind === 'uri') {
			return found(exact, exact.uri);
		}
		// the longest match
		let rewrite: Extract<CatalogEntry, { kind: 'rewriteURI' }> | undefined;
		let suffix: Extract<CatalogEntry, { kind: 'uriSuffix' }> | undefined;
		catalog.entries.forEach((entry) => {
			if (entry.kind === 'rewriteURI' && uri.startsWith(entry.uriStartString) && (!rewrite || entry.uriStartString.length > rewrite.uriStartString.length)) {
				rewrite = entry;
			} else if (entry.kind === 'uriSuffix' && uri.endsWith(entry.uriSuffix) && (!suffix || entry.uriSuffix.length > suffix.uriSuffix.length)) {
				suffix = entry;
			}
		});
		if (rewrite) {
			return found(rewrite, rewrite.rewritePrefix + uri.substring(rewrite.uriStartString.length));
		} else if (suffix) {
			return found(suffix, suffix.uri);
		}
		for (const next of catalog.nextCatalogs) {
			const resolved = this.resolveIn(next, uri, chain);
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
	// or with a prefix, and elements in other namespaces are ignored, with their descendants. The text is read with the
	// XSLT lexer, for XML
	public static parse(text: string, catalogUri: string): CatalogFile {
		const entries: CatalogEntry[] = [];
		const nextCatalogs: string[] = [];
		const references: CatalogReference[] = [];
		// the base URI, and namespace prefixes, of each open element
		const stack: { base: string, namespaces: Map<string, string>, ignored: boolean }[] = [{ base: catalogUri, namespaces: new Map(), ignored: false }];

		const startElement = (name: string, attributes: Map<string, { value: string, range: CatalogRange }>, selfClosing: boolean) => {
			const parent = stack[stack.length - 1];
			const value = (attributeName: string) => attributes.get(attributeName)?.value;
			const namespaces = new Map(parent.namespaces);
			attributes.forEach((attribute, attributeName) => {
				if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) {
					namespaces.set(attributeName.substring(6), attribute.value);
				}
			});
			const colon = name.indexOf(':');
			const localName = name.substring(colon + 1);
			const ignored = parent.ignored || namespaces.get(colon < 0 ? '' : name.substring(0, colon)) !== XmlCatalog.namespace;
			const xmlBase = value('xml:base');
			const base = xmlBase !== undefined ? XmlCatalog.absolute(xmlBase, parent.base) ?? parent.base : parent.base;
			if (!ignored) {
				// an attribute's absolute URI - and a reference, for the attribute that refers to a file or folder
				const absolute = (attributeName: 'uri' | 'rewritePrefix' | 'catalog') => {
					const attribute = attributes.get(attributeName);
					const target = attribute === undefined ? undefined : XmlCatalog.absolute(attribute.value, base);
					if (attribute !== undefined && target !== undefined) {
						references.push({ attribute: attributeName, target, range: attribute.range });
					}
					return target;
				};
				switch (localName) {
					case 'uri': {
						const entryName = value('name');
						const uri = absolute('uri');
						if (entryName !== undefined && uri !== undefined) {
							entries.push({ kind: 'uri', name: XmlCatalog.normalize(entryName), uri });
						}
						break;
					}
					case 'rewriteURI': {
						const uriStartString = value('uriStartString');
						const rewritePrefix = absolute('rewritePrefix');
						if (uriStartString !== undefined && rewritePrefix !== undefined) {
							entries.push({ kind: 'rewriteURI', uriStartString: XmlCatalog.normalize(uriStartString), rewritePrefix });
						}
						break;
					}
					case 'uriSuffix': {
						const uriSuffix = value('uriSuffix');
						const uri = absolute('uri');
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
		};

		// the tokens of each start tag, and the end tags: an attribute's value may be split into tokens, around its
		// references, and at line breaks
		const tokens = new XslLexer(XmlCatalog.lexerConfiguration).analyse(text);
		const startTokenNumber = XslLexer.getXsltStartTokenNumber();
		const lineStarts = [0];
		for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
			lineStarts.push(i + 1);
		}
		const offsetOf = (line: number, character: number) => (lineStarts[line] ?? text.length) + character;
		const tokenText = (token: BaseToken) => text.substr(offsetOf(token.line, token.startCharacter), token.length);
		let elementName: string | undefined;
		let isEndTag = false;
		let attributes = new Map<string, { value: string, range: CatalogRange }>();
		let attributeName: string | undefined;
		let valueTokens: BaseToken[] = [];
		const endAttribute = () => {
			if (attributeName !== undefined && valueTokens.length > 0) {
				const first = valueTokens[0];
				const last = valueTokens[valueTokens.length - 1];
				const start = offsetOf(first.line, first.startCharacter);
				const end = offsetOf(last.line, last.startCharacter + last.length);
				// without the quotes, and with the references decoded
				const written = text.substring(start + 1, end - 1);
				attributes.set(attributeName, {
					value: RecordTypes.decodeReferences(written).text,
					range: { startLine: first.line, startCharacter: first.startCharacter, endLine: last.line, endCharacter: last.startCharacter + last.length }
				});
			}
			attributeName = undefined;
			valueTokens = [];
		};
		tokens.forEach((token) => {
			const type = token.tokenType - startTokenNumber;
			switch (type) {
				case XSLTokenLevelState.attributeValue:
				case XSLTokenLevelState.entityRef:
					if (attributeName !== undefined) {
						valueTokens.push(token);
					}
					return;
				case XSLTokenLevelState.attributeEquals:
					return;
			}
			endAttribute();
			switch (type) {
				case XSLTokenLevelState.elementName:
				case XSLTokenLevelState.xslElementName:
					if (isEndTag) {
						if (stack.length > 1) {
							stack.pop();
						}
					} else {
						elementName = tokenText(token);
						attributes = new Map();
					}
					break;
				case XSLTokenLevelState.attributeName:
				case XSLTokenLevelState.xmlnsName:
					attributeName = elementName !== undefined ? tokenText(token) : undefined;
					break;
				case XSLTokenLevelState.xmlPunctuation: {
					const punctuation = tokenText(token);
					if (punctuation === '<' || punctuation === '</') {
						isEndTag = punctuation === '</';
						elementName = undefined;
					} else if ((punctuation === '>' || punctuation === '/>') && elementName !== undefined && !isEndTag) {
						startElement(elementName, attributes, punctuation === '/>');
						elementName = undefined;
					}
					break;
				}
			}
		});
		return { entries, nextCatalogs, references };
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
