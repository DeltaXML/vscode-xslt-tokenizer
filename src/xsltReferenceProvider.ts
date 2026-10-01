import * as vscode from 'vscode';
import { XSLTnamespaces, FunctionData } from './functionData';
import { XSLTConfiguration } from './languageConfigurations';
import { SchemaQuery } from './schemaQuery';
import { LexPosition, BaseToken, CharLevelState, Data, ErrorType, TokenLevelState, XPathLexer } from './xpLexer';
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, LanguageConfiguration, XMLCharState, XslLexer, XSLTokenLevelState } from './xslLexer';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { DefinitionData, DefinitionLocation, XsltTokenDefinitions } from './xsltTokenDefintions';
import { AttributeType, TagType, XSLTToken, XsltTokenDiagnostics, ElementData, XPathData, VariableData, ValidationType, CurlyBraceType } from './xsltTokenDiagnostics';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { RecordTypes } from './recordTypes';
import { XdocNotes } from './xdocNote';
import { FieldLocations, RecordFieldReferences } from './recordFieldReferences';
import { ImportIndex } from './importIndex';
import { XdocReferences } from './xdocReferences';

// an xsl:function or named xsl:template, for a rename of it or of one of its parameters - with, for a function, the
// numbers of arguments it can be called with
interface OverridableDeclaration {
	elementName: string;
	name: string;
	file: string;
	isParam: boolean;
	arity?: [number, number];
}

export class XSLTReferenceProvider implements vscode.ReferenceProvider, vscode.RenameProvider {

	private xslLexer: XslLexer;
	private definition: DefinitionLocation | undefined = undefined;
	private definitionData: DefinitionData | undefined = undefined;
	private refLocations: vscode.Location[] = [];
	// XPath 4.0: the record field being renamed
	private fieldLocations: FieldLocations | undefined = undefined;
	// the modules with another declaration of the function or template being renamed, or whose parameter is
	private renameConflicts: { declaration: OverridableDeclaration, files: string[] } | undefined = undefined;
	public constructor() {
		this.xslLexer = new XslLexer(XSLTConfiguration.configuration);
		this.xslLexer.provideCharLevelState = true;
	}

