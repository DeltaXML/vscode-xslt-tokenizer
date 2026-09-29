/**
 * XSLT 4.0 documentation notes: an xsl:note with format="xdoc-md", as the first child of an xsl:function, xsl:template,
 * xsl:item-type etc., with Markdown text followed by tags in the style of xqDoc (and Javadoc), e.g.
 *
 *   <xsl:note format="xdoc-md">
 *     Returns the area of a shape, **scaled** by an optional factor.
 *
 *     @param $shape the shape
 *     @param $scale the scale factor, 1 by default
 *     @return the area, in square units
 *   </xsl:note>
 *
 * The tags are @param $name, @return, @see, @since, @deprecated and @error - each starts a line, and continues on the
 * following lines up to the next tag. For an xsl:item-type that's a record type, @field name documents a field - not an
 * xqDoc tag, but in the same style - with the name quoted if it's not an NCName, e.g. @field 'nick name'.
 *
 * A module note, as the first child of the xsl:stylesheet, xsl:transform or xsl:package, describes the module - with
 * @param $name for its global parameters, @variable $name for its global variables, and xqDoc's @author and @version. A
 * global xsl:param or xsl:variable may have a note of its own instead, for more detail.
 */
import * as fs from 'fs';
import { RecordTypes } from './recordTypes';
import { RecordExtraction } from './recordExtraction';

export interface XdocTag {
	name: string;
	// for @param, the parameter name - or for @variable, the variable name - without the '$'
	paramName?: string;
	// for @field, the field name, without any quotes
	fieldName?: string;
	text: string;
	// the document offset of the '@', and of the parameter or field name - within any quotes
	offset: number;
	paramOffset?: number;
	fieldOffset?: number;
	// the document offset after the last character of the tag's text, which may be on a following line
	endOffset: number;
}

export interface XdocNote {
	// the Markdown text before the first tag
	description: string;
	tags: XdocTag[];
	// the document offsets of the note's content
	contentStart: number;
	contentEnd: number;
}

// a highlighting token within a documentation note: a document offset and length on one line, and its type, an index in
// XdocNotes.tokenTypes
export interface XdocToken {
	offset: number;
	length: number;
	type: number;
}

export class XdocNotes {
	// the semantic token types for documentation notes, after those of the XSLT lexer
	public static readonly tokenTypes = ['xdocText', 'xdocTag', 'xdocParam', 'xdocCode', 'xdocBold', 'xdocItalic', 'xdocHeading', 'xdocLink', 'xdocCdata'];
	private static readonly textType = 0;
	private static readonly tagType = 1;
	private static readonly paramType = 2;
	private static readonly codeType = 3;
	private static readonly boldType = 4;
	private static readonly italicType = 5;
	private static readonly headingType = 6;
	private static readonly linkType = 7;
	private static readonly cdataType = 8;

	// the highlighting tokens for the content of each documentation note - an xsl:note with format="xdoc-md" - with the
	// content ranges they replace: notes with child elements are not included, as their markup has its own highlighting
	public static highlight(text: string): { tokens: XdocToken[], ranges: [number, number][] } {
		const tokens: XdocToken[] = [];
		const ranges: [number, number][] = [];
		const noteOffsets = XdocNotes.noteOffsets(text);
		if (noteOffsets.length === 0) {
			return { tokens, ranges };
		}
		const markup = RecordTypes.blankMarkup(text);
		for (const noteOffset of noteOffsets) {
			const tagRgx = new RegExp(RecordTypes.tagPattern, 'y');
			tagRgx.lastIndex = noteOffset;
			const startTag = tagRgx.exec(markup);
			if (!startTag || startTag[3]) {
				continue;
			}
			const contentStart = noteOffset + startTag[0].length;
			const contentEnd = text.lastIndexOf('<', RecordExtraction.elementEnd(markup, noteOffset) - 1);
			// only text and CDATA sections - comments are blanked out in the markup, so are left as they are
			if (contentEnd < contentStart || markup.substring(contentStart, contentEnd).includes('<') ||
				text.substring(contentStart, contentEnd).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').includes('<')) {
				continue;
			}
			ranges.push([contentStart, contentEnd]);
			let lineStart = contentStart;
			let inCdata = false;
			while (lineStart < contentEnd) {
				const newLine = text.indexOf('\n', lineStart);
				const lineEnd = newLine === -1 || newLine > contentEnd ? contentEnd : newLine;
				inCdata = XdocNotes.highlightLine(text, lineStart, lineEnd, inCdata, tokens);
				lineStart = lineEnd + 1;
			}
		}
		return { tokens, ranges };
	}

