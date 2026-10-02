import * as path from "path";
import * as fs from "fs";
import { CancellationToken, Hover, HoverProvider, MarkdownString, Position, ProviderResult, TextDocument, Uri, workspace } from "vscode";
import { XPathFunctionDetails } from "./xpathFunctionDetails";
import { XsltDefinitionProvider } from "./xsltDefinitionProvider";
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, LanguageConfiguration } from "./xslLexer";
import { LexPosition } from "./xpLexer";
import { XsltTokenDiagnostics } from "./xsltTokenDiagnostics";
import { XdocNotes } from "./xdocNote";
import { RecordTypes } from "./recordTypes";
import { declarationParamLabels } from "./declarationParams";
import { XsltTokenDefinitions } from "./xsltTokenDefintions";
import { HrefPaths } from './hrefPaths';
import { XdocReferences } from './xdocReferences';

enum CharType {
	none,
	alphaNumeric,
	whitespace,
	openBracket,
	colon,
	other
}

export class XSLTHoverProvider implements HoverProvider {

	constructor(private definitionProvider?: XsltDefinitionProvider, private languageConfiguration?: LanguageConfiguration) {
	}

	// isVersion4 is set on the shared language configuration each time the document symbols are updated
	private getFunctionData() {
		if (this.languageConfiguration?.docType === DocumentTypes.XPath) {
			return XPathFunctionDetails.xpathDataPlus40;
		}
		return this.languageConfiguration?.isVersion4 ? XPathFunctionDetails.dataPlusIxslPlus40 : XPathFunctionDetails.dataPlusIxsl;
	}

	async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		// XPath 4.0: a record field, e.g. 'r' in $c?r
		const fieldReference = XsltTokenDiagnostics.recordFieldAt(document, position);
		if (fieldReference) {
			const { field, record } = fieldReference;
			const quotedName = /^[A-Za-z_][\w.-]*$/.test(field.name) ? field.name : `'${field.name}'`;
			// the type as written in an attribute value, with its references replaced, e.g. &quot;
			const declaration = `${quotedName}${field.optional ? '?' : ''}${field.type ? ' as ' + RecordTypes.decodeReferences(field.type).text : ''}`;
			const markdown = new MarkdownString();
			markdown.appendCodeblock(declaration, XSLTHoverProvider.signatureLanguage);
			const itemTypes = await this.itemTypeGlobals(document, token);
			const fieldText = /^record\s*\(/.test(record.name) ? undefined : XdocNotes.recordFieldTexts(record.name, itemTypes, document.getText())(field.name);
			// the values of a field with an enumeration type
			const enumValues = field.type ? RecordTypes.resolveEnum(field.type, XSLTHoverProvider.itemTypeMap(itemTypes)) : undefined;
			const details = [fieldText, enumValues ? XSLTHoverProvider.enumValuesMarkdown(enumValues) : undefined].filter((part) => !!part).join('\n\n');
			markdown.appendMarkdown(`${details ? details + '\n\n---\n' : ''}${field.optional ? 'Optional field' : 'Field'} of the record type: \`${record.name}\``);
			return new Hover(markdown);
		}
		// XSLT 4.0: a reference in a documentation note, e.g. @see my:area#2 - null if it refers to nothing
		const noteHover = await this.findNoteReferenceHover(document, position, token);
		if (noteHover !== undefined) {
			return noteHover ?? undefined;
		}
		const line = document.lineAt(position.line);
		const rawFnName = this.getFunctionName(line.text, position.character);

		if (!rawFnName) {
			// XSLT 4.0: the name of a called template, or of a parameter it's passed, or of a named item type - with its
			// documentation note
			if (!this.definitionProvider) {
				return undefined;
			}
			return this.findModuleNoteHover(document, position) ?? await this.findVariableHover(document, position, token) ?? await this.findModuleHover(document, position) ??
				await this.findDeclarationHover(document, position, token) ?? await this.findTemplateHover(document, position, token) ??
				await this.findItemTypeHover(document, position, token);
		}

		const trimmedFnName = rawFnName.trimRight();
		// the built-in function list stores names without their standard 'fn:' prefix
		const builtinLookupName = trimmedFnName.startsWith('fn:') ? trimmedFnName.substring(3) : trimmedFnName;
		const matchingData = this.getFunctionData().find((item) => {
			return item.name === builtinLookupName;
		});

		if (matchingData) {
			const link = this.specificationLink(builtinLookupName);
			return this.createHover(matchingData.signature, matchingData.description + (link ? `\n\n${link}` : ''));
		}

		if (this.definitionProvider) {
			// a user-defined xsl:function keeps whatever prefix it was declared with (which may itself
			// be bound to a namespace other than the standard fn: one), so match on the name as written
			const userFunction = await this.findUserFunctionHover(document, trimmedFnName, token);
			if (userFunction) {
				return userFunction;
			}
		}

		return undefined;
	}