	async prepareRename(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Range | undefined> {
		let wse: vscode.WorkspaceEdit | undefined;
		// XPath 4.0: a record field
		this.fieldLocations = await RecordFieldReferences.find(document, position, token);
		if (this.fieldLocations) {
			return this.fieldLocations.range;
		}

		const refContext = { includeDeclaration: true };
		// this call also sets this.definition + this.definitionData:
		const references = await this.provideReferences(document, position, refContext, token);
		if (references) {
			this.refLocations = references;
		}
		// another declaration of a function or template with the same name may override it, or be overridden by it: the
		// rename would change which one is called
		if (this.renameConflicts) {
			const { declaration, files } = this.renameConflicts;
			const kind = declaration.elementName === 'xsl:function' ? 'function' : 'template';
			const renamed = declaration.isParam ? `a parameter of the ${kind} ${declaration.name}` : `the ${kind} ${declaration.name}`;
			return new Promise((resolve, reject) => reject(`XSLT: ${declaration.name} is also declared in ${files.map((file) => path.basename(file)).join(', ')}, where it may override this ${kind}, or be overridden by it - so renaming ${renamed} could change which ${kind} is called`));
		}
		let initialRange: vscode.Range | undefined;
		if (this.definitionData) {
			const isDefinitionAtPosition = !(this.definitionData.inputSymbol);
			const tokenAtPosition = this.definitionData.inputSymbol ? this.definitionData.inputSymbol.token : this.definitionData.definitionLocation?.instruction?.token;
			if (tokenAtPosition) {
				let tStart = tokenAtPosition.startCharacter;
				let tLength = tokenAtPosition.length;
				if (isDefinitionAtPosition) {
					if (XSLTReferenceProvider.isTokenQuoted(tokenAtPosition) && tokenAtPosition.length > 2) {
						tStart++;
						tLength = tokenAtPosition.length - 2;
					} else if (XSLTReferenceProvider.isTokenVariable(tokenAtPosition)) {
						tStart++;
						tLength = tokenAtPosition.length - 1;
					}
				} else if (XSLTReferenceProvider.isTokenQuoted(tokenAtPosition) && tokenAtPosition.length > 2) {
					tStart++;
					tLength = tokenAtPosition.length - 2;
				} else if (XSLTReferenceProvider.isTokenVariable(tokenAtPosition)) {
					tStart++;
					tLength = tokenAtPosition.length - 1;
				}
				initialRange = XsltTokenDefinitions.createRangeFromTokenVals(tokenAtPosition.line, tStart, tLength);
			}
		}
		if (initialRange) {
			return initialRange;
		} else {
			return new Promise((resolve, reject) => reject('unsupported symbol'));
		}
	}

	async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit | undefined> {
		if (this.fieldLocations) {
			const invalid = RecordFieldReferences.invalidName(this.fieldLocations.name, newName);
			if (invalid) {
				return new Promise((resolve, reject) => reject(invalid));
			}
			const fieldEdit = new vscode.WorkspaceEdit();
			this.fieldLocations.locations.forEach((location) => fieldEdit.replace(location.uri, location.range, newName));
			return fieldEdit;
		}
		// check that name is valid
		let newNameIsValid = XsltTokenDiagnostics.validateSimpleName(newName);
		if (!newNameIsValid || !this.definition) {
			return new Promise((resolve, reject) => reject('new name is invalid: \'' + newName + '\''));
		}
		let newNameInUse = false;

		const wse = new vscode.WorkspaceEdit();
		this.refLocations.forEach(location => {
			wse.replace(location.uri, location.range, newName);
		});
		return wse;
	}

	public static isTokenQuoted(tokenAtPosition: BaseToken) {
		let isXMLToken = tokenAtPosition.tokenType >= XsltTokenDefinitions.xsltStartTokenNumber;
		let isQuoted = false;
		if (isXMLToken) {
			isQuoted = true;
		} else {
			let xpathTokenType = <TokenLevelState>tokenAtPosition.tokenType;
			isQuoted = xpathTokenType === TokenLevelState.string;
		}
		return isQuoted;
	}

	public static isTokenVariable(tokenAtPosition: BaseToken) {
		let isXMLToken = tokenAtPosition.tokenType >= XsltTokenDefinitions.xsltStartTokenNumber;
		let isVariable = false;

		if (!isXMLToken) {
			let xpathTokenType = <TokenLevelState>tokenAtPosition.tokenType;
			isVariable = xpathTokenType === TokenLevelState.variable;
		}
		return isVariable;
	}

	async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[] | null | undefined> {
		this.renameConflicts = undefined;
		// XPath 4.0: a record field - its declaration, references and @field tags
		const field = await RecordFieldReferences.find(document, position, token);
		if (field) {
			return field.locations;
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const langConfig = XSLTConfiguration.configuration;
		// TODO: first check if position is on a definition already
		const dProvider = new XsltDefinitionProvider(langConfig);
		this.definitionData = await dProvider.seekDefinition(document, position, token);
		this.definition = this.definitionData?.definitionLocation;
		let locations: vscode.Location[] = [];
		if (this.definition) {
			const { instruction, extractedImportData: eid } = this.definition;
			if (instruction && eid) {
				// find all references to this instruction
				let refTokens = XSLTReferenceProvider.calculateReferences(instruction, langConfig, langConfig.docType, document, eid.allTokens, eid.globalInstructionData, eid.allImportedGlobals);
				const refLocations = refTokens.map(token => XsltTokenDefinitions.createLocationFromToken(token, document));
				locations = refLocations;
				locations.push(this.definition);
				// XSLT 4.0: references in documentation notes, e.g. @see my:area#2
				const globals = eid.globalInstructionData.concat(eid.allImportedGlobals);
				const definition = this.definition;
				locations = locations.concat(XSLTReferenceProvider.noteReferences(document, document, definition, globals));
				// for a function or named template, or a parameter of one: the other declarations with the same name, which
				// prevent a rename - and the modules of an inferred top-level stylesheet with one, which aren't searched
				const declaration = await XSLTReferenceProvider.overridableDeclaration(this.definition, document);
				const declarationDocument = declaration ? await vscode.workspace.openTextDocument(this.definition.uri) : undefined;
				const conflicts = declaration && declarationDocument ? await XSLTReferenceProvider.conflictingModules(declaration, declarationDocument, document, eid.accumulatedHrefs) : [];
				this.renameConflicts = declaration && conflicts.length > 0 ? { declaration, files: conflicts } : undefined;
				const overridden = declaration ? await XSLTReferenceProvider.overriddenModules(declaration, document, eid.accumulatedHrefs) : new Set<string>();
				// for a parameter of a function or template: its @param in a documentation note, and keyword arguments
				const hrefs = [document.fileName].concat(eid.accumulatedHrefs.filter((href) => href !== document.fileName && !overridden.has(href)));
				const parameterLocations = await this.parameterReferences(this.definition, document, eid.allTokens, hrefs, declaration);
				locations = locations.concat(parameterLocations.filter((p) => !locations.some((l) => l.uri.toString() === p.uri.toString() && l.range.isEqual(p.range))));
				// for a function or named template: its calls in the other stylesheets that use it
				const otherModules = declaration && declarationDocument && !declaration.isParam ?
					(await XSLTReferenceProvider.usingModules(declarationDocument, declaration)).filter((file) => !eid.accumulatedHrefs.includes(file)) : [];
				const searchedModules = eid.accumulatedHrefs.concat(otherModules);
				for (let index = 0; index < searchedModules.length; index++) {
					const currentHref = searchedModules[index];
					// not a missing module, e.g. an import that isn't found - VS Code logs an error for it
					if (currentHref === document.fileName || !fs.existsSync(currentHref) || overridden.has(currentHref)) {
						continue;
					}
					try {
						const pathForUri = url.pathToFileURL(currentHref).toString();
						const docUri = vscode.Uri.parse(pathForUri);
						let hrefDoc = await vscode.workspace.openTextDocument(docUri);
						const hrefAllTokens = this.xslLexer.analyse(hrefDoc.getText());
						let refDocTokens = XSLTReferenceProvider.calculateReferences(instruction, langConfig, langConfig.docType, hrefDoc, hrefAllTokens, eid.globalInstructionData, eid.allImportedGlobals);
						const refLocations = refDocTokens.map(token => XsltTokenDefinitions.createLocationFromToken(token, hrefDoc));
						locations = locations.concat(refLocations, XSLTReferenceProvider.noteReferences(hrefDoc, document, definition, globals));
					} catch (error) {
						console.error(error);
					}
				}
			}
		}
		return new Promise(resolve => {
			this.refLocations = locations;
			resolve(locations);
		});
	}

	// XSLT 4.0: the references in the documentation notes of a module (noteDocument) to the declaration at the definition,
	// e.g. @see my:area#2 - resolved with the globals of the document, which has the declarations without an href
	private static noteReferences(noteDocument: vscode.TextDocument, document: vscode.TextDocument, definition: vscode.Location, globals: GlobalInstructionData[]): vscode.Location[] {
		const text = noteDocument.getText();
		const markup = RecordTypes.blankMarkup(text);
		const isDefinition = (global: GlobalInstructionData) => {
			const location = XsltTokenDefinitions.createLocationFromInstruction(global, document);
			return !!location && location.uri.toString() === definition.uri.toString() && location.range.start.line === definition.range.start.line &&
				Math.abs(location.range.start.character - definition.range.start.character) <= 1;
		};
		return XdocReferences.find(text, markup).filter((reference) => XdocReferences.resolve(reference, globals, text, markup).some((target) => target.global && isDefinition(target.global))).map((reference) => {
			const start = noteDocument.positionAt(reference.offset);
			return new vscode.Location(noteDocument.uri, new vscode.Range(start, start.translate(0, reference.name.length)));
		});
	}

	// XSLT 4.0: for a global xsl:param or xsl:variable, the name in its @param or @variable in the module note - and for a
	// parameter of an xsl:function or xsl:template, the name in its @param in the declaration's
	// documentation note - and for a function parameter, keyword arguments for it in calls of the function, e.g.
	// scale := 2 in ex:area(2, 3, scale := 2) - in the document and the modules it includes or imports (hrefs), and in the
	// other stylesheets that use the declaration (see usingModules) - where, for a template parameter, the xsl:with-param
	// names in calls of the template are found too, as the other references are only found in the hrefs
	private async parameterReferences(definition: vscode.Location, document: vscode.TextDocument, documentTokens: BaseToken[], hrefs: string[], declaration: OverridableDeclaration | undefined): Promise<vscode.Location[]> {
		const declarationDocument = definition.uri.toString() === document.uri.toString() ? document : await vscode.workspace.openTextDocument(definition.uri);
		const text = declarationDocument.getText();
		const tagStart = text.lastIndexOf('<', declarationDocument.offsetAt(definition.range.start));
		const markup = RecordTypes.blankMarkup(text);
		// a global xsl:param or xsl:variable: its @param or @variable in the module note
		const globalElement = tagStart > -1 ? /^<(xsl:param|xsl:variable)\s/.exec(text.substring(tagStart, tagStart + 14))?.[1] : undefined;
		if (globalElement && XdocNotes.isGlobal(markup, tagStart)) {
			const globalName = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'name');
			const tagName = globalElement === 'xsl:param' ? 'param' : 'variable';
			return (XdocNotes.moduleNote(text, markup)?.tags ?? []).filter((tag) => tag.name === tagName && tag.paramName === globalName && tag.paramOffset !== undefined).map((tag) => {
				const start = declarationDocument.positionAt(tag.paramOffset!);
				return new vscode.Location(declarationDocument.uri, new vscode.Range(start, start.translate(0, globalName!.length)));
			});
		}
		const paramName = tagStart > -1 && /^<xsl:param\s/.test(text.substring(tagStart, tagStart + 11)) ? RecordTypes.attributeOfElementAt(text, tagStart + 1, 'name') : undefined;
		const ancestors = paramName ? RecordTypes.openElements(markup, tagStart) : [];
		const parent = ancestors[ancestors.length - 1];
		if (!paramName || !parent || (parent.name !== 'xsl:function' && parent.name !== 'xsl:template')) {
			return [];
		}
		const locations: vscode.Location[] = [];
		const nameLocation = (doc: vscode.TextDocument, offset: number) => {
			const start = doc.positionAt(offset);
			return new vscode.Location(doc.uri, new vscode.Range(start, start.translate(0, paramName.length)));
		};
		XdocNotes.forDeclaration(text, parent.offset, markup)?.tags
			.filter((tag) => tag.name === 'param' && tag.paramName === paramName && tag.paramOffset !== undefined)
			.forEach((tag) => locations.push(nameLocation(declarationDocument, tag.paramOffset!)));
		// references to the parameter in the note, e.g. `$scale`
		XdocReferences.find(text, markup).filter((reference) => reference.kind === 'variable' && reference.declarationOffset === parent.offset && XdocReferences.resolve(reference, [], text, markup)[0]?.paramOffset === tagStart)
			.forEach((reference) => locations.push(nameLocation(declarationDocument, reference.offset)));
		const declarationName = RecordTypes.attributeOfElementAt(text, parent.offset + 1, 'name');
		const otherModules = declarationName && declaration ? (await XSLTReferenceProvider.usingModules(declarationDocument, declaration)).filter((file) => !hrefs.includes(file)) : [];
		const openModule = async (href: string) => {
			try {
				return href === document.fileName ? document : await vscode.workspace.openTextDocument(vscode.Uri.parse(url.pathToFileURL(href).toString()));
			} catch (error) {
				return undefined;
			}
		};
		if (parent.name !== 'xsl:function') {
			// the xsl:with-param names in calls of the template, in the other stylesheets
			for (const href of otherModules) {
				const doc = await openModule(href);
				const docText = doc?.getText() ?? '';
				if (!doc || !docText.includes(paramName)) {
					continue;
				}
				const docMarkup = RecordTypes.blankMarkup(docText);
				for (const call of docMarkup.matchAll(/<xsl:call-template\s/g)) {
					if (RecordTypes.attributeOfElementAt(docText, call.index! + 1, 'name') !== declarationName) {
						continue;
					}
					RecordTypes.childElements(docText, docMarkup, call.index!, 'xsl:with-param').forEach((withParam) => {
						const nameOffset = RecordTypes.attributeValueOffset(docText, withParam + 1, 'name');
						if (nameOffset !== undefined && RecordTypes.attributeOfElementAt(docText, withParam + 1, 'name') === paramName) {
							locations.push(nameLocation(doc, nameOffset));
						}
					});
				}
			}
			return locations;
		}
		// the calls of the function that its arity allows - the parameters with required="no" are optional, and the
		// arity of a call with an arrow operator doesn't include the implicit first argument
		const functionName = RecordTypes.attributeOfElementAt(text, parent.offset + 1, 'name');
		const params = RecordTypes.childElements(text, markup, parent.offset, 'xsl:param');
		const requiredCount = params.filter((offset) => !['no', 'false', '0'].includes((RecordTypes.attributeOfElementAt(text, offset + 1, 'required') ?? '').trim())).length;
		for (const href of hrefs.concat(otherModules)) {
			if (href !== document.fileName && !fs.existsSync(href)) {
				continue;
			}
			const doc = await openModule(href);
			if (!doc) {
				continue;
			}
			const tokens = (doc === document ? documentTokens : this.xslLexer.analyse(doc.getText())).filter((t) => t.tokenType < XsltTokenDefinitions.xsltStartTokenNumber);
			tokens.forEach((t, index) => {
				if (t.tokenType !== TokenLevelState.mapKey || t.value !== paramName || tokens[index + 1]?.value !== ':=') {
					return;
				}
				const call = RecordTypes.callArgument(tokens, index + 2);
				if (call && call.name === functionName && (call.arity === undefined || (call.arity <= params.length && call.arity + 1 >= requiredCount))) {
					locations.push(XsltTokenDefinitions.createLocationFromToken(t, doc));
				}
			});
		}
		return locations;
	}

	// from the index of the workspace's modules, the modules of the trees of the top-level stylesheets that import or
	// include the module declaring a function or named template - except a tree in which another module declares one
	// with the same name, e.g. to override it with import precedence, as its calls may be of that one
	private static async usingModules(declarationDocument: vscode.TextDocument, declaration: OverridableDeclaration): Promise<string[]> {
		const modules = new Set<string>();
		for (const tree of await ImportIndex.moduleTrees(declarationDocument)) {
			if (!tree.some((file) => file !== declaration.file && XSLTReferenceProvider.declares(file, declaration))) {
				tree.forEach((file) => modules.add(file));
			}
		}
		return [...modules];
	}

	// the modules, other than the one declaring it, with a declaration of a function or template with the same name - and
	// for a function, an arity in common - in the document's modules (hrefs), and in the trees of the stylesheets that use
	// the declaring module
	private static async conflictingModules(declaration: OverridableDeclaration, declarationDocument: vscode.TextDocument, document: vscode.TextDocument, hrefs: string[]): Promise<string[]> {
		const scope = new Set<string>([document.fileName].concat(hrefs, (await ImportIndex.moduleTrees(declarationDocument)).flat()));
		return [...scope].filter((file) => file !== declaration.file && fs.existsSync(file) && XSLTReferenceProvider.declares(file, declaration)).sort();
	}

	// for a function or named template, or a parameter of one: the modules searched (hrefs) that aren't the document's
	// own imports and includes, but those of the top-level stylesheet inferred for it - when one of them declares a
	// function or template with the same name, which may override it, so that their calls may not be of this one
	private static async overriddenModules(declaration: OverridableDeclaration, document: vscode.TextDocument, hrefs: string[]): Promise<Set<string>> {
		// the document's own tree, from the hrefs in its text and in those of the modules it imports or includes
		const ownTree = new Set<string>();
		const addTree = (file: string, text: string) => {
			if (ownTree.has(file)) {
				return;
			}
			ownTree.add(file);
			ImportIndex.moduleReferences(text, file).forEach((reference) => addTree(reference.path, XSLTReferenceProvider.moduleText(reference.path)));
		};
		addTree(document.fileName, document.getText());
		const inferred = hrefs.filter((href) => !ownTree.has(href) && href !== declaration.file);
		return inferred.some((file) => XSLTReferenceProvider.declares(file, declaration)) ? new Set(inferred) : new Set();
	}

	// the xsl:function or named xsl:template at the definition, or the one with the xsl:param at the definition
	private static async overridableDeclaration(definition: vscode.Location, document: vscode.TextDocument): Promise<OverridableDeclaration | undefined> {
		const declarationDocument = definition.uri.toString() === document.uri.toString() ? document : await vscode.workspace.openTextDocument(definition.uri);
		const text = declarationDocument.getText();
		const markup = RecordTypes.blankMarkup(text);
		const tagStart = text.lastIndexOf('<', declarationDocument.offsetAt(definition.range.start));
		let element = tagStart > -1 ? /^<(xsl:function|xsl:template|xsl:param)\s/.exec(text.substring(tagStart, tagStart + 16))?.[1] : undefined;
		let elementStart = tagStart;
		const isParam = element === 'xsl:param';
		if (isParam) {
			const ancestors = RecordTypes.openElements(markup, tagStart);
			const parent = ancestors[ancestors.length - 1];
			element = parent && (parent.name === 'xsl:function' || parent.name === 'xsl:template') ? parent.name : undefined;
			elementStart = parent?.offset ?? -1;
		}
		const name = element ? RecordTypes.attributeOfElementAt(text, elementStart + 1, 'name') : undefined;
		return element && name ? {
			elementName: element, name, file: declarationDocument.fileName, isParam,
			arity: element === 'xsl:function' ? XSLTReferenceProvider.functionArity(text, markup, elementStart) : undefined
		} : undefined;
	}

	// the numbers of arguments a function can be called with: from those of its parameters that are required, to all
	private static functionArity(text: string, markup: string, functionStart: number): [number, number] {
		const params = RecordTypes.childElements(text, markup, functionStart, 'xsl:param');
		const required = params.filter((offset) => !['no', 'false', '0'].includes((RecordTypes.attributeOfElementAt(text, offset + 1, 'required') ?? '').trim())).length;
		return [required, params.length];
	}

	// the module declares a function or named template with the same name - compared as written - and for a function, an
	// arity in common
	private static declares(file: string, declaration: OverridableDeclaration) {
		const text = XSLTReferenceProvider.moduleText(file);
		if (!text.includes(declaration.name)) {
			return false;
		}
		const markup = RecordTypes.blankMarkup(text);
		for (const match of markup.matchAll(new RegExp(`<${declaration.elementName}\\s`, 'g'))) {
			if (RecordTypes.attributeOfElementAt(text, match.index! + 1, 'name')?.trim() !== declaration.name) {
				continue;
			}
			if (!declaration.arity) {
				return true;
			}
			const [required, total] = XSLTReferenceProvider.functionArity(text, markup, match.index!);
			if (Math.max(required, declaration.arity[0]) <= Math.min(total, declaration.arity[1])) {
				return true;
			}
		}
		return false;
	}

	// the text of a module: from its editor, if it's open, as it may not be saved
	private static moduleText(file: string) {
		const open = vscode.workspace.textDocuments.find((d) => d.fileName === file);
		try {
			return open ? open.getText() : fs.readFileSync(file, 'utf8');
		} catch {
			return '';
		}
	}

	public static calculateReferences = (seekInstruction: GlobalInstructionData, languageConfig: LanguageConfiguration, docType: DocumentTypes, document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]): BaseToken[] => {
		let lineNumber = -1;
		let xslVariable = languageConfig.variableElementNames;
		let inScopeVariablesList: VariableData[] = [];
		let xpathVariableCurrentlyBeingDefined: boolean;
		let elementStack: ElementData[] = [];
		let inScopeXPathVariablesList: VariableData[] = [];
		let anonymousFunctionParamList: VariableData[] = [];
		let xpathStack: XPathData[] = [];
		let tagType = TagType.NonStart;
		let attType = AttributeType.None;
		let tagElementName = '';
		let tagElementChildren: string[] = [];
		let startTagToken: XSLTToken | null = null;
		let preXPathVariable = false;
		let anonymousFunctionParams = false;
		let variableData: VariableData | null = null;
		let xsltVariableDeclarations: BaseToken[] = [];
		let unresolvedXsltVariableReferences: BaseToken[] = [];
		let prevToken: BaseToken | null = null;
		let includeOrImport = false;
		let referenceTokens: BaseToken[] = [];
		let tagIdentifierName: string = '';
		let lastTokenIndex = allTokens.length - 1;
		let tagAttributeNames: string[] = [];
		let tagAttributeSymbols: vscode.DocumentSymbol[] = [];
		let tagXmlnsNames: string[] = [];
		let rootXmlnsBindings: [string, string][] = [];
		let inheritedPrefixes: string[] = [];
		let globalVariableData: VariableData[] = [];
		let importedGlobalVarNames: string[] = [];
		let importedGlobalVarTokens: BaseToken[] = [];
		let importedGlobalFnNames: string[] = [];
		let incrementFunctionArity = false;
		let onRootStartTag = true;
		let rootXmlnsName: string | null = null;
		let xsltPrefixesToURIs = new Map<string, XSLTnamespaces>();
		let namedTemplates: Map<string, string[]> = new Map();
		let namedTemplateTokens: Map<string, GlobalInstructionData> = new Map();
		let globalModes: string[] = ['#current', '#default'];
		let globalKeys: string[] = [];
		let globalAccumulatorNames: string[] = [];
		let globalAttributeSetNames: string[] = [];
		let tagExcludeResultPrefixes: { token: BaseToken; prefixes: string[] } | null = null;
		let ifThenStack: BaseToken[] = [];
		let currentXSLTIterateParams: VariableData[][] = [];
		let schemaQuery = languageConfig.schemaData ? new SchemaQuery(languageConfig.schemaData) : undefined;
		let xsltSchemaQuery: SchemaQuery | undefined;
		const isSchematron = docType === DocumentTypes.SCH;
		let pendingTemplateParamErrors: BaseToken[] = [];
		if (isSchematron && XSLTConfiguration.configuration.schemaData) {
			xsltSchemaQuery = new SchemaQuery(XSLTConfiguration.configuration.schemaData);
		}

		globalInstructionData.forEach((instruction) => {
			switch (instruction.type) {
				case GlobalInstructionType.Variable:
				case GlobalInstructionType.Parameter:
					globalVariableData.push({ token: instruction.token, name: instruction.name });
					xsltVariableDeclarations.push(instruction.token);
					break;
				case GlobalInstructionType.Function:
					let functionNameWithArity = instruction.name + '#' + instruction.idNumber;
					importedGlobalFnNames.push(functionNameWithArity);
					break;
				case GlobalInstructionType.Template:
					if (namedTemplates.get(instruction.name)) {

					} else {
						let members = instruction.memberNames ? instruction.memberNames : [];
						namedTemplates.set(instruction.name, members);
						namedTemplateTokens.set(instruction.name, instruction);
					}
					break;
				case GlobalInstructionType.Mode:
				case GlobalInstructionType.ModeInstruction:
				case GlobalInstructionType.ModeTemplate:
					let modes = instruction.name.split(/\s+/);
					globalModes = globalModes.concat(modes);
					break;
				case GlobalInstructionType.Key:
					globalKeys.push(instruction.name);
					break;
				case GlobalInstructionType.Accumulator:
					if (globalAccumulatorNames.indexOf(instruction.name) < 0) {
						globalAccumulatorNames.push(instruction.name);
					}
					break;
				case GlobalInstructionType.AttributeSet:
					globalAttributeSetNames.push(instruction.name);
					break;
				case GlobalInstructionType.RootXMLNS:
					if (docType === DocumentTypes.XPath) {
						inheritedPrefixes.push(instruction.name);
					}
					break;
			}
		});

		importedInstructionData.forEach((instruction) => {
			switch (instruction.type) {
				case GlobalInstructionType.Variable:
				case GlobalInstructionType.Parameter:
					importedGlobalVarNames.push(instruction.name);
					importedGlobalVarTokens.push(instruction.token);
					break;
				case GlobalInstructionType.Function:
					let functionNameWithArity = instruction.name + '#' + instruction.idNumber;
					importedGlobalFnNames.push(functionNameWithArity);
					break;
				case GlobalInstructionType.Template:
					let members = instruction.memberNames ? instruction.memberNames : [];
					namedTemplates.set(instruction.name, members);
					namedTemplateTokens.set(instruction.name, instruction);
					break;
				case GlobalInstructionType.Mode:
				case GlobalInstructionType.ModeInstruction:
				case GlobalInstructionType.ModeTemplate:
					let modes = instruction.name.split(/\s+/);
					globalModes = globalModes.concat(modes);
					break;
				case GlobalInstructionType.Key:
					globalKeys.push(instruction.name);
					break;
				case GlobalInstructionType.Accumulator:
					globalAccumulatorNames.push(instruction.name);
					break;
				case GlobalInstructionType.AttributeSet:
					globalAttributeSetNames.push(instruction.name);
					break;
			}
		});

		if (docType === DocumentTypes.XPath) {
			xsltPrefixesToURIs.set('array', XSLTnamespaces.Array);
			xsltPrefixesToURIs.set('map', XSLTnamespaces.Map);
			xsltPrefixesToURIs.set('math', XSLTnamespaces.Map);
			xsltPrefixesToURIs.set('sql', XSLTnamespaces.SQL);
			xsltPrefixesToURIs.set('xs', XSLTnamespaces.XMLSchema);
			xsltPrefixesToURIs.set('fn', XSLTnamespaces.XPath);
			xsltPrefixesToURIs.set('xsl', XSLTnamespaces.XSLT);
			xsltPrefixesToURIs.set('ixsl', XSLTnamespaces.IXSL);
			inheritedPrefixes = inheritedPrefixes.concat(['array', 'map', 'math', 'sql', 'xs', 'fn', 'xsl', 'ixsl']);
		}

		allTokens.forEach((token, index) => {
			lineNumber = token.line;
			let isXMLToken = token.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
			if (isXMLToken) {
				if (ifThenStack.length > 0) {
					ifThenStack = [];
				}
				inScopeXPathVariablesList = [];
				xpathVariableCurrentlyBeingDefined = false;
				if (xpathStack.length > 0) {
					// report last issue with nesting in each xpath:
					let errorToken: BaseToken | undefined;
					for (let index = xpathStack.length - 1; index > -1; index--) {
						const trailingToken = xpathStack[index].token;
						const tv = trailingToken.value;
						const allowedToken = (tv === 'return' || tv === 'else' || tv === 'satisfies');
						if (!allowedToken) {
							errorToken = trailingToken;
							break;
						}
					}
				}
				xpathStack = [];
				preXPathVariable = false;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenDiagnostics.xsltStartTokenNumber);

				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						// this is xslt or schematron element
						pendingTemplateParamErrors = [];
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);

						if (tagType === TagType.Start) {
							if (tagElementName === 'xsl:iterate') {
								currentXSLTIterateParams.push([]);
							}
							tagType = (xslVariable.indexOf(tagElementName) > -1) ? TagType.XSLTvar : TagType.XSLTstart;
							let xsltToken: XSLTToken = token;
							xsltToken['tagType'] = tagType;
							startTagToken = token;

							if (!includeOrImport && tagType !== TagType.XSLTvar && elementStack.length === 1) {
								includeOrImport = tagElementName === XsltTokenDiagnostics.xslImport || tagElementName === XsltTokenDiagnostics.xslInclude;
							}
						}
						break;
					case XSLTokenLevelState.elementName:
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						if (tagType === TagType.Start) {
							tagType = TagType.XMLstart;
							startTagToken = token;
						}
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								tagAttributeNames = [];
								tagAttributeSymbols = [];
								tagXmlnsNames = [];
								tagIdentifierName = '';
								variableData = null;
								tagElementName = '';
								tagExcludeResultPrefixes = null;
								tagType = TagType.Start;
								break;
							case XMLCharState.rStNoAtt:
							case XMLCharState.rSt:
							case XMLCharState.rSelfCt:
							case XMLCharState.rSelfCtNoAtt:
								// start-tag ended, we're now within the new element scope:
								if (docType === DocumentTypes.XSLT && onRootStartTag) {
									rootXmlnsBindings.forEach((prefixNsPair) => {
										let pfx = prefixNsPair[0];
										let namespaceURI = prefixNsPair[1];
										let xsltType = FunctionData.namespaces.get(namespaceURI);
										if (xsltType !== undefined) {
											xsltPrefixesToURIs.set(pfx, xsltType);
										}
									});
								}
								onRootStartTag = false;
								let orginalPrefixes = inheritedPrefixes.slice();
								const attrValType = tagElementName.startsWith('xsl:') ? ValidationType.XSLTAttribute : ValidationType.XMLAttribute;

								if (xmlCharType === XMLCharState.rStNoAtt || xmlCharType === XMLCharState.rSt) {
									// on a start tag
									if (tagElementName === 'xsl:accumulator') {
										inScopeVariablesList.push({ token: token, name: 'value' });
									} else if (tagElementName === 'xsl:catch') {
										XsltTokenDiagnostics.xsltCatchVariables.forEach((catchVar) => {
											inScopeVariablesList.push({ token: token, name: catchVar });
										});
									}
									let inheritedPrefixesCopy = inheritedPrefixes.slice();
									// if top-level element add global variables - these include following variables also:
									let newVariablesList = elementStack.length === 0 ? globalVariableData : inScopeVariablesList;
									const stackElementChildren = isSchematron ? tagElementChildren : attrValType === ValidationType.XMLAttribute && elementStack.length > 0 ? elementStack[elementStack.length - 1].expectedChildElements : tagElementChildren;
									//let newVariablesList = inScopeVariablesList;

									const childSymbols: vscode.DocumentSymbol[] = XsltTokenDiagnostics.initChildrenSymbols(tagAttributeSymbols);

									if (variableData !== null) {
										if (elementStack.length > 1) {
											xsltVariableDeclarations.push(variableData.token);
										}
										if (startTagToken) {
											// if a top-level element, use global variables instad of inScopeVariablesList;
											elementStack.push({
												namespacePrefixes: inheritedPrefixesCopy, currentVariable: variableData, variables: newVariablesList,
												symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: childSymbols, expectedChildElements: stackElementChildren
											});
										}
									} else if (startTagToken) {
										elementStack.push({ namespacePrefixes: inheritedPrefixesCopy, variables: newVariablesList, symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: childSymbols, expectedChildElements: stackElementChildren });
									}
									inScopeVariablesList = [];
									newVariablesList = [];
									tagType = TagType.NonStart;

								} else {
									// self-closed tag: xmlns declarations on this are no longer in scope
									inheritedPrefixes = orginalPrefixes;
									if (variableData !== null) {
										if (elementStack.length > 1) {
											if (docType === DocumentTypes.DCP) {
												importedGlobalVarNames.push(variableData.name);
												globalVariableData.push(variableData);
											} else {
												inScopeVariablesList.push(variableData);
											}
											xsltVariableDeclarations.push(variableData.token);
										} else {
											inScopeVariablesList = [];
										}
									}
								}

								break;
							case XMLCharState.rCt:
								// end of an element close-tag:
								if (elementStack.length > 0) {
									let poppedData = elementStack.pop();
									if (tagElementName === 'xsl:iterate' && currentXSLTIterateParams.length > 0) {
										currentXSLTIterateParams.pop();
									}
									if (poppedData) {
										inheritedPrefixes = poppedData.namespacePrefixes.slice();
										inScopeVariablesList = (poppedData) ? poppedData.variables : [];
										if (poppedData.currentVariable) {
											if (docType === DocumentTypes.DCP) {
												importedGlobalVarNames.push(poppedData.currentVariable.name);
												globalVariableData.push(poppedData.currentVariable);
											} else if (elementStack.length > 1) {
												// reset inscope variables - unless at global-variable stack-level
												inScopeVariablesList.push(poppedData.currentVariable);
											}
										}
									}
								}
								break;
						}
						break;

					case XSLTokenLevelState.attributeName:
					case XSLTokenLevelState.xmlnsName:
						rootXmlnsName = null;
						let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);

