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
import { BaseToken } from './xpLexer';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { EnumValueReference, ItemTypeAsRange, RecordTypes } from './recordTypes';
import { DocumentContext, RecordFieldReferences } from './recordFieldReferences';

export interface EnumValueLocations {
	value: string;
	// the value at the position
	range: vscode.Range;
	// the value within the quotes of each literal
	locations: vscode.Location[];
	// the literals that can't be renamed in place: written with doubled quotes or character references, e.g. &quot;
	escaped: vscode.Location[];
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
		const result: EnumValueLocations = { value, range: target.range, locations: [], escaped: [], typeValues: [] };
		const add = (doc: vscode.TextDocument, literal: BaseToken) => {
			const location = EnumValueReferences.valueLocation(doc, literal, value);
			const list = location ? result.locations : result.escaped;
			const added = location ?? new vscode.Location(doc.uri, EnumValueReferences.tokenRange(doc, literal));
			if (!list.some((l) => l.uri.toString() === added.uri.toString() && l.range.isEqual(added.range))) {
				list.push(added);
			}
		};
		const hrefs = (await definitionProvider.getImportedGlobals(document, RecordFieldReferences.startPosition())).accumulatedHrefs;
		const all = [documentEnums];
		// a value with no characters that may be escaped is written as it is in each module that refers to it
		const isPlain = !/['"&<>]/.test(value);
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
			enums.references.filter((ref) => ref.value === value && EnumValueReferences.referenceKey(enums.context, ref) === key).forEach((ref) => add(doc, ref.token));
			EnumValueReferences.declarations(enums).filter((declaration) => declaration.key === key).forEach((declaration) => {
				declaration.enumLiterals.literals.filter((literal) => literal.value === value).forEach((literal) => add(doc, literal.token));
				result.typeValues.push(...declaration.enumLiterals.values.filter((v) => !result.typeValues.includes(v)));
			});
		}
		return result;
	}

	// a new value for a rename: undefined if it's valid, otherwise why not
	public static invalidValue(locations: EnumValueLocations, newValue: string): string | undefined {
		if (newValue.length === 0 || /['"&<\r\n]/.test(newValue)) {
			return `new value is invalid: '${newValue}' - an enumeration value can't be renamed to one with quotes, '&', '<' or a new line`;
		} else if (newValue !== locations.value && locations.typeValues.includes(newValue)) {
			return `'${newValue}' is already a value of the enumeration type`;
		} else if (locations.escaped.length > 0) {
			const where = locations.escaped.map((l) => `${vscode.workspace.asRelativePath(l.uri)}:${l.range.start.line + 1}`).join(', ');
			return `'${locations.value}' is written with doubled quotes or character references at ${where} - rename it there first`;
		}
		return undefined;
	}

	// the enumeration value at the position: a reference to it, or a value in an enum(...) declaration - with its key
	private static valueAt(enums: DocumentEnums, position: vscode.Position): { value: string, key: string, range: vscode.Range } | undefined {
		const document = enums.context.document;
		const isAt = (t: BaseToken) => t.line === position.line && position.character >= t.startCharacter && position.character <= t.startCharacter + t.length;
		const result = (value: string, key: string | undefined, literal: BaseToken) => key ?
			{ value, key, range: EnumValueReferences.valueLocation(document, literal, value)?.range ?? EnumValueReferences.tokenRange(document, literal) } : undefined;
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

	// the range of the value within the quotes of the literal - undefined if it's written with doubled quotes or references
	private static valueLocation(document: vscode.TextDocument, literal: BaseToken, value: string): vscode.Location | undefined {
		const quote = literal.value.charAt(0);
		const isQuoted = (quote === '\'' || quote === '"') && literal.value.length > 1 && literal.value.endsWith(quote);
		if (!isQuoted || literal.value.substring(1, literal.value.length - 1) !== value) {
			return undefined;
		}
		const start = document.offsetAt(new vscode.Position(literal.line, literal.startCharacter)) + 1;
		return new vscode.Location(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(start + value.length)));
	}

	private static tokenRange(document: vscode.TextDocument, literal: BaseToken) {
		const start = document.offsetAt(new vscode.Position(literal.line, literal.startCharacter));
		return new vscode.Range(document.positionAt(start), document.positionAt(start + literal.length));
	}

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
