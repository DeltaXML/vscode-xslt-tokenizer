import * as path from "path";
import { CancellationToken, Hover, HoverProvider, MarkdownString, Position, ProviderResult, TextDocument } from "vscode";
import { XPathFunctionDetails } from "./xpathFunctionDetails";
import { XsltDefinitionProvider } from "./xsltDefinitionProvider";
import { GlobalInstructionData, GlobalInstructionType } from "./xslLexer";
import { LexPosition } from "./xpLexer";

enum CharType {
	none,
	alphaNumeric,
	whitespace,
	openBracket,
	colon,
	other
}

export class XSLTHoverProvider implements HoverProvider {

	private functionData = XPathFunctionDetails.dataPlusIxslPlus40;

	constructor(private definitionProvider?: XsltDefinitionProvider) {
	}

	async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		const line = document.lineAt(position.line);
		const rawFnName = this.getFunctionName(line.text, position.character);

		if (!rawFnName) {
			return undefined;
		}

		const trimmedFnName = rawFnName.trimRight();
		// the built-in function list stores names without their standard 'fn:' prefix
		const builtinLookupName = trimmedFnName.startsWith('fn:') ? trimmedFnName.substring(3) : trimmedFnName;
		const matchingData = this.functionData.find((item) => {
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
		return this.createHover(signature, description);
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