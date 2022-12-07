import * as vscode from 'vscode';
import { CodeActionDocument } from './codeActionDocument';
import { XSLTConfiguration } from './languageConfigurations';
import { possDocumentSymbol, SelectionType, XsltSymbolProvider } from './xsltSymbolProvider';
import { DiagnosticCode, XsltTokenDiagnostics } from './xsltTokenDiagnostics';


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
enum XsltCodeActionKind {
	extractXsltFunction = 'Extract XSLT function'
}

export class XSLTCodeActions implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	public static COMMAND_RENAME = 'editor.action.rename';
	public static COMMAND = 'code-actions-sample.command';

	private actionProps: ActionProps | null = null;
	private static tagNameRegex = new RegExp(/^([^\s|\/|>]+)/);

	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] | undefined {
		this.actionProps = { document, range };
		const { rangeTagType: roughSelectionType, firstTagName, lastTagName } = this.estimateSelectionType(document, range);

		const testTitle = `${RangeTagType[roughSelectionType]} [${firstTagName}] [${lastTagName}]`;
		const codeActions: vscode.CodeAction[] = [];
		// debug only:
		codeActions.push(new vscode.CodeAction(testTitle, vscode.CodeActionKind.Empty));

		switch (roughSelectionType) {
			case RangeTagType.startUnclosedSingle:
				break;
			case RangeTagType.startCloseSingle:
			case RangeTagType.selfCloseSingle:
			case RangeTagType.startCloseMulti:
				codeActions.push(new vscode.CodeAction(XsltCodeActionKind.extractXsltFunction, vscode.CodeActionKind.RefactorExtract));
				break;
			default:
				return;
		}

		// Marking a single fix as `preferred` means that users can apply it with a
		// single keyboard shortcut using the `Auto Fix` command.
		//replaceWithSmileyFix.isPreferred = true;

		// const commandAction = this.createCommand();
		// codeActions.push(commandAction);

		return codeActions;
	}

	async resolveCodeAction(codeAction: vscode.CodeAction, token: vscode.CancellationToken): Promise<vscode.CodeAction> {
		if (!this.actionProps) return codeAction;
	
		const { document, range } = this.actionProps;
		const startPosition = range.start;
		const startLine = document.lineAt(startPosition.line).text;
		const startTagIndex = startLine.indexOf('<');
		const startTagPosition = startPosition.with({ character: startTagIndex });
		const currentSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, startTagPosition);
		if (!currentSymbol) return codeAction;
		const endLine = document.lineAt(range.end.line);
		const endTagPosition = endLine.text.lastIndexOf('>');
		const finalSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.end.with({character: endTagPosition}))!;


        const ancestorOrSelfSymbol: vscode.DocumentSymbol[] = [];
        let testSymbol: vscode.DocumentSymbol = currentSymbol;
		// get parent symbol until we reach root element
		while (testSymbol) {
			ancestorOrSelfSymbol.push(testSymbol);
			const tempSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Parent, testSymbol.range.start);
			if (tempSymbol) {
				testSymbol = tempSymbol;
			} else {
				break;
			}
		}
		const ancestorOrSelfCount = ancestorOrSelfSymbol.length;
		if (ancestorOrSelfCount < 3 ) return codeAction;
		const targetSymbolRange = ancestorOrSelfSymbol[ancestorOrSelfCount - 2].range;


		console.log({ symbol: currentSymbol });
		switch (codeAction.title) {
			case XsltCodeActionKind.extractXsltFunction:
				//this.addEditToCodeAction(codeAction, document, range, codeAction.title);
				this.addTwoEditsToCodeAction(codeAction, document, range, targetSymbolRange, finalSymbol);
				break;
		}
		return codeAction;
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
			} else if ((startLine.text.indexOf('</') > -1)) {
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

	private createStubCodeAction(title: string): vscode.CodeAction {
		const fix = new vscode.CodeAction(title, vscode.CodeActionKind.RefactorExtract);
		return fix;
	}

	private addEditToCodeAction(codeAction: vscode.CodeAction, document: vscode.TextDocument, range: vscode.Range, text: string): vscode.CodeAction {
		const fullRange = this.extendRangeToFullLines(range);
		codeAction.edit = new vscode.WorkspaceEdit();
		//codeAction.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), text);
		codeAction.edit.replace(document.uri, fullRange, text);
		return codeAction;
	}

	private trimLeadingWS(text: string, charCount: number) {
		if (text.length < charCount) {
			return text.trimLeft();
		} else {
			const textPart1 = text.substring(0, charCount);
			const textPart2 = text.substring(charCount + 1);
			return textPart1.trimLeft() + textPart2;
		}
	}

	private addTwoEditsToCodeAction(codeAction: vscode.CodeAction, document: vscode.TextDocument, sourceRange: vscode.Range, targetRange: vscode.Range, finalSymbol: vscode.DocumentSymbol): vscode.CodeAction {
		const fullRange = this.extendRangeToFullLines(sourceRange);
		const firstCharOnFirstLine = document.lineAt(fullRange.start.line).firstNonWhitespaceCharacterIndex;
		const fullRangeWithoutLeadingWS = fullRange.with({start: fullRange.start.translate(0, firstCharOnFirstLine)});
		codeAction.edit = new vscode.WorkspaceEdit();
		//codeAction.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), text);
		let replacementStart = '<xsl:sequence select="';
		const replcementFnCall = 'fn:newFunction(';

		const functionHeadText = '\n\n\t<xsl:function name="fn:newFunction">\n';
		let functionFootText = '\n\t</xsl:function>';
		let finalSymbolVariableName: string|null = null;
		if (finalSymbol.name.startsWith('xsl:variable')) {
			const varNamePos = finalSymbol.name.lastIndexOf(' ');
			finalSymbolVariableName = finalSymbol.name.substring(varNamePos + 1);
		    replacementStart = `<xsl:variable name="${finalSymbolVariableName}" as="item()*" select="`;
		}
		const functionBodyText = document.getText(fullRange);
		const functionBodyLines = functionBodyText.substring(0, functionBodyText.length - 1).split('\n');
		const trimmedLines = functionBodyLines.map((line) => '\t\t' + this.trimLeadingWS(line, firstCharOnFirstLine - 1));
		const trimmedBodyText = trimmedLines.join('\n');

		const interimFunctionText = functionHeadText + trimmedBodyText + functionFootText;
        const requiredParamNames = this.findBrokenVariableRefs(document, trimmedLines.length, targetRange, interimFunctionText);

		const fnArgsString = requiredParamNames.map((arg) => '$' + arg).join(', ');
		const fnStartCharacter = firstCharOnFirstLine + replacementStart.length + 2;
		const replacementAll = replacementStart + replcementFnCall + fnArgsString + ')"/>\n';
		codeAction.edit.replace(document.uri, fullRangeWithoutLeadingWS, replacementAll);

		const functionParamLines = requiredParamNames.map((argName) => {
			return `\t\t<xsl:param name="${argName}"/>\n`;
		});

		const allFunctionText = functionHeadText + functionParamLines + trimmedBodyText + functionFootText;
		codeAction.edit.insert(document.uri, targetRange.end, allFunctionText);
		this.executeRenameCommand(fullRange.start.line, fnStartCharacter);
		return codeAction;
	}

	private findBrokenVariableRefs(document: vscode.TextDocument, lineCount: number, targetRange: vscode.Range, allFunctionText: string) {
		const virtualTextOriginal = document.getText();
		const virtualInseertPos = document.offsetAt(targetRange.end);
		const virtualTextUpdated = virtualTextOriginal.substring(0, virtualInseertPos) + allFunctionText + virtualTextOriginal.substring(virtualInseertPos);

		const caDocument = new CodeActionDocument(document.uri, virtualTextUpdated);
		const diagnostics = XsltSymbolProvider.instanceForXSLT!.calculateVirtualDiagnostics(caDocument);
		const fnStartLine = targetRange.end.line + 2;
		const brokenVariableNames: string[] = [];

		diagnostics.forEach((diagnostic) => {
			const errorLine = diagnostic.range.start.line;
			if (diagnostic.code === DiagnosticCode.unresolvedVariableRef && errorLine >= fnStartLine + 1 && errorLine <= fnStartLine + lineCount) {
				const varName = diagnostic.relatedInformation![0].message.substring(1);
				if (brokenVariableNames.indexOf(varName) < 0) {
					brokenVariableNames.push(varName);
				}
			}
		});
		return brokenVariableNames;

	}

	private extendRangeToFullLines(range: vscode.Range) {
		return new vscode.Range(range.start.with({ character: 0 }), range.end.with({ line: range.end.line + 1, character: 0 }));
	}

	private executeRenameCommand(lineNumber: number, charNumber: number) {
		setTimeout(() => {
			if (vscode.window.activeTextEditor) {
				const position = new vscode.Position(lineNumber, charNumber);
				vscode.window.activeTextEditor.selection = new vscode.Selection(position, position);
				vscode.commands.executeCommand(XSLTCodeActions.COMMAND_RENAME);
			}
		}, 250);
	}

	private createCommand(): vscode.CodeAction {
		const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.Empty);
		action.command = { command: XSLTCodeActions.COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
		return action;
	}
}