/**
 * XPath 4.0 enumeration types: find references and rename, for a value of an enumeration type - from the value in its
 * enum(...) declaration, e.g. in an xsl:item-type or an 'as' attribute, or from a string literal that the linter matched
 * to the value, e.g. select="'red'" for as="enum('red', 'green')", a function argument, a map constructor value for a
 * record field, or the test of an xsl:when in an xsl:switch.
 *
 * An enumeration type declared by an xsl:item-type - directly, or as a choice including it - is identified by the item
 * type, so a value of one named type isn't renamed in another with the same value. An inline enum(...), e.g. in the 'as'
 * of a function's parameter, has no name, and is identified by its values: inline types with the same values are the
 * same type, as they are for Saxon. As for record fields, the references are found in the document, the modules it
 * includes or imports, and the stylesheets that import or include it, from the index of the workspace's modules.
 */
import * as vscode from 'vscode';
import * as url from 'url';
import { XSLTConfiguration } from './languageConfigurations';
import { BaseToken, CharLevelState } from './xpLexer';
import { XslLexer, XSLTokenLevelState } from './xslLexer';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { EnumValueReference, ItemTypeAsRange, RecordTypes } from './recordTypes';
import { DocumentContext, RecordFieldReferences } from './recordFieldReferences';

// how a string literal is written, for an edit of its value
interface LiteralForm {
	// the value, within the quotes
	location: vscode.Location;
	// the literal's quote character
	quote: string;
	// the quote character delimiting the XML attribute the literal is in - undefined in element content, e.g. xsl:select
	attributeQuote?: string;
}

export interface EnumValueLocations {
	value: string;
	// the literal at the position
	origin: LiteralForm;
	// each literal with the value: in its declaration, and the references to it
	literals: LiteralForm[];
	// the values of the enumeration types with the value
	typeValues: string[];
}

// a document's enumeration value references and declarations, with the tokens of the document
interface DocumentEnums {
	context: DocumentContext;
	references: EnumValueReference[];
	allTokens: BaseToken[];
	// the 'as' attributes of the document's xsl:item-type declarations
	itemTypeAsRanges: ItemTypeAsRange[];
}

export class EnumValueReferences {

