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
	// the document offsets of the field's name and type in its declaration, where known - for go to definition
	nameOffset?: number;
	typeOffset?: number;
}

export interface RecordType {
	// the named item type, or the record(...) type itself, for messages
	name: string;
	fields: RecordField[];
}

// for checking function call arguments: a parameter's declared type, and the declared types of variable references and
// user-defined function results
export interface ArgumentTypes {
	paramType: (name: string, arity: number, position: number, keyword?: string) => string | undefined;
	variableType: (token: BaseToken) => string | undefined;
	returnType: (name: string, arity: number) => string | undefined;
}

// a string literal that is a value of an enumeration type, e.g. 'red' in select="'red'" for as="enum('red', 'green')" -
// with the declared type it was checked against - for find references and rename
export interface EnumValueReference {
	token: BaseToken;
	value: string;
	type: string;
}

// the values of an enumeration type, e.g. enum('red', 'green'), with their string literal tokens
export interface EnumLiterals {
	values: string[];
	literals: { token: BaseToken, value: string }[];
}

// the 'as' attribute of an xsl:item-type: from the start of its first token to the end of its last token
export interface ItemTypeAsRange {
	name: string;
	start: { line: number, character: number };
	end: { line: number, character: number };
}

// a token that refers to a field of a record type, e.g. 'r' in $c?r - for hover and go to definition
export interface FieldReference {
	token: BaseToken;
	field: RecordField;
	record: RecordType;
}

export type TemplateParamType = (templateName: string, paramName: string) => string | undefined;

