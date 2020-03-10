import * as vscode from 'vscode';
import {XslLexer} from './xslLexer';

export class XsltFormatter {
	private xslLexer = new XslLexer();

	public provideDocumentFormattingEdits = (document: vscode.TextDocument): vscode.TextEdit[] => {
		console.log('formatter!!');
		let allTokens = this.xslLexer.analyse(document.getText());
		const firstLine = document.lineAt(0);
		if (firstLine.text !== '42') {
			return [vscode.TextEdit.insert(firstLine.range.start, '42\n')];
		} else {
			return [];
		}

	}
}