						if (xmlTokenType === XSLTokenLevelState.xmlnsName) {
							tagXmlnsNames.push(attNameText);
							if (attNameText.length > 6) {
								let prefix = attNameText.substring(6);
								if (inheritedPrefixes.indexOf(prefix) < 0) {
									inheritedPrefixes.push(prefix);
								}
								if (prefix === 'ixsl') {
									if (schemaQuery) {
										schemaQuery.useIxsl = true;
									}
									if (xsltSchemaQuery) {
										xsltSchemaQuery.useIxsl = true;
									}
								}
							}
							if (onRootStartTag) {
								rootXmlnsName = attNameText;
							}
						} else {
							tagAttributeSymbols.push(XsltTokenDiagnostics.createSymbolForAttribute(token, attNameText));
							tagAttributeNames.push(attNameText);
						}

						if (tagType === TagType.XSLTvar) {
							attType = attNameText === XsltTokenDiagnostics.xslNameAtt ? AttributeType.Variable : AttributeType.None;
						} else if (tagType === TagType.XSLTstart) {
							if (docType === DocumentTypes.DCP && (attNameText === 'parameterRef' || attNameText === 'if' || attNameText === 'unless')) {
								attType = AttributeType.VariableRef;
							} else if (attNameText === XsltTokenDiagnostics.xslNameAtt) {
								attType = AttributeType.InstructionName;
							} else if (attNameText === XsltTokenDiagnostics.xslModeAtt) {
								attType = AttributeType.InstructionMode;
							} else if (attNameText === 'default-mode') {
								attType = AttributeType.DefaultMode;
							} else if (attNameText === XsltTokenDiagnostics.useAttSet) {
								attType = AttributeType.UseAttributeSets;
							} else if (attNameText === 'use-accumulators') {
								attType = AttributeType.UseAccumulators;
							} else if (attNameText === XsltTokenDiagnostics.excludePrefixes || attNameText === XsltTokenDiagnostics.xslExcludePrefixes) {
								attType = AttributeType.ExcludeResultPrefixes;
							} else {
								attType = AttributeType.None;
							}
						} else if (attNameText === XsltTokenDiagnostics.xslUseAttSet) {
							attType = AttributeType.UseAttributeSets;
						} else if (attNameText === 'xsl:default-mode') {
							attType = AttributeType.DefaultMode;
						}
						break;
					case XSLTokenLevelState.attributeValue:
						let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						if (tagAttributeSymbols.length > 0) {
							if (fullVariableName.length !== 1) {
								tagAttributeSymbols[tagAttributeSymbols.length - 1].detail = fullVariableName;
							} else {
								tagAttributeSymbols[tagAttributeSymbols.length - 1].kind = vscode.SymbolKind.Event;
							}
						}
						let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
						let hasProblem = false;
						if (rootXmlnsName !== null) {
							let prefix = rootXmlnsName.length === 5 ? '' : rootXmlnsName.substr(6);
							rootXmlnsBindings.push([prefix, variableName]);
						}
						switch (attType) {
							case AttributeType.Variable:
								tagIdentifierName = variableName;
								variableData = { token: token, name: variableName };
								if (elementStack.length > 2) {
									let parentElemmentName = elementStack[elementStack.length - 1].symbolName;
									if (parentElemmentName === 'xsl:iterate') {
										currentXSLTIterateParams[currentXSLTIterateParams.length - 1].push({ ...variableData });
									}
								}
								break;
							case AttributeType.VariableRef:
								let unResolvedToken = XsltTokenDiagnostics.resolveXPathVariableReference('', document, importedGlobalVarNames, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList,
									xpathStack, inScopeVariablesList, elementStack);
								if (unResolvedToken !== null) {
									unresolvedXsltVariableReferences.push(unResolvedToken);
								}
								break;
							case AttributeType.InstructionName:
								let slashPos = variableName.lastIndexOf('/');
								if (slashPos > 0) {
									// package name may be URI
									variableName = variableName.substring(slashPos + 1);
								}
								tagIdentifierName = variableName;
								if (elementStack.length > 0 && tagElementName === 'xsl:with-param') {
									const { symbolName, symbolID } = elementStack[elementStack.length - 1];
									if (seekInstruction.type === GlobalInstructionType.Variable && seekInstruction.name === variableName) {
										if (symbolName === 'xsl:next-iteration' && currentXSLTIterateParams.length > 0) {
											const definitions = currentXSLTIterateParams[currentXSLTIterateParams.length - 1];
											let resolvedVariable = definitions.find(defn => defn.name === variableName);
											if (resolvedVariable) {
												const rToken = resolvedVariable.token;
												if (rToken.line === seekInstruction.token.line && rToken.startCharacter === seekInstruction.token.startCharacter) {
													referenceTokens.push(token);
												}
											}
										} else if (symbolName === 'xsl:call-template' && seekInstruction.name === variableName) {
											// TODO: check that template definition token is same seekInstruction token:
											const templateInstruction = namedTemplateTokens.get(symbolID);
											if (templateInstruction && templateInstruction.memberNames) {
												const paramPos = templateInstruction.memberNames.indexOf(variableName);
												if (paramPos > -1 && templateInstruction.memberTokens) {
													const paramToken = templateInstruction.memberTokens[paramPos];
													if (paramToken && paramToken.line === seekInstruction.token.line && paramToken.startCharacter === seekInstruction.token.startCharacter) {
														referenceTokens.push(token);
													}
												}
											}
										}
									} 
								} else if (seekInstruction.type === GlobalInstructionType.Mode || seekInstruction.type === GlobalInstructionType.ModeTemplate) {
									if (variableName === seekInstruction.name && tagElementName === 'xsl:mode') {
										referenceTokens.push(token);
									}
								}
								break;
							case AttributeType.InstructionMode:
								if (tagIdentifierName === '') {
									tagIdentifierName = variableName;
								}
								if ((seekInstruction.type === GlobalInstructionType.Mode || seekInstruction.type === GlobalInstructionType.ModeInstruction || seekInstruction.type === GlobalInstructionType.ModeTemplate)) {
									if (tagElementName === 'xsl:template') {
										const modeTokens = XslLexer.tokensInsideToken(token, variableName);
										modeTokens.forEach((modeToken) => {
											if (modeToken.value === seekInstruction.name) {
												if (seekInstruction.type === GlobalInstructionType.ModeInstruction || !(seekInstruction.token.startCharacter === modeToken.startCharacter && seekInstruction.token.line === modeToken.line)) {
													referenceTokens.push(modeToken);
												}
											}
										 });
									} else if (variableName === seekInstruction.name) {
										if (seekInstruction.type === GlobalInstructionType.ModeInstruction || !(seekInstruction.token.startCharacter === token.startCharacter && seekInstruction.token.line === token.line)) {
											referenceTokens.push(token);
										}
									}
								}
								break;
							case AttributeType.DefaultMode:
								if (seekInstruction.type === GlobalInstructionType.Mode || seekInstruction.type === GlobalInstructionType.ModeInstruction || seekInstruction.type === GlobalInstructionType.ModeTemplate) {
									XslLexer.tokensInsideToken(token, variableName).forEach((modeToken) => {
										const isSeekToken = seekInstruction.token.startCharacter === modeToken.startCharacter && seekInstruction.token.line === modeToken.line;
										if (modeToken.value === seekInstruction.name && (seekInstruction.type === GlobalInstructionType.ModeInstruction || !isSeekToken)) {
											referenceTokens.push(modeToken);
										}
									});
								}
								break;
							case AttributeType.UseAttributeSets:
								if (seekInstruction.type === GlobalInstructionType.AttributeSet && variableName === seekInstruction.name) {
									referenceTokens.push(token);
								}
								break;
							case AttributeType.UseAccumulators:
								if (seekInstruction.type === GlobalInstructionType.Accumulator) {
									XslLexer.tokensInsideToken(token, variableName).filter((nameToken) => nameToken.value === seekInstruction.name).forEach((nameToken) => referenceTokens.push(nameToken));
								}
								break;
							case AttributeType.ExcludeResultPrefixes:
								let excludePrefixes = variableName.split(/\s+/);
								tagExcludeResultPrefixes = { token: token, prefixes: excludePrefixes };
								break;
						}
						if (
							seekInstruction.type === GlobalInstructionType.Template &&
							attType === AttributeType.InstructionName &&
							tagElementName === 'xsl:call-template') {
							if (variableName === seekInstruction.name) {
								referenceTokens.push(token);
							}
						}
						attType = AttributeType.None;
						break;
				}
			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;

				switch (xpathTokenType) {
					case TokenLevelState.string:
						if (xpathStack.length > 0) {
							let xp = xpathStack[xpathStack.length - 1];
							if (xp.functionArity === 0 && (xp.function?.value === 'key' || xp.function?.value.startsWith('accumulator-'))) {
								if (xp.function?.value === 'key' && seekInstruction.type === GlobalInstructionType.Key) {
									let keyVal = token.value.substring(1, token.value.length - 1);
									if (seekInstruction.name === keyVal) {
										referenceTokens.push(token);
									}
								} else if (xp.function?.value.startsWith('accumulator-') && seekInstruction.type === GlobalInstructionType.Accumulator) {
									let keyVal = token.value.substring(1, token.value.length - 1);
									if (seekInstruction.name === keyVal) {
										referenceTokens.push(token);
									}
								}
							}
						}
						break;
					case TokenLevelState.variable:
						let fullVariableName = token.value.substring(1);
						if ((preXPathVariable && !xpathVariableCurrentlyBeingDefined) || anonymousFunctionParams) {
							let currentVariable = { token: token, name: fullVariableName };
							if (anonymousFunctionParams) {
								anonymousFunctionParamList.push(currentVariable);
								xsltVariableDeclarations.push(token);
							} else {
								inScopeXPathVariablesList.push(currentVariable);
								xpathVariableCurrentlyBeingDefined = true;
								xsltVariableDeclarations.push(token);
							}
						} else {
							// don't include any current pending variable declarations when resolving
							let globalVarName: string | null = null;
							if (tagType === TagType.XSLTvar && elementStack.length === 1) {
								globalVarName = tagIdentifierName;
							}

							if (seekInstruction.type === GlobalInstructionType.Variable || seekInstruction.type === GlobalInstructionType.Parameter) {
								if (fullVariableName === seekInstruction.name) {
									let resolvedDefn = XsltTokenDiagnostics.getXPathVariableDefnToken(globalVarName, document, importedGlobalVarNames, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList,
										xpathStack, inScopeVariablesList, elementStack);
									const seekToken = seekInstruction.token;
									if (resolvedDefn && resolvedDefn.line === seekToken.line && resolvedDefn.startCharacter === seekToken.startCharacter) {
										referenceTokens.push(token);
									} else if (!resolvedDefn) {
										// only check for globals if it hasn't already been resolved
										if (globalVarName !== fullVariableName) {
											let globalVar = globalVariableData.find(vdata => vdata.name === fullVariableName);
											if (globalVar) {
												const gToken = globalVar.token;
												if (gToken.line === seekToken.line && gToken.startCharacter === seekToken.startCharacter) {
													referenceTokens.push(token);
												}
											} else {
												let globalDefnIndex = importedGlobalVarNames.indexOf(fullVariableName);
												if (globalDefnIndex > -1) {
													const globalToken = importedGlobalVarTokens[globalDefnIndex];
													if (globalToken.line === seekToken.line && globalToken.startCharacter === seekToken.startCharacter) {
														referenceTokens.push(token);
													}
												}
											}

										}
									}
								}
							}
						}
						break;
					case TokenLevelState.complexExpression:
						let valueText = token.value;
						switch (valueText) {
							case 'if':
								ifThenStack.push(token);
								break;
							case 'every':
							case 'for':
							case 'let':
							case 'some':
								preXPathVariable = true;
								xpathVariableCurrentlyBeingDefined = false;
								xpathStack.push({ token: token, variables: inScopeXPathVariablesList.slice(), preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, isRangeVar: true });
								break;
							case 'then':
								if (ifThenStack.length > 0) {
									ifThenStack.pop();
								}
								xpathStack.push({ token: token, variables: inScopeXPathVariablesList.slice(), preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined });
								inScopeXPathVariablesList = [];
								break;
							case 'return':
							case 'satisfies':
							case 'else':
								let tokenValBeforeDelete = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1].token.value : '';
								if (xpathStack.length > 1) {
									let deleteCount = 0;
									for (let i = xpathStack.length - 1; i > -1; i--) {
										const sv = xpathStack[i].token.value;
										if (sv === 'return' || sv === 'else' || sv === 'satisfies') {
											deleteCount++;
										} else {
											break;
										}
									}
									if (deleteCount > 0) {
										xpathStack.splice(xpathStack.length - deleteCount);
									}
								}

								if (xpathStack.length > 0) {
									let peekedStack = xpathStack[xpathStack.length - 1];
									if (peekedStack) {
										if (valueText === 'else') {
											preXPathVariable = peekedStack.preXPathVariable;
										} else {
											// todo: if after a return AND a ',' prePathVariable = true; see $pos := $c.
											preXPathVariable = false;
										}
										xpathVariableCurrentlyBeingDefined = peekedStack.xpathVariableCurrentlyBeingDefined;
										peekedStack.token = token;
									} else {
										inScopeXPathVariablesList = [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
								}
								break;
						}
						break;
					case TokenLevelState.operator:
						let isXPathError = false;
						let tv = token.value;

						// start checks
						let stackItem: XPathData | undefined = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : undefined;
						const sv = stackItem?.token.value;
						const tokenIsComma = tv === ',';
						const popStackLaterForComma = sv && tokenIsComma && (sv === 'return' || sv === 'else' || sv === 'satisfies');
						if (popStackLaterForComma && xpathStack.length > 1) {
							stackItem = xpathStack[xpathStack.length - 2];
						}
						if (stackItem && stackItem.curlyBraceType === CurlyBraceType.Map) {
							if (tokenIsComma) {
								if (stackItem.awaitingMapKey) {
									isXPathError = true;
								} else {
									stackItem.awaitingMapKey = true;
								}
							} else if (tv === '}' && stackItem.awaitingMapKey) {
								isXPathError = true;
							}
						}
						if (prevToken?.tokenType === TokenLevelState.complexExpression) {
							let currCharType = <CharLevelState>token.charType;
							if (currCharType === CharLevelState.rB || currCharType === CharLevelState.rBr || currCharType === CharLevelState.rPr) {
								// do nothing
							} else if (tokenIsComma) {
								// do nothing								
							}
						} else if (prevToken && tv === ':') {
							if (stackItem && stackItem.curlyBraceType === CurlyBraceType.Map) {
								if (stackItem.awaitingMapKey) {
									stackItem.awaitingMapKey = false;
								}
							}
						}
						// end checks
						let functionToken: BaseToken | null = null;
						switch (xpathCharType) {
							case CharLevelState.lBr:
								let curlyBraceType = CurlyBraceType.None;
								if (prevToken && prevToken.tokenType === TokenLevelState.operator) {
									if (prevToken.value === 'map') {
										curlyBraceType = CurlyBraceType.Map;
									} else if (prevToken.value === 'array') {
										curlyBraceType = CurlyBraceType.Array;
									}
								}
								const stackItem: XPathData = { token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, curlyBraceType };
								if (curlyBraceType === CurlyBraceType.Map) {
									stackItem.awaitingMapKey = true;
								}
								xpathStack.push(stackItem);
								if (anonymousFunctionParams) {
									// handle case: function($a) {$a + 8} pass params to inside '{...}'				
									inScopeXPathVariablesList = anonymousFunctionParamList;
									anonymousFunctionParamList = [];
									anonymousFunctionParams = false;
								} else {
									inScopeXPathVariablesList = [];
								}
								preXPathVariable = false;
								xpathVariableCurrentlyBeingDefined = false;
								break;
							case CharLevelState.lB:
								// handle case: function($a)						
								if (!anonymousFunctionParams && prevToken?.tokenType !== TokenLevelState.nodeType) {
									anonymousFunctionParams = prevToken?.tokenType === TokenLevelState.anonymousFunction;
								}
								if (prevToken?.tokenType === TokenLevelState.function) {
									functionToken = prevToken;
								} else if (prevToken?.tokenType === TokenLevelState.variable) {
									// TODO: check arity of variables of type 'function'
									incrementFunctionArity = false;
								}
							// intentionally no-break;	
							case CharLevelState.lPr:
								let xpathItem: XPathData = { token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined };
								if (functionToken) {
									xpathItem.function = functionToken;
									if (incrementFunctionArity) {
										xpathItem.functionArity = 1;
										incrementFunctionArity = false;
									} else {
										xpathItem.functionArity = 0;
									}
								}
								xpathStack.push(xpathItem);
								preXPathVariable = false;
								inScopeXPathVariablesList = [];
								xpathVariableCurrentlyBeingDefined = false;
								break;
							case CharLevelState.rB:
							case CharLevelState.rPr:
							case CharLevelState.rBr:

								if (xpathStack.length > 1) {
									let deleteCount = 0;
									for (let i = xpathStack.length - 1; i > -1; i--) {
										const sv = xpathStack[i].token.value;
										if (sv === 'return' || sv === 'else' || sv === 'satisfies') {
											deleteCount++;
										} else {
											break;
										}
									}
									if (deleteCount > 0) {
										xpathStack.splice(xpathStack.length - deleteCount);
									}
								}

								if (xpathStack.length > 0) {
									let poppedData = xpathStack.pop();
									if (poppedData) {
										inScopeXPathVariablesList = poppedData.variables;
										preXPathVariable = poppedData.preXPathVariable;
										xpathVariableCurrentlyBeingDefined = poppedData.xpathVariableCurrentlyBeingDefined;
										if (poppedData.function && poppedData.functionArity !== undefined) {
											if (prevToken?.charType !== CharLevelState.lB) {
												if (poppedData.functionArity !== undefined) {
													poppedData.functionArity++;
												}
											}
											if (seekInstruction.type === GlobalInstructionType.Function) {
												let functionName;
												let arity = poppedData.functionArity;
												const fnToken = poppedData.function;
												if (arity === undefined) {
													let parts = fnToken.value.split('#');
													arity = Number.parseInt(parts[1]);
													functionName = parts[0];
												} else {
													functionName = fnToken.value;
												}
												if (functionName === seekInstruction.name && XslLexer.functionArityMatches(seekInstruction, arity)) {
													referenceTokens.push(fnToken);
												}
											}
										}
									} else {
										inScopeXPathVariablesList = [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
								}
								break;
							case CharLevelState.sep:
								if (token.value === ',') {
									if (xpathStack.length > 0) {
										let xp = xpathStack[xpathStack.length - 1];
										if (xp.functionArity !== undefined) {
											xp.functionArity++;
										}
										if (xp.isRangeVar) {
											preXPathVariable = xp.preXPathVariable;
										}
										let nonBracketedThen = -1;
										for (let i = xpathStack.length - 1; i > -1; i--) {
											const xpathItem = xpathStack[i].token;
											const val = xpathItem.value;
											if (!(val === 'return' || val === 'else' || val === 'satisfies' || val === 'then')) {
												break;
											} else if (val === 'then') {
												nonBracketedThen = i;
											}
										}
										const sv = xp.token.value;
										if (sv === 'return' || sv === 'else' || sv === 'satisfies') {
											let poppedData = xpathStack.pop();
											if (poppedData) {
												inScopeXPathVariablesList = poppedData.variables;
												if (sv === 'else') {
													preXPathVariable = poppedData.preXPathVariable;
												} else {
													// todo: if after a return AND a ',' prePathVariable = true; see $pos := $c.
													preXPathVariable = false;
												}
												xpathVariableCurrentlyBeingDefined = false;
											}
										}
									}
									xpathVariableCurrentlyBeingDefined = false;
								}
								break;
							case CharLevelState.dSep:
								const isEmptyBracketsToken = token.value === '()';
								if (isEmptyBracketsToken && prevToken?.tokenType === TokenLevelState.function) {
									const fnArity = incrementFunctionArity ? 1 : 0;
									if (seekInstruction.type === GlobalInstructionType.Function) {
										if (prevToken.value === seekInstruction.name && XslLexer.functionArityMatches(seekInstruction, fnArity)) {
											referenceTokens.push(prevToken);
										}
									}
									incrementFunctionArity = false;
								} else if (isEmptyBracketsToken && prevToken?.tokenType === TokenLevelState.variable) {
									// TODO: check arity of variable of type 'function'
									incrementFunctionArity = false;
								} else if (token.value === '=>' || token.value === '=!>') {
									incrementFunctionArity = true;
								}
								break;
						}
						break;
					case TokenLevelState.simpleType:
						// XSLT 4.0 named item type, declared with xsl:item-type, e.g. as="cx:complex" or instance of cx:complex
						if (seekInstruction.type === GlobalInstructionType.ItemType && token.value === seekInstruction.name) {
							referenceTokens.push(token);
						}
						break;
					case TokenLevelState.functionNameTest:
						if (seekInstruction.type === GlobalInstructionType.Function) {
							const parts = token.value.split('#');
							const arity = Number.parseInt(parts[1]);
							const functionName = parts[0];
							if (functionName === seekInstruction.name && XslLexer.functionArityMatches(seekInstruction, arity)) {
								token.length = functionName.length;
								referenceTokens.push(token);
							}
						}
						break;
				}
			}
			if (incrementFunctionArity && prevToken?.charType === CharLevelState.dSep && (prevToken.value === '=>' || prevToken.value === '=!>') && token.tokenType !== TokenLevelState.function) {
				// the implicit first argument only applies to a static function call, not to a dynamic call
				incrementFunctionArity = false;
			}
			prevToken = token.tokenType === TokenLevelState.comment ? prevToken : token;
			if (index === lastTokenIndex) {
				if (elementStack.length > 0) {
					while (elementStack.length > 0) {
						elementStack.pop();
					}
				}
			}
		});

		return referenceTokens;
	};

}