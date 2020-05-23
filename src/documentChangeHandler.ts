import * as vscode from 'vscode';
import { XslLexerLight } from './xslLexerLight';
import { XSLTLightConfiguration, XMLConfiguration } from './languageConfigurations';
import { XslLexerRenameTag } from './xslLexerRenameTag';

export class DocumentChangeHandler {
	private onDidChangeRegistration: vscode.Disposable|null = null;
	private xmlDocumentRegistered = false;

	public static onDocumentChange(e: vscode.TextDocumentChangeEvent, isXML: boolean) {
		if (!isXML) {
			return;
		}
		let lexer = new XslLexerRenameTag(XMLConfiguration.configuration);

		e.contentChanges.forEach((change) => {
			let startPos = change.range.start;
			lexer.renameTag(e.document.getText(), startPos);
		});
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