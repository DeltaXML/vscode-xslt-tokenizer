/**
 * XPath 4.0 record types, e.g. record(r as xs:double, i as xs:double) or a named item type declared as one with
 * xsl:item-type - used to check that a map constructor has the record's fields, and that a lookup such as $c?r
 * names one of them. The checks are lexical: they only apply to map constructors whose keys are all string literals,
 * and only check literal values, following the rules as implemented by Saxon 13:
 * - a field is optional only if it's declared with '?', e.g. record(a? as xs:string)
 * - a map may have entries that are not fields of the record
 */
import { BaseToken, CharLevelState, ErrorType, TokenLevelState } from './xpLexer';

export interface RecordField {
	name: string;
	optional: boolean;
	// the declared SequenceType, e.g. 'xs:double' - undefined if there's no 'as'
	type?: string;
}

export interface RecordType {
	// the named item type, or the record(...) type itself, for messages
	name: string;
	fields: RecordField[];
}

interface MapEntry {
	keyToken: BaseToken;
	key: string;
	valueStart: number;
	valueEnd: number;
}

export class RecordTypes {
	// separates the parts of an error token's value, e.g. the field name and the record type name
	public static readonly valueSeparator = '\u0001';

	private static readonly integerTypes = ['integer', 'int', 'long', 'short', 'byte', 'nonNegativeInteger', 'positiveInteger', 'negativeInteger',
		'nonPositiveInteger', 'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte'].map((t) => 'xs:' + t);
	private static readonly numericTypes = ['xs:double', 'xs:float', 'xs:decimal', 'xs:numeric'].concat(RecordTypes.integerTypes);
	private static readonly stringTypes = ['string', 'normalizedString', 'token', 'language', 'NMTOKEN', 'Name', 'NCName', 'ID', 'IDREF', 'ENTITY'].map((t) => 'xs:' + t);