	private async findUserFunctionHover(document: TextDocument, fnName: string, token: CancellationToken): Promise<Hover | undefined> {
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { globalInstructionData, allImportedGlobals } = await this.definitionProvider!.getImportedGlobals(document, lexPosition);
		if (token.isCancellationRequested) {
			return undefined;
		}

		const candidates: GlobalInstructionData[] = globalInstructionData.concat(allImportedGlobals).filter(
			(item) => item.type === GlobalInstructionType.Function && item.name === fnName
		);
		if (candidates.length === 0) {
			return undefined;
		}

		// functions with the same name can be declared with different arities (overloads) - prefer the richest one
		const bestMatch = candidates.reduce((best, current) => current.idNumber > best.idNumber ? current : best);
		return this.functionHover(document, bestMatch);
	}

	// XSLT 4.0: for a reference in a documentation note, e.g. @see my:area#2 or `$scale`, the hover of the declaration it
	// refers to, as for a use of it - or for a built-in function, its signature - null for a reference to nothing, and
	// undefined if the position isn't on a reference
	private async findNoteReferenceHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | null | undefined> {
		if (!this.definitionProvider || this.languageConfiguration?.docType !== DocumentTypes.XSLT) {
			return undefined;
		}
		const text = document.getText();
		const reference = XdocReferences.at(text, document.offsetAt(position));
		if (!reference) {
			return undefined;
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { globalInstructionData, allImportedGlobals } = await this.definitionProvider.getImportedGlobals(document, lexPosition);
		if (token.isCancellationRequested) {
			return null;
		}
		const globals = globalInstructionData.concat(allImportedGlobals);
		const itemTypes = globals.filter((g) => g.type === GlobalInstructionType.ItemType);
		const markup = RecordTypes.blankMarkup(text);
		const target = XdocReferences.resolve(reference, globals, text, markup)[0];
		if (target?.paramOffset !== undefined) {
			return this.localParamHover(text, markup, target.paramOffset, itemTypes) ?? null;
		} else if (!target) {
			// a built-in function, e.g. fn:sum#1
			const builtinName = reference.name.startsWith('fn:') ? reference.name.substring(3) : reference.name;
			const builtin = reference.kind === 'function' || reference.kind === 'name' ? this.getFunctionData().find((item) => item.name === builtinName) : undefined;
			return builtin ? this.createHover(builtin.signature, builtin.description) : null;
		}
		const global = target.global;
		switch (global.type) {
			case GlobalInstructionType.Function:
				return this.functionHover(document, global);
			case GlobalInstructionType.Template:
				return this.templateHover(document, global);
			case GlobalInstructionType.ItemType:
				return this.itemTypeHover(document, global, itemTypes);
			default: {
				// a global xsl:param or xsl:variable, in this document or the module declaring it
				let moduleText = text;
				try {
					moduleText = global.href ? fs.readFileSync(global.href, 'utf8') : text;
				} catch {
					return null;
				}
				const tagStart = moduleText.lastIndexOf('<', XdocNotes.offsetAt(moduleText, global.token.line, global.token.startCharacter));
				return tagStart > -1 ? this.globalVariableHover(moduleText, tagStart, global.href, itemTypes) : null;
			}
		}
	}

	// a user-defined function's signature and documentation note
	private functionHover(document: TextDocument, fn: GlobalInstructionData) {
		// with the defaults of optional parameters, e.g. $scale as xs:double := 1
		const paramList = declarationParamLabels(fn, document.getText()).join(', ');
		const returnType = fn.returnType ? ` as ${fn.returnType}` : '';
		const signature = `${fn.name}(${paramList})${returnType}`;
		const description = fn.href ? `User-defined function, declared in ${path.basename(fn.href)}` : 'User-defined function, declared in this stylesheet';
		const note = XSLTHoverProvider.declarationNote(document, fn);
		return this.createHover(signature, note ? `${XdocNotes.toMarkdown(note)}\n\n---\n${description}` : description);
	}

	// a named template's signature and documentation note
	private templateHover(document: TextDocument, template: GlobalInstructionData) {
		const note = XSLTHoverProvider.declarationNote(document, template);
		const params = declarationParamLabels(template, document.getText()).join(', ');
		const description = template.href ? `Named template, declared in ${path.basename(template.href)}` : 'Named template, declared in this stylesheet';
		return this.createHover(`template ${template.name}(${params})`, note ? `${XdocNotes.toMarkdown(note)}\n\n---\n${description}` : description);
	}

	// a parameter of a function or template, with the text of its @param tag - undefined if it's not one of its parameters
	private paramHover(document: TextDocument, declaration: GlobalInstructionData, paramName: string) {
		const paramIndex = declaration.memberNames?.indexOf(paramName) ?? -1;
		if (paramIndex === -1) {
			return undefined;
		}
		const note = XSLTHoverProvider.declarationNote(document, declaration);
		const paramText = note ? XdocNotes.paramText(note, paramName) : undefined;
		const kind = declaration.type === GlobalInstructionType.Function ? 'function' : 'template';
		return this.createHover(declarationParamLabels(declaration, document.getText())[paramIndex], `${paramText ? paramText + '\n\n---\n' : ''}Parameter of the ${kind}: \`${declaration.name}\``);
	}

	// XSLT 4.0: for a variable reference, e.g. $scale: for a global xsl:param or xsl:variable, its type and documentation -
	// its own note, or its @param or @variable in the module note - or for a parameter of a function or template, its
	// @param in the declaration's note - not for other variables, which have no documentation
	private async findVariableHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		const wordRange = document.getWordRangeAtPosition(position, /\$[\w.:-]+/);
		if (!wordRange) {
			return undefined;
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { allTokens, globalInstructionData, allImportedGlobals } = await this.definitionProvider!.getImportedGlobals(document, lexPosition);
		if (token.isCancellationRequested) {
			return undefined;
		}
		const isXSLT = this.languageConfiguration?.docType !== DocumentTypes.XPath;
		const location = XsltTokenDefinitions.findDefinition(isXSLT, document, allTokens, globalInstructionData, allImportedGlobals, position).definitionLocation;
		if (!location) {
			return undefined;
		}
		let declarationDocument: TextDocument;
		try {
			declarationDocument = location.uri.toString() === document.uri.toString() ? document : await workspace.openTextDocument(location.uri);
		} catch {
			return undefined;
		}
		const text = declarationDocument.getText();
		const nameOffset = declarationDocument.offsetAt(location.range.start);
		const tagStart = text.lastIndexOf('<', nameOffset);
		const element = /^<(xsl:param|xsl:variable)\s/.exec(text.substring(tagStart, tagStart + 14))?.[1];
		const nameStart = element ? RecordTypes.attributeValueOffset(text, tagStart + 1, 'name') : undefined;
		// the declaration's name attribute, not e.g. a variable declared in an XPath expression within it
		if (!element || nameStart === undefined || nameOffset < nameStart || nameOffset > nameStart + (RecordTypes.attributeOfElementAt(text, tagStart + 1, 'name')?.length ?? 0)) {
			return undefined;
		}
		const markup = RecordTypes.blankMarkup(text);
		const href = declarationDocument === document ? undefined : declarationDocument.fileName;
		const itemTypes = globalInstructionData.concat(allImportedGlobals).filter((g) => g.type === GlobalInstructionType.ItemType);
		if (XdocNotes.isGlobal(markup, tagStart)) {
			return this.globalVariableHover(text, tagStart, href, itemTypes);
		}
		return element === 'xsl:param' ? this.localParamHover(text, markup, tagStart, itemTypes) : undefined;
	}

	// for the xsl:param of a function or template at tagStart, its type and the text of its @param tag
	private localParamHover(text: string, markup: string, tagStart: number, itemTypes: GlobalInstructionData[]) {
		const ancestors = RecordTypes.openElements(markup, tagStart);
		const parent = ancestors[ancestors.length - 1];
		const parentName = parent && (parent.name === 'xsl:function' || parent.name === 'xsl:template') ? RecordTypes.attributeOfElementAt(text, parent.offset + 1, 'name') : undefined;
		if (!parent || !parentName) {
			return undefined;
		}
		const name = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'name')!;
		const asText = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'as');
		const note = XdocNotes.forDeclaration(text, parent.offset, markup);
		const paramText = note ? XdocNotes.paramText(note, name) : undefined;
		const enumValues = asText ? RecordTypes.resolveEnum(asText, XSLTHoverProvider.itemTypeMap(itemTypes)) : undefined;
		const details = [paramText, enumValues ? XSLTHoverProvider.enumValuesMarkdown(enumValues) : undefined].filter((part) => !!part).join('\n\n');
		const kind = parent.name === 'xsl:function' ? 'function' : 'template';
		return this.createHover(`$${name}${asText ? ' as ' + asText : ''}`, `${details ? details + '\n\n---\n' : ''}Parameter of the ${kind}: \`${parentName}\``);
	}

	// a global xsl:param or xsl:variable: its declared type, its documentation - its own note, or its @param or @variable
	// in the module note - and for an enumeration type, its values - with the module declaring it (href), if it's another
	private globalVariableHover(text: string, tagStart: number, href: string | undefined, itemTypes: GlobalInstructionData[]) {
		const isParam = text.startsWith('<xsl:param', tagStart);
		const name = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'name') ?? '';
		const asText = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'as');
		const documentation = XdocNotes.globalDocumentation(text, tagStart);
		const enumValues = asText ? RecordTypes.resolveEnum(asText, XSLTHoverProvider.itemTypeMap(itemTypes)) : undefined;
		const details = [documentation, enumValues ? XSLTHoverProvider.enumValuesMarkdown(enumValues) : undefined].filter((part) => !!part).join('\n\n');
		const kind = isParam ? 'Global parameter' : 'Global variable';
		const description = href ? `${kind}, declared in ${path.basename(href)}` : `${kind}, declared in this stylesheet`;
		return this.createHover(`$${name}${asText ? ' as ' + asText : ''}`, details ? `${details}\n\n---\n${description}` : description);
	}

	// XSLT 4.0: for the href of an xsl:import or xsl:include, the module's note - the first child of its root element
	private async findModuleHover(document: TextDocument, position: Position): Promise<Hover | undefined> {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const tagStart = text.lastIndexOf('<', offset);
		if (tagStart < 0 || !/^<xsl:(import|include)\s/.test(text.substring(tagStart, tagStart + 13))) {
			return undefined;
		}
		const hrefStart = RecordTypes.attributeValueOffset(text, tagStart + 1, 'href');
		const href = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'href');
		if (hrefStart === undefined || !href || offset < hrefStart || offset > hrefStart + href.length || document.uri.scheme !== 'file' || href.includes('{')) {
			return undefined;
		}
		const modulePath = HrefPaths.toPath(href, document.fileName);
		if (modulePath === undefined) {
			return undefined;
		}
		const open = workspace.textDocuments.find((d) => d.fileName === modulePath);
		const catalogText = XSLTHoverProvider.catalogResolutionMarkdown(href, document.fileName);
		let moduleText: string;
		try {
			moduleText = open ? open.getText() : fs.readFileSync(modulePath, 'utf8');
		} catch {
			// for an href resolved by the XML catalog, how it was resolved, to a file that isn't found
			return catalogText ? this.createHover(`module ${path.basename(modulePath)}`, `Stylesheet module: ${modulePath} (not found)\n\n${catalogText}`) : undefined;
		}
		const note = XdocNotes.moduleNote(moduleText);
		return this.createHover(`module ${path.basename(modulePath)}`, `${note ? XdocNotes.toMarkdown(note) + '\n\n---\n' : ''}Stylesheet module: ${modulePath}${catalogText ? '\n\n' + catalogText : ''}`);
	}

	// how the XML catalog resolved an href, e.g. 'Resolved by the uri entry in catalogs/libraries.xml, via catalog.xml'
	// with links to the catalog files - undefined if the catalog didn't resolve it
	public static catalogResolutionMarkdown(href: string, documentPath: string) {
		const resolution = HrefPaths.catalogResolution(href, documentPath);
		if (!resolution) {
			return undefined;
		}
		const link = (file: string) => `[${workspace.asRelativePath(file)}](${Uri.file(file).toString()})`;
		const entry = resolution.entry;
		const matched = entry.kind === 'uri' ? `the \`uri\` entry for \`${entry.name}\`` :
			entry.kind === 'rewriteURI' ? `the \`rewriteURI\` entry for \`${entry.uriStartString}\`` : `the \`uriSuffix\` entry for \`${entry.uriSuffix}\``;
		const via = resolution.chain.length > 1 ? `, via ${resolution.chain.slice(0, -1).map(link).join(' → ')}` : '';
		return `Resolved by the XML catalog: ${matched} in ${link(resolution.catalogPath)}${via}`;
	}

	// XSLT 4.0: for the start tag of the module note, a preview of the note, as it's shown for an xsl:import or
	// xsl:include of the module - not for other notes, which are shown where their declarations are used
	private findModuleNoteHover(document: TextDocument, position: Position): Hover | undefined {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const tagStart = text.lastIndexOf('<', offset);
		if (tagStart < 0 || !/^<xsl:note[\s>]/.test(text.substring(tagStart, tagStart + 10))) {
			return undefined;
		}
		const markup = RecordTypes.blankMarkup(text);
		const startTag = new RegExp(RecordTypes.tagPattern, 'y');
		startTag.lastIndex = tagStart;
		const match = startTag.exec(markup);
		const root = XdocNotes.rootOffset(markup);
		const moduleNoteOffset = root === undefined ? undefined : RecordTypes.childElements(text, markup, root, 'xsl:note')
			.find((noteOffset) => RecordTypes.attributeOfElementAt(text, noteOffset + 1, 'format') === XdocNotes.format);
		if (!match || offset >= tagStart + match[0].length || moduleNoteOffset !== tagStart) {
			return undefined;
		}
		const note = XdocNotes.parseNote(text, markup, tagStart);
		return note ? this.createHover(`module ${path.basename(document.fileName)}`, `${XdocNotes.toMarkdown(note)}\n\n---\nPreview of the module note, as shown for an xsl:import or xsl:include of this module`) : undefined;
	}

	// a named item type's declaration and documentation note - and for an enumeration type, its values, resolved from
	// the item types, e.g. for one declared as another, or as a choice of enumeration types
	private itemTypeHover(document: TextDocument, itemType: GlobalInstructionData, itemTypes: GlobalInstructionData[]) {
		const note = XSLTHoverProvider.declarationNote(document, itemType);
		const enumValues = itemType.declaredType ? RecordTypes.resolveEnum(itemType.declaredType, XSLTHoverProvider.itemTypeMap(itemTypes)) : undefined;
		const details = [note ? XdocNotes.toMarkdown(note) : undefined, enumValues ? XSLTHoverProvider.enumValuesMarkdown(enumValues) : undefined].filter((part) => !!part).join('\n\n');
		const description = itemType.href ? `Named item type, declared in ${path.basename(itemType.href)}` : 'Named item type, declared in this stylesheet';
		const declaredType = itemType.declaredType ? RecordTypes.decodeReferences(itemType.declaredType).text : undefined;
		return this.createHover(`type ${itemType.name}${declaredType ? ' as ' + declaredType : ''}`, details ? `${details}\n\n---\n${description}` : description);
	}

	// the values of an enumeration type, as XPath string literals in their declaration order, without duplicates: on one
	// line for a few values, otherwise as a list - not numbered, as the order has no meaning
	public static enumValuesMarkdown(values: string[]) {
		const literals = [...new Set(values)].map((value) => {
			const literal = value.includes('\'') && !value.includes('"') ? `"${value}"` : `'${value.replace(/'/g, "''")}'`;
			// a code span with a backtick in it is delimited by two
			return literal.includes('`') ? `\`\` ${literal} \`\`` : `\`${literal}\``;
		});
		if (literals.length === 0) {
			return 'Values: none';
		}
		return literals.length < XSLTHoverProvider.enumListThreshold ? `Values: ${literals.join(', ')}` : `Values:\n\n${literals.map((literal) => `- ${literal}`).join('\n')}`;
	}

	// the number of enumeration values from which they're shown as a list
	private static readonly enumListThreshold = 5;

	// the xsl:item-type declarations, by name, with their 'as' values
	private static itemTypeMap(itemTypes: GlobalInstructionData[]) {
		return new Map(itemTypes.filter((g) => g.declaredType).map((g) => [g.name, g.declaredType!]));
	}

	// the xsl:item-type declarations of the document and the modules it includes or imports
	private async itemTypeGlobals(document: TextDocument, token: CancellationToken): Promise<GlobalInstructionData[]> {
		if (!this.definitionProvider) {
			return [];
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { globalInstructionData, allImportedGlobals } = await this.definitionProvider.getImportedGlobals(document, lexPosition);
		return token.isCancellationRequested ? [] : globalInstructionData.concat(allImportedGlobals).filter((g) => g.type === GlobalInstructionType.ItemType);
	}

	// for the name of a declaration - an xsl:function, a named xsl:template or an xsl:item-type - its signature and
	// documentation note, as for a use of it - or for the name of an xsl:param of a function or template, the parameter's
	// documentation
	private async findDeclarationHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const nameAt = (tagStart: number) => {
			const nameStart = RecordTypes.attributeValueOffset(text, tagStart + 1, 'name');
			const name = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'name');
			return nameStart !== undefined && name ? { nameStart, name } : undefined;
		};
		const tagStart = text.lastIndexOf('<', offset);
		const element = /^<(xsl:function|xsl:template|xsl:item-type|xsl:param|xsl:variable)\s/.exec(text.substring(tagStart, tagStart + 16))?.[1];
		const own = element ? nameAt(tagStart) : undefined;
		if (!own || offset < own.nameStart || offset > own.nameStart + own.name.length) {
			return undefined;
		}
		// a global xsl:param or xsl:variable
		if ((element === 'xsl:param' || element === 'xsl:variable') && XdocNotes.isGlobal(RecordTypes.blankMarkup(text), tagStart)) {
			return this.globalVariableHover(text, tagStart, undefined, await this.itemTypeGlobals(document, token));
		} else if (element === 'xsl:variable') {
			return undefined;
		}
		// for an xsl:param, the function or template declaring it
		let declarationName = own;
		if (element === 'xsl:param') {
			const ancestors = RecordTypes.openElements(RecordTypes.blankMarkup(text.substring(0, tagStart)), tagStart);
			const parent = ancestors[ancestors.length - 1];
			const parentName = parent && (parent.name === 'xsl:function' || parent.name === 'xsl:template') ? nameAt(parent.offset) : undefined;
			if (!parentName) {
				return undefined;
			}
			declarationName = parentName;
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { globalInstructionData, allImportedGlobals } = await this.definitionProvider!.getImportedGlobals(document, lexPosition);
		if (token.isCancellationRequested) {
			return undefined;
		}
		// the declaration in this document whose name is at that position
		const namePosition = document.positionAt(declarationName.nameStart);
		const declaration = globalInstructionData.find((g) => (g.type === GlobalInstructionType.Function || g.type === GlobalInstructionType.Template || g.type === GlobalInstructionType.ItemType) &&
			g.name === declarationName.name && g.token.line === namePosition.line && namePosition.character >= g.token.startCharacter && namePosition.character <= g.token.startCharacter + g.token.length);
		if (!declaration) {
			return undefined;
		} else if (element === 'xsl:param') {
			return this.paramHover(document, declaration, own.name);
		}
		return declaration.type === GlobalInstructionType.Function ? this.functionHover(document, declaration) :
			declaration.type === GlobalInstructionType.Template ? this.templateHover(document, declaration) :
			this.itemTypeHover(document, declaration, globalInstructionData.concat(allImportedGlobals).filter((g) => g.type === GlobalInstructionType.ItemType));
	}

	// the documentation note - an xsl:note with format="xdoc-md" - of a function, template or item type declaration, in
	// this document or the module declaring it
	public static declarationNote(document: TextDocument, declaration: GlobalInstructionData) {
		return XdocNotes.forGlobal(declaration, document.getText());
	}

	// for the name of an xsl:call-template, the template's signature and documentation note - or for the name of an
	// xsl:with-param within it, the parameter's documentation
	private async findTemplateHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const tagStart = text.lastIndexOf('<', offset);
		const element = /^<(xsl:call-template|xsl:with-param)\s/.exec(text.substring(tagStart, tagStart + 20))?.[1];
		const nameStart = element ? RecordTypes.attributeValueOffset(text, tagStart + 1, 'name') : undefined;
		const name = element ? RecordTypes.attributeOfElementAt(text, tagStart + 1, 'name') : undefined;
		if (nameStart === undefined || !name || offset < nameStart || offset > nameStart + name.length) {
			return undefined;
		}
		let templateName = name;
		if (element === 'xsl:with-param') {
			const ancestors = RecordTypes.openElements(RecordTypes.blankMarkup(text.substring(0, tagStart)), tagStart);
			const callTemplate = ancestors[ancestors.length - 1];
			const calledName = callTemplate?.name === 'xsl:call-template' ? RecordTypes.attributeOfElementAt(text, callTemplate.offset + 1, 'name') : undefined;
			if (!calledName) {
				return undefined;
			}
			templateName = calledName;
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { globalInstructionData, allImportedGlobals } = await this.definitionProvider!.getImportedGlobals(document, lexPosition);
		if (token.isCancellationRequested) {
			return undefined;
		}
		const template = globalInstructionData.concat(allImportedGlobals).find((g) => g.type === GlobalInstructionType.Template && g.name === templateName);
		if (!template) {
			return undefined;
		}
		return element === 'xsl:with-param' ? this.paramHover(document, template, name) : this.templateHover(document, template);
	}

	// XSLT 4.0: for the name of a named item type where it's used, e.g. cx:point in as="cx:point?", its declaration and
	// documentation note
	private async findItemTypeHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		const wordRange = document.getWordRangeAtPosition(position, /[\w.:-]+/);
		const word = wordRange ? document.getText(wordRange) : undefined;
		if (!word) {
			return undefined;
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { allTokens, globalInstructionData, allImportedGlobals } = await this.definitionProvider!.getImportedGlobals(document, lexPosition);
		// the tokens are only searched when an item type has a name that could be at the position
		if (token.isCancellationRequested || !globalInstructionData.concat(allImportedGlobals).some((g) => g.type === GlobalInstructionType.ItemType && word.includes(g.name))) {
			return undefined;
		}
		const isXSLT = this.languageConfiguration?.docType !== DocumentTypes.XPath;
		const itemType = XsltTokenDefinitions.findDefinition(isXSLT, document, allTokens, globalInstructionData, allImportedGlobals, position).definitionLocation?.instruction;
		return itemType?.type === GlobalInstructionType.ItemType ?
			this.itemTypeHover(document, itemType, globalInstructionData.concat(allImportedGlobals).filter((g) => g.type === GlobalInstructionType.ItemType)) : undefined;
	}

	// XPath 4.0: 'current' is in the functions specification, and these aren't in either 4.0 specification
	private static readonly functions40 = ['current'];
	private static readonly unspecified40 = ['function-identity', 'jposition'];

	// a link to the definition of a built-in function in the specification for the version: the W3C recommendations for
	// XPath 3.1 and XSLT 3.0, or the drafts for 4.0 - undefined for other functions, e.g. ixsl:page() or xs:integer()
	private specificationLink(name: string) {
		const isVersion4 = this.languageConfiguration?.docType === DocumentTypes.XPath || !!this.languageConfiguration?.isVersion4;
		const parts = /^(?:(math|map|array):)?([\w-]+)$/.exec(name);
		if (!parts || (isVersion4 && XSLTHoverProvider.unspecified40.includes(name))) {
			return undefined;
		}
		const isXSLT = XPathFunctionDetails.xsltData.some((item) => item.name === name) && !(isVersion4 && XSLTHoverProvider.functions40.includes(name));
		const [title, url] = isXSLT ?
			(isVersion4 ? ['XSLT 4.0', 'https://qt4cg.org/specifications/xslt-40/Overview.html'] : ['XSLT 3.0', 'https://www.w3.org/TR/xslt-30/']) :
			(isVersion4 ? ['XPath Functions 4.0', 'https://qt4cg.org/specifications/xpath-functions-40/Overview.html'] : ['XPath Functions 3.1', 'https://www.w3.org/TR/xpath-functions-31/']);
		return `[${title} specification](${url}#func-${parts[1] ? parts[1] + '-' : ''}${parts[2]})`;
	}

	// the language of the signatures' code blocks, for their highlighting: the grammar syntaxes/xpath-signature.tmLanguage.json,
	// with the types from syntaxes/xpath-type.tmLanguage.json
	public static readonly signatureLanguage = 'xpath-signature';

	private createHover(signature: string, description: string) {
		return new Hover(new MarkdownString().appendCodeblock(signature, XSLTHoverProvider.signatureLanguage).appendMarkdown('\n' + description));
	}

	private getFunctionName(line: string, char: number) {
		// track forwards to get end of potential function name
    let endChar = char;
		let findFirstEndSpace = true;
		let charType = CharType.none;

		while (endChar < line.length) {
			charType = this.classifyCharAtPos(line, endChar);
			if (charType !== CharType.alphaNumeric) {
				if (charType === CharType.colon) {
					//
				} else if (findFirstEndSpace) {
					if (charType === CharType.whitespace) {
						findFirstEndSpace = false;
					} else {
						break;
					}
				} else {
					if (charType !== CharType.whitespace) {
						break;
					}
				}
			} else {
				// is alphaNumeric
				if (!findFirstEndSpace) {
					break;
				}
			}
			endChar++;
		}

		if (charType !== CharType.openBracket) {
			return null;
		}

		let startChar = char -1;
		let findFirstStartColon = true;

		while (startChar > -1) {
			charType = this.classifyCharAtPos(line, startChar);
			if (charType !== CharType.alphaNumeric) {
				if (findFirstStartColon) {
					if (charType === CharType.colon) {
						findFirstStartColon = false;
					} else {
						break;
					}
				} else {
						break;
				}
			}
			startChar--;
		}

		startChar++;

		const result = line.substring(startChar, endChar);
		return result;

	}



	classifyCharAtPos(line: string, charPos: number) {
		const CHAR_CODE_A = 65;
		const CHAR_CODE_Z = 90;
		const CHAR_CODE_AS = 97;
		const CHAR_CODE_ZS = 122;
		const CHAR_CODE_0 = 48;
		const CHAR_CODE_9 = 57;
		const CHAR_CODE_DASH = 45;
		const CHAR_CODE_UNDERSCORE = 95;
	
		let code = line.charCodeAt(charPos);

		if (code === 9 || code === 10 || code === 12 || code === 32 ) {
			return CharType.whitespace;
		} else if (code === 35 || code === 40) {
			// the '#' char or '(' char
			return CharType.openBracket;
		} else if (code === 58) {
			return CharType.colon;
		} else {
			const isAlphaNumeric = (
				(code >= CHAR_CODE_A && code <= CHAR_CODE_Z) ||
				(code >= CHAR_CODE_AS && code <= CHAR_CODE_ZS) ||
				(code >= CHAR_CODE_0 && code <= CHAR_CODE_9) || 
				(code === CHAR_CODE_DASH || code === CHAR_CODE_UNDERSCORE )
			);
			const result = isAlphaNumeric? CharType.alphaNumeric : CharType.other;
			return result;
		}



	
	}
	
}