export interface MapEntry {
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
	// - with the document offset of typeText, if known, the fields have their offsets - for a named item type, the offset
	// of its declaration's 'as' value is from itemTypeOffsets
	public static resolve(typeText: string, itemTypes: Map<string, string>, depth = 0, offset?: number): RecordType | undefined {
		let text = typeText.trim();
		const start = offset === undefined ? undefined : offset + typeText.length - typeText.trimStart().length;
		if (depth > 10 || text.length === 0) {
			return undefined;
		}
		if ('?*+'.includes(text.charAt(text.length - 1))) {
			text = text.substring(0, text.length - 1).trim();
		}
		if (text.startsWith('(') && RecordTypes.closingIndex(text, 0) === text.length - 1 && RecordTypes.splitTopLevel(text.substring(1, text.length - 1), '|').length === 1) {
			// a parenthesized item type
			return RecordTypes.resolve(text.substring(1, text.length - 1), itemTypes, depth + 1, start === undefined ? undefined : start + 1);
		}
		const recordMatch = /^record\s*\(/.exec(text);
		if (recordMatch) {
			const openIndex = recordMatch[0].length - 1;
			if (RecordTypes.closingIndex(text, openIndex) !== text.length - 1) {
				return undefined;
			}
			const fields = RecordTypes.parseFields(text.substring(openIndex + 1, text.length - 1), start === undefined ? undefined : start + openIndex + 1);
			return fields ? { name: text.replace(/\s+/g, ' '), fields } : undefined;
		}
		if (/^[\w.-]+(:[\w.-]+)?$/.test(text)) {
			const declared = itemTypes.get(text);
			const resolved = declared ? RecordTypes.resolve(declared, itemTypes, depth + 1, RecordTypes.itemTypeOffsets.get(text)) : undefined;
			return resolved ? { name: text, fields: resolved.fields } : undefined;
		}
		return undefined;
	}

	// XPath 4.0: the record type of the content of a JNode type, e.g. 'point' in jnode(*, point), or a named item type
	// declared as one - a value with this type can be used with '/' for the record's fields, e.g. $v/x - undefined if
	// it's not such a type
	public static resolveJNode(typeText: string, itemTypes: Map<string, string>, depth = 0): RecordType | undefined {
		let text = typeText.trim();
		if ('?*+'.includes(text.charAt(text.length - 1))) {
			text = text.substring(0, text.length - 1).trim();
		}
		if (depth > 10) {
			return undefined;
		}
		if (/^[\w.-]+(:[\w.-]+)?$/.test(text)) {
			const declared = itemTypes.get(text);
			return declared ? RecordTypes.resolveJNode(declared, itemTypes, depth + 1) : undefined;
		}
		const jnodeMatch = /^jnode\s*\(/.exec(text);
		const openIndex = jnodeMatch ? jnodeMatch[0].length - 1 : -1;
		if (!jnodeMatch || RecordTypes.closingIndex(text, openIndex) !== text.length - 1) {
			return undefined;
		}
		const args = RecordTypes.splitTopLevel(text.substring(openIndex + 1, text.length - 1), ',');
		return args.length === 2 ? RecordTypes.resolve(args[1], itemTypes, depth + 1) : undefined;
	}

	// the document offsets of the 'as' values of the xsl:item-type declarations in the document being processed - set
	// for each linter run, for the offsets of record fields
	public static itemTypeOffsets = new Map<string, number>();
	// the tokens matched to record fields in the document being processed: lookups, child steps and map keys
	public static fieldReferences: FieldReference[] = [];
	// the string literals matched to enumeration values in the document being processed
	public static enumValueReferences: EnumValueReference[] = [];
	// the 'as' attributes of the xsl:item-type declarations in the document being processed
	public static itemTypeAsRanges: ItemTypeAsRange[] = [];

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
				const match = /^\s*(['"])([\s\S]*)\1\s*$/.exec(RecordTypes.decodeReferences(valueText).text);
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
		// the quotes may be references, e.g. &quot;red&quot; or &#39;red&#39; in an attribute
		const literal = token ? RecordTypes.decodeReferences(token.value).text : '';
		if (token && token.tokenType === TokenLevelState.string && /^(['"]).*\1$/.test(literal)) {
			const quote = literal.charAt(0);
			const value = literal.substring(1, literal.length - 1).split(quote + quote).join(quote);
			if (!enumValues.includes(value)) {
				problemTokens.push(RecordTypes.problemToken(token, ErrorType.EnumValueUnknown, value, typeText.trim()));
			} else {
				RecordTypes.enumValueReferences.push({ token, value, type: typeText });
			}
		}
	}

	// for a value of an enumeration type, the enum(...) type with the value: its values, and the name of the item type
	// declared as it, or as a choice including it - e.g. 'color' for 'red' with <xsl:item-type name="color"
	// as="enum('red', 'green')"/>, also when the type is an item type declared as 'color' - with no name for an inline
	// enum(...), e.g. in an 'as' attribute - undefined if the type has no enum(...) with the value
	public static enumSource(typeText: string, value: string, itemTypes: Map<string, string>, typeName?: string, depth = 0): { values: string[], typeName?: string } | undefined {
		let text = typeText.trim();
		if (depth > 10 || text.length === 0) {
			return undefined;
		}
		if ('?*+'.includes(text.charAt(text.length - 1))) {
			text = text.substring(0, text.length - 1).trim();
		}
		if (text.startsWith('(') && RecordTypes.closingIndex(text, 0) === text.length - 1) {
			for (const choice of RecordTypes.splitTopLevel(text.substring(1, text.length - 1), '|')) {
				const source = RecordTypes.enumSource(choice, value, itemTypes, typeName, depth + 1);
				if (source) {
					return source;
				}
			}
			return undefined;
		}
		if (/^enum\s*\(/.test(text)) {
			const values = RecordTypes.resolveEnum(text, itemTypes);
			return values?.includes(value) ? { values, typeName } : undefined;
		}
		if (/^[\w.-]+(:[\w.-]+)?$/.test(text)) {
			const declared = itemTypes.get(text);
			return declared ? RecordTypes.enumSource(declared, value, itemTypes, text, depth + 1) : undefined;
		}
		return undefined;
	}

	// the enumeration types in the tokens, e.g. enum('red', 'green') in an 'as' attribute, with the tokens of their values
	public static enumLiterals(tokens: BaseToken[]): EnumLiterals[] {
		const result: EnumLiterals[] = [];
		tokens.forEach((token, index) => {
			if (token.tokenType !== TokenLevelState.simpleType || token.value !== 'enum') {
				return;
			}
			const openIndex = RecordTypes.nextNonComment(tokens, index);
			const closeIndex = openIndex > -1 && tokens[openIndex].charType === CharLevelState.lB ? RecordTypes.closingTokenIndex(tokens, openIndex) : -1;
			if (closeIndex < 0) {
				return;
			}
			const literals: { token: BaseToken, value: string }[] = [];
			for (let i = openIndex + 1; i < closeIndex; i++) {
				const t = tokens[i];
				// the quotes may be references, e.g. &quot;x&quot; or &#39;x&#39; in an attribute
				const quoted = t.tokenType === TokenLevelState.string ? /^(['"])(.*)\1$/.exec(RecordTypes.decodeReferences(t.value).text) : null;
				if (quoted) {
					literals.push({ token: t, value: quoted[2].split(quoted[1] + quoted[1]).join(quoted[1]) });
				}
			}
			result.push({ values: literals.map((l) => l.value), literals });
		});
		return result;
	}

	// the record type of a field's value, e.g. for record(a as record(b as xs:integer))
	public static fieldRecord(field: RecordField, itemTypes: Map<string, string>) {
		return field.type ? RecordTypes.resolve(field.type, itemTypes, 0, field.typeOffset) : undefined;
	}

	// checks the tokens of an expression that is a single map constructor against the record type
	public static checkMapConstructor(tokens: BaseToken[], record: RecordType, itemTypes: Map<string, string>, problemTokens: BaseToken[]) {
		const realTokens = tokens.filter((t) => t.tokenType !== TokenLevelState.comment);
		RecordTypes.checkMapTokens(realTokens, 0, realTokens.length - 1, record, itemTypes, problemTokens);
	}

	// the document offset of the value of an attribute on the element whose start tag contains the offset, after its quote
	public static attributeValueOffset(text: string, offset: number, attributeName: string): number | undefined {
		const tagStart = text.lastIndexOf('<', offset);
		const nameRgx = /<[\w.:-]+/y;
		nameRgx.lastIndex = tagStart;
		if (tagStart < 0 || !nameRgx.exec(text)) {
			return undefined;
		}
		const attributeRgx = /\s+([\w.:-]+)(\s*=\s*)("[^"]*"|'[^']*')/y;
		attributeRgx.lastIndex = nameRgx.lastIndex;
		let match: RegExpExecArray | null;
		while ((match = attributeRgx.exec(text)) !== null) {
			if (match[1] === attributeName) {
				return attributeRgx.lastIndex - match[3].length + 1;
			}
		}
		return undefined;
	}

	// the value of an attribute on the element whose start tag contains the offset, e.g. the 'as' of an xsl:variable
	// from the position of its 'name' attribute value - attribute values may contain '>'
	// - with its references replaced, unless raw is true, e.g. for the offsets of the value's parts
	public static attributeOfElementAt(text: string, offset: number, attributeName: string, raw = false): string | undefined {
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
				return raw ? value : RecordTypes.decodeReferences(value).text;
			}
		}
		return undefined;
	}

	// for completions: when tokens[cursor - 1] is the '{' or ',' before a new entry of a map constructor, e.g. { 'a': 1, |,
	// the keys of the entries that contain it, from the outermost map constructor, e.g. ['address'] for { 'address': { |
	// and the keys the map constructor already has, before or after the cursor - undefined if the outermost map
	// constructor isn't the whole expression, or a containing map constructor isn't the value of a string literal key
	// - or when tokens[cursor - 1] is the ':' after a string literal key, the valueKey, e.g. 'c' for { 'c': |
	// - outerStart is the index of the outermost map constructor's first token: 0, or after the ':=' of a let binding
	public static mapEntryPosition(tokens: BaseToken[], cursor: number): { keyPath: string[], usedKeys: string[], valueKey?: string, outerStart: number } | undefined {
		// isRoot: an outermost map constructor - the whole expression, a let binding or keyword argument value, or a function argument
		interface Frame { isMap: boolean, isRoot?: boolean, isCall?: boolean, parentKey?: string, key?: string, keys: string[], start: number }
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
				const isArgument = !!top?.isCall && (before?.charType === CharLevelState.lB || (before?.charType === CharLevelState.sep && before.value === ','));
				// ':=' is a complexExpression token in a let binding and an operator in a keyword argument
				const isRoot = (stack.length === 0 && start === 0) || before?.value === ':=' || isArgument;
				const isEntryValue = !!top?.isMap && top.key !== undefined && before?.charType === CharLevelState.sep && before.value === ':';
				stack.push({ isMap: isRoot || isEntryValue, isRoot, parentKey: isEntryValue ? top.key : undefined, keys: [], start });
			} else if (RecordTypes.isOpenBracket(t)) {
				stack.push({ isMap: false, isCall: t.charType === CharLevelState.lB && prev?.tokenType === TokenLevelState.function, keys: [], start: i });
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
		// the frames from the innermost outermost map constructor
		const rootIndex = cursorFrames ? cursorFrames.map((frame) => !!frame.isRoot).lastIndexOf(true) : -1;
		const mapFrames = cursorFrames && rootIndex > -1 ? cursorFrames.slice(rootIndex) : [];
		if (mapFrames.length === 0 || !mapFrames.every((frame) => frame.isMap)) {
			return undefined;
		}
		cursorFrames = mapFrames;
		const keyPath = cursorFrames.slice(1).map((frame) => frame.parentKey!);
		const outerStart = cursorFrames[0].start;
		if (isValuePosition) {
			// the string literal key before the ':'
			const keyToken = realTokens[cursorIndex - 2];
			const isStringKey = keyToken && (keyToken.tokenType === TokenLevelState.mapKey || keyToken.tokenType === TokenLevelState.string) && /^(['"]).*\1$/.test(keyToken.value);
			return isStringKey ? { keyPath, usedKeys: [], valueKey: keyToken.value.substring(1, keyToken.value.length - 1), outerStart } : undefined;
		}
		return { keyPath, usedKeys: cursorFrames[cursorFrames.length - 1].keys, outerStart };
	}

	// the tokens of the type declared for the variable at tokens[varIndex] in XPath, e.g. [first, last] for 'person' in
	// let $p as person := ..., for $p as person in ..., or function($p as person) - undefined if it has no type
	public static xpathVariableTypeRange(tokens: BaseToken[], varIndex: number): [number, number] | undefined {
		const asIndex = RecordTypes.nextNonComment(tokens, varIndex);
		if (asIndex === -1 || tokens[asIndex].value !== 'as') {
			return undefined;
		}
		let depth = 0;
		let last = -1;
		for (let i = asIndex + 1; i < tokens.length; i++) {
			const t = tokens[i];
			if (t.tokenType === TokenLevelState.comment) {
				continue;
			}
			if (depth === 0 && (t.tokenType === TokenLevelState.complexExpression || (t.charType === CharLevelState.sep && t.value === ',') ||
				RecordTypes.isCloseBracket(t) || t.charType === CharLevelState.lBr)) {
				break;
			}
			if (RecordTypes.isOpenBracket(t)) {
				depth++;
			} else if (RecordTypes.isCloseBracket(t)) {
				depth--;
			}
			last = i;
		}
		return last > asIndex ? [RecordTypes.nextNonComment(tokens, asIndex), last] : undefined;
	}

	// for the ')' at tokens[closeIndex] that ends a function call, e.g. cx:new(1, 2), its name and arity
	public static functionCallAt(tokens: BaseToken[], closeIndex: number): { name: string, arity: number } | undefined {
		const close = tokens[closeIndex];
		if (close?.charType === CharLevelState.dSep && close.value === '()') {
			const fn = tokens[closeIndex - 1];
			return fn?.tokenType === TokenLevelState.function ? { name: fn.value, arity: 0 } : undefined;
		}
		if (close?.charType !== CharLevelState.rB) {
			return undefined;
		}
		let depth = 0;
		let arity = 1;
		for (let i = closeIndex; i > -1; i--) {
			const t = tokens[i];
			if (RecordTypes.isCloseBracket(t)) {
				depth++;
			} else if (RecordTypes.isOpenBracket(t)) {
				if (--depth === 0) {
					const fn = tokens[i - 1];
					return fn?.tokenType === TokenLevelState.function && t.charType === CharLevelState.lB ? { name: fn.value, arity } : undefined;
				}
			} else if (depth === 1 && t.charType === CharLevelState.sep && t.value === ',') {
				arity++;
			}
		}
		return undefined;
	}

	// the index of the last token of the map constructor starting at tokens[start], e.g. map { ... }, { ... } or {} -
	// -1 if there isn't one there
	public static mapConstructorEnd(tokens: BaseToken[], start: number): number {
		let i = start;
		if (tokens[i]?.tokenType === TokenLevelState.operator && tokens[i].value === 'map') {
			i++;
		}
		if (tokens[i]?.charType === CharLevelState.dSep && tokens[i].value === '{}') {
			return i;
		}
		return tokens[i]?.charType === CharLevelState.lBr ? RecordTypes.closingTokenIndex(tokens, i) : -1;
	}

	// the tokens of the type of a typed let binding whose ':=' is tokens[assignIndex], e.g. let $p as person :=
	public static letBindingTypeRange(tokens: BaseToken[], assignIndex: number): [number, number] | undefined {
		for (let j = assignIndex - 2; j > -1 && j > assignIndex - 40; j--) {
			const range = tokens[j].tokenType === TokenLevelState.variable ? RecordTypes.xpathVariableTypeRange(tokens, j) : undefined;
			if (range && range[1] === assignIndex - 1) {
				return range;
			}
		}
		return undefined;
	}

	// checks the value of each typed let binding, e.g. let $p as person := { ... } - a map constructor against a record type,
	// and a string literal against an enumeration type
	public static checkLetBindings(tokens: BaseToken[], typeText: (range: [number, number]) => string, itemTypes: Map<string, string>, problemTokens: BaseToken[]) {
		tokens.forEach((t, i) => {
			if (t.tokenType !== TokenLevelState.complexExpression || t.value !== ':=') {
				return;
			}
			const typeRange = RecordTypes.letBindingTypeRange(tokens, i);
			const valueStart = RecordTypes.nextNonComment(tokens, i);
			if (!typeRange || valueStart === -1) {
				return;
			}
			const after = tokens[RecordTypes.nextNonComment(tokens, valueStart)];
			const isSingleValue = !after || (after.tokenType === TokenLevelState.complexExpression && after.value === 'return') || (after.charType === CharLevelState.sep && after.value === ',');
			RecordTypes.checkValue(tokens, valueStart, isSingleValue ? valueStart : -1, typeText(typeRange), itemTypes, problemTokens);
		});
	}

	// checks the value starting at tokens[valueStart] against the type: a map constructor against a record type, or when the
	// value is the single token tokens[singleEnd], a string literal against an enumeration type
	public static checkValue(tokens: BaseToken[], valueStart: number, singleEnd: number, declaredType: string, itemTypes: Map<string, string>, problemTokens: BaseToken[], valueEnd?: number) {
		const record = RecordTypes.resolve(declaredType, itemTypes);
		const mapEnd = record ? RecordTypes.mapConstructorEnd(tokens, valueStart) : -1;
		// without a valueEnd, the value ends at a 'return' or ',', e.g. for a let binding
		const after = tokens[mapEnd + 1];
		const isWholeValue = valueEnd !== undefined ? mapEnd === valueEnd :
			!after || (after.tokenType === TokenLevelState.complexExpression && after.value === 'return') || (after.charType === CharLevelState.sep && after.value === ',');
		if (record && mapEnd > -1 && isWholeValue) {
			RecordTypes.checkMapConstructor(tokens.slice(valueStart, mapEnd + 1), record, itemTypes, problemTokens);
			return;
		}
		const enumValues = RecordTypes.resolveEnum(declaredType, itemTypes);
		if (enumValues && singleEnd === valueStart) {
			RecordTypes.checkEnumValue([tokens[valueStart]], enumValues, declaredType, problemTokens);
		}
	}

	// for the first token of a function call argument, e.g. the '{' in cx:area({ ... }) or cx:area(shape := { ... }):
	// the function's name, the argument's position (from 0) or keyword, and the call's arity, if the call is closed
	public static callArgument(tokens: BaseToken[], argStart: number): { name: string, position: number, keyword?: string, arity?: number } | undefined {
		let begin = argStart;
		let keyword: string | undefined;
		if (tokens[argStart - 1]?.value === ':=' && tokens[argStart - 2]?.tokenType === TokenLevelState.mapKey) {
			keyword = tokens[argStart - 2].value;
			begin = argStart - 2;
		}
		let depth = 0;
		let position = 0;
		for (let i = begin - 1; i > -1; i--) {
			const t = tokens[i];
			if (RecordTypes.isCloseBracket(t)) {
				depth++;
			} else if (RecordTypes.isOpenBracket(t)) {
				if (depth-- === 0) {
					if (t.charType !== CharLevelState.lB || tokens[i - 1]?.tokenType !== TokenLevelState.function) {
						return undefined;
					}
					const close = RecordTypes.closingTokenIndex(tokens, i);
					let arity: number | undefined;
					if (close > -1) {
						arity = 1 + tokens.slice(i + 1, close).filter((a, k, all) => a.charType === CharLevelState.sep && a.value === ',' && RecordTypes.bracketDepth(all, k) === 0).length;
					}
					return { name: tokens[i - 1].value, position, keyword, arity };
				}
			} else if (depth === 0 && t.charType === CharLevelState.sep && t.value === ',') {
				position++;
			}
		}
		return undefined;
	}

	// the bracket depth before tokens[index]
	private static bracketDepth(tokens: BaseToken[], index: number) {
		let depth = 0;
		for (let i = 0; i < index; i++) {
			if (RecordTypes.isOpenBracket(tokens[i])) {
				depth++;
			} else if (RecordTypes.isCloseBracket(tokens[i])) {
				depth--;
			}
		}
		return depth;
	}

	// checks the arguments of each call of a user-defined function: a map constructor against a parameter with a record type,
	// a string literal against one with an enumeration type, and a variable reference or function call with a declared type
	// against the parameter's type - including the operand of an arrow operator, e.g. { ... } => cx:area(), the first argument
	public static checkFunctionArguments(tokens: BaseToken[], types: ArgumentTypes, itemTypes: Map<string, string>, problemTokens: BaseToken[]) {
		tokens.forEach((t, open) => {
			// an empty argument list, e.g. cx:mag(), is a single '()' token - with an arrow operator's operand as the argument
			const isEmptyCall = t.charType === CharLevelState.dSep && t.value === '()';
			if (!(t.charType === CharLevelState.lB || isEmptyCall) || tokens[open - 1]?.tokenType !== TokenLevelState.function) {
				return;
			}
			const close = isEmptyCall ? open : RecordTypes.closingTokenIndex(tokens, open);
			if (close === -1) {
				return;
			}
			const args: [number, number][] = [];
			// the operand of '=>' or '=!>' before the function name is the first argument
			const arrow = tokens[open - 2];
			const operand = arrow?.tokenType === TokenLevelState.operator && (arrow.value === '=>' || arrow.value === '=!>') ? RecordTypes.operandStart(tokens, open - 3) : -1;
			if (operand > -1) {
				args.push([operand, open - 3]);
			}
			let argStart = open + 1;
			let depth = 0;
			for (let i = open + 1; i <= close && !isEmptyCall; i++) {
				const a = tokens[i];
				if (i === close || (depth === 0 && a.charType === CharLevelState.sep && a.value === ',')) {
					if (i > argStart) {
						args.push([argStart, i - 1]);
					}
					argStart = i + 1;
				} else if (RecordTypes.isOpenBracket(a)) {
					depth++;
				} else if (RecordTypes.isCloseBracket(a)) {
					depth--;
				}
			}
			const name = tokens[open - 1].value;
			args.forEach(([start, end], position) => {
				const hasKeyword = tokens[start].tokenType === TokenLevelState.mapKey && tokens[start + 1]?.value === ':=';
				const valueStart = hasKeyword ? start + 2 : start;
				const declaredType = valueStart <= end ? types.paramType(name, args.length, position, hasKeyword ? tokens[start].value : undefined) : undefined;
				if (!declaredType) {
					return;
				}
				RecordTypes.checkValue(tokens, valueStart, end, declaredType, itemTypes, problemTokens, end);
				// a variable reference or function call with a declared type
				const valueToken = tokens[valueStart];
				const call = valueToken.tokenType === TokenLevelState.function ? RecordTypes.functionCallAt(tokens, end) : undefined;
				const isCall = !!call && call.name === valueToken.value && (tokens[valueStart + 1]?.value === '()' ? valueStart + 1 === end : RecordTypes.closingTokenIndex(tokens, valueStart + 1) === end);
				const argType = valueStart === end && valueToken.tokenType === TokenLevelState.variable ? types.variableType(valueToken) :
					isCall ? types.returnType(call!.name, call!.arity) : undefined;
				if (argType) {
					RecordTypes.checkTypeCompatible(valueToken, argType, declaredType, itemTypes, problemTokens);
				}
			});
		});
	}

	// for the operand ending at tokens[operandEnd] of an arrow operator, e.g. { ... } => cx:area(2): the function's name and
	// the call's arity, including the operand, the first argument - undefined if it's not an arrow operator's operand
	public static arrowTarget(tokens: BaseToken[], operandEnd: number): { name: string, arity: number } | undefined {
		const arrow = tokens[operandEnd + 1];
		const fn = tokens[operandEnd + 2];
		const open = tokens[operandEnd + 3];
		if (!(arrow?.tokenType === TokenLevelState.operator && (arrow.value === '=>' || arrow.value === '=!>')) || fn?.tokenType !== TokenLevelState.function || !open) {
			return undefined;
		}
		if (open.charType === CharLevelState.dSep && open.value === '()') {
			return { name: fn.value, arity: 1 };
		}
		const close = open.charType === CharLevelState.lB ? RecordTypes.closingTokenIndex(tokens, operandEnd + 3) : -1;
		if (close === -1) {
			return undefined;
		}
		const commas = tokens.slice(operandEnd + 4, close).filter((a, k, all) => a.charType === CharLevelState.sep && a.value === ',' && RecordTypes.bracketDepth(all, k) === 0).length;
		return { name: fn.value, arity: close > operandEnd + 4 ? commas + 2 : 1 };
	}

	// the index of the first token of the operand ending at tokens[end]: a variable reference, a map constructor or a
	// function call - otherwise -1
	private static operandStart(tokens: BaseToken[], end: number): number {
		const last = tokens[end];
		if (!last) {
			return -1;
		} else if (last.tokenType === TokenLevelState.variable) {
			return end;
		}
		let open = -1;
		if (last.charType === CharLevelState.dSep && (last.value === '{}' || last.value === '()')) {
			open = end;
		} else if (RecordTypes.isCloseBracket(last)) {
			let depth = 0;
			for (let i = end; i > -1 && open === -1; i--) {
				if (RecordTypes.isCloseBracket(tokens[i])) {
					depth++;
				} else if (RecordTypes.isOpenBracket(tokens[i]) && --depth === 0) {
					open = i;
				}
			}
		}
		if (open === -1) {
			return -1;
		}
		const before = tokens[open - 1];
		if (tokens[open].value.startsWith('{')) {
			// a map constructor, e.g. map { ... } or { ... }
			return before?.tokenType === TokenLevelState.operator && before.value === 'map' ? open - 1 : open;
		}
		// a function call
		return before?.tokenType === TokenLevelState.function ? open - 1 : -1;
	}

	// reports a value whose declared type can't match the parameter's: a record type that doesn't have a field that the
	// parameter's record type requires, or a record type and an enumeration type - Saxon 13 accepts a value with one
	// enumeration type for a parameter with another, even with no values in common, so that's not reported
	private static checkTypeCompatible(token: BaseToken, argType: string, paramType: string, itemTypes: Map<string, string>, problemTokens: BaseToken[]) {
		const argRecord = RecordTypes.resolve(argType, itemTypes);
		const paramRecord = RecordTypes.resolve(paramType, itemTypes);
		const argEnum = RecordTypes.resolveEnum(argType, itemTypes);
		const paramEnum = RecordTypes.resolveEnum(paramType, itemTypes);
		let reason: string | undefined;
		if (argRecord && paramRecord) {
			const missingField = paramRecord.fields.find((field) => !field.optional && !argRecord.fields.some((f) => f.name === field.name));
			reason = missingField ? `it has no field '${missingField.name}'` : undefined;
		} else if ((argRecord && paramEnum) || (argEnum && paramRecord)) {
			reason = argRecord ? 'a record is not an enumeration value' : 'an enumeration value is not a record';
		}
		if (reason) {
			problemTokens.push(RecordTypes.problemToken(token, ErrorType.ArgumentTypeMismatch, token.value, argType.trim(), paramType.trim(), reason));
		}
	}

	// XPath 4.0: a duplicate field name in a record type - a static error, also for a quoted name, e.g. record(a, 'a') -
	// or a duplicate value in an enumeration type, e.g. enum('red', 'red'), which Saxon allows but is likely a mistake
	public static checkTypeDuplicates(tokens: BaseToken[], problemTokens: BaseToken[]) {
		tokens.forEach((token, index) => {
			if (token.tokenType !== TokenLevelState.simpleType || (token.value !== 'record' && token.value !== 'enum')) {
				return;
			}
			const openIndex = RecordTypes.nextNonComment(tokens, index);
			const closeIndex = openIndex > -1 && tokens[openIndex].charType === CharLevelState.lB ? RecordTypes.closingTokenIndex(tokens, openIndex) : -1;
			if (closeIndex < 0) {
				return;
			}
			const isRecord = token.value === 'record';
			const names = new Set<string>();
			let depth = 0;
			let separator: BaseToken | undefined;
			let isEntryStart = true;
			for (let i = openIndex + 1; i < closeIndex; i++) {
				const t = tokens[i];
				if (t.tokenType === TokenLevelState.comment) {
					continue;
				}
				if (depth === 0 && t.charType === CharLevelState.sep && t.value === ',') {
					separator = t;
					isEntryStart = true;
					continue;
				}
				if (isEntryStart && depth === 0) {
					// the quotes may be references, e.g. &quot;x&quot; or &#39;x&#39; in an attribute
					const quoted = t.tokenType === TokenLevelState.string ? /^(['"])(.*)\1$/.exec(RecordTypes.decodeReferences(t.value).text) : null;
					const name = quoted ? quoted[2].split(quoted[1] + quoted[1]).join(quoted[1]) :
						isRecord && t.tokenType === TokenLevelState.nodeNameTest ? t.value : undefined;
					if (name !== undefined && names.has(name) && !t.error) {
						if (isRecord) {
							problemTokens.push(RecordTypes.problemToken(t, ErrorType.RecordFieldDuplicate, name));
						} else if (separator) {
							// the fix removes the value and its preceding comma
							const recordFix = { line: separator.line, character: separator.startCharacter, text: '', end: { line: t.line, character: t.startCharacter + t.length } };
							problemTokens.push({ ...RecordTypes.problemToken(t, ErrorType.EnumValueDuplicate, name), recordFix });
						}
					} else if (name !== undefined) {
						names.add(name);
					}
				}
				isEntryStart = false;
				if (RecordTypes.isOpenBracket(t)) {
					depth++;
				} else if (RecordTypes.isCloseBracket(t)) {
					depth--;
				}
			}
		});
	}

	// the identity of a literal map key, for finding duplicates - the same for 'a' and "a", and for 1 and 1.0, but not for
	// 1 and '1' - undefined if it's not a literal
	public static literalKeyIdentity(keyText: string): string | undefined {
		// the quotes may be references, e.g. &quot;a&quot; or &#39;a&#39; in an attribute
		const quoted = /^(['"])([\s\S]*)\1$/.exec(RecordTypes.decodeReferences(keyText).text);
		if (quoted) {
			return 's' + quoted[2].split(quoted[1] + quoted[1]).join(quoted[1]);
		}
		return /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(keyText) ? 'n' + Number(keyText) : undefined;
	}

	// a duplicate literal key in a map constructor, e.g. map { 'a': 1, 'a': 2 } - as in Saxon, a static error XQDY0137
	public static checkMapConstructorKeys(tokens: BaseToken[], problemTokens: BaseToken[]) {
		tokens.forEach((token, index) => {
			if (token.charType !== CharLevelState.lBr) {
				return;
			}
			const closeIndex = RecordTypes.closingTokenIndex(tokens, index);
			if (closeIndex < 0) {
				return;
			}
			const keys = new Set<string>();
			let depth = 0;
			let isEntryStart = true;
			for (let i = index + 1; i < closeIndex; i++) {
				const t = tokens[i];
				if (t.tokenType === TokenLevelState.comment) {
					continue;
				}
				if (depth === 0 && t.charType === CharLevelState.sep && t.value === ',') {
					isEntryStart = true;
					continue;
				}
				if (isEntryStart && depth === 0) {
					// a key is a single token followed by ':' - which also excludes braces that aren't a map constructor
					const next = RecordTypes.nextNonComment(tokens, i);
					const isKey = next > -1 && next < closeIndex && tokens[next].charType === CharLevelState.sep && tokens[next].value === ':';
					const isLiteral = t.tokenType === TokenLevelState.mapKey || t.tokenType === TokenLevelState.string || t.tokenType === TokenLevelState.number;
					const identity = isKey && isLiteral ? RecordTypes.literalKeyIdentity(t.value) : undefined;
					if (identity !== undefined && keys.has(identity) && !t.error) {
						problemTokens.push(RecordTypes.problemToken(t, ErrorType.MapKeyDuplicate, t.value));
					} else if (identity !== undefined) {
						keys.add(identity);
					}
				}
				isEntryStart = false;
				if (RecordTypes.isOpenBracket(t)) {
					depth++;
				} else if (RecordTypes.isCloseBracket(t)) {
					depth--;
				}
			}
		});
	}

	// the xsl:map-entry children of each xsl:map with a literal key that's the same as that of an earlier one - as in
	// Saxon, a dynamic error XTDE3365 - excluding xsl:map-entry elements within xsl:if etc. and those with use-when - and
	// whether it's handled: XSLT 4.0, the xsl:map has a duplicates attribute, e.g. duplicates="fn($a, $b) { $a + $b }"
	public static duplicateMapEntryKeys(text: string, markup: string): { key: string, offset: number, handled: boolean }[] {
		const duplicates: { key: string, offset: number, handled: boolean }[] = [];
		[...markup.matchAll(/<xsl:map[\s>]/g)].forEach((mapMatch) => {
			const keys = new Set<string>();
			const handled = RecordTypes.attributeOfElementAt(text, mapMatch.index! + 1, 'duplicates') !== undefined;
			RecordTypes.childElements(text, markup, mapMatch.index!, 'xsl:map-entry').forEach((entryOffset) => {
				const valueOffset = RecordTypes.attributeValueOffset(text, entryOffset + 1, 'key');
				const key = RecordTypes.attributeOfElementAt(text, entryOffset + 1, 'key')?.trim();
				const identity = key !== undefined ? RecordTypes.literalKeyIdentity(key) : undefined;
				if (identity === undefined || valueOffset === undefined || RecordTypes.attributeOfElementAt(text, entryOffset + 1, 'use-when') !== undefined) {
					return;
				}
				if (keys.has(identity)) {
					duplicates.push({ key: key!, offset: valueOffset + text.substring(valueOffset).search(/\S/), handled });
				}
				keys.add(identity);
			});
		});
		return duplicates;
	}

	private static nextNonComment(tokens: BaseToken[], index: number) {
		for (let i = index + 1; i < tokens.length; i++) {
			if (tokens[i].tokenType !== TokenLevelState.comment) {
				return i;
			}
		}
		return -1;
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

	// the open elements at each of the offsets, which must be in ascending order - as openElements, in one pass
	public static openElementsAt(markup: string, offsets: number[]): { name: string, offset: number }[][] {
		const result: { name: string, offset: number }[][] = [];
		const ancestors: { name: string, offset: number }[] = [];
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		let match: RegExpExecArray | null = tagRgx.exec(markup);
		for (const offset of offsets) {
			while (match !== null && match.index < offset) {
				if (match[1]) {
					ancestors.pop();
				} else if (!match[3]) {
					ancestors.push({ name: match[2], offset: match.index });
				}
				match = tagRgx.exec(markup);
			}
			result.push(ancestors.slice());
		}
		return result;
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
	// - templateParamType gives the type of a named template's parameter, for an xsl:with-param without an 'as'
	public static xslMapRecord(text: string, ancestors: { name: string, offset: number }[], index: number, itemTypes: Map<string, string>, templateParamType?: TemplateParamType): RecordType | undefined {
		const declaredType = RecordTypes.contentType(text, ancestors, index, itemTypes, templateParamType);
		return declaredType ? RecordTypes.resolve(declaredType, itemTypes) : undefined;
	}

	// the declared type of the value of the instruction at ancestors[index], e.g. an xsl:sequence, xsl:select or xsl:map,
	// from the element containing it (within any xsl:if or xsl:choose etc.): the 'as' of an xsl:variable, xsl:param or
	// xsl:function, the type of the parameter an xsl:with-param sets, or for an xsl:map-entry of an xsl:map with a record
	// type, the type of its field
	// - an xsl:sequence or xsl:select with its own 'as' has that type: see instructionType
	public static contentType(text: string, ancestors: { name: string, offset: number }[], index: number, itemTypes: Map<string, string>, templateParamType?: TemplateParamType, depth = 0): string | undefined {
		if (depth > 10) {
			return undefined;
		}
		for (let i = index - 1; i > -1; i--) {
			const { name, offset } = ancestors[i];
			if (name === 'xsl:variable' || name === 'xsl:param' || name === 'xsl:with-param' || name === 'xsl:function') {
				return RecordTypes.attributeOfElementAt(text, offset + 1, 'as') ?? (name === 'xsl:with-param' ? RecordTypes.withParamType(text, ancestors, i, templateParamType) : undefined);
			} else if (name === 'xsl:sequence') {
				// XSLT 4.0: an xsl:sequence with content - its value is the content's value, with its own 'as' if it has one
				const ownType = RecordTypes.attributeOfElementAt(text, offset + 1, 'as');
				if (ownType) {
					return ownType;
				}
			} else if (name === 'xsl:map-entry') {
				const key = /^\s*(['"])(.*)\1\s*$/.exec(RecordTypes.attributeOfElementAt(text, offset + 1, 'key') ?? '');
				const parentMap = i - 1;
				if (!key || parentMap < 0 || ancestors[parentMap].name !== 'xsl:map') {
					return undefined;
				}
				const mapType = RecordTypes.contentType(text, ancestors, parentMap, itemTypes, templateParamType, depth + 1);
				const record = mapType ? RecordTypes.resolve(mapType, itemTypes) : undefined;
				return record?.fields.find((f) => f.name === key[2])?.type;
			} else if (!RecordTypes.conditionalInstructions.includes(name)) {
				return undefined;
			}
		}
		return undefined;
	}

	// the declared type of the value of the xsl:sequence or xsl:select at ancestors[index]: its own 'as' (XSLT 4.0), or
	// otherwise the type from the element containing it
	public static instructionType(text: string, ancestors: { name: string, offset: number }[], index: number, itemTypes: Map<string, string>, templateParamType?: TemplateParamType): string | undefined {
		const offset = ancestors[index].offset;
		const ownType = offset > -1 ? RecordTypes.attributeOfElementAt(text, offset + 1, 'as') : undefined;
		return ownType ?? RecordTypes.contentType(text, ancestors, index, itemTypes, templateParamType);
	}

	// for the xsl:with-param at ancestors[index], without an 'as': the type of the parameter it sets - of the called
	// template for xsl:call-template, or of the enclosing xsl:iterate for xsl:next-iteration
	public static withParamType(text: string, ancestors: { name: string, offset: number }[], index: number, templateParamType?: TemplateParamType) {
		const parent = ancestors[index - 1];
		const paramName = RecordTypes.attributeOfElementAt(text, ancestors[index].offset + 1, 'name');
		if (!paramName || !parent) {
			return undefined;
		}
		if (parent.name === 'xsl:call-template') {
			const templateName = RecordTypes.attributeOfElementAt(text, parent.offset + 1, 'name');
			return templateName && templateParamType ? templateParamType(templateName, paramName) : undefined;
		} else if (parent.name === 'xsl:next-iteration') {
			const iterate = [...ancestors.slice(0, index - 1)].reverse().find((a) => a.name === 'xsl:iterate');
			const param = iterate ? RecordTypes.childElements(text, RecordTypes.blankMarkup(text), iterate.offset, 'xsl:param')
				.find((offset) => RecordTypes.attributeOfElementAt(text, offset + 1, 'name') === paramName) : undefined;
			return param !== undefined ? RecordTypes.attributeOfElementAt(text, param + 1, 'as') : undefined;
		}
		return undefined;
	}

	// the offsets of the start tags of the child elements with the name, of the element whose start tag is at offset
	public static childElements(text: string, markup: string, offset: number, name: string): number[] {
		const children: number[] = [];
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
		tagRgx.lastIndex = offset;
		let depth = 0;
		let match: RegExpExecArray | null;
		while ((match = tagRgx.exec(markup)) !== null) {
			if (match[1]) {
				if (--depth === 0) {
					break;
				}
			} else {
				if (depth === 1 && match[2] === name) {
					children.push(match.index);
				}
				if (!match[3]) {
					depth++;
				} else if (depth === 0) {
					break;
				}
			}
		}
		return children;
	}

	public static readonly conditionalInstructions = ['xsl:if', 'xsl:choose', 'xsl:when', 'xsl:otherwise', 'xsl:try', 'xsl:catch'];
	// a start tag, end tag or empty element tag: [1] is '/' for an end tag, [2] the name, [3] '/' for an empty element
	public static readonly tagPattern = /<(\/?)([\w.:-]+)(?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*(\/?)>/.source;

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
			RecordTypes.fieldReferences.push({ token: entry.keyToken, field, record });
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
	public static parseMapConstructor(tokens: BaseToken[], start: number, end: number): { startToken: BaseToken, entries: MapEntry[] } | undefined {
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

	public static closingTokenIndex(tokens: BaseToken[], openIndex: number) {
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
	// the fields declared in the record types within a SequenceType at the document offset, e.g. both fields of
	// 'record(a as record(b))' - with the offsets of their names, e.g. for renaming a field
	public static recordFieldDeclarations(typeText: string, offset: number): RecordField[] {
		const fields: RecordField[] = [];
		for (const match of typeText.matchAll(/(?<![\w.:-])record\s*\(/g)) {
			const openIndex = match.index! + match[0].length - 1;
			const closeIndex = RecordTypes.closingIndex(typeText, openIndex);
			if (closeIndex > -1) {
				fields.push(...(RecordTypes.parseFields(typeText.substring(openIndex + 1, closeIndex), offset + openIndex + 1) ?? []));
			}
		}
		return fields;
	}

	private static parseFields(fieldsText: string, offset?: number): RecordField[] | undefined {
		const fields: RecordField[] = [];
		if (fieldsText.trim().length === 0) {
			return fields;
		}
		let partStart = 0;
		for (const fieldText of RecordTypes.splitTopLevel(fieldsText, ',')) {
			// the field is matched with its references replaced, e.g. a name quoted with &quot; - the type is the text as
			// written, so that the offsets within it are those of the document
			const { text: decoded, offsets } = RecordTypes.decodeReferences(fieldText);
			const match = /^(\s*)(?:'([^']*)'|"([^"]*)"|([\w.-]+))(\s*\??\s*)(?:as(\s+)([\s\S]+))?$/.exec(decoded);
			if (!match) {
				return undefined;
			}
			const name = match[2] ?? match[3] ?? match[4];
			const typeStart = match[7] !== undefined ? offsets[decoded.length - match[7].length] : undefined;
			const field: RecordField = { name, optional: match[5].includes('?'), type: typeStart !== undefined ? fieldText.substring(typeStart).trim() : undefined };
			if (offset !== undefined) {
				// the name, within any quotes - unless it has a reference, e.g. 'a&amp;b', as its length isn't that of
				// the text - and the type after 'as'
				const nameIndex = match[1].length + (match[4] === undefined ? 1 : 0);
				const nameStart = offsets[nameIndex];
				field.nameOffset = fieldText.substring(nameStart, offsets[nameIndex + name.length]) === name ? offset + partStart + nameStart : undefined;
				field.typeOffset = typeStart !== undefined ? offset + partStart + typeStart : undefined;
			}
			fields.push(field);
			partStart += fieldText.length + 1;
		}
		return fields;
	}

	// the character of an XML character or entity reference at the index, e.g. '"' for &quot; or &#34; - with the
	// reference's length - undefined if there isn't one
	private static referenceAt(text: string, index: number): { char: string, length: number } | undefined {
		if (text.charAt(index) !== '&') {
			return undefined;
		}
		const reference = /^&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/.exec(text.substring(index, index + 12));
		if (!reference) {
			return undefined;
		}
		const name = reference[1];
		const entities: { [name: string]: string } = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };
		const char = name.startsWith('#x') ? String.fromCodePoint(parseInt(name.substring(2), 16)) : name.startsWith('#') ? String.fromCodePoint(parseInt(name.substring(1), 10)) : entities[name];
		return { char, length: reference[0].length };
	}

	// a quote character at the index, written as itself or as a reference, e.g. &quot; or &apos;
	private static quoteAt(text: string, index: number): { char: string, length: number } | undefined {
		const ch = text.charAt(index);
		if (ch === '\'' || ch === '"') {
			return { char: ch, length: 1 };
		}
		const reference = RecordTypes.referenceAt(text, index);
		return reference && (reference.char === '\'' || reference.char === '"') ? reference : undefined;
	}

	// the text of an attribute value, e.g. a SequenceType, with its character and entity references replaced - and the
	// index in the text of each character, and of the end
	public static decodeReferences(text: string): { text: string, offsets: number[] } {
		const chars: string[] = [];
		const offsets: number[] = [];
		for (let i = 0; i < text.length;) {
			const reference = RecordTypes.referenceAt(text, i);
			chars.push(reference ? reference.char : text.charAt(i));
			offsets.push(i);
			i += reference ? reference.length : 1;
		}
		offsets.push(text.length);
		return { text: chars.join(''), offsets };
	}

	// the parts of the text separated by the separator, outside brackets and string literals - the text may be an
	// attribute value, with quotes written as references, e.g. enum(&quot;it's&quot;)
	private static splitTopLevel(text: string, separator: string) {
		const parts: string[] = [];
		let depth = 0;
		let quote = '';
		let partStart = 0;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			const quoteChar = RecordTypes.quoteAt(text, i);
			if (quoteChar) {
				quote = !quote ? quoteChar.char : quote === quoteChar.char ? '' : quote;
				i += quoteChar.length - 1;
			} else if (quote) {
				// within a string literal
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
			const quoteChar = RecordTypes.quoteAt(text, i);
			if (quoteChar) {
				quote = !quote ? quoteChar.char : quote === quoteChar.char ? '' : quote;
				i += quoteChar.length - 1;
			} else if (quote) {
				// within a string literal
			} else if (ch === '(') {
				depth++;
			} else if (ch === ')' && --depth === 0) {
				return i;
			}
		}
		return -1;
	}
}
