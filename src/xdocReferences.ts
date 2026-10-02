/**
 * References in XSLT 4.0 documentation notes - an xsl:note with format="xdoc-md" - to declarations outside the note,
 * written with XPath syntax: as the first word of an @see tag's text, or as the whole of a Markdown code span, e.g.
 *
 *   @see my:area#2
 *   Uses `$scale` and `template my:draw`.
 *
 * The forms are:
 *
 *   my:area#2          the function with that arity - as in a named function reference
 *   my:area()          a function of any arity
 *   my:area            a function of any arity - or else a named item type, or else a named template
 *   $scale             a parameter of the function or template the note documents - or else a global xsl:param or
 *                      xsl:variable
 *   template my:draw   a named template
 *
 * In a code span, a name without a prefix is a reference only as $name, name#N, name() or 'template name', as code
 * spans are used for other text too, e.g. `cm`. Names are matched as they're written, without resolving their
 * prefixes to namespace URIs.
 */
import { GlobalInstructionData, GlobalInstructionType, XslLexer } from './xslLexer';
import { RecordTypes } from './recordTypes';
import { XdocNotes } from './xdocNote';

export type XdocReferenceKind = 'function' | 'template' | 'variable' | 'name';

export interface XdocReference {
	kind: XdocReferenceKind;
	// the name as written, without any '$'
	name: string;
	// for name#N, the arity
	arity?: number;
	// the document offset of the name, and the offsets of the whole reference, e.g. with 'template ' or '#2'
	offset: number;
	start: number;
	end: number;
	// the first word of an @see tag's text - not a code span
	isSee: boolean;
	// the start tag offset of the xsl:function or xsl:template the note documents, for its parameters
	declarationOffset?: number;
}

// what a reference refers to: a global declaration, or a parameter of the function or template the note documents -
// the offset of its xsl:param start tag
export type XdocTarget = { global: GlobalInstructionData, paramOffset?: undefined } | { global?: undefined, paramOffset: number };

export class XdocReferences {
	private static readonly ncName = '[\\p{L}_][\\p{L}\\p{N}_.\\-]*';
	private static readonly referenceRgx = new RegExp(`^(?:(template)[ \\t]+|(\\$))?((?:${XdocReferences.ncName}:)?${XdocReferences.ncName})(?:#(\\d+)|(\\(\\)))?$`, 'u');

