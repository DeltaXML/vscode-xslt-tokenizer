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
import { ImportIndex } from './importIndex';
import { RecordTypes } from './recordTypes';

export interface TagRenameEdit {
	range: vscode.Range;
	text: string;
	fullTagName: string;
}
export class DocumentChangeHandler {
	public static lastActiveXMLEditor: vscode.TextEditor | null = null;
	public static lastActiveXMLNonXSLEditor: vscode.TextEditor | null = null;
	// the XML context file in use: for the active stylesheet (see useContextFor), or else the last one picked
	public static lastActiveXMLNonXSLUri: vscode.Uri | null = null;
	// true when the user deliberately chose 'None' as the XML context file - unlike the initial unset state,
	// this is not replaced by the next XML file viewed
	public static contextFileIsNone = false;
	// the XML context file last picked (or 'None') - or the first XML file viewed, when none has been picked yet. It's
	// used for a stylesheet with no context file of its own, and for XPath and DCP files
	private static lastPickedUri: vscode.Uri | null = null;
	private static lastPickedIsNone = false;
	// the (top-level) stylesheet whose own context file is in use - undefined when it's the last one picked
	private static contextStylesheet: string | undefined;
	// for a stylesheet with no context file picked for it, the source of its Quick Run task: its fsPath, null for a
	// task with no source, or undefined with no task (set by the extension, which knows the tasks)
	public static taskContextFile: ((stylesheetFsPath: string) => Promise<string | null | undefined>) | undefined;
	// counts the lookups, so that a slower, earlier one doesn't overwrite the context file a later one found
	private static contextLookups = 0;

	public static lastXMLDocumentGlobalData: GlobalInstructionData[] = [];
	// set when completions are triggered by typing ',' in an XSLT 4.0 stylesheet: the completion provider then only
	// offers the entries of a map constructor for a record type, and otherwise no completions
	// - for the cursor position after the typed character: a completion request for any other position, e.g. after a
	// further character was typed before the triggered request, doesn't use it
	private static commaTriggerPending: { uri: string, offset: number } | null = null;

	public static setCommaTrigger(document: vscode.TextDocument, offset: number) {
		DocumentChangeHandler.commaTriggerPending = { uri: document.uri.toString(), offset };
	}

	public static consumeCommaTrigger(document: vscode.TextDocument, position: vscode.Position): boolean {
		const pending = DocumentChangeHandler.commaTriggerPending;
		DocumentChangeHandler.commaTriggerPending = null;
		return !!pending && pending.uri === document.uri.toString() && pending.offset === document.offsetAt(position);
	}
	public static isWindowsOS: boolean | undefined;

	// the context file picked, for the active stylesheet - and as the last one picked, for the others
	public static setLastActiveXMLNonXSLUri(uri: vscode.Uri): void {
		DocumentChangeHandler.setPickedContextFile(uri);
	}

	public static setNoContextFile(): void {
		DocumentChangeHandler.setPickedContextFile(null);
	}

	private static setPickedContextFile(uri: vscode.Uri | null) {
		DocumentChangeHandler.contextLookups++;
		DocumentChangeHandler.setLastPicked(uri, uri === null);
		const pickedFsPath = uri ? uri.fsPath : FileSelection.NO_FILE_PICKED;
		FileSelection.instance?.setContextFileUri(pickedFsPath);
		const activeDocument = vscode.window.activeTextEditor?.document;
		const stylesheet = activeDocument && DocumentChangeHandler.isStylesheetFile(activeDocument) ? DocumentChangeHandler.stylesheetKey(activeDocument) : undefined;
		if (stylesheet) {
			FileSelection.instance?.setStylesheetContextFile(stylesheet, pickedFsPath);
		}
		DocumentChangeHandler.useContext(uri, uri === null, stylesheet);
	}

	// the last context file picked, e.g. as restored at startup - also in use, unless a stylesheet's own one is
	public static setLastPicked(uri: vscode.Uri | null, isNone: boolean) {
		DocumentChangeHandler.lastPickedUri = uri;
		DocumentChangeHandler.lastPickedIsNone = isNone;
		if (!DocumentChangeHandler.contextStylesheet) {
			DocumentChangeHandler.useContext(uri, isNone, undefined);
		}
	}

