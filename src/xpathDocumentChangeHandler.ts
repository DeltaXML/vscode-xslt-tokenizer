import * as vscode from 'vscode';

export class XPathDocumentChangeHandler {
	public async onDocumentChange(e: vscode.TextDocumentChangeEvent) {
		let activeChange = e.contentChanges[0];
		if (!activeChange) {
			return;
		}
		console.log('xpath changed');
	}
}