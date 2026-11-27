/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import { XMLConfiguration, XSLTConfiguration } from './languageConfigurations';
import { XMLCharState, XSLTokenLevelState, XslLexer } from './xslLexer';
import { RedHatXml, redHatXmlId } from './redHatXml';
import { HtmlCompletions } from './htmlCompletions';

// what's learned of an element name in a document: where it's used, with what, and its attributes' values
interface ElementProfile {
	count: number;
	// instances with no content: self-closed, or nothing but whitespace between the tags
	emptyCount: number;
	// the names of its child elements, with their counts - in the order they're first seen
	children: Map<string, number>;
	// count: on the start tag; added: XSLT - by an xsl:attribute with a literal name, within the element
	attributes: Map<string, { count: number, added: number, values: Map<string, number> }>;
}

interface DocumentProfile {
	elements: Map<string, ElementProfile>;
	// the names of the root's children, and the root's name
	rootName?: string;
	// the namespace prefixes declared anywhere, e.g. xsi
	prefixes: Set<string>;
	// XSLT: the prefix of the XSLT elements - '' when XSLT is the default namespace
	xsltPrefix?: string;
}

// the start tag being read, while a document's tokens are walked
interface PendingTag {
	name: string;
	attributes: { name: string, value?: string }[];
	// the name token is at the cursor, e.g. <ite| - not learned
	atCursor: boolean;
	// XSLT: an XSLT element, not a literal result element
	isXslt: boolean;
}

// an open element, while a document's tokens are walked - with whether it has content yet
interface OpenElement {
	name: string;
	hasContent: boolean;
	learned: boolean;
	isXslt: boolean;
	// XSLT: its content isn't learned, e.g. an xsl:note's, or a top-level element that isn't XSLT
	ignored: boolean;
}

const xsiNamespace = 'http://www.w3.org/2001/XMLSchema-instance';

// completion in an XML file without a schema - or without Red Hat's XML extension, which completes from a schema or
// DTD: the names the document itself uses. After '<', the child elements that other elements with the parent's name have;
// in a start tag, the attributes that other elements with its name have, and the namespace and xml: attributes; in an
// attribute's value, the values it has elsewhere - those of an attribute with a few values, not one with a different
// value each time, e.g. an id
export class XmlCompletions {
	// above this, the document isn't read for names - about 50ms a megabyte
	private static readonly maxLength = 5_000_000;
	// a larger document's names, read a moment ago, are used while it's edited: they're read again only after a pause
	private static readonly largeLength = 500_000;
	private static readonly largeReuseMs = 5000;
	private static cache: { uri: string, version: number, time: number, profile: DocumentProfile } | undefined;

