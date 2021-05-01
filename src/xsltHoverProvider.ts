import { CancellationToken, Hover, HoverProvider, MarkdownString, Position, ProviderResult, TextDocument } from "vscode";

enum CharType {
	none,
	alphaNumeric,
	whitespace,
	openBracket,
	colon,
	other
}

export class XSLTHoverProvider implements HoverProvider {

	provideHover(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Hover> {
		const line = document.lineAt(position.line);
		const s = this.getFunctionName(line.text, position.character);

		return this.createHover('analyze\u2011string( input as xs:string?, pattern as xs:string, flags as xs:string ) as element(fn:analyze-string-result)', '*Something* is going to happen now');
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

		console.log('-----forwards--------');
		console.log('charType', CharType[charType]);
		console.log('endChar', endChar);
		console.log('endString', line.substring(char, endChar));

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

		console.log('-----backwards--------');
		console.log('charType', CharType[charType]);
		console.log('startChar', startChar);
		console.log('startString', line.substring(startChar, char));
		
		console.log(line.substring(startChar, endChar));
	}



	classifyCharAtPos(line: string, charPos: number) {
		const CHAR_CODE_A = 65;
		const CHAR_CODE_Z = 90;
		const CHAR_CODE_AS = 97;
		const CHAR_CODE_ZS = 122;
		const CHAR_CODE_0 = 48;
		const CHAR_CODE_9 = 57;
	
		let code = line.charCodeAt(charPos);

		if (code === 9 || code === 10 || code === 12 || code === 32 ) {
			return CharType.whitespace;
		} else if (code === 40) {
			return CharType.openBracket;
		} else if (code === 58) {
			return CharType.colon;
		} else {
			const isAlphaNumeric = (
				(code >= CHAR_CODE_A && code <= CHAR_CODE_Z) ||
				(code >= CHAR_CODE_AS && code <= CHAR_CODE_ZS) ||
				(code >= CHAR_CODE_0 && code <= CHAR_CODE_9)
			);
			const result = isAlphaNumeric? CharType.alphaNumeric : CharType.other;
			return result;
		}



	
	}
	
}