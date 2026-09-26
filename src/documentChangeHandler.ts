import * as vscode from 'vscode';
import * as path from 'path';
import { XMLConfiguration, XSLTLightConfiguration } from './languageConfigurations';
import { XPathDocumentChangeHandler } from './xpathDocumentChangeHandler';
import { Data, XPathLexer } from './xpLexer';
import { GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { XslLexerLight } from './xslLexerLight';
import { XslLexerRenameTag, TagRenamePosition } from './xslLexerRenameTag';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { FileSelection } from './fileSelection';

export interface TagRenameEdit {
	range: vscode.Range;
	text: string;
	fullTagName: string;
}
export class DocumentChangeHandler {
	public static lastActiveXMLEditor: vscode.TextEditor | null = null;
	public static lastActiveXMLNonXSLEditor: vscode.TextEditor | null = null;
	public static lastActiveXMLNonXSLUri: vscode.Uri | null = null;
	// true when the user deliberately chose 'None' as the XML context file - unlike the initial unset state,
	// this is not replaced by the next XML file viewed
	public static contextFileIsNone = false;

	public static lastXMLDocumentGlobalData: GlobalInstructionData[] = [];
	// set when completions are triggered by typing ',' in an XSLT 4.0 stylesheet: the completion provider then only
	// offers the entries of a map constructor for a record type, and otherwise no completions
	private static commaTriggerPending = false;

	public static consumeCommaTrigger(): boolean {
		const pending = DocumentChangeHandler.commaTriggerPending;
		DocumentChangeHandler.commaTriggerPending = false;
		return pending;
	}
	public static isWindowsOS: boolean | undefined;

	public static setLastActiveXMLNonXSLUri(uri: vscode.Uri): void {
		DocumentChangeHandler.lastActiveXMLNonXSLUri = uri;
		DocumentChangeHandler.contextFileIsNone = false;
		FileSelection.instance?.setContextFileUri(uri.fsPath);
	}

	public static setNoContextFile(): void {
		DocumentChangeHandler.lastActiveXMLNonXSLUri = null;
		DocumentChangeHandler.contextFileIsNone = true;
		FileSelection.instance?.setContextFileUri(FileSelection.NO_FILE_PICKED);
	}

	private onDidChangeRegistration: vscode.Disposable | null = null;
	private xmlDocumentRegistered = false;
	private lastChangePerformed: TagRenameEdit | null = null;
	private pendingTriggerSuggestTimeout: ReturnType<typeof setTimeout> | null = null;
	private lexer = new XslLexerRenameTag(XMLConfiguration.configuration);
	private cachedFailedEdit: TagRenameEdit | null = null;
	private xpathDocumentChangeHanlder: XPathDocumentChangeHandler | null = null;
	private static lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
	public static contextStatusBarItem: vscode.StatusBarItem = DocumentChangeHandler.newStatusBarItem();

	public static newStatusBarItem() {
		const contextStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		contextStatusBarItem.command = 'xslt-xpath.pickXsltContextFile';
		this.contextStatusBarItem = contextStatusBarItem;
		return contextStatusBarItem;
	}

	public async onDocumentChange(e: vscode.TextDocumentChangeEvent, isXML: boolean) {
		if (!isXML) {
			return;
		}
		let activeChange = e.contentChanges[0];
		let skipTrigger = false;
		if (!activeChange || activeChange.text.length > 20) {
			return;
		}
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
				skipTrigger = true;
			}
		}
		let triggerSuggest = DocumentChangeHandler.setTriggerSuggestP1(skipTrigger, activeChange, e);
		if (!triggerSuggest && !skipTrigger && activeChange.text === '?') {
			// XPath 4.0 record fields for a lookup on a variable, e.g. $c? or $p?address? - not for an occurrence indicator such as xs:string?
			const textBefore = e.document.lineAt(activeChange.range.start.line).text.substring(0, activeChange.range.start.character);
			triggerSuggest = /\$[\w.:-]+(\?[\w.-]+)*$/.test(textBefore);
		}
		// the start of a map constructor or of an entry's key, or of an entry's value - after a string literal key, e.g. 'a':
		const lineBefore = e.document.lineAt(activeChange.range.start.line).text.substring(0, activeChange.range.start.character);
		const isValueStart = activeChange.text === ':' && /['"]\s*$/.test(lineBefore);
		// a quote, or an auto-closed pair, starting a string literal key or value, e.g. { 'a': ' or select="'
		const isStringStart = ['\'', '"', '\'\'', '""'].includes(activeChange.text) && /(?:[:,{]|=\s*["'])\s*$/.test(lineBefore);
		const isMapEntryStart = activeChange.text === ',' || activeChange.text === '{' || activeChange.text === '{}' || isValueStart || isStringStart;
		if (!triggerSuggest && !skipTrigger && isMapEntryStart && e.document.languageId === 'xslt' && /\sversion\s*=\s*["']4\.0["']/.test(e.document.getText(new vscode.Range(0, 0, 50, 0)))) {
			// XPath 4.0 record types: the next entry of a map constructor, or the whole map constructor
			triggerSuggest = true;
			DocumentChangeHandler.commaTriggerPending = true;
		}
		if (triggerSuggest || activeChange.text === '(' || (activeChange.text === '/') || activeChange.text === '[' || activeChange.text === '!' || activeChange.text === '$' || activeChange.text === '<' || activeChange.text.endsWith('::')) {
			let isCloseTagFeature = false;
			if (activeChange.text === '/') {
				let prevChar = e.document.getText().charAt(activeChange.rangeOffset - 1);
				isCloseTagFeature = prevChar === '<';
			}

			if (!isCloseTagFeature && !skipTrigger) {
				// console.log('activeChange.text:', activeChange.text, 'triggerSuggest', triggerSuggest);
				// debounce: fast typing schedules one of these per keystroke, and without
				// cancelling earlier ones each still fires 10ms later, piling up overlapping
				// triggerSuggest calls (and so overlapping completion requests) for what the
				// user now sees as a single edit - only the latest keystroke should trigger.
				if (this.pendingTriggerSuggestTimeout) {
					clearTimeout(this.pendingTriggerSuggestTimeout);
				}
				this.pendingTriggerSuggestTimeout = setTimeout(() => {
					this.pendingTriggerSuggestTimeout = null;
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

	public static setTriggerSuggestP1(skipTrigger: boolean, activeChange: vscode.TextDocumentContentChangeEvent, e: vscode.TextDocumentChangeEvent) {
		let triggerSuggest = false;
		if (!skipTrigger && activeChange.rangeOffset > 10) {
			let prevChar = e.document.getText().charAt(activeChange.rangeOffset - 1);
			if (prevChar === ' ') {
				prevChar = e.document.getText().charAt(activeChange.rangeOffset - 2);
			}

			if ((Data.completionTriggers.indexOf(prevChar)) > -1 && activeChange.text.length === 1 && (activeChange.text === ' ' || XsltTokenDiagnostics.nameStartCharRgx.test(activeChange.text))) {
				triggerSuggest = true;
			} else if (prevChar === '<' && activeChange.text === '?') {
				triggerSuggest = true;
			} else if (XsltTokenDiagnostics.nameCharRgx.test(activeChange.text) && XsltTokenDiagnostics.nameCharRgx.test(prevChar)) {
				triggerSuggest = false;
			} else if (activeChange.range.start.character > 1) {
				const backTwoPosition = activeChange.range.start.translate(0, -2);
				const prevWordRange = e.document.getWordRangeAtPosition(backTwoPosition);
				if (prevWordRange) {
					const prevWord = e.document.getText(prevWordRange);
					if (Data.triggerWords.indexOf(prevWord) !== -1) {
						const rangeBackTwoText = e.document.getText(activeChange.range.with(backTwoPosition));
						if (!(prevWord === 'as' && rangeBackTwoText.startsWith('="'))) {
							triggerSuggest = true;
						}
					}
				}
			}
		}
		return triggerSuggest;
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
		let isXSLTDocument = document.languageId === 'xslt';

		if (this.xmlDocumentRegistered && (!isXMLDocument || !isXPathDocument) && this.onDidChangeRegistration) {
			this.onDidChangeRegistration.dispose();
			this.xmlDocumentRegistered = false;
		}
		if (isXMLDocument) {
			DocumentChangeHandler.lastActiveXMLEditor = editor;
			if (document.languageId !== 'xslt' && document.languageId !== 'dcp') {
				FileSelection.instance.addToRecentlyUsedPickFile(FileSelection.MMO_PREFIX + FileSelection.XSLT_CONTEXT_PREVIOIUS_LABEL, editor.document.uri.fsPath);
				DocumentChangeHandler.lastActiveXMLNonXSLEditor = editor;
				if (!DocumentChangeHandler.lastActiveXMLNonXSLUri && !DocumentChangeHandler.contextFileIsNone) {
					DocumentChangeHandler.setLastActiveXMLNonXSLUri(editor.document.uri);
				}
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
		let isDCPDocument = document.languageId === 'dcp';
		DocumentChangeHandler.updateStatusBarItem(isXPathDocument || isXSLTDocument || isDCPDocument);

	};

	public static updateStatusBarItem(isXSLTOrXPath: boolean): void {
		if (isXSLTOrXPath) {
			const docUri = DocumentChangeHandler.lastActiveXMLNonXSLUri;
			const filename = docUri ? path.basename(docUri.path) : DocumentChangeHandler.contextFileIsNone ? '[no XML context]' : '[XML context file]';
			DocumentChangeHandler.contextStatusBarItem.tooltip = 'XML context file - used for XPath auto-completion and as the source for Quick Run';
			DocumentChangeHandler.contextStatusBarItem.text = `$(file-code) ${filename}`;
			DocumentChangeHandler.contextStatusBarItem.show();
		} else {
			DocumentChangeHandler.contextStatusBarItem.hide();
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

	private static getLastDocXmlnsPrefixes() {
		if (DocumentChangeHandler.lastActiveXMLEditor) {
			DocumentChangeHandler.lastXMLDocumentGlobalData = this.lexer.analyseLight(DocumentChangeHandler.lastActiveXMLEditor.document.getText(), true);
		}
	}
}