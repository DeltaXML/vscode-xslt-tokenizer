/**
 * XPath 4.0 record types: the 'Extract record type' refactoring - for a selected map constructor with string literal
 * keys, or a selected xsl:map with xsl:map-entry children with string literal keys, whose value is the value of an
 * xsl:variable, xsl:param, xsl:with-param or xsl:function (within any xsl:if or xsl:choose etc.):
 * - a record type is inferred from the keys, with field types from literal values, e.g. xs:string for 'a' - a nested map
 *   constructor or xsl:map has a nested record type, and other values have no field type
 * - an xsl:item-type declaration is added for it, and the declaration's 'as' is set to it - replacing a generic type,
 *   e.g. map(*) or item()*, keeping any occurrence indicator
 * - or instead of a new xsl:item-type, an existing one with the same field names is used
 */
import { BaseToken, ExitCondition, TokenLevelState, XPathLexer } from './xpLexer';
import { RecordTypes } from './recordTypes';

export interface RecordExtractionPlan {
	// the record type inferred from the map, e.g. record(name as xs:string, age as xs:integer)
	recordType: string;
	// the field names, for matching existing record types
	fieldNames: string[];
	// the edit for the declaration's 'as': replacing the value [start, end), or inserting ' as="..."' at start (end is start)
	asEdit: { start: number, end: number, isInsert: boolean, occurrence: string };
	// where the xsl:item-type declaration is inserted: at offset, on a new line after it, or on a new line before it
	itemTypeInsert: { offset: number, indent: string, isAfter: boolean };
}

export class RecordExtraction {
	private static readonly conditionals = RecordTypes.conditionalInstructions;
	private static readonly declarations = ['xsl:variable', 'xsl:param', 'xsl:with-param', 'xsl:function'];

