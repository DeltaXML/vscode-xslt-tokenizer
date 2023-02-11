import * as vscode from 'vscode';
import { XMLConfiguration, XSLTLightConfiguration } from './languageConfigurations';
import { XPathDocumentChangeHandler } from './xpathDocumentChangeHandler';
import { Data } from './xpLexer';
import { GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { XslLexerLight } from './xslLexerLight';
import { XslLexerRenameTag, TagRenamePosition } from './xslLexerRenameTag';

export interface TagRenameEdit {
	range: vscode.Range;
	text: string;
	fullTagName: string;
}
export class DocumentChangeHandler {
	public static lastActiveXMLEditor: vscode.TextEditor|null = null;
	public static lastActiveXMLNonXSLEditor: vscode.TextEditor|null = null;

	public static lastXMLDocumentGlobalData: GlobalInstructionData[] = [];
	public static isWindowsOS: boolean | undefined;

	private onDidChangeRegistration: vscode.Disposable | null = null;
	private xmlDocumentRegistered = false;
	private lastChangePerformed: TagRenameEdit | null = null;
	private lexer = new XslLexerRenameTag(XMLConfiguration.configuration);
	private cachedFailedEdit: TagRenameEdit | null = null;
	private xpathDocumentChangeHanlder: XPathDocumentChangeHandler|null = null;
	private static lexer = new XslLexerLight(XSLTLightConfiguration.configuration);

	public async onDocumentChange(e: vscode.TextDocumentChangeEvent, isXML: boolean) {
		if (!isXML) {
			return;
		}
		let activeChange = e.contentChanges[0];
		let skipTrigger = false;
		if (!activeChange) {
			return;
		}
		let triggerSuggest = false;
		if (activeChange.text === '/' && activeChange.rangeLength === 0) {
			let nextChar = e.document.getText().charAt(activeChange.rangeOffset + 1);
			if (nextChar === '>') {
				let textBeforeCloseEnd = this.lexer.getTextBeforeCloseEnd(e.document, activeChange);
				if (textBeforeCloseEnd) {
					let newStartChar = (activeChange.range.start.character - textBeforeCloseEnd.length); // positive number
					let activeStartPos = activeChange.range.start;
					let newStartPos = new vscode.Position(activeStartPos.line, newStartChar + 1);
					let newRange = new vscode.Range(newStartPos, newStartPos);
					let newOffset = activeChange.rangeOffset - (textBeforeCloseEnd.length + 1);
					let endTagPosData = this.lexer.getEndTagForStartTagChange(e.document, newOffset, activeChange.range.start.line, newStartChar, newRange, true);
					if (endTagPosData && endTagPosData?.startTag.endsWith('/')) {
						endTagPosData.startTag = endTagPosData.startTag.substring(0, endTagPosData.startTag.length - 1);
					}
					if (endTagPosData && endTagPosData.startTag === endTagPosData.endTag) {
						let endLine = e.document.lineAt(endTagPosData.startPosition.line).text;
						let followingStartCloseTag = endLine.substring(endTagPosData.startPosition.character);
						let closeTagCharPos = followingStartCloseTag.indexOf('>');
						if (closeTagCharPos > -1) {
							let startPos = new vscode.Position(activeChange.range.start.line, activeChange.range.start.character + 1);
							let endCharPos = endTagPosData.startPosition.character + closeTagCharPos;
							let endPos = new vscode.Position(endTagPosData.startPosition.line, endCharPos);
							let deletionRange = new vscode.Range(startPos, endPos);
							let wse = new vscode.WorkspaceEdit();
							wse.delete(e.document.uri, deletionRange);
							vscode.workspace.applyEdit(wse);
						}
					}
				}
			} else {
				let prevChar = e.document.getText().charAt(activeChange.rangeOffset - 1);
				skipTrigger = prevChar === '"';
			}
		}
		if (!skipTrigger && activeChange.rangeOffset > 10) {
			let prevChar = e.document.getText().charAt(activeChange.rangeOffset - 1);
			if (prevChar === ' ') {
				prevChar = e.document.getText().charAt(activeChange.rangeOffset - 2);
				let prevWordRange = e.document.getWordRangeAtPosition(activeChange.range.start.with({ character: activeChange.rangeOffset - 2 }));
				if (prevWordRange) {
					const prevWord = e.document.getText(prevWordRange);
					console.log(prevWord);
				}
			} 

			if ((Data.completionTriggers.indexOf(prevChar)) > -1 && activeChange.text.length === 1 && ['[', '(', '{', '?', '"', '\''].indexOf(activeChange.text) === -1) {
				triggerSuggest = true;
			} else if (prevChar === '<' && activeChange.text === '?') {
				triggerSuggest = true;
			}
		}
		// console.log('activeChange.text:', activeChange.text, 'triggerSuggest', triggerSuggest);
		if (triggerSuggest || activeChange.text === '(' || (activeChange.text === '/')  ||  activeChange.text === '[' || activeChange.text === '!' || activeChange.text === '$' || activeChange.text === '<') {
			// console.log('triggering...');
			let isCloseTagFeature = false;
			if (activeChange.text === '/') {
				let prevChar = e.document.getText().charAt(activeChange.rangeOffset - 1);
				isCloseTagFeature = prevChar === '<';
			}
			if (!isCloseTagFeature && !skipTrigger) {
				setTimeout(() => {
					vscode.commands.executeCommand('editor.action.triggerSuggest');
				}, 10);
			}
			return;
		}
		if (this.lastChangePerformed === null || !this.changesAreEqual(this.lastChangePerformed, activeChange)) {
			let tagNameLengthBeforeEdit = this.lexer.isStartTagChange(e.document, activeChange);
			if (tagNameLengthBeforeEdit > -1) {
				let startBracketPos = activeChange.range.start.character - (tagNameLengthBeforeEdit + 1);
				let startTagOffset = activeChange.range.start.character - startBracketPos; // positive number
				let offset = activeChange.rangeOffset - startTagOffset;
				let line = activeChange.range.start.line;
				let character = startBracketPos;

				let endTagPosData = this.lexer.getEndTagForStartTagChange(e.document, offset, line, character, activeChange.range, false);
				if (endTagPosData) {
					if (this.cachedFailedEdit) {
						this.cachedFailedEdit = null;
						let startChar = endTagPosData.startPosition.character;
						let startLline = endTagPosData.startPosition.line;
						let updateStartPos = new vscode.Position(startLline, startChar);
						let updateEndPos = new vscode.Position(startLline, startChar + endTagPosData.endTag.length);
						let updateRange = new vscode.Range(updateStartPos, updateEndPos);
						// replace the whole endtag to be safe:
						this.lastChangePerformed = { range: updateRange, text: endTagPosData.startTag, fullTagName: endTagPosData.startTag };
						await this.performRename(e.document, Object.assign(this.lastChangePerformed));
					}
					let endTagNameOk = this.checkEndTag(endTagPosData, tagNameLengthBeforeEdit, activeChange);
					if (endTagNameOk) {
						let endTagPos = endTagPosData.startPosition;
						let adjustedStartTagPos = endTagPos.character + (tagNameLengthBeforeEdit);
						let updateStartPos = new vscode.Position(endTagPos.line, adjustedStartTagPos);
						let updateEndPos = new vscode.Position(endTagPos.line, adjustedStartTagPos + activeChange.rangeLength);
						let updateRange = new vscode.Range(updateStartPos, updateEndPos);
						this.lastChangePerformed = { range: updateRange, text: activeChange.text, fullTagName: endTagPosData.startTag };
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

	public registerXMLEditor = (editor: vscode.TextEditor | undefined) => {
		if (editor) {
			this.registerXMLDocument(editor);
		} else {

		}
	};

	private getXPathDocumentChangeHandler() {
		if (this.xpathDocumentChangeHanlder === null) {
			this.xpathDocumentChangeHanlder = new XPathDocumentChangeHandler();
		}
		return this.xpathDocumentChangeHanlder;
	}

	private registerXMLDocument = (editor: vscode.TextEditor) => {
		const document = editor.document;
		let isXMLDocument = document.languageId === 'xml' || document.languageId === 'xslt' || document.languageId === 'dcp' || document.languageId === 'sch';
		let isXPathDocument = document.languageId === 'xpath';

		if (this.xmlDocumentRegistered && (!isXMLDocument || !isXPathDocument) && this.onDidChangeRegistration) {
			this.onDidChangeRegistration.dispose();
			this.xmlDocumentRegistered = false;
		} 
		if (isXMLDocument) {
			DocumentChangeHandler.lastActiveXMLEditor = editor;
			if (document.languageId !== 'xslt') {
				DocumentChangeHandler.lastActiveXMLNonXSLEditor = editor;
			}
			DocumentChangeHandler.getLastDocXmlnsPrefixes();
		}
		if (isXMLDocument && !this.xmlDocumentRegistered) {
			this.xmlDocumentRegistered = true;
			this.onDidChangeRegistration = vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChange(e, isXMLDocument));
		} else if (isXPathDocument && !this.xmlDocumentRegistered) {
			this.xmlDocumentRegistered = true;
			this.onDidChangeRegistration = vscode.workspace.onDidChangeTextDocument(e => this.getXPathDocumentChangeHandler().onDocumentChange(e));
		}
	};

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

	private static getLastDocXmlnsPrefixes() {
		if (DocumentChangeHandler.lastActiveXMLEditor) {
			DocumentChangeHandler.lastXMLDocumentGlobalData = this.lexer.analyseLight(DocumentChangeHandler.lastActiveXMLEditor.document.getText(), true);
		}
	}
}