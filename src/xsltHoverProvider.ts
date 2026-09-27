import * as path from "path";
import { CancellationToken, Hover, HoverProvider, MarkdownString, Position, ProviderResult, TextDocument } from "vscode";
import { XPathFunctionDetails } from "./xpathFunctionDetails";
import { XsltDefinitionProvider } from "./xsltDefinitionProvider";
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, LanguageConfiguration } from "./xslLexer";
import { LexPosition } from "./xpLexer";
import { XsltTokenDiagnostics } from "./xsltTokenDiagnostics";
import { XdocNotes } from "./xdocNote";
import { RecordTypes } from "./recordTypes";
import * as fs from 'fs';

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
			markdown.appendMarkdown(`${field.optional ? 'Optional field' : 'Field'} of the record type: \`${record.name}\``);
			return new Hover(markdown);
		}
		const line = document.lineAt(position.line);
		const rawFnName = this.getFunctionName(line.text, position.character);

		if (!rawFnName) {
			// XSLT 4.0: the name of a called template, or of a parameter it's passed - with its documentation note
			return this.definitionProvider ? this.findTemplateHover(document, position, token) : undefined;
		}

		const trimmedFnName = rawFnName.trimRight();
		// the built-in function list stores names without their standard 'fn:' prefix
		const builtinLookupName = trimmedFnName.startsWith('fn:') ? trimmedFnName.substring(3) : trimmedFnName;
		const matchingData = this.getFunctionData().find((item) => {
			return item.name === builtinLookupName;
		});

		if (matchingData) {
			return this.createHover(matchingData.signature, matchingData.description);
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
		const paramList = (bestMatch.memberNames ?? []).map((paramName, i) => {
			const paramType = bestMatch.memberTypes?.[i];
			return paramType ? `$${paramName} as ${paramType}` : `$${paramName}`;
		}).join(', ');
		const returnType = bestMatch.returnType ? ` as ${bestMatch.returnType}` : '';
		const signature = `${bestMatch.name}(${paramList})${returnType}`;
		const description = bestMatch.href ? `User-defined function, declared in ${path.basename(bestMatch.href)}` : 'User-defined function, declared in this stylesheet';
		const note = XSLTHoverProvider.declarationNote(document, bestMatch);
		return this.createHover(signature, note ? `${XdocNotes.toMarkdown(note)}\n\n---\n${description}` : description);
	}

	// the documentation note - an xsl:note with format="xdoc-md" - of a function or template declaration, in this document
	// or the module declaring it
	public static declarationNote(document: TextDocument, declaration: GlobalInstructionData) {
		let text: string;
		try {
			text = declaration.href ? fs.readFileSync(declaration.href, 'utf8') : document.getText();
		} catch {
			return undefined;
		}
		const tagStart = text.lastIndexOf('<', XdocNotes.offsetAt(text, declaration.token.line, declaration.token.startCharacter));
		return tagStart > -1 ? XdocNotes.forDeclaration(text, tagStart) : undefined;
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
		const note = XSLTHoverProvider.declarationNote(document, template);
		if (element === 'xsl:with-param') {
			const paramIndex = template.memberNames?.indexOf(name) ?? -1;
			const paramType = paramIndex > -1 ? template.memberTypes?.[paramIndex] : undefined;
			const paramText = note ? XdocNotes.paramText(note, name) : undefined;
			if (paramIndex === -1) {
				return undefined;
			}
			return this.createHover(`$${name}${paramType ? ' as ' + paramType : ''}`, `${paramText ? paramText + '\n\n---\n' : ''}Parameter of the template: \`${templateName}\``);
		}
		const params = (template.memberNames ?? []).map((paramName, i) => template.memberTypes?.[i] ? `$${paramName} as ${template.memberTypes[i]}` : `$${paramName}`).join(', ');
		const description = template.href ? `Named template, declared in ${path.basename(template.href)}` : 'Named template, declared in this stylesheet';
		return this.createHover(`template ${templateName}(${params})`, note ? `${XdocNotes.toMarkdown(note)}\n\n---\n${description}` : description);
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