	private static useContext(uri: vscode.Uri | null, isNone: boolean, stylesheet: string | undefined) {
		DocumentChangeHandler.lastActiveXMLNonXSLUri = uri;
		DocumentChangeHandler.contextFileIsNone = isNone;
		DocumentChangeHandler.contextStylesheet = stylesheet;
	}

	// only a stylesheet saved as a file has a context file of its own, kept by its fsPath
	private static isStylesheetFile(document: vscode.TextDocument) {
		return document.languageId === 'xslt' && document.uri.scheme === 'file';
	}

	// modules share the context file of the top-level stylesheet that imports or includes them
	public static stylesheetKey(document: vscode.TextDocument): string {
		return (ImportIndex.isEnabled() ? ImportIndex.instance.masterFor(document.fileName) : undefined) ?? document.fileName;
	}

	// the XML context file for the stylesheet: the one picked for it (or its top-level stylesheet), else the source
	// of its Quick Run task, else the last one picked. A null uri with isNone for 'None' - starting from
	// xsl:initial-template - or with !isNone, when there's no context file yet
	public static async contextFor(document: vscode.TextDocument | undefined): Promise<{ uri: vscode.Uri | null; isNone: boolean; stylesheet?: string }> {
		if (document && DocumentChangeHandler.isStylesheetFile(document)) {
			const stylesheet = DocumentChangeHandler.stylesheetKey(document);
			const picked = FileSelection.instance?.getStylesheetContextFile(stylesheet);
			const fsPath = picked !== undefined ? picked : await DocumentChangeHandler.taskContextFile?.(stylesheet);
			if (fsPath === FileSelection.NO_FILE_PICKED || fsPath === null) {
				return { uri: null, isNone: true, stylesheet };
			}
			if (fsPath !== undefined) {
				return { uri: vscode.Uri.file(fsPath), isNone: false, stylesheet };
			}
		}
		return { uri: DocumentChangeHandler.lastPickedUri, isNone: DocumentChangeHandler.lastPickedIsNone };
	}

