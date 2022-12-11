import * as vscode from 'vscode';
import { CodeActionDocument } from './codeActionDocument';
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
	singleElement,
	multipleElement,
	attribute
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
	firstSymbol: vscode.DocumentSymbol;
	lastSymbol: vscode.DocumentSymbol;
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
		const { rangeTagType: roughSelectionType, firstTagName, lastTagName } = this.estimateSelectionType2(document, range);

		const testTitle = `${RangeTagType[roughSelectionType]} [${firstTagName}] [${lastTagName}]`;
		const codeActions: vscode.CodeAction[] = [];
		// debug only:
		codeActions.push(new vscode.CodeAction(testTitle, vscode.CodeActionKind.Empty));

		switch (roughSelectionType) {
			case RangeTagType.attribute:
				break;
			case RangeTagType.singleElement:
			case RangeTagType.multipleElement:
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

		const { document, range, firstSymbol, lastSymbol } = this.actionProps;


		const ancestorOrSelfSymbol: vscode.DocumentSymbol[] = [];
		let testSymbol: vscode.DocumentSymbol = lastSymbol;
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
		if (ancestorOrSelfCount < 3) return codeAction;
		const targetSymbolRange = ancestorOrSelfSymbol[ancestorOrSelfCount - 2].range;

		switch (codeAction.title) {
			case XsltCodeActionKind.extractXsltFunction:
				//this.addEditToCodeAction(codeAction, document, range, codeAction.title);
				const usedLastSymbol = lastSymbol? lastSymbol : firstSymbol;
				this.addTwoEditsToCodeAction(codeAction, document, range, targetSymbolRange, usedLastSymbol);
				break;
		}
		return codeAction;
	}

	private estimateSelectionType2(document: vscode.TextDocument, initRange: vscode.Range): { rangeTagType: RangeTagType; firstTagName: string; lastTagName: string } {
		let rangeTagType = RangeTagType.unknown,
			firstTagName = '',
			lastTagName = '',
			firstSymbol: possDocumentSymbol | undefined,
			lastSymbol: possDocumentSymbol | undefined;
		let range = initRange;

		const startPosition = range.start;
		const startLine = document.lineAt(startPosition.line).text;
		const startTagIndex = startLine.indexOf('<', startPosition.character);
		if (startTagIndex < 0) {
			firstSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.start);
			lastSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.end);
			if (firstSymbol && lastSymbol) {
				if (firstSymbol.range.isEqual(lastSymbol.range)) {
					if (firstSymbol.kind === vscode.SymbolKind.Event || firstSymbol.kind === vscode.SymbolKind.Field) {
						firstTagName = firstSymbol.name;
						lastSymbol = null;
						rangeTagType = RangeTagType.attribute;
					}
				}
			}
		} else {
			let endPosition = range.end;
			if (endPosition.character === 0) {
				const prevLineIndex = endPosition.line - 1;
				const prevLineEndChar = document.lineAt(prevLineIndex).range.end.character;
				endPosition = endPosition.with({line: prevLineIndex, character: prevLineEndChar});
				range = range.with({end: endPosition});
			}
			const endLine = document.lineAt(endPosition.line).text;
			const endTagIndex = endLine.lastIndexOf('>', endPosition.character);
			if (endTagIndex > -1) {
				firstSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.start.with({ character: startTagIndex }));
				lastSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.end.with({ character: endTagIndex }));
				if (firstSymbol && lastSymbol) {
					firstTagName = firstSymbol.name;
					if (firstSymbol.range.isEqual(lastSymbol.range)) {
						lastSymbol = null;
						rangeTagType = RangeTagType.singleElement;
					} else {
						if (lastSymbol.range.end.isAfter(firstSymbol.range.end)) {
							rangeTagType = RangeTagType.multipleElement;
							lastTagName = lastSymbol.name;
						}
					}
				}
			}
		}

		///const lastSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.end.with({ character: endTagPosition }))!;
		if (firstSymbol && lastSymbol) {
			this.actionProps = { document, range, firstSymbol, lastSymbol };
		}
		return { rangeTagType, firstTagName, lastTagName };
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
			const textPart2 = text.substring(charCount);
			return textPart1.trimLeft() + textPart2;
		}
	}

	private selectOrContentFromInstructionSymbol(document: vscode.TextDocument, elementSymbol: vscode.DocumentSymbol): { text: string; lines: number; isSelect: boolean } {
		const attributesSymbol = elementSymbol.children.find((item) => item.kind === vscode.SymbolKind.Array && item.name === 'attributes');
		if (attributesSymbol) {
			const selectAttributeSymbol = attributesSymbol.children.find((item) => item.name === 'select');
			if (selectAttributeSymbol) {
				const lines = (selectAttributeSymbol.range.end.line - selectAttributeSymbol.range.start.line) + 1;
				const linesFromStart = selectAttributeSymbol.range.start.line - elementSymbol.range.start.line;
				const linesToEnd = elementSymbol.range.end.line - selectAttributeSymbol.range.end.line;
				return { text: document.getText(selectAttributeSymbol.range), lines, isSelect: true };
			}
		}
		const childNodeSymbols = elementSymbol.children.filter((item) => item.kind !== vscode.SymbolKind.Array);
		let variableElementText = document.getText(elementSymbol.range);
		if (childNodeSymbols.length > 0) {
			if (attributesSymbol) {
				const foundAttributeRanges: vscode.Range[] = [];
				let attributesAdjacent = false;
				for (const attr of attributesSymbol.children) {
					if (attr.name === 'name' || attr.name === 'as') {
						if (foundAttributeRanges.length === 1) {
							if (attributesAdjacent) {
								foundAttributeRanges[0] = new vscode.Range(foundAttributeRanges[0].start, attr.range.end);
							} else {
								foundAttributeRanges.push(attr.range);
							}
							break;
						} else {
							foundAttributeRanges.push(attr.range);
							attributesAdjacent = true;
						}
					} else {
						attributesAdjacent = false;
					}
				}
				foundAttributeRanges.reverse();
				const elementStartPos = document.offsetAt(elementSymbol.range.start);
				for (const attrRange of foundAttributeRanges) {
					const deleteStartPos = document.offsetAt(attrRange.start) - elementStartPos;
					const deleteEndPos = document.offsetAt(attrRange.end) - elementStartPos;
					const beforeDelete2 = variableElementText.substring(0, deleteStartPos);
					const afterDelete2 = variableElementText.substring(deleteEndPos);

					variableElementText = beforeDelete2.trimRight() + afterDelete2;
				}
				variableElementText = '<xsl:sequence' + variableElementText.substring(13);
				const endTagPos = variableElementText.lastIndexOf('</');
				variableElementText = variableElementText.substring(0, endTagPos) + '</xsl:sequence>';
			}

			return { text: variableElementText, lines: 2, isSelect: false };
		}
		return { text: '', lines: 0, isSelect: false };
	}

	private addTwoEditsToCodeAction(codeAction: vscode.CodeAction, document: vscode.TextDocument, sourceRange: vscode.Range, targetRange: vscode.Range, finalSymbol: vscode.DocumentSymbol): vscode.CodeAction {
		const fullRange = this.extendRangeToFullLines(sourceRange);
		const firstCharOnFirstLine = document.lineAt(fullRange.start.line).firstNonWhitespaceCharacterIndex;
		const fullRangeWithoutLeadingWS = fullRange.with({ start: fullRange.start.translate(0, firstCharOnFirstLine) });
		codeAction.edit = new vscode.WorkspaceEdit();
		//codeAction.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), text);
		let replacementStart = '<xsl:sequence select="';
		const replcementFnCall = 'dx:extractFunction(';

		const functionHeadText = '\n\n\t<xsl:function name="dx:extractFunction">\n';
		let functionFootText = '\n\t</xsl:function>';
		let finalSymbolVariableName: string | null = null;

		let trimmedBodyText = '';
		const functionBodyText = document.getText(fullRange);
		const functionBodyLines = functionBodyText.substring(0, functionBodyText.length - 1).split('\n');
		const trimmedLines = functionBodyLines.map((line) => '\t\t' + this.trimLeadingWS(line, firstCharOnFirstLine));
		if (finalSymbol.name.startsWith('xsl:variable')) {
			const varNamePos = finalSymbol.name.lastIndexOf(' ');
			finalSymbolVariableName = finalSymbol.name.substring(varNamePos + 1);
			replacementStart = `<xsl:variable name="${finalSymbolVariableName}" as="item()*" select="`;
			const { text: selectText, lines, isSelect } = this.selectOrContentFromInstructionSymbol(document, finalSymbol);
			const selectTextLines = selectText.split('\n');
			const trimmedSelectTextLines = selectTextLines.map((line) => '\t\t' + this.trimLeadingWS(line, firstCharOnFirstLine));
			const preFinalBodyLines = trimmedLines.slice(0, finalSymbol.range.start.line - (sourceRange.start.line));
			const preFinalBodyText = preFinalBodyLines.join('\n');
			if (isSelect) {
				trimmedSelectTextLines[0] = trimmedSelectTextLines[0].trimLeft();
				const trimmedSelectText = trimmedSelectTextLines.join('\n');
				const finalSequenceText = '\n\t\t<xsl:sequence';
				const separator = lines === 1 ? ' ' : '\n\t\t\t';
				trimmedBodyText = preFinalBodyText + finalSequenceText + separator + trimmedSelectText + '/>';
			} else {
				const newLine = preFinalBodyText.length > 0 ? '\n' : '';
				trimmedBodyText = preFinalBodyText + newLine + trimmedSelectTextLines.join('\n');
			}
		} else {
			trimmedBodyText = trimmedLines.join('\n');
		}

		const interimFunctionText = functionHeadText + trimmedBodyText + functionFootText;
		const requiredParamNames = this.findBrokenVariableRefs(document, functionBodyLines.length, targetRange, interimFunctionText);

		const fnArgsString = requiredParamNames.map((arg) => '$' + arg).join(', ');
		const fnStartCharacter = firstCharOnFirstLine + replacementStart.length + 2;
		const replacementAll = replacementStart + replcementFnCall + fnArgsString + ')"/>\n';
		codeAction.edit.replace(document.uri, fullRangeWithoutLeadingWS, replacementAll);

		const functionParamLines = requiredParamNames.map((argName) => {
			return `\t\t<xsl:param name="${argName}"/>\n`;
		});

		const allFunctionText = functionHeadText + functionParamLines + trimmedBodyText + functionFootText;
		codeAction.edit.insert(document.uri, targetRange.end, allFunctionText);
		this.executeRenameCommand(fullRange.start.line, fnStartCharacter, document.uri);
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
			if (diagnostic.code === DiagnosticCode.unresolvedVariableRef && errorLine >= fnStartLine + 1 && errorLine <= fnStartLine + lineCount + 1) {
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

	private executeRenameCommand(lineNumber: number, charNumber: number, uri: vscode.Uri) {
		setTimeout(() => {
			if (vscode.window.activeTextEditor) {
				const position = new vscode.Position(lineNumber, charNumber);
				vscode.window.activeTextEditor.selection = new vscode.Selection(position, position);
				vscode.commands.executeCommand(XSLTCodeActions.COMMAND_RENAME, [
					uri,
					position
				]);
			}
		}, 250);
	}

	private createCommand(): vscode.CodeAction {
		const action = new vscode.CodeAction('Learn more...', vscode.CodeActionKind.Empty);
		action.command = { command: XSLTCodeActions.COMMAND, title: 'Learn more about emojis', tooltip: 'This will open the unicode emoji page.' };
		return action;
	}
}