	// the references in the notes of the document
	public static find(text: string, markup = RecordTypes.blankMarkup(text)): XdocReference[] {
		const noteOffsets = XdocNotes.noteOffsets(text);
		if (noteOffsets.length === 0) {
			return [];
		}
		const openElements = RecordTypes.openElementsAt(markup, noteOffsets);
		const references: XdocReference[] = [];
		noteOffsets.forEach((noteOffset, index) => {
			const note = XdocNotes.parseNote(text, markup, noteOffset);
			if (!note) {
				return;
			}
			const parent = openElements[index][openElements[index].length - 1];
			const declarationOffset = parent && (parent.name === 'xsl:function' || parent.name === 'xsl:template') ? parent.offset : undefined;
			const { text: content, offsets } = XdocNotes.decode(text.substring(note.contentStart, note.contentEnd));
			const documentOffset = (index: number) => note.contentStart + offsets[index];
			const add = (word: string, index: number, isSee: boolean) => {
				const parsed = XdocReferences.parse(word, !isSee);
				if (parsed) {
					references.push({ ...parsed, offset: documentOffset(index + parsed.nameIndex), start: documentOffset(index), end: documentOffset(index + word.length - 1) + 1, isSee, declarationOffset });
				}
			};
			let lineStart = 0;
			for (const line of content.split('\n')) {
				// a trailing full stop or comma is punctuation, not part of the name
				const see = /^([ \t]*@see[ \t]+)(template[ \t]+[^\s`]+|[^\s`]+)/.exec(line);
				if (see) {
					add(see[2].replace(/[.,;:)]+$/, ''), lineStart + see[1].length, true);
				}
				for (const span of line.matchAll(/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)) {
					const leading = span[2].length - span[2].trimStart().length;
					add(span[2].trim(), lineStart + span.index! + span[1].length + leading, false);
				}
				lineStart += line.length + 1;
			}
		});
		return references;
	}

	// the reference at the document offset, if any
	public static at(text: string, offset: number): XdocReference | undefined {
		return XdocReferences.find(text).find((reference) => offset >= reference.start && offset <= reference.end);
	}

	// the reference written as the word, with the index of the name within it
	private static parse(word: string, inCodeSpan: boolean): { kind: XdocReferenceKind, name: string, arity?: number, nameIndex: number } | undefined {
		const match = XdocReferences.referenceRgx.exec(word);
		if (!match) {
			return undefined;
		}
		const [, template, dollar, name, arity, parens] = match;
		const isFunction = arity !== undefined || parens !== undefined;
		if ((template || dollar) && isFunction) {
			return undefined;
		} else if (inCodeSpan && !template && !dollar && !isFunction && !name.includes(':')) {
			return undefined;
		}
		const suffixLength = arity !== undefined ? arity.length + 1 : parens ? 2 : 0;
		return {
			kind: template ? 'template' : dollar ? 'variable' : isFunction ? 'function' : 'name',
			name,
			arity: arity !== undefined ? Number(arity) : undefined,
			nameIndex: word.length - name.length - suffixLength
		};
	}

	// what the reference refers to, using the global declarations of the document and the modules it includes or
	// imports - the most likely first
	public static resolve(reference: XdocReference, globals: GlobalInstructionData[], text: string, markup = RecordTypes.blankMarkup(text)): XdocTarget[] {
		const named = (...types: GlobalInstructionType[]) => globals.filter((g) => types.includes(g.type) && g.name === reference.name);
		const functions = () => named(GlobalInstructionType.Function).filter((g) => reference.arity === undefined || XslLexer.functionArityMatches(g, reference.arity));
		let targets: GlobalInstructionData[];
		switch (reference.kind) {
			case 'variable': {
				const paramOffset = reference.declarationOffset === undefined ? undefined : RecordTypes.childElements(text, markup, reference.declarationOffset, 'xsl:param')
					.find((offset) => RecordTypes.attributeOfElementAt(text, offset + 1, 'name') === reference.name);
				if (paramOffset !== undefined) {
					return [{ paramOffset }];
				}
				targets = named(GlobalInstructionType.Variable, GlobalInstructionType.Parameter);
				break;
			}
			case 'function':
				targets = functions();
				break;
			case 'template':
				targets = named(GlobalInstructionType.Template);
				break;
			default: {
				const fns = functions();
				const itemTypes = named(GlobalInstructionType.ItemType);
				targets = fns.length > 0 ? fns : itemTypes.length > 0 ? itemTypes : named(GlobalInstructionType.Template);
			}
		}
		return targets.map((global) => ({ global }));
	}

	// for a reference that doesn't refer to anything, whether it's reported: only in @see, where other text, e.g. a URL,
	// isn't taken as a name - and not for a built-in function or type, e.g. fn:sum#1 or xs:string, whose namespace is a
	// W3C one, or an unprefixed function, which isn't user-defined
	public static isReported(reference: XdocReference, text: string) {
		if (!reference.isSee) {
			return false;
		}
		const colon = reference.name.indexOf(':');
		if (colon === -1) {
			return reference.kind === 'variable' || reference.kind === 'template';
		}
		const prefix = reference.name.substring(0, colon).replace(/[.\-]/g, '\\$&');
		const namespace = new RegExp(`xmlns:${prefix}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(text);
		const uri = namespace ? namespace[1] ?? namespace[2] : undefined;
		return uri !== undefined && !uri.startsWith('http://www.w3.org/');
	}

	// the kinds of declaration a reference may refer to, e.g. for a message
	public static kindLabel(reference: XdocReference) {
		switch (reference.kind) {
			case 'function':
				return reference.arity === undefined ? 'function' : `function with ${reference.arity} argument${reference.arity === 1 ? '' : 's'}`;
			case 'template':
				return 'named template';
			case 'variable':
				return 'parameter or global variable';
			default:
				return 'function, item type or named template';
		}
	}
}
