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
		let nestingLevel = 0;
		let stringLengthOffset = 0;
		let xmlSpacePreserveStack: boolean[] = [];
		allTokens.forEach((token) => {
			lineNumber = token.line;
			let actualIndentLength = token.startCharacter;
			const currentLine = document.lineAt(lineNumber);

			let requiredIndentLength = nestingLevel * indentCharLength;
			let isXsltToken = token.tokenType >= XMLDocumentFormattingProvider.xsltStartTokenNumber;
			if (isXsltToken) {
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XMLDocumentFormattingProvider.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								nestingLevel++;
								break;
							case XMLCharState.rSelfCt:
							case XMLCharState.lCt:
								nestingLevel--;
								break;
						}
						break;
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;
			}
			if (token.line > lineNumber) {
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
			lineNumber = token.line;
		});
		return result;
	}
}