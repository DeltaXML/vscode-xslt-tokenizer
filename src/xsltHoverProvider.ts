import * as path from "path";
import { CancellationToken, Hover, HoverProvider, MarkdownString, Position, ProviderResult, TextDocument } from "vscode";
import { XPathFunctionDetails } from "./xpathFunctionDetails";
import { XsltDefinitionProvider } from "./xsltDefinitionProvider";
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, LanguageConfiguration } from "./xslLexer";
import { LexPosition } from "./xpLexer";
import { XsltTokenDiagnostics } from "./xsltTokenDiagnostics";
import { XdocNotes } from "./xdocNote";
import { RecordTypes } from "./recordTypes";
import { declarationParamLabels } from "./declarationParams";
import { XsltTokenDefinitions } from "./xsltTokenDefintions";

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
			const declaration = `${quotedName}${field.optional ? '?' : ''}${field.type ? ' as ' + field.type : ''}`;
			const markdown = new MarkdownString();
			markdown.appendCodeblock(declaration, 'xpath');
			const fieldText = await this.recordFieldText(document, record.name, field.name, token);
			markdown.appendMarkdown(`${fieldText ? fieldText + '\n\n---\n' : ''}${field.optional ? 'Optional field' : 'Field'} of the record type: \`${record.name}\``);
			return new Hover(markdown);
		}
		const line = document.lineAt(position.line);
		const rawFnName = this.getFunctionName(line.text, position.character);

		if (!rawFnName) {
			// XSLT 4.0: the name of a called template, or of a parameter it's passed, or of a named item type - with its
			// documentation note
			if (!this.definitionProvider) {
				return undefined;
			}
			return await this.findDeclarationHover(document, position, token) ?? await this.findTemplateHover(document, position, token) ??
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

	// a named item type's declaration and documentation note
	private itemTypeHover(document: TextDocument, itemType: GlobalInstructionData) {
		const note = XSLTHoverProvider.declarationNote(document, itemType);
		const description = itemType.href ? `Named item type, declared in ${path.basename(itemType.href)}` : 'Named item type, declared in this stylesheet';
		return this.createHover(`type ${itemType.name}${itemType.declaredType ? ' as ' + itemType.declaredType : ''}`, note ? `${XdocNotes.toMarkdown(note)}\n\n---\n${description}` : description);
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
		const element = /^<(xsl:function|xsl:template|xsl:item-type|xsl:param)\s/.exec(text.substring(tagStart, tagStart + 16))?.[1];
		const own = element ? nameAt(tagStart) : undefined;
		if (!own || offset < own.nameStart || offset > own.nameStart + own.name.length) {
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
		const { globalInstructionData } = await this.definitionProvider!.getImportedGlobals(document, lexPosition);
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
			declaration.type === GlobalInstructionType.Template ? this.templateHover(document, declaration) : this.itemTypeHover(document, declaration);
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

	// XSLT 4.0: the text of the @field tag for a field of a named record type
	private async recordFieldText(document: TextDocument, typeName: string, fieldName: string, token: CancellationToken): Promise<string | undefined> {
		if (!this.definitionProvider || /^record\s*\(/.test(typeName)) {
			return undefined;
		}
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const { globalInstructionData, allImportedGlobals } = await this.definitionProvider.getImportedGlobals(document, lexPosition);
		if (token.isCancellationRequested) {
			return undefined;
		}
		const itemTypes = globalInstructionData.concat(allImportedGlobals).filter((g) => g.type === GlobalInstructionType.ItemType);
		return XdocNotes.recordFieldTexts(typeName, itemTypes, document.getText())(fieldName);
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
		return itemType?.type === GlobalInstructionType.ItemType ? this.itemTypeHover(document, itemType) : undefined;
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

	private createHover(signature: string, description: string) {
		return new Hover(new MarkdownString().appendCodeblock(signature, 'ts').appendMarkdown('\n' + description));
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