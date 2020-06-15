import * as vscode from 'vscode';
import { XMLConfiguration } from './languageConfigurations';
import { XslLexerRenameTag, TagRenamePosition } from './xslLexerRenameTag';

export interface TagRenameEdit {
	range: vscode.Range,
	text: string
	fullTagName: string
}
export class DocumentChangeHandler {
	private onDidChangeRegistration: vscode.Disposable|null = null;
	private xmlDocumentRegistered = false;
	private lastChangePerformed: TagRenameEdit|null = null;
	private lexer = new XslLexerRenameTag(XMLConfiguration.configuration);
	private cachedFailedEdit: TagRenameEdit|null = null;


	public async onDocumentChange(e: vscode.TextDocumentChangeEvent, isXML: boolean) {
		if (!isXML) {
			return;
		}
		let activeChange = e.contentChanges[0];
		if (!activeChange) {
			return;
		}
		if (activeChange.text === ' ' || activeChange.text === '(' || activeChange.text === '[' || activeChange.text === '!' || activeChange.text === '/' || activeChange.text === '$') {
			setTimeout(() => {
				vscode.commands.executeCommand('editor.action.triggerSuggest');
			}, 10);
			return;
		}
		if (this.cachedFailedEdit) {
			console.log('fail entry');
		}
		//console.log('didChange');
		if (this.lastChangePerformed === null || !this.changesAreEqual(this.lastChangePerformed, activeChange)) {
			if (e.contentChanges.length > 1) {
				//console.log('multi-change');
			}
			let tagNameLengthBeforeEdit = this.lexer.isStartTagChange(e.document, activeChange);
			if (tagNameLengthBeforeEdit > -1) {
				let startBracketPos = activeChange.range.start.character - (tagNameLengthBeforeEdit + 1);
				let startTagOffset = activeChange.range.start.character - startBracketPos; // positive number
				let offset = activeChange.rangeOffset - startTagOffset;
				let line = activeChange.range.start.line;
				let character = startBracketPos;

				let endTagPosData = this.lexer.getEndTagForStartTagChange(e.document, offset, line, character,activeChange);
				if (endTagPosData) {
					if (this.cachedFailedEdit) {
						this.cachedFailedEdit = null;
						let startChar = endTagPosData.startPosition.character;
						let startLline = endTagPosData.startPosition.line;
						let updateStartPos = new vscode.Position(startLline, startChar);
						let updateEndPos = new vscode.Position(startLline, startChar + endTagPosData.endTag.length);
						let updateRange = new vscode.Range(updateStartPos, updateEndPos);
						// replace the whole endtag to be safe:
						this.lastChangePerformed = {range: updateRange, text: endTagPosData.startTag, fullTagName: endTagPosData.startTag};
						await this.performRename(e.document, Object.assign(this.lastChangePerformed));
					}
					let endTagNameOk = this.checkEndTag(endTagPosData, tagNameLengthBeforeEdit, activeChange);
					if (endTagNameOk) {
						let endTagPos = endTagPosData.startPosition;
						let adjustedStartTagPos = endTagPos.character + (tagNameLengthBeforeEdit);
						let updateStartPos = new vscode.Position(endTagPos.line, adjustedStartTagPos);
						let updateEndPos = new vscode.Position(endTagPos.line, adjustedStartTagPos + activeChange.rangeLength);
						let updateRange = new vscode.Range(updateStartPos, updateEndPos);
						this.lastChangePerformed = {range: updateRange, text: activeChange.text, fullTagName: endTagPosData.startTag};
						await this.performRename(e.document, Object.assign(this.lastChangePerformed));
					} else {
						this.lastChangePerformed = null;
					}
				}
			} else {
				this.lastChangePerformed = null;
			}
		} else {
			this.lastChangePerformed = null;
		}
	}

	private checkEndTag(endTagData: TagRenamePosition, startTagPos: number, startTagChange: vscode.TextDocumentContentChangeEvent): boolean {
		let result = false;
		let endTagName = endTagData.endTag;
		if (startTagPos > endTagName.length) {
			return false;
		}
		let originalStartTagLength = endTagData.startTag.length - (startTagChange.text.length - startTagChange.rangeLength);
		if (originalStartTagLength !== endTagData.endTag.length) {
			return false;
		}
		let beforeEndTag = endTagName.substring(0, startTagPos);
		let afterEndTag = endTagName.substring(startTagPos + startTagChange.rangeLength);
		let updatedEndName = beforeEndTag + startTagChange.text + afterEndTag;
		result = updatedEndName === endTagData.startTag;
		return result;
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
		let success = false;
        await vscode.workspace.applyEdit(wse).then((result) => {
			success = result;
		});
		if (success) {
			this.cachedFailedEdit = null;
		} else {
			this.cachedFailedEdit = edit;
			this.lastChangePerformed = null;
		}
		return success;
    }

	private changesAreEqual(tagRenameEdit: TagRenameEdit, change2: vscode.TextDocumentContentChangeEvent) {
		if (tagRenameEdit && change2) {
			let result = (
			tagRenameEdit.range.start.line === change2.range.start.line &&
			tagRenameEdit.range.start.character === change2.range.start.character &&
			tagRenameEdit.range.end.character === change2.range.end.character &&
			tagRenameEdit.range.end.line === change2.range.end.line &&
			tagRenameEdit.text === change2.text);
			return result;
		} else {
			return false;
		}
	}
}