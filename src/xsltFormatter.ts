import * as vscode from 'vscode';
import {XslLexer} from './xslLexer';

export class XsltFormatter {
	private xslLexer = new XslLexer();
	private useTabs = false;
	private spaceIndentSize = 2;


	public provideDocumentFormattingEdits = (document: vscode.TextDocument): vscode.TextEdit[] => {
		let result: vscode.TextEdit[] = [];
		console.log('formatter!!');
		let indentString = '';
		// using non-whitespace for testing only!!
		if (this.useTabs) {
			indentString = 't';
		} else {
			indentString = 's'.repeat(this.spaceIndentSize);
		}
		let indentCharLength = indentString.length;

		let allTokens = this.xslLexer.analyse(document.getText());
		let lineNumber = -1;
		allTokens.forEach((token) => {
			if (token.line > lineNumber) {
				lineNumber = token.line;
				let actualIndentLength = token.startCharacter;
				let nesting = (token.nesting)? token.nesting : 0; 
				let requiredIndentLength = nesting * indentCharLength;

				if (actualIndentLength !== requiredIndentLength) {
					let indentLengthDiff = requiredIndentLength - actualIndentLength;
					const currentLine = document.lineAt(lineNumber);
					if (indentLengthDiff > 0) {
						vscode.TextEdit.insert(currentLine.range.start, indentString.repeat(indentLengthDiff));
					} else {
						let endPos = new vscode.Position(lineNumber, indentLengthDiff);
						let deletionRange = currentLine.range.with(currentLine.range.start, endPos);
						vscode.TextEdit.delete(deletionRange);
					}
				} 
				lineNumber = token.line;
			}
		});
		const firstLine = document.lineAt(0);
		if (firstLine.text !== '42') {
			return [vscode.TextEdit.insert(firstLine.range.start, '42\n')];
		} else {
			return [];
		}

	}
}