/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT package quick fixes
 */
import { RecordTypes } from './recordTypes';

// an edit of a module's text: replacing start to end with the text - its XSLT names with the prefix xsl
export interface TextEdit {
	start: number;
	end: number;
	text: string;
}

// the extent of an element: the end of its start tag, the start of its end tag (the same for an empty element), and
// its end
export interface ElementExtent {
	startTagEnd: number;
	endTagStart: number;
	end: number;
	selfClosing: boolean;
}

/**
 * Text edits for the quick fixes of PackageScope's problems: within a start tag, of an element as a whole, and of a
 * name in a list of names, e.g. the names attribute of xsl:accept. Offsets are in the module's text; its markup
 * (RecordTypes.blankMarkup) is used to find tags.
 */
export class PackageEdits {

	public static elementExtent(markup: string, tagStart: number): ElementExtent | undefined {
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		tagRgx.lastIndex = tagStart;
		const first = tagRgx.exec(markup);
		if (!first || first.index !== tagStart || first[1]) {
			return undefined;
		}
		if (first[3]) {
			return { startTagEnd: tagRgx.lastIndex, endTagStart: tagRgx.lastIndex, end: tagRgx.lastIndex, selfClosing: true };
		}
		let depth = 1;
		let match: RegExpExecArray | null;
		while ((match = tagRgx.exec(markup)) !== null) {
			if (match[1]) {
				depth--;
				if (depth === 0) {
					return { startTagEnd: first.index + first[0].length, endTagStart: match.index, end: tagRgx.lastIndex, selfClosing: false };
				}
			} else if (!match[3]) {
				depth++;
			}
		}
		return undefined;
	}

	// the indentation of the line with the offset
	public static lineIndent(text: string, offset: number) {
		return /^[ \t]*/.exec(text.substring(text.lastIndexOf('\n', offset - 1) + 1, offset))![0];
	}

	// removes the element - with its line, if nothing else is on it
	public static removeElement(text: string, markup: string, tagStart: number): TextEdit | undefined {
		const extent = PackageEdits.elementExtent(markup, tagStart);
		if (!extent) {
			return undefined;
		}
		const lineStart = text.lastIndexOf('\n', tagStart - 1) + 1;
		const lineEnd = text.indexOf('\n', extent.end);
		const ownLine = text.substring(lineStart, tagStart).trim() === '' && text.substring(extent.end, lineEnd === -1 ? text.length : lineEnd).trim() === '';
		if (!ownLine) {
			return { start: tagStart, end: extent.end, text: '' };
		}
		const end = lineEnd === -1 ? text.length : lineEnd + 1;
		// between blank lines, one of them too, so they don't accumulate
		const blankBefore = /\n[ \t]*\r?\n$/.test(text.substring(0, lineStart));
		const blankAfter = /^[ \t]*\r?\n/.exec(text.substring(end));
		return { start: lineStart, end: blankBefore && blankAfter ? end + blankAfter[0].length : end, text: '' };
	}

	// the element's text, indented as it would be on a line with the indent
	public static reindented(text: string, markup: string, tagStart: number, indent: string): string | undefined {
		const extent = PackageEdits.elementExtent(markup, tagStart);
		if (!extent) {
			return undefined;
		}
		const current = PackageEdits.lineIndent(text, tagStart);
		return indent + text.substring(tagStart, extent.end).split('\n').map((line, index) => index > 0 && line.startsWith(current) ? indent + line.substring(current.length) : line).join('\n');
	}

	// replaces the start tag at tagStart with one whose attributes are changed - each name to its value, or removed for
	// undefined - a new attribute is added at the end
	public static withAttributes(text: string, markup: string, tagStart: number, changes: [string, string | undefined][]): TextEdit | undefined {
		const extent = PackageEdits.elementExtent(markup, tagStart);
		if (!extent) {
			return undefined;
		}
		let tag = text.substring(tagStart, extent.startTagEnd);
		for (const [name, value] of changes) {
			const attribute = new RegExp(`(\\s+)${name.replace(/[.]/g, '\\.')}\\s*=\\s*(["'])[\\s\\S]*?\\2`);
			const quoted = value === undefined ? undefined : `${name}="${value.replace(/"/g, '&quot;')}"`;
			if (attribute.test(tag)) {
				tag = tag.replace(attribute, (_match, space) => quoted === undefined ? '' : space + quoted);
			} else if (quoted !== undefined) {
				tag = tag.replace(/\s*(\/?>)$/, (_match, end) => ` ${quoted}${end}`);
			}
		}
		return { start: tagStart, end: extent.startTagEnd, text: tag };
	}

	// removes a name from a list of names - and the space between it and the next name, or the previous one
	public static removeName(text: string, nameStart: number, nameLength: number): TextEdit {
		const after = /^[ \t\r\n]+/.exec(text.substring(nameStart + nameLength))?.[0] ?? '';
		const before = /[ \t\r\n]+$/.exec(text.substring(0, nameStart))?.[0] ?? '';
		const nextIsName = after !== '' && !/^["']/.test(text.substring(nameStart + nameLength + after.length));
		return nextIsName ? { start: nameStart, end: nameStart + nameLength + after.length, text: '' } :
			{ start: nameStart - (/[^ \t\r\n"']$/.test(text.substring(0, nameStart - before.length)) ? before.length : 0), end: nameStart + nameLength, text: '' };
	}
}
