import * as vscode from 'vscode';
import { XslLexerLight } from './xslLexerLight';
import { XSLTLightConfiguration, XMLConfiguration } from './languageConfigurations';
import { XslLexerRenameTag } from './xslLexerRenameTag';

export interface TagRenameEdit {
	range: vscode.Range,
	text: string
}

export class DocumentChangeHandler {
	private onDidChangeRegistration: vscode.Disposable|null = null;
	private xmlDocumentRegistered = false;
	private lastChangePerformed: TagRenameEdit|null = null;

	public onDocumentChange(e: vscode.TextDocumentChangeEvent, isXML: boolean) {
		if (!isXML) {
			return;
		}
		let lexer = new XslLexerRenameTag(XMLConfiguration.configuration);
		if (this.lastChangePerformed === null || !this.changesAreEqual(this.lastChangePerformed, e.contentChanges[0])) {
			this.lastChangePerformed = {range: e.contentChanges[0].range, text: 'test'};
			this.performRename(e.document, this.lastChangePerformed);
		} else {
			this.lastChangePerformed = null;
		}
		//lexer.renameTag(e.document, e.contentChanges[0]);
	}

	public registerXMLEditor = (editor: vscode.TextEditor|undefined) => {
		if (editor) {
			this.registerXMLDocument(editor.document);
		}
	}

	public performRename(document: vscode.TextDocument, edit: TagRenameEdit) {
        let wse = new vscode.WorkspaceEdit();
        wse.replace(document.uri, edit.range, edit.text);
        vscode.workspace.applyEdit(wse);
    }

	private registerXMLDocument = (document: vscode.TextDocument) => {
		let isXMLDocument = document.languageId === 'xml' || document.languageId === 'xslt';

		if (this.xmlDocumentRegistered && !isXMLDocument && this.onDidChangeRegistration) {
			this.onDidChangeRegistration.dispose();
			this.xmlDocumentRegistered = false;
		} else if (isXMLDocument && !this.xmlDocumentRegistered) {
			this.xmlDocumentRegistered = true;
			this.onDidChangeRegistration = vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChange(e, isXMLDocument));
		}
	}

	private changesAreEqual(tagRenameEdit: TagRenameEdit, change2: vscode.TextDocumentContentChangeEvent) {
		let result = (
		tagRenameEdit.range.start.line === change2.range.start.line &&
		tagRenameEdit.range.start.character === change2.range.start.character &&
		tagRenameEdit.range.end.character === change2.range.end.character &&
		tagRenameEdit.range.end.line === change2.range.end.line &&
		tagRenameEdit.text === change2.text);
		return result;
	}
}