	// makes the stylesheet's context file the one in use - e.g. when its editor becomes active
	public static async useContextFor(document: vscode.TextDocument | undefined): Promise<void> {
		const lookup = ++DocumentChangeHandler.contextLookups;
		const { uri, isNone, stylesheet } = await DocumentChangeHandler.contextFor(document);
		if (lookup === DocumentChangeHandler.contextLookups) {
			DocumentChangeHandler.useContext(uri, isNone, stylesheet);
		}
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
		const isStringStart = ['\'', '"', '\'\'', '""'].includes(activeChange.text) && /(?:[:,{(]|:=|=\s*["'])\s*$/.test(lineBefore);
		// the name of an xsl:with-param or xsl:call-template: the parameter or template names, as the value's quote is typed
		const isNameStart = ['"', '\'', '""', '\'\''].includes(activeChange.text) && XsltTokenDiagnostics.xsltPatternOf(/<xsl:(?:with-param|call-template)\s(?:[^<>]*\s)?name\s*=\s*$/, e.document).test(lineBefore);
		if (!triggerSuggest && !skipTrigger && isNameStart) {
			triggerSuggest = true;
		}
		const isMapEntryStart = activeChange.text === ',' || activeChange.text === '{' || activeChange.text === '{}' || isValueStart || isStringStart;
		if (!triggerSuggest && !skipTrigger && isMapEntryStart && e.document.languageId === 'xslt' && /\sversion\s*=\s*["']4\.0["']/.test(e.document.getText(new vscode.Range(0, 0, 50, 0)))) {
			// XPath 4.0 record types: the next entry of a map constructor, or the whole map constructor
			triggerSuggest = true;
			// the cursor is after the first typed character - also between an auto-closed pair, e.g. {}
			DocumentChangeHandler.setCommaTrigger(e.document, activeChange.rangeOffset + 1);
		}
		if (!triggerSuggest && !skipTrigger && XPathDocumentChangeHandler.isKindTestWildcardStart(activeChange.text, lineBefore)) {
			// the names in element(...) or attribute(...), e.g. *:book
			triggerSuggest = true;
		}
		if (!triggerSuggest && !skipTrigger && activeChange.text === '@' && e.document.languageId === 'xslt') {
			// a tag within a documentation note, an xsl:note with format="xdoc-md"
			const textBefore = e.document.getText(new vscode.Range(new vscode.Position(0, 0), activeChange.range.start));
			const noteStart = textBefore.lastIndexOf(RecordTypes.xsltTag(textBefore, 'note'));
			const noteTag = noteStart > -1 ? RecordTypes.xsltPattern(/^<xsl:note\s[^>]*format\s*=\s*["']xdoc-md["'][^>]*>/, textBefore).exec(textBefore.substring(noteStart)) : null;
			// no other markup after the note's start tag, except CDATA sections
			triggerSuggest = !!noteTag && !textBefore.substring(noteStart + noteTag[0].length).replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, '').includes('<');
		}
		if (triggerSuggest || activeChange.text === '(' || (activeChange.text === '/') || activeChange.text === '[' || activeChange.text === '!' || activeChange.text === '$' || activeChange.text === '<' || activeChange.text.endsWith('::')) {
			let isCloseTagFeature = false;
			if (activeChange.text === '/') {
				let prevChar = e.document.getText().charAt(activeChange.rangeOffset - 1);
				isCloseTagFeature = prevChar === '<';
			}

			if (isCloseTagFeature) {
				// the end tag's name is added by the on-type formatter, so no completions: not for a trigger still
				// pending for the '<' typed just before - which would run after the name is added - nor in a suggest
				// widget it already opened
				if (this.pendingTriggerSuggestTimeout) {
					clearTimeout(this.pendingTriggerSuggestTimeout);
					this.pendingTriggerSuggestTimeout = null;
				}
				vscode.commands.executeCommand('hideSuggestWidget');
			} else if (!skipTrigger) {
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
				// only a file can be the XML context file - not, e.g., the debugger's view of the output so far
				// ('[XSLT output] ...'), an untitled document, or another extension's virtual document
				const isFile = document.uri.scheme === 'file';
				if (isFile) {
					FileSelection.instance.addToRecentlyUsedPickFile(FileSelection.MMO_PREFIX + FileSelection.XSLT_CONTEXT_PREVIOIUS_LABEL, editor.document.uri.fsPath);
				}
				DocumentChangeHandler.lastActiveXMLNonXSLEditor = editor;
				// with none picked yet, the first XML file viewed - for stylesheets with no context file of their own
				if (isFile && !DocumentChangeHandler.lastPickedUri && !DocumentChangeHandler.lastPickedIsNone) {
					DocumentChangeHandler.setLastPicked(editor.document.uri, false);
					FileSelection.instance?.setContextFileUri(editor.document.uri.fsPath);
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
		if (isXPathDocument || isXSLTDocument || isDCPDocument) {
			DocumentChangeHandler.refreshStatusBarItem();
		} else {
			DocumentChangeHandler.updateStatusBarItem(false);
		}
	};

	// for a stylesheet that Quick Run runs on itself, as its own source document - with no XML context file, and no
	// xsl:initial-template - the label of the task it uses (set by the extension, which knows the tasks)
	public static selfSourceTask: ((document: vscode.TextDocument) => Promise<string | undefined>) | undefined;
	// counts the updates, so that a slower, earlier lookup of a self-source task doesn't overwrite a later update
	private static statusBarUpdates = 0;

	public static updateStatusBarItem(isXSLTOrXPath: boolean): void {
		const update = ++DocumentChangeHandler.statusBarUpdates;
		if (isXSLTOrXPath) {
			const docUri = DocumentChangeHandler.lastActiveXMLNonXSLUri;
			const activeDocument = vscode.window.activeTextEditor?.document;
			const isXslt = activeDocument?.languageId === 'xslt';
			const isItself = !!docUri && docUri.toString() === activeDocument?.uri.toString();
			const filename = docUri ? path.basename(docUri.path) + (isItself ? ' (itself)' : '') : DocumentChangeHandler.contextFileIsNone ? '[no XML context]' : '[XML context file]';
			const stylesheet = DocumentChangeHandler.contextStylesheet;
			const tooltip = stylesheet ? `XML context file for ${path.basename(stylesheet)}${stylesheet !== activeDocument?.fileName ? ' and the modules it imports or includes' : ''} - used for XPath auto-completion and as the source for Quick Run` :
				isXslt ? 'XML context file - the last one picked, as none has been picked for this stylesheet - used for XPath auto-completion and as the source for Quick Run' :
					'XML context file - used for XPath auto-completion and as the source for Quick Run';
			DocumentChangeHandler.contextStatusBarItem.tooltip = DocumentChangeHandler.statusBarTooltip(tooltip, isXslt);
			DocumentChangeHandler.contextStatusBarItem.text = `$(file-code) ${filename}`;
			DocumentChangeHandler.contextStatusBarItem.show();
			// the context file isn't shared by a stylesheet that runs on itself: shown for that stylesheet alone
			if (!docUri && isXslt && DocumentChangeHandler.selfSourceTask) {
				DocumentChangeHandler.selfSourceTask(activeDocument).then((taskLabel) => {
					if (taskLabel !== undefined && update === DocumentChangeHandler.statusBarUpdates) {
						const stylesheetName = path.basename(activeDocument.uri.path);
						DocumentChangeHandler.contextStatusBarItem.text = `$(file-code) ${stylesheetName} (itself)`;
						DocumentChangeHandler.contextStatusBarItem.tooltip = DocumentChangeHandler.statusBarTooltip(`Quick Run runs ${stylesheetName} on itself, as its own source document, with the task '${taskLabel}' - pick an XML context file to run it on that file instead`, true);
					}
				}, () => undefined);
			}
		} else {
			DocumentChangeHandler.contextStatusBarItem.hide();
		}
	}

	// for a stylesheet, with a link to its Quick Run task in tasks.json - the text is escaped, e.g. a file name's '_'
	private static statusBarTooltip(text: string, isXslt: boolean): string | vscode.MarkdownString {
		if (!isXslt) {
			return text;
		}
		const tooltip = new vscode.MarkdownString(undefined, true);
		tooltip.isTrusted = { enabledCommands: ['xslt-xpath.editQuickRunTask'] };
		tooltip.appendText(text);
		tooltip.appendMarkdown('\n\n[$(edit) Edit Quick Run Task](command:xslt-xpath.editQuickRunTask)');
		return tooltip;
	}

	// the context file in use and the status bar item again, for the active editor - e.g. when it changes, or after
	// tasks.json changes
	public static refreshStatusBarItem(): void {
		const document = vscode.window.activeTextEditor?.document;
		const languageId = document?.languageId;
		const show = languageId === 'xslt' || languageId === 'xpath' || languageId === 'dcp';
		// an XPath or DCP file uses the last one picked
		const lookup = show ? DocumentChangeHandler.useContextFor(languageId === 'xslt' ? document : undefined) : Promise.resolve();
		lookup.then(() => DocumentChangeHandler.updateStatusBarItem(show), () => DocumentChangeHandler.updateStatusBarItem(show));
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

	// the xmlns prefixes of an open XML file - e.g. the XML context file, for the 'Find Nodes with XPath' query file
	public static xmlnsPrefixesOf(uri: vscode.Uri): GlobalInstructionData[] | undefined {
		const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
		return document ? this.lexer.analyseLight(document.getText(), true) : undefined;
	}

	private static getLastDocXmlnsPrefixes() {
		if (DocumentChangeHandler.lastActiveXMLEditor) {
			DocumentChangeHandler.lastXMLDocumentGlobalData = this.lexer.analyseLight(DocumentChangeHandler.lastActiveXMLEditor.document.getText(), true);
		}
	}
}