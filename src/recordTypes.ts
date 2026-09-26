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

	// the type that a named item type is declared as, following named item types, e.g. 'xs:boolean' for 'flag'
	public static resolveNamedType(typeText: string, itemTypes: Map<string, string>, depth = 0): string | undefined {
		const declared = itemTypes.get(typeText.trim());
		if (!declared || depth > 10) {
			return undefined;
		}
		return RecordTypes.resolveNamedType(declared, itemTypes, depth + 1) ?? declared.trim();
	}

	// the values of an enumeration type, e.g. ['red', 'green'] for enum('red', 'green'), a named item type declared as one,
	// or a choice of them - undefined if it's not an enumeration type
	public static resolveEnum(typeText: string, itemTypes: Map<string, string>, depth = 0): string[] | undefined {
		let text = typeText.trim();
		if (depth > 10 || text.length === 0) {
			return undefined;
		}
		if ('?*+'.includes(text.charAt(text.length - 1))) {
			text = text.substring(0, text.length - 1).trim();
		}
		if (text.startsWith('(') && RecordTypes.closingIndex(text, 0) === text.length - 1) {
			// a parenthesized item type, or a choice item type, e.g. (enum('a') | enum('b'))
			const choices = RecordTypes.splitTopLevel(text.substring(1, text.length - 1), '|').map((choice) => RecordTypes.resolveEnum(choice, itemTypes, depth + 1));
			return choices.every((values) => values !== undefined) ? choices.flat() as string[] : undefined;
		}
		const enumMatch = /^enum\s*\(/.exec(text);
		if (enumMatch) {
			const openIndex = enumMatch[0].length - 1;
			if (RecordTypes.closingIndex(text, openIndex) !== text.length - 1) {
				return undefined;
			}
			const values: string[] = [];
			for (const valueText of RecordTypes.splitTopLevel(text.substring(openIndex + 1, text.length - 1), ',')) {
				const match = /^\s*(['"])([\s\S]*)\1\s*$/.exec(valueText);
				if (!match) {
					return undefined;
				}
				values.push(match[2].split(match[1] + match[1]).join(match[1]));
			}
			return values;
		}
		if (/^[\w.-]+(:[\w.-]+)?$/.test(text)) {
			const declared = itemTypes.get(text);
			return declared ? RecordTypes.resolveEnum(declared, itemTypes, depth + 1) : undefined;
		}
		return undefined;
	}

	// a problem token if the tokens of an expression are a single string literal that isn't one of the values of an
	// enumeration type, e.g. 'blue' for enum('red', 'green')
	public static checkEnumValue(tokens: BaseToken[], enumValues: string[], typeText: string, problemTokens: BaseToken[]) {
		const realTokens = tokens.filter((t) => t.tokenType !== TokenLevelState.comment);
		const token = realTokens.length === 1 ? realTokens[0] : undefined;
		if (token && token.tokenType === TokenLevelState.string && /^(['"]).*\1$/.test(token.value)) {
			const quote = token.value.charAt(0);
			const value = token.value.substring(1, token.value.length - 1).split(quote + quote).join(quote);
			if (!enumValues.includes(value)) {
				problemTokens.push(RecordTypes.problemToken(token, ErrorType.EnumValueUnknown, value, typeText.trim()));
			}
		}
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

	// for completions: when tokens[cursor - 1] is the '{' or ',' before a new entry of a map constructor, e.g. { 'a': 1, |,
	// the keys of the entries that contain it, from the outermost map constructor, e.g. ['address'] for { 'address': { |
	// and the keys the map constructor already has, before or after the cursor - undefined if the outermost map
	// constructor isn't the whole expression, or a containing map constructor isn't the value of a string literal key
	// - or when tokens[cursor - 1] is the ':' after a string literal key, the valueKey, e.g. 'c' for { 'c': |
	public static mapEntryPosition(tokens: BaseToken[], cursor: number): { keyPath: string[], usedKeys: string[], valueKey?: string } | undefined {
		interface Frame { isMap: boolean, parentKey?: string, key?: string, keys: string[] }
		const realTokens = tokens.filter((t, i) => t.tokenType !== TokenLevelState.comment || i >= cursor);
		const cursorIndex = cursor - (tokens.length - realTokens.length);
		const previous = realTokens[cursorIndex - 1];
		const isValuePosition = previous?.charType === CharLevelState.sep && previous.value === ':';
		if (!previous || !(isValuePosition || previous.charType === CharLevelState.lBr || (previous.charType === CharLevelState.sep && previous.value === ','))) {
			return undefined;
		}
		const stack: Frame[] = [];
		let cursorFrames: Frame[] | undefined;
		for (let i = 0; i < realTokens.length; i++) {
			if (i === cursorIndex) {
				cursorFrames = stack.slice();
			}
			const t = realTokens[i];
			const top = stack[stack.length - 1];
			const prev = realTokens[i - 1];
			if (t.charType === CharLevelState.lBr) {
				// a map constructor starts the expression, e.g. { or map {, or is the value of an entry with a string literal key
				const start = prev?.tokenType === TokenLevelState.operator && prev.value === 'map' ? i - 1 : i;
				const before = realTokens[start - 1];
				const isOuterMap = stack.length === 0 && start === 0;
				const isEntryValue = !!top?.isMap && top.key !== undefined && before?.charType === CharLevelState.sep && before.value === ':';
				stack.push({ isMap: isOuterMap || isEntryValue, parentKey: isEntryValue ? top.key : undefined, keys: [] });
			} else if (RecordTypes.isOpenBracket(t)) {
				stack.push({ isMap: false, keys: [] });
			} else if (RecordTypes.isCloseBracket(t)) {
				stack.pop();
			} else if (top?.isMap && t.charType === CharLevelState.sep && t.value === ':') {
				const isStringKey = prev && (prev.tokenType === TokenLevelState.mapKey || prev.tokenType === TokenLevelState.string) && /^(['"]).*\1$/.test(prev.value);
				top.key = isStringKey ? prev.value.substring(1, prev.value.length - 1) : undefined;
				if (top.key !== undefined) {
					top.keys.push(top.key);
				}
			} else if (top?.isMap && t.charType === CharLevelState.sep && t.value === ',') {
				top.key = undefined;
			}
		}
		if (cursorIndex >= realTokens.length) {
			cursorFrames = stack.slice();
		}
		if (!cursorFrames || cursorFrames.length === 0 || !cursorFrames.every((frame) => frame.isMap)) {
			return undefined;
		}
		const keyPath = cursorFrames.slice(1).map((frame) => frame.parentKey!);
		if (isValuePosition) {
			// the string literal key before the ':'
			const keyToken = realTokens[cursorIndex - 2];
			const isStringKey = keyToken && (keyToken.tokenType === TokenLevelState.mapKey || keyToken.tokenType === TokenLevelState.string) && /^(['"]).*\1$/.test(keyToken.value);
			return isStringKey ? { keyPath, usedKeys: [], valueKey: keyToken.value.substring(1, keyToken.value.length - 1) } : undefined;
		}
		return { keyPath, usedKeys: cursorFrames[cursorFrames.length - 1].keys };
	}

	// the text with comments, CDATA sections and processing instructions blanked out, keeping offsets
	public static blankMarkup(text: string) {
		return text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, (m) => ' '.repeat(m.length));
	}

	// the elements whose start tags are before the offset and are not yet closed there, outermost first
	public static openElements(markup: string, end: number): { name: string, offset: number }[] {
		const ancestors: { name: string, offset: number }[] = [];
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		let match: RegExpExecArray | null;
		while ((match = tagRgx.exec(markup)) !== null && match.index < end) {
			if (match[1]) {
				ancestors.pop();
			} else if (!match[3]) {
				ancestors.push({ name: match[2], offset: match.index });
			}
		}
		return ancestors;
	}

	// the string literal keys of the xsl:map-entry children of the xsl:map whose start tag is at mapOffset, e.g. 'a'
	// for key="'a'", with the offsets of their start tags
	public static mapEntryKeys(text: string, markup: string, mapOffset: number): { key: string, offset: number }[] {
		const keys: { key: string, offset: number }[] = [];
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		tagRgx.lastIndex = mapOffset;
		let depth = 0;
		let match: RegExpExecArray | null;
		while ((match = tagRgx.exec(markup)) !== null) {
			if (match[1]) {
				if (--depth === 0) {
					break;
				}
			} else {
				if (depth === 1 && match[2] === 'xsl:map-entry') {
					const key = /^\s*(['"])(.*)\1\s*$/.exec(RecordTypes.attributeOfElementAt(text, match.index + 1, 'key') ?? '');
					if (key) {
						keys.push({ key: key[2], offset: match.index });
					}
				}
				if (!match[3]) {
					depth++;
				} else if (depth === 0) {
					break; // <xsl:map/>
				}
			}
		}
		return keys;
	}

	// the record type of the result of the xsl:map at ancestors[index]: from the 'as' of the xsl:variable, xsl:param,
	// xsl:with-param or xsl:function containing it (within any xsl:if or xsl:choose etc.), or for an xsl:map within
	// an xsl:map-entry of another xsl:map with a record type, the record type of that field
	public static xslMapRecord(text: string, ancestors: { name: string, offset: number }[], index: number, itemTypes: Map<string, string>, depth = 0): RecordType | undefined {
		if (depth > 10) {
			return undefined;
		}
		for (let i = index - 1; i > -1; i--) {
			const { name, offset } = ancestors[i];
			if (name === 'xsl:variable' || name === 'xsl:param' || name === 'xsl:with-param' || name === 'xsl:function') {
				const declaredType = RecordTypes.attributeOfElementAt(text, offset + 1, 'as');
				return declaredType ? RecordTypes.resolve(declaredType, itemTypes) : undefined;
			} else if (name === 'xsl:map-entry') {
				const key = /^\s*(['"])(.*)\1\s*$/.exec(RecordTypes.attributeOfElementAt(text, offset + 1, 'key') ?? '');
				const parentMap = i - 1;
				if (!key || parentMap < 0 || ancestors[parentMap].name !== 'xsl:map') {
					return undefined;
				}
				const field = RecordTypes.xslMapRecord(text, ancestors, parentMap, itemTypes, depth + 1)?.fields.find((f) => f.name === key[2]);
				return field ? RecordTypes.fieldRecord(field, itemTypes) : undefined;
			} else if (!RecordTypes.conditionalInstructions.includes(name)) {
				return undefined;
			}
		}
		return undefined;
	}

	public static readonly conditionalInstructions = ['xsl:if', 'xsl:choose', 'xsl:when', 'xsl:otherwise', 'xsl:try', 'xsl:catch'];
	// a start tag, end tag or empty element tag: [1] is '/' for an end tag, [2] the name, [3] '/' for an empty element
	private static readonly tagPattern = /<(\/?)([\w.:-]+)(?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*(\/?)>/.source;

	public static problemToken(token: BaseToken, error: ErrorType, ...parts: string[]): BaseToken {
		return { ...token, error, value: parts.join(RecordTypes.valueSeparator) };
	}

	private static checkMapTokens(tokens: BaseToken[], start: number, end: number, record: RecordType, itemTypes: Map<string, string>, problemTokens: BaseToken[]) {
		const map = RecordTypes.parseMapConstructor(tokens, start, end);
		if (!map) {
			return;
		}
		const keys = map.entries.map((e) => e.key);
		const missingFields = record.fields.filter((field) => !field.optional && !keys.includes(field.name));
		if (missingFields.length > 0) {
			const recordFix = RecordTypes.missingFieldsFix(tokens, end, map.entries.length > 0, missingFields, itemTypes);
			missingFields.forEach((field) => {
				problemTokens.push({ ...RecordTypes.problemToken(map.startToken, ErrorType.RecordFieldMissing, field.name, record.name), recordFix });
			});
		}
		map.entries.forEach((entry) => {
			const field = record.fields.find((f) => f.name === entry.key);
			if (!field) {
				problemTokens.push(RecordTypes.problemToken(entry.keyToken, ErrorType.RecordFieldUnknown, entry.key, record.name));
				return;
			}
			const nestedRecord = RecordTypes.fieldRecord(field, itemTypes);
			const enumValues = field.type ? RecordTypes.resolveEnum(field.type, itemTypes) : undefined;
			if (nestedRecord) {
				RecordTypes.checkMapTokens(tokens, entry.valueStart, entry.valueEnd, nestedRecord, itemTypes, problemTokens);
			} else if (enumValues && entry.valueStart === entry.valueEnd && tokens[entry.valueStart].tokenType === TokenLevelState.string) {
				RecordTypes.checkEnumValue([tokens[entry.valueStart]], enumValues, field.type!, problemTokens);
			} else if (entry.valueStart === entry.valueEnd && field.type && !RecordTypes.isLiteralAllowed(tokens[entry.valueStart], field.type)) {
				problemTokens.push(RecordTypes.problemToken(tokens[entry.valueStart], ErrorType.RecordFieldValueType, field.name, field.type.trim()));
			}
		});
	}

	// a placeholder for a value, e.g. __TODO.city
	public static readonly placeholderPrefix = '__TODO.';

	// the entries for the fields, e.g. 'r': __TODO.r, 'i': __TODO.i - a field with a record type has a map constructor
	// with its required fields
	public static fieldEntriesText(fields: RecordField[], itemTypes: Map<string, string>, depth = 0): string {
		return fields.map((field) => {
			const quote = field.name.includes('\'') ? '"' : '\'';
			const key = `${quote}${field.name}${quote}`;
			const fieldRecord = depth < 5 ? RecordTypes.fieldRecord(field, itemTypes) : undefined;
			if (fieldRecord) {
				const requiredFields = fieldRecord.fields.filter((f) => !f.optional);
				return requiredFields.length > 0 ? `${key}: { ${RecordTypes.fieldEntriesText(requiredFields, itemTypes, depth + 1)} }` : `${key}: {}`;
			}
			return `${key}: ${RecordTypes.placeholderPrefix}${field.name.replace(/[^\w.]/g, '_')}`;
		}).join(', ');
	}

	// where and what to insert to add the fields to the map constructor ending with tokens[end]
	private static missingFieldsFix(tokens: BaseToken[], end: number, hasEntries: boolean, fields: RecordField[], itemTypes: Map<string, string>) {
		const entries = RecordTypes.fieldEntriesText(fields, itemTypes);
		const closeToken = tokens[end];
		if (closeToken.value === '{}') {
			return { line: closeToken.line, character: closeToken.startCharacter + 1, text: ` ${entries} ` };
		}
		// after the last entry, or after the '{' of an empty map constructor
		const previous = tokens[end - 1];
		return { line: previous.line, character: previous.startCharacter + previous.length, text: hasEntries ? `, ${entries}` : ` ${entries}` };
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