	// adds the tokens for a line of a note: CDATA markers are tokens of their own, and the text is classified as if they
	// weren't there - returns true if the line ends within a CDATA section
	private static highlightLine(text: string, lineStart: number, lineEnd: number, inCdata: boolean, tokens: XdocToken[]): boolean {
		// the line's text without CDATA markers, with the document offset of each of its characters
		const chars: string[] = [];
		const offsets: number[] = [];
		let i = lineStart;
		while (i < lineEnd) {
			const marker = !inCdata && text.startsWith('<![CDATA[', i) ? '<![CDATA[' : inCdata && text.startsWith(']]>', i) ? ']]>' : undefined;
			if (marker) {
				tokens.push({ offset: i, length: Math.min(marker.length, lineEnd - i), type: XdocNotes.cdataType });
				inCdata = marker === '<![CDATA[';
				i += marker.length;
			} else {
				chars.push(text.charAt(i));
				offsets.push(i);
				i++;
			}
		}
		const line = chars.join('');
		// the ranges [start, end) of the line's text, by type - later ones override earlier ones where they overlap
		const typed: { start: number, end: number, type: number }[] = [];
		const firstChar = line.search(/\S/);
		if (firstChar === -1) {
			return inCdata;
		}
		typed.push({ start: firstChar, end: line.trimEnd().length, type: XdocNotes.textType });
		const tag = /^(\s*)(@([\w-]+))(?:(\s+)(\$?[\w.:-]+|'[^']*'|"[^"]*"))?/.exec(line);
		const heading = /^\s*#{1,6}\s/.test(line);
		if (heading) {
			typed.push({ start: firstChar, end: line.trimEnd().length, type: XdocNotes.headingType });
		} else {
			if (tag && XdocNotes.tagNames.includes(tag[3])) {
				const tagEnd = tag[1].length + tag[2].length;
				typed.push({ start: tag[1].length, end: tagEnd, type: XdocNotes.tagType });
				if ((tag[3] === 'param' || tag[3] === 'variable' || tag[3] === 'field') && tag[5]) {
					const paramStart = tagEnd + tag[4].length;
					typed.push({ start: paramStart, end: paramStart + tag[5].length, type: XdocNotes.paramType });
				}
			}
			// inline Markdown: code spans, links, bold and italic - code spans are last, as their content isn't Markdown
			const inline: [RegExp, number][] = [
				[/\[[^\]\n]*\]\([^)\s]*\)/g, XdocNotes.linkType],
				[/(\*\*|__)(?=\S)[^*_\n]*?\S\1/g, XdocNotes.boldType],
				[/(?<![*\w])(\*|_)(?=[^\s*_])[^*_\n]*?[^\s*_]\1(?![*\w])/g, XdocNotes.italicType],
				[/(`+)[^`\n]*?\1/g, XdocNotes.codeType]
			];
			for (const [rgx, type] of inline) {
				for (const match of line.matchAll(rgx)) {
					typed.push({ start: match.index!, end: match.index! + match[0].length, type });
				}
			}
		}
		// the type of each character, the last range for it winning
		const types = new Array<number>(line.length).fill(-1);
		typed.forEach((range) => types.fill(range.type, range.start, range.end));
		// a token for each run of characters of the same type, split where a CDATA marker was removed
		let runStart = 0;
		for (let c = 1; c <= line.length; c++) {
			const isRunEnd = c === line.length || types[c] !== types[runStart] || offsets[c] !== offsets[c - 1] + 1;
			if (isRunEnd) {
				if (types[runStart] > -1) {
					tokens.push({ offset: offsets[runStart], length: offsets[c - 1] - offsets[runStart] + 1, type: types[runStart] });
				}
				runStart = c;
			}
		}
		return inCdata;
	}
	public static readonly format = 'xdoc-md';
	// before XSLT 4.0, a note is excluded, so the processor doesn't report it as an unknown XSLT element
	public static readonly excludedAttribute = 'use-when="false()"';
	public static readonly tagNames = ['param', 'variable', 'field', 'return', 'see', 'since', 'deprecated', 'error', 'author', 'version'];
	public static readonly rootNames = ['xsl:stylesheet', 'xsl:transform', 'xsl:package'];
	public static readonly tagDescriptions: { [name: string]: string } = {
		param: 'a parameter: @param $name description',
		variable: 'a global variable: @variable $name description',
		author: 'the author of the module',
		version: 'the version of the module',
		field: 'a field of the record type: @field name description',
		return: 'the result',
		see: 'a related function, template or URI',
		since: 'the version it was added in',
		deprecated: 'why it should no longer be used, and what to use instead',
		error: 'an error it may raise'
	};

	// the tags that apply to a declaration, e.g. 'xsl:item-type' - @field is only for an item type, which has no
	// parameters or result - a module note has its global parameters and variables, and its author and version - and a
	// global xsl:param or xsl:variable has neither
	public static tagNamesFor(declarationName: string | undefined) {
		const common = ['see', 'since', 'deprecated'];
		if (declarationName === 'xsl:item-type') {
			return ['field'].concat(common);
		} else if (declarationName && XdocNotes.rootNames.includes(declarationName)) {
			return ['param', 'variable'].concat(common, ['author', 'version']);
		} else if (declarationName === 'xsl:param' || declarationName === 'xsl:variable') {
			return common;
		}
		return ['param', 'return'].concat(common, ['error']);
	}

	// the xsl:note elements with format="xdoc-md" in the markup, by the offset of their start tags
	public static noteOffsets(text: string): number[] {
		return [...text.matchAll(/<xsl:note\s[^<>]*format\s*=\s*["']xdoc-md["']/g)].map((match) => match.index!);
	}

	// the documentation note of a function, template or item type declaration, from its global instruction data: in the document's
	// text, or in the module declaring it (its href)
	public static forGlobal(declaration: { href?: string, token: { line: number, startCharacter: number } }, documentText: string): XdocNote | undefined {
		let text: string;
		try {
			text = declaration.href ? fs.readFileSync(declaration.href, 'utf8') : documentText;
		} catch {
			return undefined;
		}
		const tagStart = text.lastIndexOf('<', XdocNotes.offsetAt(text, declaration.token.line, declaration.token.startCharacter));
		return tagStart > -1 ? XdocNotes.forDeclaration(text, tagStart) : undefined;
	}

	// the documentation note of the declaration whose start tag is at declarationOffset: its first xsl:note child with
	// format="xdoc-md" - undefined if there isn't one
	public static forDeclaration(text: string, declarationOffset: number, markup = RecordTypes.blankMarkup(text)): XdocNote | undefined {
		const noteOffset = RecordTypes.childElements(text, markup, declarationOffset, 'xsl:note')
			.find((offset) => RecordTypes.attributeOfElementAt(text, offset + 1, 'format') === XdocNotes.format);
		return noteOffset === undefined ? undefined : XdocNotes.parseNote(text, markup, noteOffset);
	}

	// the note whose start tag is at noteOffset
	public static parseNote(text: string, markup: string, noteOffset: number): XdocNote | undefined {
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'y');
		tagRgx.lastIndex = noteOffset;
		const startTag = tagRgx.exec(markup);
		if (!startTag) {
			return undefined;
		}
		const contentStart = noteOffset + startTag[0].length;
		const contentEnd = startTag[3] ? contentStart : text.lastIndexOf('<', RecordExtraction.elementEnd(markup, noteOffset) - 1);
		return XdocNotes.parse(text.substring(contentStart, contentEnd), contentStart);
	}

	// parses the content of a note, at the document offset - CDATA sections and entity references are decoded first, as
	// either may span the description and the tags
	public static parse(rawContent: string, contentStart = 0): XdocNote {
		const { text: content, offsets } = XdocNotes.decode(rawContent);
		const documentOffset = (index: number) => contentStart + offsets[index];
		const descriptionLines: string[] = [];
		const tags: XdocTag[] = [];
		let lineStart = 0;
		for (const line of content.split('\n')) {
			const tag = /^(\s*)@([\w-]+)(?:\s+(\$?)([\w.:-]+))?/.exec(line);
			const field = /^(\s*)@field(?:\s+(?:'([^']*)'|"([^"]*)"|([\w.-]+)))?(?![\w.:-])/.exec(line);
			if (field) {
				const fieldName = field[2] ?? field[3] ?? field[4];
				const isQuoted = field[4] === undefined;
				tags.push({
					name: 'field',
					fieldName,
					text: line.substring(field[0].length).trim(),
					offset: documentOffset(lineStart + field[1].length),
					fieldOffset: fieldName !== undefined ? documentOffset(lineStart + field[0].length - fieldName.length - (isQuoted ? 1 : 0)) : undefined,
					endOffset: documentOffset(lineStart + line.trimEnd().length - 1) + 1
				});
			} else if (tag && XdocNotes.tagNames.includes(tag[2]) && tag[2] !== 'field') {
				// the name of a parameter, or of a global variable in a module note
				const isParam = (tag[2] === 'param' || tag[2] === 'variable') && tag[4] !== undefined;
				const textStart = isParam ? tag[0].length : tag[1].length + 1 + tag[2].length;
				tags.push({
					name: tag[2],
					paramName: isParam ? tag[4] : undefined,
					text: line.substring(textStart).trim(),
					offset: documentOffset(lineStart + tag[1].length),
					paramOffset: isParam ? documentOffset(lineStart + tag[0].length - tag[4].length) : undefined,
					endOffset: documentOffset(lineStart + line.trimEnd().length - 1) + 1
				});
			} else if (tags.length > 0) {
				// the continuation of the last tag's text
				const last = tags[tags.length - 1];
				last.text = (last.text + '\n' + line.trim()).trim();
				if (line.trim() !== '') {
					last.endOffset = documentOffset(lineStart + line.trimEnd().length - 1) + 1;
				}
			} else {
				descriptionLines.push(line);
			}
			lineStart += line.length + 1;
		}
		return { description: XdocNotes.dedent(descriptionLines), tags, contentStart, contentEnd: contentStart + rawContent.length };
	}

	// the text of the content: the text within CDATA sections, without their '<![CDATA[' and ']]>', and elsewhere with
	// entity and character references replaced - with the offset in the content of each character of the text
	public static decode(content: string): { text: string, offsets: number[] } {
		const chars: string[] = [];
		const offsets: number[] = [];
		const entities: { [name: string]: string } = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };
		let i = 0;
		while (i < content.length) {
			if (content.startsWith('<![CDATA[', i)) {
				const end = content.indexOf(']]>', i + 9);
				const cdataEnd = end === -1 ? content.length : end;
				for (let j = i + 9; j < cdataEnd; j++) {
					chars.push(content.charAt(j));
					offsets.push(j);
				}
				i = end === -1 ? content.length : end + 3;
				continue;
			}
			const reference = content.charAt(i) === '&' ? /^&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/.exec(content.substring(i, i + 12)) : null;
			if (reference) {
				const name = reference[1];
				chars.push(name.startsWith('#x') ? String.fromCodePoint(parseInt(name.substring(2), 16)) : name.startsWith('#') ? String.fromCodePoint(parseInt(name.substring(1), 10)) : entities[name]);
				offsets.push(i);
				i += reference[0].length;
				continue;
			}
			chars.push(content.charAt(i));
			offsets.push(i);
			i++;
		}
		// the offset after the last character
		offsets.push(content.length);
		return { text: chars.join(''), offsets };
	}

	// Markdown for the note, e.g. for a hover - with the parameters, unless they're shown elsewhere
	public static toMarkdown(note: XdocNote, includeParams = true): string {
		const parts: string[] = [];
		const description = XdocNotes.markdownText(note.description);
		if (description) {
			parts.push(description);
		}
		const tagLines = note.tags.filter((tag) => includeParams || tag.name !== 'param').map((tag) => {
			const text = XdocNotes.markdownText(tag.text);
			switch (tag.name) {
				case 'param':
				case 'variable':
					return `*@${tag.name}* \`$${tag.paramName ?? ''}\`${text ? ' — ' + text : ''}`;
				case 'field':
					return `*@field* \`${tag.fieldName ?? ''}\`${text ? ' — ' + text : ''}`;
				case 'deprecated':
					return `**Deprecated**${text ? ' — ' + text : ''}`;
				default:
					return `*@${tag.name}*${text ? ' — ' + text : ''}`;
			}
		});
		if (tagLines.length > 0) {
			// a line break for each tag
			parts.push(tagLines.join('  \n'));
		}
		return parts.join('\n\n');
	}

	// the text of the @param tag for the parameter
	public static paramText(note: XdocNote, paramName: string): string | undefined {
		const tag = note.tags.find((t) => t.name === 'param' && t.paramName === paramName);
		return tag ? XdocNotes.markdownText(tag.text) : undefined;
	}

	// the text of the @field tag for the field
	public static fieldText(note: XdocNote, fieldName: string): string | undefined {
		const tag = note.tags.find((t) => t.name === 'field' && t.fieldName === fieldName);
		return tag ? XdocNotes.markdownText(tag.text) : undefined;
	}

	// for a named record type, the text of each field's @field tag, if any: in the documentation note of the xsl:item-type
	// declaring it - or of the one it's declared as, e.g. cx:point for <xsl:item-type name="cx:location" as="cx:point"/> -
	// from the item type declarations, in the document's text or the modules declaring them
	public static recordFieldTexts(typeName: string, itemTypes: { name: string, declaredType?: string, href?: string, token: { line: number, startCharacter: number } }[], documentText: string): (fieldName: string) => string | undefined {
		const notes: XdocNote[] = [];
		let name: string | undefined = typeName;
		for (let depth = 0; name && depth < 10; depth++) {
			const itemType = itemTypes.find((g) => g.name === name);
			if (!itemType) {
				break;
			}
			const note = XdocNotes.forGlobal(itemType, documentText);
			if (note) {
				notes.push(note);
			}
			name = itemType.declaredType?.trim();
		}
		return (fieldName) => notes.map((note) => XdocNotes.fieldText(note, fieldName)).find((text) => !!text);
	}

	// a field name as written after @field: quoted if it's not an NCName
	public static fieldLabel(name: string) {
		return /^[A-Za-z_][\w.-]*$/.test(name) ? name : name.includes('\'') ? `"${name}"` : `'${name}'`;
	}

	// the field names of the record type of an xsl:item-type declaration, from its 'as' - using the named item types for
	// one that's declared as another - undefined if it's not a record type
	public static declarationFieldNames(text: string, declarationOffset: number, itemTypes = XdocNotes.itemTypes(text)): string[] | undefined {
		const asText = RecordTypes.attributeOfElementAt(text, declarationOffset + 1, 'as');
		return asText ? RecordTypes.resolve(asText, itemTypes)?.fields.map((field) => field.name) : undefined;
	}

	// the named item types declared in the text, with their 'as' values
	public static itemTypes(text: string): Map<string, string> {
		const itemTypes = new Map<string, string>();
		for (const match of RecordTypes.blankMarkup(text).matchAll(/<xsl:item-type\s/g)) {
			const name = RecordTypes.attributeOfElementAt(text, match.index! + 1, 'name');
			const asText = RecordTypes.attributeOfElementAt(text, match.index! + 1, 'as');
			if (name && asText) {
				itemTypes.set(name, asText);
			}
		}
		return itemTypes;
	}

	// the note of the module: the first child of its xsl:stylesheet, xsl:transform or xsl:package with format="xdoc-md"
	public static moduleNote(text: string, markup = RecordTypes.blankMarkup(text)): XdocNote | undefined {
		const root = XdocNotes.rootOffset(markup);
		return root === undefined ? undefined : XdocNotes.forDeclaration(text, root, markup);
	}

	// the offset of the start tag of the module's root element
	public static rootOffset(markup: string): number | undefined {
		return /<(xsl:stylesheet|xsl:transform|xsl:package)[\s>]/.exec(markup)?.index;
	}

	// the element at the offset is a global declaration: a child of the root element
	public static isGlobal(markup: string, offset: number) {
		const ancestors = RecordTypes.openElements(markup, offset);
		return ancestors.length === 1 && XdocNotes.rootNames.includes(ancestors[0].name);
	}

	// the documentation of the global xsl:param or xsl:variable at the offset: its own note - or else its @param or
	// @variable in the module note - as Markdown, undefined if it has none
	public static globalDocumentation(text: string, declarationOffset: number, markup = RecordTypes.blankMarkup(text)): string | undefined {
		const own = XdocNotes.forDeclaration(text, declarationOffset, markup);
		if (own) {
			return XdocNotes.toMarkdown(own);
		}
		const isParam = text.startsWith('<xsl:param', declarationOffset);
		const name = RecordTypes.attributeOfElementAt(text, declarationOffset + 1, 'name');
		const tag = name ? XdocNotes.moduleNote(text, markup)?.tags.find((t) => t.name === (isParam ? 'param' : 'variable') && t.paramName === name) : undefined;
		return tag ? XdocNotes.markdownText(tag.text) : undefined;
	}

	// a documentation note at the offset, e.g. of a new element, would be used: its parent is an xsl:function, a named
	// xsl:template, an xsl:item-type, the root element - for the module note - or a global xsl:param or xsl:variable,
	// and it has no documentation note yet
	public static isDocumentationNoteParent(text: string, offset: number): boolean {
		const markup = RecordTypes.blankMarkup(text);
		const ancestors = RecordTypes.openElements(markup, offset);
		const parent = ancestors[ancestors.length - 1];
		if (!parent) {
			return false;
		}
		const isRoot = ancestors.length === 1 && XdocNotes.rootNames.includes(parent.name);
		const isGlobalVariable = (parent.name === 'xsl:param' || parent.name === 'xsl:variable') && ancestors.length === 2 && XdocNotes.rootNames.includes(ancestors[0].name);
		const isNamedTemplate = parent.name === 'xsl:template' && RecordTypes.attributeOfElementAt(text, parent.offset + 1, 'name') !== undefined;
		if (!(isRoot || isGlobalVariable || isNamedTemplate || parent.name === 'xsl:function' || parent.name === 'xsl:item-type')) {
			return false;
		}
		return !XdocNotes.forDeclaration(text, parent.offset, markup);
	}

	// the names of the global xsl:param (or xsl:variable) declarations of the module that have no note of their own
	public static globalNamesWithoutNotes(text: string, markup: string, rootOffset: number, elementName: string): string[] {
		return RecordTypes.childElements(text, markup, rootOffset, elementName)
			.filter((offset) => !XdocNotes.forDeclaration(text, offset, markup))
			.map((offset) => RecordTypes.attributeOfElementAt(text, offset + 1, 'name'))
			.filter((name): name is string => !!name);
	}

	// the declaration's parameter names, from its xsl:param children
	public static paramNames(text: string, markup: string, declarationOffset: number): string[] {
		return RecordTypes.childElements(text, markup, declarationOffset, 'xsl:param')
			.map((offset) => RecordTypes.attributeOfElementAt(text, offset + 1, 'name'))
			.filter((name): name is string => !!name);
	}

	// for the cursor in the start tag of an xsl:function, xsl:template, xsl:item-type, the root element, or a global
	// xsl:param or xsl:variable, without an xsl:note child, the snippet for a new note as its first child - with an
	// @param for each xsl:param, and @return for a function or a template with an 'as' - for a module note, an @param
	// or @variable for each global parameter or variable without a note of its own - and where to insert it: after the
	// start tag, or replacing the '/>' of an empty element - before XSLT 4.0, the note is excluded with use-when, as
	// xsl:note is an unknown XSLT element for the processor
	public static noteSnippetAt(text: string, offset: number, isExcluded = false): { insertOffset: number, replaceLength: number, snippet: string } | undefined {
		const tagStart = offset > 0 ? text.lastIndexOf('<', offset - 1) : -1;
		const elementName = tagStart > -1 ? /^<(xsl:function|xsl:template|xsl:item-type|xsl:stylesheet|xsl:transform|xsl:package|xsl:param|xsl:variable)[\s/>]/.exec(text.substring(tagStart, tagStart + 16))?.[1] : undefined;
		if (!elementName) {
			return undefined;
		}
		// before XSLT 4.0, there's no xsl:item-type
		if (isExcluded && elementName === 'xsl:item-type') {
			return undefined;
		}
		const markup = RecordTypes.blankMarkup(text);
		const isGlobalVariable = elementName === 'xsl:param' || elementName === 'xsl:variable';
		if (isGlobalVariable && !XdocNotes.isGlobal(markup, tagStart)) {
			return undefined;
		}
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'y');
		tagRgx.lastIndex = tagStart;
		const startTag = tagRgx.exec(markup);
		const isEmpty = !!startTag?.[3];
		if (!startTag || (isEmpty && elementName !== 'xsl:item-type' && !isGlobalVariable) || offset >= tagStart + startTag[0].length ||
			RecordTypes.childElements(text, markup, tagStart, 'xsl:note').length > 0) {
			return undefined;
		}
		const tagEnd = tagStart + startTag[0].length;
		// for an empty element, the '/>' and any whitespace before it are replaced
		const insertOffset = isEmpty ? tagStart + startTag[0].replace(/\s*\/>$/, '').length : tagEnd;
		// the indentation of the first child element, or one step more than the declaration's
		const lineIndent = (at: number) => {
			const lineStart = text.lastIndexOf('\n', at - 1) + 1;
			return /^[ \t]*$/.test(text.substring(lineStart, at)) ? text.substring(lineStart, at) : undefined;
		};
		const declarationIndent = lineIndent(tagStart) ?? '';
		const childRgx = new RegExp(RecordTypes.tagPattern, 'g');
		childRgx.lastIndex = tagEnd;
		const firstChild = isEmpty ? null : childRgx.exec(markup);
		const firstChildIndent = firstChild && !firstChild[1] ? lineIndent(firstChild.index) : undefined;
		const step = firstChildIndent !== undefined && firstChildIndent.length > declarationIndent.length && firstChildIndent.startsWith(declarationIndent) ?
			firstChildIndent.substring(declarationIndent.length) : declarationIndent.includes('\t') ? '\t' : '  ';
		const indent = declarationIndent + step;
		const hasReturn = elementName === 'xsl:function' || (elementName === 'xsl:template' && RecordTypes.attributeOfElementAt(text, tagStart + 1, 'as') !== undefined);
		let tabStop = 2;
		const escape = (name: string) => name.replace(/[$}\\]/g, '\\$&');
		const isRoot = XdocNotes.rootNames.includes(elementName);
		const paramNames = isGlobalVariable ? [] : isRoot ? XdocNotes.globalNamesWithoutNotes(text, markup, tagStart, 'xsl:param') : XdocNotes.paramNames(text, markup, tagStart);
		const tagLines = paramNames.map((name) => `\n${indent}${step}@param \\$${escape(name)} \${${tabStop++}:description}`);
		if (isRoot) {
			XdocNotes.globalNamesWithoutNotes(text, markup, tagStart, 'xsl:variable').forEach((name) => tagLines.push(`\n${indent}${step}@variable \\$${escape(name)} \${${tabStop++}:description}`));
		}
		if (elementName === 'xsl:item-type') {
			(XdocNotes.declarationFieldNames(text, tagStart) ?? []).forEach((name) => tagLines.push(`\n${indent}${step}@field ${XdocNotes.fieldLabel(name).replace(/[$}\\]/g, '\\$&')} \${${tabStop++}:description}`));
		}
		if (hasReturn) {
			tagLines.push(`\n${indent}${step}@return \${${tabStop++}:description}`);
		}
		const tags = tagLines.length > 0 ? `\n${tagLines.join('')}` : '';
		const note = `\n${indent}<xsl:note ${isExcluded ? XdocNotes.excludedAttribute + ' ' : ''}format="${XdocNotes.format}">\n${indent}${step}\${1:description}${tags}\n${indent}</xsl:note>`;
		return isEmpty ?
			{ insertOffset, replaceLength: tagEnd - insertOffset, snippet: `>${note}\n${declarationIndent}</${elementName}>` } :
			{ insertOffset, replaceLength: 0, snippet: note };
	}

	// the document offset for a line and character position in the text, e.g. for a token in another file
	public static offsetAt(text: string, line: number, character: number): number {
		let offset = 0;
		for (let i = 0; i < line; i++) {
			const next = text.indexOf('\n', offset);
			if (next === -1) {
				return text.length;
			}
			offset = next + 1;
		}
		return offset + character;
	}

	// Markdown for decoded text, e.g. from a CDATA section: '&' and '<' outside a code span are escaped, so that the text
	// is shown as written - e.g. '&lt;' in a CDATA section, and '<b>', which would otherwise be removed as raw HTML
	private static markdownText(text: string) {
		return text.split(/(`+[\s\S]*?`+)/).map((part, index) => index % 2 === 1 ? part : part.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('');
	}

	// the lines without their common indentation, and without leading and trailing empty lines
	private static dedent(lines: string[]) {
		const nonEmpty = lines.filter((line) => line.trim() !== '');
		const indent = nonEmpty.length > 0 ? Math.min(...nonEmpty.map((line) => line.length - line.trimStart().length)) : 0;
		return lines.map((line) => line.substring(Math.min(indent, line.length - line.trimStart().length)).trimEnd()).join('\n').trim();
	}
}
