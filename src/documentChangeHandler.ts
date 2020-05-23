import * as vscode from 'vscode';

export class DocumentChangeHandler {
	private onDidChangeRegistration: vscode.Disposable|null = null;
	private xmlDocumentRegistered = false;

	public static onDocumentChange(e: vscode.TextDocumentChangeEvent, isXML: boolean) {
		if (isXML && e.contentChanges.length === 1) {
			let contentChange = e.contentChanges[0];
			console.log(contentChange.text);
		}
	}

	public registerXMLEditor = (editor: vscode.TextEditor|undefined) => {
		if (editor) {
			this.registerXMLDocument(editor.document);
		}
	}

	private registerXMLDocument = (document: vscode.TextDocument) => {
		let isXMLDocument = document.languageId === 'xml' || document.languageId === 'xslt';

		if (this.xmlDocumentRegistered && !isXMLDocument && this.onDidChangeRegistration) {
			this.onDidChangeRegistration.dispose();
			this.xmlDocumentRegistered = false;
		} else if (isXMLDocument && !this.xmlDocumentRegistered) {
			this.xmlDocumentRegistered = true;
			this.onDidChangeRegistration = vscode.workspace.onDidChangeTextDocument(e => DocumentChangeHandler.onDocumentChange(e, isXMLDocument));
		}
	}
}