	// the enumeration value at the position, with all its locations - undefined if there's no enumeration value there
	public static async find(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<EnumValueLocations | undefined> {
		const definitionProvider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
		const context = await RecordFieldReferences.documentContext(definitionProvider, document);
		if (!context || token.isCancellationRequested) {
			return undefined;
		}
		const cached = XsltTokenDiagnostics.enumValueReferences.get(document.uri.toString());
		const documentEnums = await EnumValueReferences.documentEnums(definitionProvider, context, cached);
		const target = EnumValueReferences.valueAt(documentEnums, position);
		if (!target) {
			return undefined;
		}
		const { value, key } = target;
		const result: EnumValueLocations = { value, origin: target.form, literals: [], typeValues: [] };
		const add = (doc: vscode.TextDocument, allTokens: BaseToken[], literal: BaseToken) => {
			const form = EnumValueReferences.literalForm(doc, allTokens, literal);
			if (form && !result.literals.some((l) => l.location.uri.toString() === form.location.uri.toString() && l.location.range.isEqual(form.location.range))) {
				result.literals.push(form);
			}
		};
		const hrefs = (await definitionProvider.getImportedGlobals(document, RecordFieldReferences.startPosition())).accumulatedHrefs;
		const all = [documentEnums];
		// a value with no characters that may be escaped is written as it is in each module that refers to it
		const isPlain = !/['"&<]/.test(value);
		for (const href of await RecordFieldReferences.scopeModules(document, hrefs)) {
			try {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(url.pathToFileURL(href).toString()));
				if (isPlain && !doc.getText().includes(value)) {
					continue;
				}
				const docContext = await RecordFieldReferences.documentContext(definitionProvider, doc);
				if (docContext) {
					all.push(await EnumValueReferences.documentEnums(definitionProvider, docContext));
				}
			} catch (error) {
				console.error(error);
			}
			if (token.isCancellationRequested) {
				return undefined;
			}
		}
		for (const enums of all) {
			const doc = enums.context.document;
			enums.references.filter((ref) => ref.value === value && EnumValueReferences.referenceKey(enums.context, ref) === key).forEach((ref) => add(doc, enums.allTokens, ref.token));
			EnumValueReferences.declarations(enums).filter((declaration) => declaration.key === key).forEach((declaration) => {
				declaration.enumLiterals.literals.filter((literal) => literal.value === value).forEach((literal) => add(doc, enums.allTokens, literal.token));
				result.typeValues.push(...declaration.enumLiterals.values.filter((v) => !result.typeValues.includes(v)));
			});
		}
		return result;
	}

	// the edit for a rename to the new name, written as the value would be in the literal at the position - e.g. it''s
	// for the value it's, in a literal with single quotes - or why it's not valid
	public static renameEdit(locations: EnumValueLocations, newName: string): vscode.WorkspaceEdit | string {
		const { quote } = locations.origin;
		// the quotes may be references, e.g. &apos; in an attribute
		const parts = RecordTypes.decodeReferences(newName).text.split(quote + quote);
		const newValue = parts.join(quote);
		if (parts.some((part) => part.includes(quote))) {
			return `new value is invalid: '${newName}' - a ${quote} in the value must be doubled: ${quote}${quote}`;
		} else if (newValue.length === 0 || /[\r\n]/.test(newValue)) {
			return `new value is invalid: '${newName}'`;
		} else if (newValue !== locations.value && locations.typeValues.includes(newValue)) {
			return `'${newValue}' is already a value of the enumeration type`;
		}
		// the attribute's quote character can only be a reference, e.g. &apos; for it's in "..." within select='...', or
		// &quot;&quot; in &quot;...&quot; - which the lexer splits into separate tokens - so by convention, it's not written
		const conflicts = locations.literals.filter((literal) => literal.attributeQuote && newValue.includes(literal.attributeQuote));
		if (conflicts.length > 0) {
			const where = conflicts.map((l) => `${vscode.workspace.asRelativePath(l.location.uri)}:${l.location.range.start.line + 1}`).join(', ');
			return `'${newValue}' can't be written in the literal at ${where}: it's in an attribute with ${conflicts[0].attributeQuote} quotes - change them to use the other quotes`;
		}
		const edit = new vscode.WorkspaceEdit();
		locations.literals.forEach((literal) => edit.replace(literal.location.uri, literal.location.range, EnumValueReferences.literalText(newValue, literal)));
		return edit;
	}

	// the value as written within the quotes of the literal: its quote character doubled, and the characters that the XML
	// requires as references, e.g. &amp;
	private static literalText(value: string, literal: LiteralForm) {
		return value.split(literal.quote).join(literal.quote + literal.quote).replace(/&/g, '&amp;').replace(/</g, '&lt;');
	}

	// the enumeration value at the position: a reference to it, or a value in an enum(...) declaration - with its key
	private static valueAt(enums: DocumentEnums, position: vscode.Position): { value: string, key: string, form: LiteralForm } | undefined {
		const document = enums.context.document;
		const isAt = (t: BaseToken) => t.line === position.line && position.character >= t.startCharacter && position.character <= t.startCharacter + t.length;
		const result = (value: string, key: string | undefined, literal: BaseToken) => {
			const form = key ? EnumValueReferences.literalForm(document, enums.allTokens, literal) : undefined;
			return form ? { value, key: key!, form } : undefined;
		};
		const reference = enums.references.find((ref) => isAt(ref.token));
		if (reference) {
			return result(reference.value, EnumValueReferences.referenceKey(enums.context, reference), reference.token);
		}
		for (const declaration of EnumValueReferences.declarations(enums)) {
			const literal = declaration.enumLiterals.literals.find((l) => isAt(l.token));
			if (literal) {
				return result(literal.value, declaration.key, literal.token);
			}
		}
		return undefined;
	}

	// the key of the enumeration type of a reference: the item type declaring it, or the values of an inline enum(...)
	private static referenceKey(context: DocumentContext, reference: EnumValueReference): string | undefined {
		const source = RecordTypes.enumSource(reference.type, reference.value, EnumValueReferences.itemTypeMap(context));
		if (!source) {
			return undefined;
		}
		const itemType = source.typeName ? context.itemTypes.find((g) => g.name === source.typeName) : undefined;
		return itemType ? EnumValueReferences.namedKey(itemType.href ?? context.document.fileName, itemType.name) : EnumValueReferences.valuesKey(source.values);
	}

	// each enum(...) in the document, with its key: the xsl:item-type whose 'as' it's in, if that's an enumeration type,
	// e.g. as="enum('a', 'b')" or as="(enum('a') | enum('b'))" - otherwise its values
	private static declarations(enums: DocumentEnums) {
		const document = enums.context.document;
		const itemTypeMap = EnumValueReferences.itemTypeMap(enums.context);
		const named = enums.itemTypeAsRanges.filter((asRange) => {
			const declared = itemTypeMap.get(asRange.name);
			return declared && RecordTypes.resolveEnum(declared, itemTypeMap);
		});
		const isBefore = (a: { line: number, character: number }, b: { line: number, character: number }) => a.line < b.line || (a.line === b.line && a.character <= b.character);
		return RecordTypes.enumLiterals(enums.allTokens).map((enumLiterals) => {
			const first = enumLiterals.literals[0]?.token;
			const start = first ? { line: first.line, character: first.startCharacter } : undefined;
			const itemType = start ? named.find((asRange) => isBefore(asRange.start, start) && isBefore(start, asRange.end)) : undefined;
			return { enumLiterals, key: itemType ? EnumValueReferences.namedKey(document.fileName, itemType.name) : EnumValueReferences.valuesKey(enumLiterals.values) };
		});
	}

	private static namedKey(file: string, typeName: string) {
		return `type:${file}#${typeName}`;
	}

	private static valuesKey(values: string[]) {
		return `values:${[...new Set(values)].sort().join('\u0000')}`;
	}

	// how the string literal is written, from the tokens: its quote character, from the token's charType - which also tells
	// if the quotes are references, e.g. &quot;red&quot; - the range within its quotes, and the quote character of the XML
	// attribute it's in, from the token before the literal
	private static literalForm(document: vscode.TextDocument, allTokens: BaseToken[], literal: BaseToken): LiteralForm | undefined {
		const index = allTokens.findIndex((t) => t.line === literal.line && t.startCharacter === literal.startCharacter);
		const charType = index > -1 ? allTokens[index].charType : undefined;
		const quote = charType === CharLevelState.lSq || charType === CharLevelState.rSqEnt ? '\'' : charType === CharLevelState.lDq || charType === CharLevelState.rDqEnt ? '"' : undefined;
		// the offsets of the decoded characters, for the length of quotes that are references
		const decoded = RecordTypes.decodeReferences(literal.value);
		if (!quote || decoded.text.length < 2) {
			return undefined;
		}
		const text = document.getText();
		const tokenOffset = (t: BaseToken) => document.offsetAt(new vscode.Position(t.line, t.startCharacter));
		let attributeQuote: string | undefined;
		for (let i = index - 1; i > -1; i--) {
			const t = allTokens[i];
			if (t.tokenType >= EnumValueReferences.xsltStartTokenNumber) {
				// the attribute's opening quote is an attributeValue token
				const quoteChar = text.charAt(tokenOffset(t));
				if (t.tokenType - EnumValueReferences.xsltStartTokenNumber === XSLTokenLevelState.attributeValue && (quoteChar === '"' || quoteChar === '\'')) {
					attributeQuote = quoteChar;
				}
				break;
			}
		}
		const start = tokenOffset(literal);
		const range = new vscode.Range(document.positionAt(start + decoded.offsets[1]), document.positionAt(start + decoded.offsets[decoded.text.length - 1]));
		return { location: new vscode.Location(document.uri, range), quote, attributeQuote };
	}

	private static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();

	private static itemTypeMap(context: DocumentContext) {
		const map = new Map<string, string>();
		context.itemTypes.forEach((itemType) => {
			if (itemType.declaredType && !map.has(itemType.name)) {
				map.set(itemType.name, itemType.declaredType);
			}
		});
		return map;
	}

	// the enumeration value references found by the linter in the document, and its tokens
	private static async documentEnums(definitionProvider: XsltDefinitionProvider, context: DocumentContext, cached?: EnumValueReference[]): Promise<DocumentEnums> {
		const { allTokens } = await definitionProvider.getImportedGlobals(context.document, RecordFieldReferences.startPosition());
		if (!cached) {
			await RecordFieldReferences.lint(definitionProvider, context);
		}
		const uri = context.document.uri.toString();
		return { context, allTokens, references: cached ?? XsltTokenDiagnostics.enumValueReferences.get(uri) ?? [], itemTypeAsRanges: XsltTokenDiagnostics.itemTypeAsRanges.get(uri) ?? [] };
	}
}