	// the extraction for the selection [start, end), or undefined if it's not a map constructor or xsl:map with a
	// declaration whose 'as' can be set
	public static forSelection(text: string, start: number, end: number): RecordExtractionPlan | undefined {
		const selected = text.substring(start, end);
		const selectionStart = start + selected.length - selected.trimStart().length;
		const selectionEnd = end - (selected.length - selected.trimEnd().length);
		if (selectionEnd <= selectionStart) {
			return undefined;
		}
		const markup = RecordTypes.blankMarkup(text);
		let record: { recordType: string, fieldNames: string[] } | undefined;
		let valueElement: { name: string, offset: number } | undefined;
		let ancestors: { name: string, offset: number }[];
		if (/^<xsl:map[\s/>]/.test(text.substring(selectionStart, selectionStart + 9))) {
			// the selection is one xsl:map element, from its start tag to its end
			if (RecordExtraction.elementEnd(markup, selectionStart) !== selectionEnd) {
				return undefined;
			}
			record = RecordExtraction.xslMapRecord(text, markup, selectionStart);
			ancestors = RecordTypes.openElements(markup, selectionStart);
		} else {
			// the selection is one map constructor that is a whole select attribute value, or the content of an xsl:select
			const tagStart = text.lastIndexOf('<', selectionStart);
			const before = text.substring(tagStart, selectionStart);
			const attribute = /^<([\w.:-]+)\s(?:[^<>]*\s)?select\s*=\s*(["'])\s*$/.exec(before);
			const selectElement = /^<xsl:select(?:\s[^<>]*)?>\s*$/.test(before);
			const after = text.substring(selectionEnd, selectionEnd + 200).trimStart();
			const isWholeValue = attribute ? after.startsWith(attribute[2]) : selectElement && after.startsWith('</xsl:select>');
			if (tagStart < 0 || !isWholeValue) {
				return undefined;
			}
			const tokens = RecordExtraction.xpathTokens(selected.trim());
			if (!tokens || RecordTypes.mapConstructorEnd(tokens, 0) !== tokens.length - 1) {
				return undefined;
			}
			record = RecordExtraction.mapConstructorRecord(tokens, 0, tokens.length - 1);
			const elementName = attribute ? attribute[1] : 'xsl:select';
			valueElement = { name: elementName, offset: tagStart };
			ancestors = RecordTypes.openElements(markup, tagStart);
		}
		if (!record || record.fieldNames.length === 0) {
			return undefined;
		}
		const declaration = RecordExtraction.declarationFor(text, ancestors, valueElement);
		const asEdit = declaration ? RecordExtraction.asEdit(text, declaration) : undefined;
		const itemTypeInsert = RecordExtraction.itemTypeInsertion(text, markup);
		return asEdit && itemTypeInsert ? { recordType: record.recordType, fieldNames: record.fieldNames, asEdit, itemTypeInsert } : undefined;
	}

	// the extraction for the start tag at the offset, of an xsl:variable, xsl:param, xsl:with-param, xsl:function,
	// xsl:sequence or xsl:select whose value is a map constructor or xsl:map - undefined if it's not one, or if the element
	// already has a more specific type
	public static forCursor(text: string, offset: number): RecordExtractionPlan | undefined {
		// the start tag the cursor is within, after its '<'
		const tagStart = offset > 0 ? text.lastIndexOf('<', offset - 1) : -1;
		// a quick check of the element name, before processing the whole document
		const elementName = tagStart > -1 ? /^<([\w.:-]+)/.exec(text.substring(tagStart, tagStart + 30))?.[1] : undefined;
		if (!elementName || !RecordExtraction.cursorElements.includes(elementName)) {
			return undefined;
		}
		const markup = RecordTypes.blankMarkup(text);
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'y');
		tagRgx.lastIndex = tagStart;
		const tag = tagStart > -1 ? tagRgx.exec(markup) : null;
		const name = tag?.[2];
		// the cursor is within the start tag, before its '>'
		if (!tag || tag[1] || !name || offset >= tagStart + tag[0].length || !RecordExtraction.cursorElements.includes(name)) {
			return undefined;
		}
		let record: { recordType: string, fieldNames: string[] } | undefined;
		const select = name === 'xsl:select' ? undefined : RecordTypes.attributeOfElementAt(text, tagStart + 1, 'select');
		if (select !== undefined) {
			record = RecordExtraction.xpathRecord(select);
		} else if (!tag[3]) {
			// the content: an xsl:select's XPath, or a single child element
			const contentStart = tagStart + tag[0].length;
			const contentEnd = RecordExtraction.elementEnd(markup, tagStart);
			if (name === 'xsl:select') {
				record = RecordExtraction.xpathRecord(text.substring(contentStart, text.lastIndexOf('<', contentEnd - 1)));
			} else {
				record = RecordExtraction.singleChildRecord(text, markup, contentStart, contentEnd);
			}
		}
		if (!record || record.fieldNames.length === 0) {
			return undefined;
		}
		const asEdit = RecordExtraction.asEdit(text, { name, offset: tagStart });
		const itemTypeInsert = RecordExtraction.itemTypeInsertion(text, markup);
		return asEdit && itemTypeInsert ? { recordType: record.recordType, fieldNames: record.fieldNames, asEdit, itemTypeInsert } : undefined;
	}

	private static readonly cursorElements = ['xsl:variable', 'xsl:param', 'xsl:with-param', 'xsl:function', 'xsl:sequence', 'xsl:select'];

	// the record type for XPath that is a single map constructor with string literal keys
	private static xpathRecord(xpath: string) {
		const tokens = RecordExtraction.xpathTokens(xpath.trim());
		return tokens && RecordTypes.mapConstructorEnd(tokens, 0) === tokens.length - 1 ? RecordExtraction.mapConstructorRecord(tokens, 0, tokens.length - 1) : undefined;
	}

	// the record type for content that is a single element, with no other content: an xsl:map, an xsl:select, or an
	// xsl:sequence with a select attribute
	private static singleChildRecord(text: string, markup: string, contentStart: number, contentEnd: number) {
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		tagRgx.lastIndex = contentStart;
		const child = tagRgx.exec(markup);
		if (!child || child[1] || child.index >= contentEnd) {
			return undefined;
		}
		const childEnd = RecordExtraction.elementEnd(markup, child.index);
		const endTagStart = text.lastIndexOf('<', contentEnd - 1);
		// only whitespace around the child element
		if (markup.substring(contentStart, child.index).trim() !== '' || markup.substring(childEnd, endTagStart).trim() !== '') {
			return undefined;
		}
		if (child[2] === 'xsl:map') {
			return RecordExtraction.xslMapRecord(text, markup, child.index);
		} else if (child[2] === 'xsl:select' && !child[3]) {
			return RecordExtraction.xpathRecord(text.substring(child.index + child[0].length, text.lastIndexOf('<', childEnd - 1)));
		} else if (child[2] === 'xsl:sequence') {
			const select = RecordTypes.attributeOfElementAt(text, child.index + 1, 'select');
			return select !== undefined ? RecordExtraction.xpathRecord(select) : undefined;
		}
		return undefined;
	}

	// a name for the new xsl:item-type that isn't used
	public static newTypeName(existingNames: string[]) {
		let name = 'record-type';
		for (let i = 2; existingNames.includes(name); i++) {
			name = `record-type-${i}`;
		}
		return name;
	}

	// the XPath tokens for the text, or undefined if there are none
	private static xpathTokens(xpath: string): BaseToken[] | undefined {
		const tokens = new XPathLexer().analyse(xpath, ExitCondition.None, { line: 0, startCharacter: 0, documentOffset: 0 })
			.filter((t) => t.tokenType !== TokenLevelState.comment);
		return tokens.length > 0 ? tokens : undefined;
	}

	// the record type for a map constructor tokens[start..end] with string literal keys
	private static mapConstructorRecord(tokens: BaseToken[], start: number, end: number): { recordType: string, fieldNames: string[] } | undefined {
		const map = RecordTypes.parseMapConstructor(tokens, start, end);
		if (!map) {
			return undefined;
		}
		const fields = map.entries.map((entry) => ({ name: entry.key, type: RecordExtraction.valueType(tokens, entry.valueStart, entry.valueEnd) }));
		return RecordExtraction.recordFromFields(fields);
	}

	// the record type for an xsl:map at mapOffset, from its xsl:map-entry children with string literal keys
	private static xslMapRecord(text: string, markup: string, mapOffset: number): { recordType: string, fieldNames: string[] } | undefined {
		const fields: { name: string, type?: string }[] = [];
		for (const entryOffset of RecordTypes.childElements(text, markup, mapOffset, 'xsl:map-entry')) {
			const key = /^\s*(['"])(.*)\1\s*$/.exec(RecordTypes.attributeOfElementAt(text, entryOffset + 1, 'key') ?? '');
			if (!key) {
				return undefined;
			}
			const select = RecordTypes.attributeOfElementAt(text, entryOffset + 1, 'select');
			let type: string | undefined;
			if (select !== undefined) {
				const tokens = RecordExtraction.xpathTokens(select);
				type = tokens ? RecordExtraction.valueType(tokens, 0, tokens.length - 1) : undefined;
			} else {
				// a nested xsl:map
				const nestedMap = RecordTypes.childElements(text, markup, entryOffset, 'xsl:map')[0];
				type = nestedMap !== undefined ? RecordExtraction.xslMapRecord(text, markup, nestedMap)?.recordType : undefined;
			}
			fields.push({ name: key[2], type });
		}
		return RecordExtraction.recordFromFields(fields);
	}

	private static recordFromFields(fields: { name: string, type?: string }[]) {
		const fieldText = fields.map((field) => {
			const name = /^[A-Za-z_][\w.-]*$/.test(field.name) ? field.name : `'${field.name.replace(/'/g, '\'\'')}'`;
			return field.type ? `${name} as ${field.type}` : name;
		});
		return { recordType: `record(${fieldText.join(', ')})`, fieldNames: fields.map((field) => field.name) };
	}

	// the type of a value from its literal form: a string literal, a numeric literal, true() or false(), or a map constructor
	private static valueType(tokens: BaseToken[], start: number, end: number): string | undefined {
		const first = tokens[start];
		if (start === end && first.tokenType === TokenLevelState.string) {
			return 'xs:string';
		} else if (start === end && first.tokenType === TokenLevelState.number) {
			return /[eE]/.test(first.value) ? 'xs:double' : first.value.includes('.') ? 'xs:decimal' : 'xs:integer';
		} else if (end === start + 1 && first.tokenType === TokenLevelState.function && (first.value === 'true' || first.value === 'false') && tokens[end].value === '()') {
			return 'xs:boolean';
		} else if (RecordTypes.mapConstructorEnd(tokens, start) === end) {
			return RecordExtraction.mapConstructorRecord(tokens, start, end)?.recordType;
		}
		return undefined;
	}

	// the declaration whose value is the value of the map: the element with the select attribute or xsl:select, or the
	// xsl:map itself, within any xsl:if etc. or xsl:sequence - undefined if it's not the value of a declaration
	private static declarationFor(text: string, ancestors: { name: string, offset: number }[], valueElement?: { name: string, offset: number }) {
		if (valueElement && RecordExtraction.declarations.includes(valueElement.name)) {
			return valueElement;
		} else if (valueElement && !['xsl:sequence', 'xsl:select'].includes(valueElement.name)) {
			return undefined;
		}
		for (let i = ancestors.length - 1; i > -1; i--) {
			const { name } = ancestors[i];
			if (RecordExtraction.declarations.includes(name)) {
				return ancestors[i];
			} else if (!RecordExtraction.conditionals.includes(name) && name !== 'xsl:sequence') {
				return undefined;
			}
		}
		return undefined;
	}

	// the edit for the declaration's 'as': a generic type is replaced, keeping any occurrence indicator, or an 'as' is
	// inserted after the name attribute - undefined if it already has a more specific type
	private static asEdit(text: string, declaration: { name: string, offset: number }) {
		const asValue = RecordTypes.attributeOfElementAt(text, declaration.offset + 1, 'as');
		if (asValue !== undefined) {
			// map(*), map(xs:string, ...) or item(), with any occurrence indicator
			const generic = /^\s*(?:map\s*\(\s*(?:\*|xs:string\s*,[\s\S]*)\)|item\s*\(\s*\))\s*([?*+]?)\s*$/.exec(asValue);
			const valueStart = RecordTypes.attributeValueOffset(text, declaration.offset + 1, 'as');
			if (!generic || valueStart === undefined) {
				return undefined;
			}
			return { start: valueStart, end: valueStart + text.substring(valueStart).search(/["']/), isInsert: false, occurrence: generic[1] };
		}
		// after the name attribute, or the element name, e.g. for xsl:sequence
		const nameStart = RecordTypes.attributeValueOffset(text, declaration.offset + 1, 'name');
		const insertAt = nameStart !== undefined ? nameStart + text.substring(nameStart).search(/["']/) + 1 : declaration.offset + 1 + declaration.name.length;
		return { start: insertAt, end: insertAt, isInsert: true, occurrence: '' };
	}

	// after the last top-level xsl:item-type, xsl:import, xsl:include or xsl:use-package - or before the first top-level
	// element, or after the root element's start tag if it has none
	private static itemTypeInsertion(text: string, markup: string) {
		const root = new RegExp(RecordTypes.tagPattern, 'g').exec(markup);
		if (!root || root[1] || root[3]) {
			return undefined;
		}
		const rootOffset = root.index;
		const before = ['xsl:item-type', 'xsl:import', 'xsl:include', 'xsl:use-package']
			.flatMap((name) => RecordTypes.childElements(text, markup, rootOffset, name));
		const indentAt = (offset: number) => /[ \t]*$/.exec(text.substring(text.lastIndexOf('\n', offset) + 1, offset))![0];
		if (before.length > 0) {
			const last = Math.max(...before);
			return { offset: RecordExtraction.elementEnd(markup, last), indent: indentAt(last), isAfter: true };
		}
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		tagRgx.lastIndex = rootOffset + root[0].length;
		const firstChild = tagRgx.exec(markup);
		if (firstChild && !firstChild[1]) {
			return { offset: text.lastIndexOf('\n', firstChild.index) + 1, indent: indentAt(firstChild.index), isAfter: false };
		}
		return { offset: rootOffset + root[0].length, indent: '\t', isAfter: true };
	}

	// the offset after the end of the element whose start tag is at offset
	public static elementEnd(markup: string, offset: number): number {
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		tagRgx.lastIndex = offset;
		let depth = 0;
		let match: RegExpExecArray | null;
		while ((match = tagRgx.exec(markup)) !== null) {
			if (match[1]) {
				depth--;
			} else if (!match[3]) {
				depth++;
			}
			if (depth === 0) {
				return tagRgx.lastIndex;
			}
		}
		return -1;
	}

}