	public static activate(context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xml' }, {
			provideCompletionItems: (document, position) => XmlCompletions.completions(document, position)
		}, '<', '"', '\''));
		// XSLT: a literal result element's attribute values - its element and attribute names are added to the XSLT
		// completions (see XsltTokenCompletions)
		context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: 'xslt' }, {
			provideCompletionItems: (document, position) => XmlCompletions.literalValueCompletions(document, position)
		}, '"', '\''));
	}

	public static completions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		const text = document.getText();
		if (text.length > XmlCompletions.maxLength) {
			return undefined;
		}
		const offset = document.offsetAt(position);
		// after '<!' or '<?': a comment, CDATA section or processing instruction, as in XSLT
		const markup = XmlCompletions.markupCompletions(text, offset, position);
		if (markup) {
			return markup;
		}
		// the start tag the cursor is in, if any: from its '<' - with no '>' between, and not a comment, PI or end tag
		const tagStart = text.lastIndexOf('<', offset - 1);
		const inTag = tagStart > -1 && !text.substring(tagStart, offset).includes('>') && /^<[^!?/]/.test(text.substring(tagStart, tagStart + 2) + ' ') &&
			!XmlCompletions.inCommentOrCData(text, tagStart);
		const before = inTag ? text.substring(tagStart, offset) : '';
		const elementName = /^<([\w.:-]*)$/.exec(before);
		const attributeValue = /^<([\w.:-]+)\b[^<>]*\s([\w.:-]+)\s*=\s*(["'])([^"'<]*)$/.exec(before);
		const attributeName = !attributeValue ? /^<([\w.:-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s+([\w.:-]*)$/.exec(before) : null;
		if (!elementName && !attributeValue && !attributeName) {
			return undefined;
		}
		// with a schema or DTD, Red Hat's XML extension knows the names: it completes them
		const grammarHandled = RedHatXml.validates() && XmlCompletions.hasGrammar(document);
		if (grammarHandled && !attributeValue) {
			return undefined;
		}
		const profile = XmlCompletions.profile(document, offset);
		if (elementName) {
			return XmlCompletions.elementCompletions(document, profile, text, tagStart, offset, elementName[1]);
		}
		if (attributeName) {
			const existing = [...attributeName[2].matchAll(/([\w.:-]+)\s*=/g)].map((m) => m[1]);
			const isRoot = !XmlCompletions.hasElementBefore(text, tagStart);
			return XmlCompletions.attributeCompletions(document, profile, attributeName[1], existing, attributeName[3], position, isRoot);
		}
		return grammarHandled ? undefined : XmlCompletions.valueCompletions(profile, attributeValue![1], attributeValue![2], attributeValue![4], position);
	}

	// the document has a schema or DTD Red Hat's XML extension uses: by xsi:schemaLocation or xsi:noNamespaceSchemaLocation,
	// a DOCTYPE with an external DTD or an internal subset, an xml-model processing instruction, or the xml.fileAssociations setting
	public static hasGrammar(document: vscode.TextDocument): boolean {
		const text = document.getText();
		if (/\s[\w.-]+:(schemaLocation|noNamespaceSchemaLocation)\s*=/.test(text) || /<\?xml-model\s/.test(text) || /<!DOCTYPE\s[^>[]*(\sSYSTEM\s|\sPUBLIC\s|\[)/.test(text)) {
			return true;
		}
		const associations = vscode.workspace.getConfiguration('xml', document).get<{ pattern?: string }[]>('fileAssociations') ?? [];
		return associations.some((association) => !!association.pattern && vscode.languages.match({ pattern: association.pattern }, document) > 0);
	}

	// ---------------------------------------------------------------- learning the document

	// what the document's elements are used with - not the start tag at the offset, which is being typed
	private static profile(document: vscode.TextDocument, offset: number, isXslt = false): DocumentProfile {
		const key = (isXslt ? 'xslt:' : '') + document.uri.toString();
		const cached = XmlCompletions.cache;
		if (cached && cached.uri === key && (cached.version === document.version ||
			(document.getText().length > XmlCompletions.largeLength && Date.now() - cached.time < XmlCompletions.largeReuseMs))) {
			return cached.profile;
		}
		const profile = XmlCompletions.read(document, offset, isXslt);
		XmlCompletions.cache = { uri: key, version: document.version, time: Date.now(), profile };
		return profile;
	}

	// XSLT: the literal result elements are learned - the XSLT elements are as if they weren't there, so in
	// <tr><xsl:for-each …><td>, td is a child of tr - with the attributes on their start tags, those an xsl:attribute with a
	// literal name adds within them, and the values that aren't attribute value templates. Not a top-level element that
	// isn't XSLT, e.g. lookup data, nor an xsl:note's content
	private static read(document: vscode.TextDocument, cursorOffset: number, isXslt = false): DocumentProfile {
		const profile: DocumentProfile = { elements: new Map(), prefixes: new Set() };
		const lexer = new XslLexer(isXslt ? XSLTConfiguration.configuration : XMLConfiguration.configuration);
		lexer.provideCharLevelState = true;
		const tokens = lexer.analyse(document.getText());
		const xmlStart = XslLexer.getXsltStartTokenNumber();
		const textOf = (t: { line: number, startCharacter: number, length: number }) => document.lineAt(t.line).text.substring(t.startCharacter, t.startCharacter + t.length);
		const cursor = document.positionAt(cursorOffset);
		const isAtCursor = (t: { line: number, startCharacter: number, length: number }) => t.line === cursor.line && t.startCharacter <= cursor.character && cursor.character <= t.startCharacter + t.length;
		const elementOf = (name: string) => {
			let element = profile.elements.get(name);
			if (!element) {
				element = { count: 0, emptyCount: 0, children: new Map(), attributes: new Map() };
				profile.elements.set(name, element);
			}
			return element;
		};
		const attributeOf = (element: ElementProfile, name: string) => {
			let entry = element.attributes.get(name);
			if (!entry) {
				entry = { count: 0, added: 0, values: new Map() };
				element.attributes.set(name, entry);
			}
			return entry;
		};
		// XSLT: an attribute on a literal result element that's for the XSLT processor, e.g. xsl:use-attribute-sets
		const isXsltAttribute = (name: string) => !!profile.xsltPrefix && name.startsWith(profile.xsltPrefix + ':');
		const stack: OpenElement[] = [];
		// XSLT: the literal result element the content is in - past XSLT elements
		const literalParent = () => {
			for (let i = stack.length - 1; i > -1; i--) {
				if (!stack[i].isXslt) {
					return stack[i];
				}
			}
			return undefined;
		};
		let pending: PendingTag | undefined;
		const startElement = (tag: PendingTag, selfClosed: boolean) => {
			const parent = stack[stack.length - 1];
			if (parent) {
				parent.hasContent = true;
			}
			if (isXslt && profile.xsltPrefix === undefined && tag.isXslt) {
				// the root: stylesheet, transform or package
				profile.xsltPrefix = tag.name.includes(':') ? tag.name.substring(0, tag.name.indexOf(':')) : '';
			}
			// XSLT: not learned at the top level, within an xsl:note or top-level data, nor an XSLT element
			const ignored = isXslt && (!!parent?.ignored || (stack.length < 2 && !tag.isXslt) || (tag.isXslt && /(^|:)note$/.test(tag.name)));
			const learned = !tag.atCursor && tag.name !== '' && !(isXslt && (tag.isXslt || ignored));
			if (isXslt && tag.isXslt && !ignored && /(^|:)attribute$/.test(tag.name) && !tag.atCursor) {
				// an xsl:attribute with a literal name: an attribute of the literal result element it's in
				const name = tag.attributes.find((a) => a.name === 'name')?.value;
				const owner = literalParent();
				if (name && !/[{}]/.test(name) && owner?.learned) {
					attributeOf(elementOf(owner.name), name).added++;
				}
			}
			if (learned) {
				const element = elementOf(tag.name);
				element.count++;
				if (selfClosed) {
					element.emptyCount++;
				}
				const learnedParent = isXslt ? literalParent() : parent;
				if (learnedParent?.learned) {
					const siblings = elementOf(learnedParent.name).children;
					siblings.set(tag.name, (siblings.get(tag.name) ?? 0) + 1);
				} else if (!parent && profile.rootName === undefined) {
					profile.rootName = tag.name;
				}
				tag.attributes.forEach((attribute) => {
					if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) {
						if (attribute.name.startsWith('xmlns:')) {
							profile.prefixes.add(attribute.name.substring(6));
						}
						return;
					}
					if (isXsltAttribute(attribute.name)) {
						return;
					}
					const entry = attributeOf(element, attribute.name);
					entry.count++;
					// not an attribute value template's
					if (attribute.value !== undefined && !(isXslt && /[{}]/.test(attribute.value))) {
						entry.values.set(attribute.value, (entry.values.get(attribute.value) ?? 0) + 1);
					}
				});
			}
			if (!selfClosed) {
				stack.push({ name: tag.name, hasContent: false, learned, isXslt: tag.isXslt, ignored });
			}
		};
		for (const token of tokens) {
			if (token.tokenType < xmlStart) {
				// XPath-like content isn't expected in plain XML - but it's content
				if (stack.length > 0) {
					stack[stack.length - 1].hasContent = true;
				}
				continue;
			}
			const type = token.tokenType - xmlStart;
			switch (type) {
				case XSLTokenLevelState.xmlPunctuation:
					switch (token.charType) {
						case XMLCharState.lSt:
							pending = { name: '', attributes: [], atCursor: false, isXslt: false };
							break;
						case XMLCharState.rSt:
						case XMLCharState.rStNoAtt:
							if (pending) {
								startElement(pending, false);
							}
							pending = undefined;
							break;
						case XMLCharState.rSelfCt:
						case XMLCharState.rSelfCtNoAtt:
							if (pending) {
								startElement(pending, true);
							}
							pending = undefined;
							break;
						case XMLCharState.lCt: {
							pending = undefined;
							const endName = /^[^\s/>]+/.exec(document.lineAt(token.line).text.substring(token.startCharacter + 2))?.[0];
							const index = endName ? stack.map((e) => e.name).lastIndexOf(endName) : -1;
							if (index > -1) {
								stack.splice(index).forEach((closed) => {
									if (closed.learned && !closed.hasContent) {
										elementOf(closed.name).emptyCount++;
									}
								});
							}
							break;
						}
					}
					break;
				case XSLTokenLevelState.elementName:
				case XSLTokenLevelState.xslElementName:
					if (pending && pending.name === '') {
						pending.name = textOf(token);
						pending.atCursor = isAtCursor(token);
						pending.isXslt = isXslt && type === XSLTokenLevelState.xslElementName;
					}
					break;
				case XSLTokenLevelState.attributeName:
					if (pending && !isAtCursor(token)) {
						pending.attributes.push({ name: textOf(token).trim() });
					}
					break;
				case XSLTokenLevelState.attributeValue:
					if (pending && pending.attributes.length > 0) {
						// a value on one line, with its quotes
						const quoted = textOf(token);
						const match = /^(["'])(.*)\1$/.exec(quoted);
						const last = pending.attributes[pending.attributes.length - 1];
						if (match && last.value === undefined && !isAtCursor(token)) {
							last.value = match[2];
						}
					}
					break;
				case XSLTokenLevelState.xmlText:
				case XSLTokenLevelState.entityRef:
					if (stack.length > 0 && (type === XSLTokenLevelState.entityRef || textOf(token).trim() !== '')) {
						stack[stack.length - 1].hasContent = true;
					}
					break;
				default:
					// a comment, PI or CDATA section is content
					if (stack.length > 0 && type !== XSLTokenLevelState.attributeEquals && type !== XSLTokenLevelState.dtd) {
						stack[stack.length - 1].hasContent = true;
					}
			}
		}
		return profile;
	}

	// ---------------------------------------------------------------- the completions

	private static elementCompletions(document: vscode.TextDocument, profile: DocumentProfile, text: string, tagStart: number, offset: number, typed: string, isXslt = false) {
		const open = XmlCompletions.openAt(text, tagStart);
		// XSLT: the literal result element the '<' is in, past XSLT elements - none, directly in a template
		const parentName = isXslt ? [...open].reverse().find((name) => !XmlCompletions.isXsltName(name, profile)) : open[open.length - 1];
		const parent = parentName !== undefined ? profile.elements.get(parentName) : undefined;
		// the parent's children elsewhere - or, with none known, e.g. a new element, every element name but the root's and its own
		let names = parent ? [...parent.children.keys()] : [];
		const isFallback = names.length === 0;
		// XSLT: after the parent's children, every other name, the most used first - as an element's children are often
		// written in other templates, e.g. a td in a template a tr applies
		const others = isXslt ? [...profile.elements.entries()].filter(([name]) => !names.includes(name)).sort((a, b) => b[1].count - a[1].count).map(([name]) => name) : [];
		const childCount = names.length;
		if (isXslt) {
			names = names.concat(others);
		} else if (isFallback) {
			if (parentName === undefined && profile.rootName !== undefined) {
				return undefined;
			}
			names = [...profile.elements.keys()].filter((name) => name !== profile.rootName && name !== parentName);
		}
		// XSLT: in an HTML element, for HTML output, the elements HTML allows there that the stylesheet doesn't use
		const html = isXslt && parentName !== undefined && XmlCompletions.isHtmlElement(parentName, profile, text) ?
			HtmlCompletions.childrenOf(parentName).filter((element) => !names.includes(element.name)) : [];
		if (names.length === 0 && html.length === 0) {
			return undefined;
		}
		// a tag that already goes on after the name, e.g. <ite|m attr="1">, has its name replaced, not a new element added
		const after = text.substring(offset);
		const nameRest = /^[\w.:-]*/.exec(after)![0];
		const tagGoesOn = /^\s*(\/?>|[\w.:-]+\s*=)/.test(after.substring(nameRest.length));
		const start = document.positionAt(offset - typed.length);
		const range = new vscode.Range(start, document.positionAt(offset + nameRest.length));
		const htmlItems = html.map((element) => {
			const item = new vscode.CompletionItem(element.name, vscode.CompletionItemKind.Property);
			item.range = range;
			if (!tagGoesOn) {
				// XML syntax: the serializer writes a void element as HTML, e.g. <br>
				item.insertText = new vscode.SnippetString(element.void ? `${element.name}/>\$0` : `${element.name}>\$0</${element.name}>`);
			}
			item.detail = `HTML element${parentName ? ` - in ${parentName}` : ''}`;
			item.documentation = XmlCompletions.htmlDocumentation(element.description, element.mdn);
			// after the names the stylesheet uses
			item.sortText = '~~' + element.name;
			item.filterText = element.name;
			return item;
		});
		return names.map((name, index) => {
			const element = profile.elements.get(name)!;
			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
			item.range = range;
			if (!tagGoesOn) {
				// with the attributes it always has - with more than one instance, so it's a pattern - and empty, if it always is
				const always = element.count > 1 ? [...element.attributes.entries()].filter(([, a]) => a.count === element.count).map(([n]) => n) : [];
				let tabStop = 1;
				const attributes = always.map((n) => ` ${n}="\${${tabStop++}}"`).join('');
				item.insertText = new vscode.SnippetString(element.emptyCount === element.count ?
					`${XmlCompletions.escape(name)}${attributes}/>\$0` : `${XmlCompletions.escape(name)}${attributes}>\$0</${XmlCompletions.escape(name)}>`);
			}
			const isChild = parentName !== undefined && index < childCount;
			const where = isChild ? `in ${parentName}: ${parent!.children.get(name)} of ${parent!.count}` : `used ${element.count} time${element.count === 1 ? '' : 's'}`;
			item.detail = `${isXslt ? 'literal result element' : 'element'} - ${where}`;
			// the parent's children first, in the order they're first seen - XSLT: before the instructions, and the other
			// names after them, as '~' sorts after their labels
			item.sortText = (isXslt && !isChild ? '~' : '') + String(index).padStart(5, '0');
			item.filterText = name;
			return item;
		}).concat(htmlItems);
	}

	// XSLT: an HTML element, as a literal result element, where the stylesheet's output is HTML (see HtmlCompletions) -
	// not with XSLT as the default namespace, when an unprefixed name is XSLT's
	private static isHtmlElement(name: string, profile: DocumentProfile, text: string) {
		return profile.xsltPrefix !== '' && !name.includes(':') && !!HtmlCompletions.element(name) && HtmlCompletions.isHtmlOutput(text);
	}

	private static htmlDocumentation(description: string | undefined, mdn?: string) {
		const markdown = new vscode.MarkdownString(description ?? '');
		if (mdn) {
			markdown.appendMarkdown(`\n\n[MDN Reference](${mdn})`);
		}
		return markdown;
	}

	// ---------------------------------------------------------------- XSLT: literal result elements

	// after '<' in a sequence constructor: the literal result elements the stylesheet uses - those in the literal result
	// element the '<' is in first, as elsewhere in it - past XSLT elements, e.g. a td in an xsl:for-each in a tr. Added
	// to the XSLT instructions' completions
	public static literalElementCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
		const text = document.getText();
		if (text.length > XmlCompletions.maxLength) {
			return [];
		}
		const offset = document.offsetAt(position);
		const tagStart = text.lastIndexOf('<', offset - 1);
		const typed = tagStart > -1 ? /^<([\w.:-]*)$/.exec(text.substring(tagStart, offset)) : null;
		if (!typed) {
			return [];
		}
		const profile = XmlCompletions.profile(document, offset, true);
		return XmlCompletions.elementCompletions(document, profile, text, tagStart, offset, typed[1], true) ?? [];
	}

	// in a literal result element's start tag: the attributes other literal result elements with its name have, the
	// most used first - also those an xsl:attribute with a literal name adds. Added to the XSLT completions
	public static literalAttributeCompletions(document: vscode.TextDocument, position: vscode.Position, elementName: string, existing: string[]): vscode.CompletionItem[] {
		const text = document.getText();
		if (text.length > XmlCompletions.maxLength) {
			return [];
		}
		const profile = XmlCompletions.profile(document, document.offsetAt(position), true);
		const element = profile.elements.get(elementName);
		const typed = /[\w.:-]*$/.exec(document.lineAt(position.line).text.substring(0, position.character))![0];
		const range = new vscode.Range(position.translate(0, -typed.length), position);
		const learned = element ? [...element.attributes.entries()].filter(([name]) => !existing.includes(name)) : [];
		const items = learned.sort((a, b) => (b[1].count + b[1].added) - (a[1].count + a[1].added)).map(([name, attribute], index) => {
			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
			item.range = range;
			item.insertText = new vscode.SnippetString(`${name}="$1"$0`);
			const on = attribute.count > 0 ? `on ${attribute.count} of ${element!.count} ${elementName}` : '';
			const added = attribute.added > 0 ? `added by xsl:attribute ${attribute.added} time${attribute.added === 1 ? '' : 's'}` : '';
			item.detail = `attribute - ${[on, added].filter((s) => s).join(', ')}`;
			// before the XSLT attributes
			item.sortText = String(index).padStart(5, '0');
			// its value's completions, straight away
			item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
			return item;
		});
		if (XmlCompletions.isHtmlElement(elementName, profile, text)) {
			// HTML's attributes for the element, then the global ones - not those the stylesheet uses with it, nor aria-*,
			// which are left out of the data
			const names = new Set(learned.map(([name]) => name).concat(existing));
			HtmlCompletions.attributesOf(elementName).filter((attribute) => !names.has(attribute.name)).forEach((attribute, index) => {
				names.add(attribute.name);
				const item = new vscode.CompletionItem(attribute.name, vscode.CompletionItemKind.Field);
				item.range = range;
				item.insertText = new vscode.SnippetString(`${attribute.name}="$1"$0`);
				item.detail = `HTML attribute`;
				if (attribute.description) {
					item.documentation = XmlCompletions.htmlDocumentation(attribute.description);
				}
				// after the XSLT attributes
				item.sortText = '~~' + String(index).padStart(5, '0');
				if (attribute.valueSet) {
					item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
				}
				items.push(item);
			});
		}
		return items;
	}

	// in a literal result element's attribute value: the values the attribute has elsewhere, as in XML - not within an
	// attribute value template's expression, nor in a value that has one
	private static literalValueCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		const text = document.getText();
		if (text.length > XmlCompletions.maxLength) {
			return undefined;
		}
		const offset = document.offsetAt(position);
		const tagStart = text.lastIndexOf('<', offset - 1);
		if (tagStart < 0 || text.substring(tagStart, offset).includes('>') || XmlCompletions.inCommentOrCData(text, tagStart)) {
			return undefined;
		}
		const value = /^<([\w.:-]+)\b[^<>]*\s([\w.:-]+)\s*=\s*(["'])([^"'<{}]*)$/.exec(text.substring(tagStart, offset));
		if (!value) {
			return undefined;
		}
		const profile = XmlCompletions.profile(document, offset, true);
		if (XmlCompletions.isXsltName(value[1], profile)) {
			return undefined;
		}
		const items = XmlCompletions.valueCompletions(profile, value[1], value[2], value[4], position) ?? [];
		if (XmlCompletions.isHtmlElement(value[1], profile, text)) {
			// the values HTML has for the attribute, after those the stylesheet uses
			const used = new Set(items.map((item) => item.label));
			HtmlCompletions.valuesOf(value[1], value[2]).filter((v) => !used.has(v)).forEach((v, index) => {
				const item = XmlCompletions.valueItem(v, `HTML value of ${value[2]}`, value[4], position);
				item.sortText = '~~' + String(index).padStart(4, '0');
				items.push(item);
			});
		}
		return items.length > 0 ? items : undefined;
	}

	// an XSLT element's name - with the stylesheet's prefix for XSLT, or none when XSLT is the default namespace
	private static isXsltName(name: string, profile: DocumentProfile) {
		const prefix = profile.xsltPrefix ?? 'xsl';
		return prefix === '' ? !name.includes(':') : name.startsWith(prefix + ':');
	}

	private static attributeCompletions(document: vscode.TextDocument, profile: DocumentProfile, elementName: string, existing: string[], typed: string, position: vscode.Position, isRoot: boolean) {
		const range = new vscode.Range(position.translate(0, -typed.length), position);
		const items: vscode.CompletionItem[] = [];
		const add = (name: string, detail: string, sortText: string, value = '') => {
			if (existing.includes(name)) {
				return;
			}
			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
			item.range = range;
			item.insertText = new vscode.SnippetString(`${name}="${value || '$1'}"$0`);
			item.detail = detail;
			item.sortText = sortText;
			if (!value) {
				// its value's completions, straight away
				item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
			}
			items.push(item);
		};
		const element = profile.elements.get(elementName);
		if (element) {
			// the most used first
			[...element.attributes.entries()].sort((a, b) => b[1].count - a[1].count).forEach(([name, attribute], index) => {
				add(name, `attribute - on ${attribute.count} of ${element.count} ${elementName}`, '0' + String(index).padStart(4, '0'));
			});
		}
		const declared = (prefix: string) => profile.prefixes.has(prefix) || existing.includes('xmlns:' + prefix);
		if (isRoot && !declared('xsi')) {
			add('xmlns:xsi', 'the XML Schema instance namespace - for xsi:schemaLocation and xsi:noNamespaceSchemaLocation', '1', xsiNamespace);
		}
		if (declared('xsi') && !vscode.extensions.getExtension('redhat.vscode-xml')) {
			// Red Hat's XML extension has these
			if (isRoot) {
				add('xsi:schemaLocation', 'pairs of a namespace URI and the location of its XML Schema', '20');
				add('xsi:noNamespaceSchemaLocation', 'the location of the XML Schema for elements in no namespace', '21');
			}
			add('xsi:type', 'the element\'s XML Schema type', '22');
			add('xsi:nil', 'true: the element is nil - with no content', '23');
		}
		add('xml:lang', 'the language of the content, e.g. en', '30');
		add('xml:space', 'preserve: whitespace in the content is significant', '31');
		add('xml:base', 'the base URI of the element, for relative URIs within it', '32');
		return items;
	}

	// the values the attribute has on other elements with the name - not for an attribute with a different value each
	// time, e.g. an id, or with many values
	private static valueCompletions(profile: DocumentProfile, elementName: string, attributeName: string, typed: string, position: vscode.Position) {
		if (attributeName === 'xml:space') {
			return ['preserve', 'default'].map((value, index) => {
				const item = XmlCompletions.valueItem(value, 'xml:space', typed, position);
				item.sortText = String(index);
				return item;
			});
		}
		const attribute = profile.elements.get(elementName)?.attributes.get(attributeName);
		if (!attribute) {
			return undefined;
		}
		const values = [...attribute.values.entries()].filter(([value]) => value !== '');
		const isRepeated = values.some(([, count]) => count > 1);
		// a single value, or values that repeat - not a different one each time
		if (values.length === 0 || values.length > 50 || (!isRepeated && values.length > 1)) {
			return undefined;
		}
		return values.sort((a, b) => b[1] - a[1]).map(([value, count], index) => {
			const item = XmlCompletions.valueItem(value, `${elementName}/@${attributeName}: used ${count} time${count === 1 ? '' : 's'}`, typed, position);
			item.sortText = String(index).padStart(4, '0');
			return item;
		});
	}

	private static valueItem(value: string, detail: string, typed: string, position: vscode.Position) {
		const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
		item.range = new vscode.Range(position.translate(0, -typed.length), position);
		item.detail = detail;
		return item;
	}

	// after '<!': an XML comment, or within the root element a CDATA section; after '<?': a processing instruction - and
	// before the root element, an xml-model processing instruction associating a Schematron schema, and at the start of the
	// file, the XML declaration. Undefined if the cursor isn't after either, e.g. in a comment. Red Hat's XML extension has
	// its own comment, CDATA section and XML declaration - and DTD, XML Schema and stylesheet associations - so with it
	// installed, these aren't offered too
	private static markupCompletions(text: string, offset: number, position: vscode.Position): vscode.CompletionItem[] | undefined {
		const before = text.substring(Math.max(0, offset - 50), offset);
		const match = /<([!?])([\w.:[-]*)$/.exec(before);
		if (!match) {
			return undefined;
		}
		const markupStart = offset - match[0].length;
		if (XmlCompletions.inCommentOrCData(text, markupStart)) {
			return undefined;
		}
		const typed = match[2];
		const range = new vscode.Range(position.translate(0, -typed.length), position);
		const item = (label: string, snippet: string, detail: string, filterText: string, sortText: string) => {
			const completion = new vscode.CompletionItem(label, vscode.CompletionItemKind.Constant);
			completion.insertText = new vscode.SnippetString(snippet);
			completion.range = range;
			completion.detail = detail;
			completion.filterText = filterText;
			completion.sortText = sortText;
			return completion;
		};
		const beforeRoot = !XmlCompletions.hasElementBefore(text, markupStart);
		const hasRedHat = !!vscode.extensions.getExtension(redHatXmlId);
		if (match[1] === '!') {
			if (hasRedHat) {
				return undefined;
			}
			const items = [item('<!-- -->', '-- ${1} -->${0}', 'XML comment', '--', '0')];
			if (!beforeRoot) {
				// character data is only allowed within an element
				items.push(item('<![CDATA[]]>', '[CDATA[${1}]]>${0}', 'CDATA section', '[CDATA[', '1'));
			}
			return items;
		}
		const items: vscode.CompletionItem[] = [];
		if (markupStart === 0 && !hasRedHat) {
			items.push(item('<?xml version="1.0" encoding="UTF-8"?>', 'xml version="1.0" encoding="UTF-8"?>\n${0}', 'XML declaration', 'xml', '0'));
		}
		if (beforeRoot && !/<\?xml-model\s[^>]*schematron/.test(text)) {
			items.push(item('<?xml-model href="…" ?> (Schematron)', 'xml-model href="${1:rules.sch}" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>${0}',
				'associates a Schematron schema - for Schematron: Validate', 'xml-model', '1'));
		}
		items.push(item('<?name value?>', '${1:name} ${2:value}?>${0}', 'XML Processing Instruction', typed || 'name', '2'));
		items.push(item('<?name?>', '${1:name}?>${0}', 'XML Processing Instruction - name-only', typed || 'name', '3'));
		return items;
	}

	// ---------------------------------------------------------------- the cursor's context

	// the names of the elements whose content the offset is in, the outermost first - none at the top level
	private static openAt(text: string, offset: number): string[] {
		const open: string[] = [];
		const markup = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)(?:"[^"]*"|'[^']*'|[^'">])*?(\/?)>/g;
		let match: RegExpExecArray | null;
		while ((match = markup.exec(text)) !== null && match.index < offset) {
			if (match[1]) {
				const index = open.lastIndexOf(match[1]);
				if (index > -1) {
					open.splice(index);
				}
			} else if (match[2] && !match[3] && match.index + match[0].length <= offset) {
				open.push(match[2]);
			}
		}
		return open;
	}

	private static hasElementBefore(text: string, offset: number) {
		return /<[^!?/\s]/.test(text.substring(0, offset).replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>/g, ''));
	}

	private static inCommentOrCData(text: string, offset: number) {
		const commentStart = text.lastIndexOf('<!--', offset);
		const cdataStart = text.lastIndexOf('<![CDATA[', offset);
		return (commentStart > -1 && text.indexOf('-->', commentStart) === -1) || (commentStart > -1 && text.indexOf('-->', commentStart) > offset) ||
			(cdataStart > -1 && (text.indexOf(']]>', cdataStart) === -1 || text.indexOf(']]>', cdataStart) > offset));
	}

	private static escape(name: string) {
		return name.replace(/[$}\\]/g, '\\$&');
	}
}
