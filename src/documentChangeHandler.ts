import * as vscode from 'vscode';
import { XMLConfiguration } from './languageConfigurations';
import { XslLexerRenameTag } from './xslLexerRenameTag';
import {TagRenameEdit} from './xslLexerRenameTag';

export class DocumentChangeHandler {
	private onDidChangeRegistration: vscode.Disposable|null = null;
	private xmlDocumentRegistered = false;
	private lastChangePerformed: TagRenameEdit|null = null;
	private lexer = new XslLexerRenameTag(XMLConfiguration.configuration);


	public async onDocumentChange(e: vscode.TextDocumentChangeEvent, isXML: boolean) {
		if (!isXML) {
			return;
		}
		if (this.lastChangePerformed === null || !this.changesAreEqual(this.lastChangePerformed, e.contentChanges[0])) {
			if (e.contentChanges.length > 1) {
				console.log('multi-change');
			}
			let startTagPos = this.lexer.isStartTagChange(e.document, e.contentChanges[0]);
			if (startTagPos > -1) {
				let endTagPos = this.lexer.getEndTagForStartTagChange(e.document, e.contentChanges[0]);
				if (endTagPos) {
					let adjustedStartTagPos = endTagPos.character + (startTagPos - 1);
					let updateStartPos = new vscode.Position(endTagPos.line, adjustedStartTagPos);
					let updateEndPos = new vscode.Position(endTagPos.line, adjustedStartTagPos + e.contentChanges[0].rangeLength);
					let updateRange = new vscode.Range(updateStartPos, updateEndPos);
					this.lastChangePerformed = {range: updateRange, text: e.contentChanges[0].text};
					await this.performRename(e.document, this.lastChangePerformed);
				}
			} else {
				this.lastChangePerformed = null;
			}
		} else {
			this.lastChangePerformed = null;
		}
	}

	public registerXMLEditor = (editor: vscode.TextEditor|undefined) => {
		if (editor) {
			this.registerXMLDocument(editor.document);
		} else {

		}
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

	public async performRename(document: vscode.TextDocument, edit: TagRenameEdit) {
        let wse = new vscode.WorkspaceEdit();
        wse.replace(document.uri, edit.range, edit.text);
        await vscode.workspace.applyEdit(wse);
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