	// the record type for a SequenceType, e.g. 'record(a as xs:string)*' or 'cx:complex', using the xsl:item-type
	// declarations to resolve named item types - undefined if it's not a record type
	public static resolve(typeText: string, itemTypes: Map<string, string>, depth = 0): RecordType | undefined {
		let text = typeText.trim();
		if (depth > 10 || text.length === 0) {
			return undefined;
		}
		if ('?*+'.includes(text.charAt(text.length - 1))) {
			text = text.substring(0, text.length - 1).trim();
		}
		if (text.startsWith('(') && RecordTypes.closingIndex(text, 0) === text.length - 1 && RecordTypes.splitTopLevel(text.substring(1, text.length - 1), '|').length === 1) {
			// a parenthesized item type
			return RecordTypes.resolve(text.substring(1, text.length - 1), itemTypes, depth + 1);
		}
		const recordMatch = /^record\s*\(/.exec(text);
		if (recordMatch) {
			const openIndex = recordMatch[0].length - 1;
			if (RecordTypes.closingIndex(text, openIndex) !== text.length - 1) {
				return undefined;
			}
			const fields = RecordTypes.parseFields(text.substring(openIndex + 1, text.length - 1));
			return fields ? { name: text.replace(/\s+/g, ' '), fields } : undefined;
		}
		if (/^[\w.-]+(:[\w.-]+)?$/.test(text)) {
			const declared = itemTypes.get(text);
			const resolved = declared ? RecordTypes.resolve(declared, itemTypes, depth + 1) : undefined;
			return resolved ? { name: text, fields: resolved.fields } : undefined;
		}
		return undefined;
	}

	// the record type of a field's value, e.g. for record(a as record(b as xs:integer))
	public static fieldRecord(field: RecordField, itemTypes: Map<string, string>) {
		return field.type ? RecordTypes.resolve(field.type, itemTypes) : undefined;
	}

	// checks the tokens of an expression that is a single map constructor against the record type
	public static checkMapConstructor(tokens: BaseToken[], record: RecordType, itemTypes: Map<string, string>, problemTokens: BaseToken[]) {
		const realTokens = tokens.filter((t) => t.tokenType !== TokenLevelState.comment);
		RecordTypes.checkMapTokens(realTokens, 0, realTokens.length - 1, record, itemTypes, problemTokens);
	}

	// the value of an attribute on the element whose start tag contains the offset, e.g. the 'as' of an xsl:variable
	// from the position of its 'name' attribute value - attribute values may contain '>'
	public static attributeOfElementAt(text: string, offset: number, attributeName: string): string | undefined {
		const tagStart = text.lastIndexOf('<', offset);
		if (tagStart < 0) {
			return undefined;
		}
		const nameRgx = /<[\w.:-]+/y;
		nameRgx.lastIndex = tagStart;
		if (!nameRgx.exec(text)) {
			return undefined;
		}
		const attributeRgx = /\s+([\w.:-]+)\s*=\s*("[^"]*"|'[^']*')/y;
		attributeRgx.lastIndex = nameRgx.lastIndex;
		let match: RegExpExecArray | null;
		while ((match = attributeRgx.exec(text)) !== null) {
			if (match[1] === attributeName) {
				const value = match[2].substring(1, match[2].length - 1);
				return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&');
			}
		}
		return undefined;
	}

	public static problemToken(token: BaseToken, error: ErrorType, ...parts: string[]): BaseToken {
		return { ...token, error, value: parts.join(RecordTypes.valueSeparator) };
	}

	private static checkMapTokens(tokens: BaseToken[], start: number, end: number, record: RecordType, itemTypes: Map<string, string>, problemTokens: BaseToken[]) {
		const map = RecordTypes.parseMapConstructor(tokens, start, end);
		if (!map) {
			return;
		}
		const keys = map.entries.map((e) => e.key);
		record.fields.forEach((field) => {
			if (!field.optional && !keys.includes(field.name)) {
				problemTokens.push(RecordTypes.problemToken(map.startToken, ErrorType.RecordFieldMissing, field.name, record.name));
			}
		});
		map.entries.forEach((entry) => {
			const field = record.fields.find((f) => f.name === entry.key);
			if (!field) {
				problemTokens.push(RecordTypes.problemToken(entry.keyToken, ErrorType.RecordFieldUnknown, entry.key, record.name));
				return;
			}
			const nestedRecord = RecordTypes.fieldRecord(field, itemTypes);
			if (nestedRecord) {
				RecordTypes.checkMapTokens(tokens, entry.valueStart, entry.valueEnd, nestedRecord, itemTypes, problemTokens);
			} else if (entry.valueStart === entry.valueEnd && field.type && !RecordTypes.isLiteralAllowed(tokens[entry.valueStart], field.type)) {
				problemTokens.push(RecordTypes.problemToken(tokens[entry.valueStart], ErrorType.RecordFieldValueType, field.name, field.type.trim()));
			}
		});
	}

	// false if the literal value can't match the field's atomic type, e.g. a string literal for xs:double
	private static isLiteralAllowed(valueToken: BaseToken, fieldType: string) {
		let type = fieldType.trim();
		const occurrence = type.charAt(type.length - 1);
		const allowsEmpty = occurrence === '?' || occurrence === '*';
		if ('?*+'.includes(occurrence)) {
			type = type.substring(0, type.length - 1).trim();
		}
		const isString = valueToken.tokenType === TokenLevelState.string || valueToken.tokenType === TokenLevelState.mapKey;
		const isNumber = valueToken.tokenType === TokenLevelState.number;
		if (valueToken.charType === CharLevelState.dSep && valueToken.value === '()') {
			return allowsEmpty;
		} else if (RecordTypes.numericTypes.includes(type)) {
			if (isString) {
				return false;
			}
			// numeric literals: integer (1), decimal (1.5) or double (1e0) - an integer or decimal is promoted to float or double
			const isDouble = isNumber && /[eE]/.test(valueToken.value);
			const isDecimal = isNumber && !isDouble && valueToken.value.includes('.');
			if (RecordTypes.integerTypes.includes(type)) {
				return !isDouble && !isDecimal;
			}
			return !(isDouble && (type === 'xs:decimal' || type === 'xs:float'));
		} else if (RecordTypes.stringTypes.includes(type)) {
			return !isNumber;
		} else if (type === 'xs:boolean') {
			return !isString && !isNumber;
		}
		return true;
	}

	// the entries of a map constructor with string literal keys spanning tokens[start..end], e.g. map { 'a': 1 } or { 'a': 1 } -
	// undefined if it's not one, or any key is not a string literal
	private static parseMapConstructor(tokens: BaseToken[], start: number, end: number): { startToken: BaseToken, entries: MapEntry[] } | undefined {
		if (start > end) {
			return undefined;
		}
		const startToken = tokens[start];
		let i = start;
		if (tokens[i].tokenType === TokenLevelState.operator && tokens[i].value === 'map') {
			i++;
		}
		if (i === end && tokens[i]?.charType === CharLevelState.dSep && tokens[i].value === '{}') {
			return { startToken, entries: [] };
		}
		if (tokens[i]?.charType !== CharLevelState.lBr || RecordTypes.closingTokenIndex(tokens, i) !== end) {
			return undefined;
		}
		const entries: MapEntry[] = [];
		let entryStart = i + 1;
		let colonIndex = -1;
		let depth = 0;
		for (let j = i + 1; j <= end; j++) {
			const t = tokens[j];
			const isEntryEnd = depth === 0 && (j === end || (t.charType === CharLevelState.sep && t.value === ','));
			if (isEntryEnd) {
				if (j === end && entryStart === j && entries.length === 0) {
					break; // empty map
				}
				if (colonIndex !== entryStart + 1) {
					return undefined; // no ':' (map merge), or a key that isn't a single token
				}
				const keyToken = tokens[entryStart];
				const isStringKey = keyToken.tokenType === TokenLevelState.mapKey || keyToken.tokenType === TokenLevelState.string;
				if (!isStringKey || !/^(['"]).*\1$/.test(keyToken.value) || colonIndex + 1 > j - 1) {
					return undefined;
				}
				entries.push({ keyToken, key: keyToken.value.substring(1, keyToken.value.length - 1), valueStart: colonIndex + 1, valueEnd: j - 1 });
				entryStart = j + 1;
				colonIndex = -1;
			} else if (RecordTypes.isOpenBracket(t)) {
				depth++;
			} else if (RecordTypes.isCloseBracket(t)) {
				depth--;
			} else if (depth === 0 && colonIndex === -1 && t.charType === CharLevelState.sep && t.value === ':') {
				colonIndex = j;
			}
		}
		return { startToken, entries };
	}

	private static isOpenBracket(t: BaseToken) {
		return t.charType === CharLevelState.lB || t.charType === CharLevelState.lBr || t.charType === CharLevelState.lPr;
	}

	private static isCloseBracket(t: BaseToken) {
		return t.charType === CharLevelState.rB || t.charType === CharLevelState.rBr || t.charType === CharLevelState.rPr;
	}

	private static closingTokenIndex(tokens: BaseToken[], openIndex: number) {
		let depth = 0;
		for (let i = openIndex; i < tokens.length; i++) {
			if (RecordTypes.isOpenBracket(tokens[i])) {
				depth++;
			} else if (RecordTypes.isCloseBracket(tokens[i]) && --depth === 0) {
				return i;
			}
		}
		return -1;
	}

	// fields of record(...), e.g. "r as xs:double, 'first name', b? as xs:integer" - undefined for record(*)
	private static parseFields(fieldsText: string): RecordField[] | undefined {
		const fields: RecordField[] = [];
		if (fieldsText.trim().length === 0) {
			return fields;
		}
		for (const fieldText of RecordTypes.splitTopLevel(fieldsText, ',')) {
			const match = /^\s*(?:'([^']*)'|"([^"]*)"|([\w.-]+))\s*(\?)?\s*(?:as\s+([\s\S]+))?$/.exec(fieldText);
			if (!match) {
				return undefined;
			}
			fields.push({ name: match[1] ?? match[2] ?? match[3], optional: !!match[4], type: match[5]?.trim() });
		}
		return fields;
	}

	private static splitTopLevel(text: string, separator: string) {
		const parts: string[] = [];
		let depth = 0;
		let quote = '';
		let partStart = 0;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (quote) {
				if (ch === quote) quote = '';
			} else if (ch === '\'' || ch === '"') {
				quote = ch;
			} else if (ch === '(' || ch === '[' || ch === '{') {
				depth++;
			} else if (ch === ')' || ch === ']' || ch === '}') {
				depth--;
			} else if (depth === 0 && ch === separator) {
				parts.push(text.substring(partStart, i));
				partStart = i + 1;
			}
		}
		parts.push(text.substring(partStart));
		return parts;
	}

	private static closingIndex(text: string, openIndex: number) {
		let depth = 0;
		let quote = '';
		for (let i = openIndex; i < text.length; i++) {
			const ch = text.charAt(i);
			if (quote) {
				if (ch === quote) quote = '';
			} else if (ch === '\'' || ch === '"') {
				quote = ch;
			} else if (ch === '(') {
				depth++;
			} else if (ch === ')' && --depth === 0) {
				return i;
			}
		}
		return -1;
	}
}
