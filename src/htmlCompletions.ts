/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import { HtmlAttribute, HtmlElement, htmlElements, htmlGlobalAttributes, htmlValueSets } from './htmlData';

// HTML's names for literal result element completion in XSLT (see XmlCompletions) - only where the output is HTML: an HTML
// element is the nearest literal result element, and the stylesheet's output is HTML, by xsl:output, the XHTML namespace,
// or an html or body element - as other vocabularies, e.g. DocBook, have elements named table, title or p. The names are
// from VS Code's own HTML data (see htmlData.ts); which elements go where is HTML's content model, for its strict cases
export class HtmlCompletions {
	private static elementsByName = new Map(htmlElements.map((element) => [element.name, element]));

	// parents with only these children - other than script and template, which go anywhere
	private static readonly strictChildren: Record<string, string[]> = {
		html: ['head', 'body'],
		head: ['title', 'meta', 'link', 'style', 'script', 'base', 'noscript', 'template'],
		table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr'],
		thead: ['tr'], tbody: ['tr'], tfoot: ['tr'],
		tr: ['td', 'th'],
		colgroup: ['col'],
		ul: ['li'], ol: ['li'], menu: ['li'],
		dl: ['dt', 'dd', 'div'],
		select: ['option', 'optgroup', 'hr'],
		optgroup: ['option'],
		datalist: ['option'],
		picture: ['source', 'img'],
	};

	// elements only in a particular parent, or in the head - not offered elsewhere
	private static readonly placedElements = new Set(['html', 'head', 'body', 'title', 'base', 'meta', 'link', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot',
		'tr', 'td', 'th', 'li', 'dt', 'dd', 'option', 'optgroup', 'legend', 'summary', 'figcaption', 'source', 'track', 'rt', 'rp', 'area']);

	// the placed elements a parent has as well as its other content
	private static readonly placedIn: Record<string, string[]> = {
		figure: ['figcaption'], fieldset: ['legend'], details: ['summary'], audio: ['source', 'track'], video: ['source', 'track'], ruby: ['rt', 'rp'], map: ['area'],
	};

	// parents whose content is phrasing content: text, and elements within text
	private static readonly phrasingParents = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'em', 'strong', 'small', 's', 'cite', 'q', 'dfn', 'abbr',
		'code', 'var', 'samp', 'kbd', 'sub', 'sup', 'i', 'b', 'u', 'mark', 'bdi', 'bdo', 'pre', 'label', 'data', 'time', 'output', 'legend', 'rt', 'rp']);

	private static readonly phrasingElements = new Set(['a', 'abbr', 'area', 'audio', 'b', 'bdi', 'bdo', 'br', 'button', 'canvas', 'cite', 'code', 'data', 'datalist',
		'del', 'dfn', 'em', 'embed', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'map', 'mark', 'meter', 'noscript', 'object', 'output', 'picture', 'progress',
		'q', 'ruby', 's', 'samp', 'script', 'select', 'slot', 'small', 'span', 'strong', 'sub', 'sup', 'template', 'textarea', 'time', 'u', 'var', 'video', 'wbr']);

	public static element(name: string): HtmlElement | undefined {
		return HtmlCompletions.elementsByName.get(name);
	}

	// the stylesheet's output is HTML: xsl:output with method html or xhtml, or an html-version - or the XHTML namespace,
	// or an html or body literal result element
	public static isHtmlOutput(text: string) {
		return /<(?:[\w.-]+:)?output\b[^>]*?\s(?:method\s*=\s*["']\s*x?html\s*["']|html-version\s*=)/.test(text) ||
			/\sxmlns(?::[\w.-]+)?\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xhtml["']/.test(text) || /<(?:html|body)[\s>/]/.test(text);
	}

	// the elements HTML allows in the parent - an HTML element
	public static childrenOf(parent: string): HtmlElement[] {
		const strict = HtmlCompletions.strictChildren[parent];
		let names: string[];
		if (strict) {
			names = strict.concat(parent === 'head' ? [] : ['script', 'template']);
		} else {
			const placed = HtmlCompletions.placedIn[parent] ?? [];
			names = htmlElements.map((e) => e.name).filter((name) => !HtmlCompletions.placedElements.has(name) || placed.includes(name));
			if (HtmlCompletions.phrasingParents.has(parent)) {
				names = names.filter((name) => HtmlCompletions.phrasingElements.has(name) || placed.includes(name));
			}
		}
		return names.map((name) => HtmlCompletions.elementsByName.get(name)).filter((e): e is HtmlElement => !!e);
	}

	// the element's attributes, then the global attributes
	public static attributesOf(name: string): HtmlAttribute[] {
		const element = HtmlCompletions.elementsByName.get(name);
		return element ? element.attributes.concat(htmlGlobalAttributes) : [];
	}

	// the values HTML has for the attribute - a boolean attribute's is its name, e.g. checked="checked"
	public static valuesOf(elementName: string, attributeName: string): string[] {
		const attribute = HtmlCompletions.attributesOf(elementName).find((a) => a.name === attributeName);
		if (!attribute?.valueSet) {
			return [];
		}
		return attribute.valueSet === 'v' ? [attribute.name] : htmlValueSets[attribute.valueSet] ?? [];
	}
}
