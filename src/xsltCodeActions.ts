import * as vscode from 'vscode';

const COMMAND = 'code-actions-sample.command';
enum ElementSelectionType {
	unknown,
	multilineStartEnd,
	multilineStartStart
}

enum LineTagStartType {
	unknown,
	startTag,  // <abc
	closeTag,  // </abc
}
enum LineTagEndType {
	unknown,
	selfClose, // abc/>
	endTag     // abc>
}
enum RangeTagType {
	unknown,
	startUnclosedSingle,
	startCloseSingle,
	selfCloseSingle,
	startCloseMulti,
}
interface StartLineProps {
	lineType: LineTagStartType;
	tagName: string;
}
interface EndLineProps {
	lineType: LineTagEndType;
	endTagName: string;
}
interface ActionProps {
	document: vscode.TextDocument;
	range: vscode.Range;
}

export class XSLTCodeActions implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	public static COMMAND = 'code-actions-sample.command';
	private actionProps: ActionProps|null = null;
	private static tagNameRegex = new RegExp(/^([^\s|\/|>]+)/);

	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] | undefined {
		this.actionProps = { document, range };
		const { rangeTagType: roughSelectionType, firstTagName, lastTagName } = this.estimateSelectionType(document, range);

		let fixText = "unset";
		switch (roughSelectionType) {
			case RangeTagType.startUnclosedSingle:
				fixText = RangeTagType[roughSelectionType];
				break;
			case RangeTagType.startCloseSingle:
				fixText = RangeTagType[roughSelectionType];
				break;
			case RangeTagType.selfCloseSingle:
				fixText = RangeTagType[roughSelectionType];
				break;
			case RangeTagType.startCloseMulti:
				fixText = RangeTagType[roughSelectionType];
				break;
			default:
				return;
		}

		fixText = `${fixText} [${firstTagName}] [${lastTagName}]`;

		const testXSLTFix = this.createStubFix(fixText);


		// Marking a single fix as `preferred` means that users can apply it with a
		// single keyboard shortcut using the `Auto Fix` command.
		//replaceWithSmileyFix.isPreferred = true;

		const commandAction = this.createCommand();

		return [
			testXSLTFix,
			commandAction
		];
	}

	resolveCodeAction(codeAction: vscode.CodeAction, token: vscode.CancellationToken): vscode.CodeAction {
		if (!this.actionProps) {
			return codeAction;
		}
		const { document, range } = this.actionProps;
        return this.addFix(codeAction, document, range, codeAction.title);
	}

	private estimateSelectionType(document: vscode.TextDocument, range: vscode.Range) {
		/*
		returns:
			unknown,
			startCloseSingle,
			selfCloseSingle,
			startCloseMulti,
		*/
		const start = range.start;
		const end = range.end;
		const isSingleLine = start.line === end.line;
		let rangeTagType = RangeTagType.unknown;
		let firstTagName = '';
		let lastTagName = '';

		const startLine = document.lineAt(start.line);
		const { lineType: startLineTagStartType, tagName } = this.testTagLineStart(startLine);
		const { lineType: startLineTageEndType, endTagName } = this.testTagLineEnd(startLine);
		firstTagName = tagName;

		if ((startLineTagStartType !== LineTagStartType.startTag) || (isSingleLine && (startLineTageEndType === LineTagEndType.unknown))) {
			return { rangeTagType, firstTagName, lastTagName };
		}
		if (isSingleLine) {
			lastTagName = endTagName;
			if (firstTagName !== lastTagName) {
				// unknown still
			} else if (startLineTageEndType === LineTagEndType.selfClose) {
				rangeTagType = RangeTagType.selfCloseSingle;
			} else if ((startLine.text.indexOf('</') > -1) ) {
				rangeTagType = RangeTagType.startCloseSingle;
			} else {
				rangeTagType = RangeTagType.startUnclosedSingle;
			}
		} else {
			const endLine = document.lineAt(end.line);
			//const endLineTagStartType = this.testTagLineStart(endLine);

			const { lineType: endLineTageStartType, tagName: finalStartTagName } = this.testTagLineStart(endLine);
			const { lineType: endLineTageEndType, endTagName: finalEndTagName } = this.testTagLineEnd(endLine);
			lastTagName = finalEndTagName;

			if (endLineTageEndType === LineTagEndType.endTag || endLineTageEndType === LineTagEndType.selfClose) {
				rangeTagType = RangeTagType.startCloseMulti;
			}
		}
		return { rangeTagType, firstTagName, lastTagName };
	}

	private testTagLineStart(anyLine: vscode.TextLine): StartLineProps {
		let lineType = LineTagStartType.unknown;
		let tagName = '';
		if (anyLine.firstNonWhitespaceCharacterIndex > anyLine.text.length - 2) {
			return { lineType, tagName };
		}

		const startLineChar = anyLine.text[anyLine.firstNonWhitespaceCharacterIndex];
		const startLineChar2 = anyLine.text[anyLine.firstNonWhitespaceCharacterIndex + 1];
		if (startLineChar === '<' && !(startLineChar2 === '?' || startLineChar2 === '!')) {
			lineType = startLineChar2 === '/' ? LineTagStartType.closeTag : LineTagStartType.startTag;
			const offset = lineType === LineTagStartType.closeTag ? 2 : 1;
			const matches = anyLine.text.substring(anyLine.firstNonWhitespaceCharacterIndex + offset).match(XSLTCodeActions.tagNameRegex);
			if (matches) {
				tagName = matches[0];
			}
		}
		return { lineType, tagName };
	}

	private testTagLineEnd(anyLine: vscode.TextLine): EndLineProps {
		const trimStartLineRight = anyLine.text.trimRight();
		let endTagName = '';
		let lineType = LineTagEndType.unknown;
		if (trimStartLineRight.length < 2) {
			return { lineType, endTagName };
		}
		const lenOfTrimStartLine = trimStartLineRight.length;
		const startLineFinalChar = trimStartLineRight[lenOfTrimStartLine - 1];
		const startLineFinalCharBar1 = trimStartLineRight[lenOfTrimStartLine - 2];
		if (startLineFinalChar === '>' && !(startLineFinalCharBar1 === '?' || startLineFinalCharBar1 === '-')) {
			lineType = startLineFinalCharBar1 === '/' ? LineTagEndType.selfClose : LineTagEndType.endTag;
			const finalTagPos = anyLine.text.lastIndexOf('<');
			if (finalTagPos > -1 && finalTagPos < anyLine.text.length - 3) {
				const isCloseTagStart = anyLine.text.charAt(finalTagPos + 1) === '/';
				const offset = (isCloseTagStart) ? 2 : 1;
				const matches = anyLine.text.substring(finalTagPos + offset).match(XSLTCodeActions.tagNameRegex);
				if (matches) {
					endTagName = matches[0];
				}
			}
		}
		return { lineType, endTagName };
	}

	private createStubFix(title: string): vscode.CodeAction {
		const fix = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
		return fix;
	}

	private addFix(codeAction: vscode.CodeAction, document: vscode.TextDocument, range: vscode.Range, text: string): vscode.CodeAction {
		codeAction.edit = new vscode.WorkspaceEdit();
		codeAction.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), text);
		return codeAction;
	}

	private createCommand(): vscode.CodeAction {
		const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.Empty);
		action.command = { command: COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
		return action;
	}
}