/**
 * XPath 4.0 record fields: find references and rename, for a field of a record type - declared in a record(...) type,
 * e.g. in an xsl:item-type or an 'as' attribute - from the field's name in its declaration, from a reference, e.g. 'r'
 * in $c?r, a map constructor key or an xsl:map-entry key, or from an @field tag in a documentation note.
 *
 * A field is identified by the document and offset of its name in its declaration. The references are those that the
 * linter records - and the @field tags for the field in the notes of the xsl:item-type declaring it, and of item types
 * declared as that one, e.g. as="cx:point". They're found in the document and the modules it includes or imports - and,
 * from the index of the workspace's modules, in each top-level stylesheet that imports or includes the document, directly
 * or indirectly, and the modules of its tree - so a rename in a module of types reaches the stylesheets that use them.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as url from 'url';
import { XSLTConfiguration } from './languageConfigurations';
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { LexPosition } from './xpLexer';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { FieldReference, RecordTypes } from './recordTypes';
import { XdocNotes } from './xdocNote';
import { ImportIndex } from './importIndex';
import { ItemTypeSupport } from './itemTypeSupport';

// a field's declaration: the document, and the offset of its name
interface FieldDeclaration {
	uri: string;
	offset: number;
}

export interface FieldLocations {
	name: string;
	// the name at the position
	range: vscode.Range;
	locations: vscode.Location[];
}

// a document with the item type declarations in scope for it
interface DocumentContext {
	document: vscode.TextDocument;
	itemTypes: GlobalInstructionData[];
}

export class RecordFieldReferences {

	// the field at the position, with all its locations - undefined if there's no field at the position
	public static async find(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<FieldLocations | undefined> {
		const definitionProvider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
		const context = await RecordFieldReferences.documentContext(definitionProvider, document);
		if (!context || token.isCancellationRequested) {
			return undefined;
		}
		const cached = XsltTokenDiagnostics.recordFieldReferences.get(document.uri.toString());
		const target = RecordFieldReferences.fieldAt(context, cached ?? await RecordFieldReferences.fieldReferences(definitionProvider, context), position);
		if (!target) {
			return undefined;
		}
		const { name, declaration, range } = target;
		const locations: vscode.Location[] = [];
		const add = (doc: vscode.TextDocument, offset: number) => {
			const start = doc.positionAt(offset);
			const location = new vscode.Location(doc.uri, new vscode.Range(start, start.translate(0, name.length)));
			if (!locations.some((l) => l.uri.toString() === location.uri.toString() && l.range.isEqual(location.range))) {
				locations.push(location);
			}
		};
		const hrefs = (await definitionProvider.getImportedGlobals(document, RecordFieldReferences.startPosition())).accumulatedHrefs;
		const contexts = [context];
		for (const href of await RecordFieldReferences.scopeModules(document, hrefs)) {
			try {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(url.pathToFileURL(href).toString()));
				// a module without the name has nothing to rename - unless it declares the field, e.g. with a quoted name
				if (!doc.getText().includes(name) && doc.uri.toString() !== declaration.uri) {
					continue;
				}
				const docContext = await RecordFieldReferences.documentContext(definitionProvider, doc);
				if (docContext) {
					contexts.push(docContext);
				}
			} catch (error) {
				console.error(error);
			}
			if (token.isCancellationRequested) {
				return undefined;
			}
		}
		for (const docContext of contexts) {
			const doc = docContext.document;
			const text = doc.getText();
			if (doc.uri.toString() === declaration.uri) {
				add(doc, declaration.offset);
			}
			const references = docContext === context && cached ? cached : await RecordFieldReferences.fieldReferences(definitionProvider, docContext);
			references.filter((ref) => ref.field.name === name && RecordFieldReferences.sameDeclaration(RecordFieldReferences.referenceDeclaration(docContext, ref), declaration)).forEach((ref) => {
				const tokenOffset = doc.offsetAt(new vscode.Position(ref.token.line, ref.token.startCharacter));
				// within any quotes, or get('...')
				const nameIndex = ref.token.value.indexOf(name);
				add(doc, tokenOffset + (nameIndex > -1 ? nameIndex : 0));
			});
			// the @field tags in the notes of the item types declared in this document
			docContext.itemTypes.filter((itemType) => RecordFieldReferences.isDeclaredIn(itemType, doc)).forEach((itemType) => {
				if (!RecordFieldReferences.sameDeclaration(RecordFieldReferences.namedFieldDeclaration(docContext, itemType.name, name), declaration)) {
					return;
				}
				const tagStart = text.lastIndexOf('<', doc.offsetAt(new vscode.Position(itemType.token.line, itemType.token.startCharacter)));
				XdocNotes.forDeclaration(text, tagStart)?.tags.filter((tag) => tag.name === 'field' && tag.fieldName === name && tag.fieldOffset !== undefined)
					.forEach((tag) => add(doc, tag.fieldOffset!));
			});
		}
		return { name, range, locations };
	}

	// the other modules to search: those the document includes or imports (hrefs) - and from the index of the workspace's
	// modules, each top-level stylesheet that imports or includes the document, with all the modules of its tree
	private static async scopeModules(document: vscode.TextDocument, hrefs: string[]): Promise<string[]> {
		const modules = new Set<string>(hrefs.concat((await ImportIndex.moduleTrees(document)).flat()));
		modules.delete(document.fileName);
		return [...modules].filter((file) => fs.existsSync(file));
	}

	// a field name for a rename: an NCName - or, for a field whose name isn't one, and so is always quoted, any name
	// without quotes - undefined if it's valid, otherwise why not
	public static invalidName(oldName: string, newName: string): string | undefined {
		const isNCName = (name: string) => /^[A-Za-z_][\w.-]*$/.test(name);
		if (isNCName(newName)) {
			return undefined;
		} else if (isNCName(oldName)) {
			return `new name is not an NCName: '${newName}' - a field name that isn't one must be quoted`;
		}
		return newName.length === 0 || /['"\n]/.test(newName) ? `new name is invalid: '${newName}'` : undefined;
	}

	// the field at the position: a reference to it, its name in a record type, or the name after an @field tag
	private static fieldAt(context: DocumentContext, references: FieldReference[], position: vscode.Position): { name: string, declaration: FieldDeclaration, range: vscode.Range } | undefined {
		const document = context.document;
		const text = document.getText();
		const offset = document.offsetAt(position);
		const within = (start: number, name: string) => offset >= start && offset <= start + name.length;
		const result = (name: string, declaration: FieldDeclaration | undefined, start: number) => declaration ?
			{ name, declaration, range: new vscode.Range(document.positionAt(start), document.positionAt(start + name.length)) } : undefined;
		const reference = references.find((ref) => ref.token.line === position.line && position.character >= ref.token.startCharacter && position.character <= ref.token.startCharacter + ref.token.length);
		if (reference) {
			const nameIndex = reference.token.value.indexOf(reference.field.name);
			const start = document.offsetAt(new vscode.Position(reference.token.line, reference.token.startCharacter)) + (nameIndex > -1 ? nameIndex : 0);
			return result(reference.field.name, RecordFieldReferences.referenceDeclaration(context, reference), start);
		}
		// the name of a field in a record type, in an 'as' attribute
		const tagStart = text.lastIndexOf('<', offset);
		const asOffset = tagStart > -1 ? RecordTypes.attributeValueOffset(text, tagStart + 1, 'as') : undefined;
		const asText = tagStart > -1 ? RecordTypes.attributeOfElementAt(text, tagStart + 1, 'as', true) : undefined;
		if (asOffset !== undefined && asText !== undefined && offset >= asOffset && offset <= asOffset + asText.length) {
			const field = RecordTypes.recordFieldDeclarations(asText, asOffset).find((f) => f.nameOffset !== undefined && within(f.nameOffset, f.name));
			return field ? result(field.name, { uri: document.uri.toString(), offset: field.nameOffset! }, field.nameOffset!) : undefined;
		}
		// the name after an @field tag, in the documentation note of an xsl:item-type
		const markup = RecordTypes.blankMarkup(text);
		for (const noteOffset of XdocNotes.noteOffsets(text)) {
			const tag = XdocNotes.parseNote(text, markup, noteOffset)?.tags.find((t) => t.name === 'field' && t.fieldName !== undefined && t.fieldOffset !== undefined && within(t.fieldOffset, t.fieldName));
			if (tag) {
				const ancestors = RecordTypes.openElements(markup, noteOffset);
				const itemType = ancestors[ancestors.length - 1];
				const typeName = itemType?.name === 'xsl:item-type' ? RecordTypes.attributeOfElementAt(text, itemType.offset + 1, 'name') : undefined;
				return typeName ? result(tag.fieldName!, RecordFieldReferences.namedFieldDeclaration(context, typeName, tag.fieldName!), tag.fieldOffset!) : undefined;
			}
		}
		return undefined;
	}

	// the declaration of the field of a reference: in the reference's document when the linter found the offset of the
	// field's name - otherwise, in the item type declaration of its named record type
	private static referenceDeclaration(context: DocumentContext, reference: FieldReference): FieldDeclaration | undefined {
		if (reference.field.nameOffset !== undefined) {
			return { uri: context.document.uri.toString(), offset: reference.field.nameOffset };
		}
		return /^[\w.-]+(:[\w.-]+)?$/.test(reference.record.name) ? RecordFieldReferences.namedFieldDeclaration(context, reference.record.name, reference.field.name) : undefined;
	}

	// the declaration of a field of a named record type: in its xsl:item-type - or in that of the item type it's declared
	// as, e.g. cx:point for <xsl:item-type name="cx:location" as="cx:point"/> - in this document or another module
	private static namedFieldDeclaration(context: DocumentContext, typeName: string, fieldName: string): FieldDeclaration | undefined {
		let name = typeName;
		for (let depth = 0; depth < 10; depth++) {
			const itemType = context.itemTypes.find((g) => g.name === name);
			if (!itemType) {
				return undefined;
			}
			let text: string;
			try {
				text = itemType.href ? fs.readFileSync(itemType.href, 'utf8') : context.document.getText();
			} catch {
				return undefined;
			}
			const tagStart = text.lastIndexOf('<', XdocNotes.offsetAt(text, itemType.token.line, itemType.token.startCharacter));
			const asOffset = tagStart > -1 ? RecordTypes.attributeValueOffset(text, tagStart + 1, 'as') : undefined;
			const asText = tagStart > -1 ? RecordTypes.attributeOfElementAt(text, tagStart + 1, 'as', true) : undefined;
			if (asOffset === undefined || asText === undefined) {
				return undefined;
			}
			if (/^\s*[\w.-]+(:[\w.-]+)?\s*$/.test(asText)) {
				name = asText.trim();
				continue;
			}
			const field = RecordTypes.resolve(asText, new Map(), 0, asOffset)?.fields.find((f) => f.name === fieldName);
			const uri = itemType.href ? vscode.Uri.parse(url.pathToFileURL(itemType.href).toString()).toString() : context.document.uri.toString();
			return field?.nameOffset !== undefined ? { uri, offset: field.nameOffset } : undefined;
		}
		return undefined;
	}

	private static sameDeclaration(a: FieldDeclaration | undefined, b: FieldDeclaration) {
		return !!a && a.uri === b.uri && a.offset === b.offset;
	}

	private static isDeclaredIn(itemType: GlobalInstructionData, document: vscode.TextDocument) {
		return itemType.href ? itemType.href === document.fileName : true;
	}

	private static startPosition(): LexPosition {
		return { line: 0, startCharacter: 0, documentOffset: 0 };
	}

	// the document, with the item types declared in it and in the modules it includes or imports - undefined if it's not
	// a stylesheet module with item types: XSLT 4.0, or an earlier version with the setting (see ItemTypeSupport)
	private static async documentContext(definitionProvider: XsltDefinitionProvider, document: vscode.TextDocument): Promise<DocumentContext | undefined> {
		if (!ItemTypeSupport.isEnabledForText(document.getText(new vscode.Range(0, 0, 50, 0)))) {
			return undefined;
		}
		const { globalInstructionData, allImportedGlobals } = await definitionProvider.getImportedGlobals(document, RecordFieldReferences.startPosition());
		// the globals declared in the document itself have no href
		return { document, itemTypes: globalInstructionData.concat(allImportedGlobals).filter((g) => g.type === GlobalInstructionType.ItemType) };
	}

	// the record field references in a document, found by the linter
	private static async fieldReferences(definitionProvider: XsltDefinitionProvider, context: DocumentContext): Promise<FieldReference[]> {
		const { allTokens, globalInstructionData, allImportedGlobals } = await definitionProvider.getImportedGlobals(context.document, RecordFieldReferences.startPosition());
		const isVersion4 = ItemTypeSupport.isVersion4Text(context.document.getText());
		XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, context.document, allTokens, globalInstructionData, allImportedGlobals, []);
		return XsltTokenDiagnostics.recordFieldReferences.get(context.document.uri.toString()) ?? [];
	}
}
