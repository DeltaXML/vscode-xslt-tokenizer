import * as vscode from 'vscode';

const COMMAND = 'code-actions-sample.command';
enum ElementSelectionType {
	unknown,
	multilineStartEnd,
	multilineStartStart
}
enum LineTagEndType {
	unknown,
	selfClose,
	endTag
}
enum LineTagStartType {
	unknown,
	startTag,
	closeTag,
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

export class XSLTCodeActions implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	public static COMMAND = 'code-actions-sample.command';
	private static tagNameRegex = new RegExp(/^([^\s|>]+)/);

	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] | undefined {
		const roughSelectionType = this.estimateSelectionType(document, range);
		if (this.estimateSelectionType(document, range) === RangeTagType.unknown) {
			return;
		}
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

		const testXSLTFix = this.createFix(document, range, fixText);

		const replaceWithSmileyFix = this.createFix(document, range, '😀');
		// Marking a single fix as `preferred` means that users can apply it with a
		// single keyboard shortcut using the `Auto Fix` command.
		replaceWithSmileyFix.isPreferred = true;

		const replaceWithSmileyHankyFix = this.createFix(document, range, '💩');

		const commandAction = this.createCommand();

		return [
			testXSLTFix,
			// replaceWithSmileyFix,
			// replaceWithSmileyHankyFix,
			commandAction
		];
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
		let result = RangeTagType.unknown;

		const startLine = document.lineAt(start.line);
		const { lineType: startLineTagStartType, tagName } = this.testTagLineStart(startLine);
		const { lineType: startLineTageEndType, endTagName }  = this.testTagLineEnd(startLine);
		if ((startLineTagStartType !== LineTagStartType.startTag) || (isSingleLine && (startLineTageEndType === LineTagEndType.unknown))) {
			return result;
		}
		if (isSingleLine) {
			if (startLineTageEndType === LineTagEndType.selfClose) {
				result = RangeTagType.selfCloseSingle;
			} else {
				result = (startLine.text.indexOf('</') > -1) ? RangeTagType.startCloseSingle : RangeTagType.startUnclosedSingle;
			}
		} else {
			const endLine = document.lineAt(end.line);
			//const endLineTagStartType = this.testTagLineStart(endLine);
		
			const { lineType: endLineTageEndType, endTagName: finalEndTagName }  = this.testTagLineEnd(endLine);

			if (endLineTageEndType === LineTagEndType.endTag || endLineTageEndType === LineTagEndType.selfClose) {
				result = RangeTagType.startCloseMulti;
			}

		}
		return result;

	}


	private testTagLineStart(anyLine: vscode.TextLine):StartLineProps {
		let lineType = LineTagStartType.unknown;
		let tagName = '';
		if (anyLine.firstNonWhitespaceCharacterIndex > anyLine.text.length - 2) {
			return { lineType, tagName };
		}

		const startLineChar = anyLine.text[anyLine.firstNonWhitespaceCharacterIndex];
		const startLineChar2 = anyLine.text[anyLine.firstNonWhitespaceCharacterIndex + 1];
		if (startLineChar === '<' && !(startLineChar2 === '?' || startLineChar2 === '!')) {
			const angleEnd = anyLine.text.indexOf('>', anyLine.firstNonWhitespaceCharacterIndex);
			const spaceEnd = anyLine.text.indexOf('>', anyLine.firstNonWhitespaceCharacterIndex);
			const tagNameEnd = anyLine.text.indexOf('>', anyLine.firstNonWhitespaceCharacterIndex);
			lineType = startLineChar2 === '/' ? LineTagStartType.closeTag : LineTagStartType.startTag;
			const matches = anyLine.text.match(XSLTCodeActions.tagNameRegex);
			if (matches) {
				tagName = matches[0];
			}
		}
		return { lineType, tagName };
	}

	private testTagLineEnd(anyLine: vscode.TextLine):EndLineProps {
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
		}
		return { lineType, endTagName };
	}

	private createFix(document: vscode.TextDocument, range: vscode.Range, text: string): vscode.CodeAction {
		const fix = new vscode.CodeAction(`Found ${text}`, vscode.CodeActionKind.QuickFix);
		fix.edit = new vscode.WorkspaceEdit();
		fix.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), text);
		return fix;
	}

	private createCommand(): vscode.CodeAction {
		const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.Empty);
		action.command = { command: COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
		return action;
	}
}