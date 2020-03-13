import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState } from './xslLexer';
import { CharLevelState, TokenLevelState } from './xpLexer';

export class XMLDocumentFormattingProvider {
	private xslLexer = new XslLexer();
	private static xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();

	constructor() {
		this.xslLexer.provideCharLevelState = true;
	}


	public provideDocumentFormattingEdits = (document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): vscode.TextEdit[] => {
		let result: vscode.TextEdit[] = [];
		console.log('formatter!!');
		let indentString = '';
		let useTabs = !(options.insertSpaces);
		// using non-whitespace for testing only!!
		if (useTabs) {
			indentString = 't';
		} else {
			indentString = 's';
		}
		let indentCharLength = useTabs? 1: options.tabSize;

		let allTokens = this.xslLexer.analyse(document.getText());
		let lineNumber = -1;
		let prevLineNumber = -1;
		let nestingLevel = 0;
		let newNestingLevel = 0;
		let stringLengthOffset = 0;
		let xmlSpacePreserveStack: boolean[] = [];
		allTokens.forEach((token) => {
			lineNumber = token.line;
			let actualIndentLength = token.startCharacter;


			let isXsltToken = token.tokenType >= XMLDocumentFormattingProvider.xsltStartTokenNumber;
			let outDent = 0;
			if (isXsltToken) {
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XMLDocumentFormattingProvider.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								newNestingLevel++;
								break;
							case XMLCharState.lCt:
								outDent = 1;
								// intentional no-break;
							case XMLCharState.rSelfCt:
								newNestingLevel--;
								break;
						}
						break;
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;
			}
			let requiredIndentLength = nestingLevel * indentCharLength - (outDent * indentCharLength);
			let lineNumberDiff = lineNumber - prevLineNumber;

			if (lineNumberDiff > 0) {
				// process any skipped lines (text not in tokens):
				for (let i = lineNumberDiff - 1; i > -1; i--) {
					const currentLine = document.lineAt(lineNumber - i);

					if (actualIndentLength !== requiredIndentLength) {
						let indentLengthDiff = requiredIndentLength - actualIndentLength;

						if (indentLengthDiff > 0) {
							result.push(vscode.TextEdit.insert(currentLine.range.start, indentString.repeat(indentLengthDiff)));
						} else {
							let endPos = new vscode.Position(lineNumber, 0 - indentLengthDiff);
							let deletionRange = currentLine.range.with(currentLine.range.start, endPos);
							result.push(vscode.TextEdit.delete(deletionRange));
						}
					}
				}
			}
			prevLineNumber = lineNumber;
			nestingLevel = newNestingLevel;
		});
		return result;
	}
}