import * as vscode from 'vscode';

export class XsltFormatter {
	public provideDocumentFormattingEdits = (document: vscode.TextDocument): vscode.TextEdit[] => {
		console.log('formatter!!');
		const firstLine = document.lineAt(0);
		if (firstLine.text !== '42') {
			return [vscode.TextEdit.insert(firstLine.range.start, '42\n')];
		} else {
			return [];
		}

	}
}