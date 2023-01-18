import * as vscode from 'vscode';
import { CodeActionDocument } from './codeActionDocument';
import { XPathSemanticTokensProvider } from './extension';
import { XSLTConfiguration } from './languageConfigurations';
import { SchemaQuery } from './schemaQuery';
import { Data, XPathLexer } from './xpLexer';
import { possDocumentSymbol, SelectionType, XsltSymbolProvider } from './xsltSymbolProvider';
import { XsltTokenDefinitions } from './xsltTokenDefintions';
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
	xpathAttribute,
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
	firstSymbol: anyDocumentSymbol;
	lastSymbol: anyDocumentSymbol;
	expandTextVal: string | undefined;
}
export type anyDocumentSymbol = vscode.DocumentSymbol | undefined | null;

enum XsltCodeActionKind {
	extractXsltFunction = 'xsl:function - full refactor',
	extractXsltFunctionPartial = 'xsl:function - partial refactor',
	extractXsltTemplate = 'xsl:template',
	extractXsltVariable = 'xsl:variable',
	extractXsltFunctionFmXPath = 'xsl:function (XPath) - full refactor',
	extractXsltFunctionFmXPathPartial = 'xsl:function (XPath) - partial refactor',
}

enum ExtractFunctionParams {
	context = 'c.x',
	position = 'c.p',
	last = 'c.l',
	currentGroup = 'g.current',
	currentGroupingKey = 'g.key',
	currentMergeGroup = 'm.current',
	currentMergeGroupMap = 'm.groups',
	currentMergeKey = 'm.key',
	regexGroup = 'r.group'
}

export class XSLTCodeActions implements vscode.CodeActionProvider {

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix,
		vscode.CodeActionKind.Refactor
	];

	public static COMMAND_RENAME = 'editor.action.rename';
	public static COMMAND = 'code-actions-sample.command';
	private static regexForRegexGroup = new RegExp(/'regex-group\(\s*(\d+)\s*\)'$/);
	private static regexForVariable = new RegExp(/\$[^\s]+/);
	private schemaQuery = new SchemaQuery(XSLTConfiguration.schemaData4);
	private expectedElementData = this.schemaQuery.getExpected('xsl:function').elements;
	private expectedElementNames = this.expectedElementData.map((item) => item[0]);
	private static regexForAVT = new RegExp(/([^{}]+)|(\{[^\}]+})/g);

	private actionProps: ActionProps | null = null;
	private xpathTokenProvider = new XPathSemanticTokensProvider();

	public provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] | undefined {
		const { rangeTagType: roughSelectionType, firstTagName, lastTagName } = this.estimateSelectionType(document, range);

		const testTitle = `${RangeTagType[roughSelectionType]} [${firstTagName}] [${lastTagName}]`;
		let codeActions: vscode.CodeAction[] | undefined = [];
		// debug only:
		//codeActions.push(new vscode.CodeAction(testTitle, vscode.CodeActionKind.Empty));

		switch (roughSelectionType) {

			case RangeTagType.xpathAttribute:
				codeActions.push(new vscode.CodeAction(XsltCodeActionKind.extractXsltVariable, vscode.CodeActionKind.RefactorExtract));
				codeActions.push(new vscode.CodeAction(XsltCodeActionKind.extractXsltFunctionFmXPath, vscode.CodeActionKind.RefactorExtract));
				codeActions.push(new vscode.CodeAction(XsltCodeActionKind.extractXsltFunctionFmXPathPartial, vscode.CodeActionKind.RefactorExtract));
				break;
			case RangeTagType.singleElement:
			case RangeTagType.multipleElement:
				codeActions.push(new vscode.CodeAction(XsltCodeActionKind.extractXsltFunction, vscode.CodeActionKind.RefactorExtract));
				codeActions.push(new vscode.CodeAction(XsltCodeActionKind.extractXsltFunctionPartial, vscode.CodeActionKind.RefactorExtract));
				codeActions.push(new vscode.CodeAction(XsltCodeActionKind.extractXsltTemplate, vscode.CodeActionKind.RefactorExtract));
				break;
			default:
				codeActions = undefined;
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
		const usedLastSymbol = lastSymbol ? lastSymbol : firstSymbol;

		const ancestorOrSelfSymbols = this.populateAncestorArray(usedLastSymbol);
		const symbolKind = firstSymbol?.kind;
		const extraDescendants = symbolKind === vscode.SymbolKind.Event || symbolKind === vscode.SymbolKind.Field ? 1 : 0;
		const ancestorOrSelfCount = ancestorOrSelfSymbols.length;
		if (ancestorOrSelfCount < 3 + extraDescendants) return codeAction;
		const targetSymbolRange = ancestorOrSelfSymbols[ancestorOrSelfCount - 2].range;

		switch (codeAction.title) {
			case XsltCodeActionKind.extractXsltFunction:
			case XsltCodeActionKind.extractXsltFunctionPartial:
			case XsltCodeActionKind.extractXsltTemplate:
				const nullAttrParentRange = null;
				this.addExtractFunctionEdits(codeAction, document, range, targetSymbolRange, usedLastSymbol, nullAttrParentRange);
				break;
			case XsltCodeActionKind.extractXsltFunctionFmXPath:
			case XsltCodeActionKind.extractXsltFunctionFmXPathPartial:
			case XsltCodeActionKind.extractXsltVariable:
				let validAttrParent = ancestorOrSelfSymbols[1];
				if (validAttrParent.name === 'xsl:when') validAttrParent = ancestorOrSelfSymbols[2];
				const attrParentRange = validAttrParent.range;
				this.addExtractFunctionEdits(codeAction, document, range, targetSymbolRange, usedLastSymbol, attrParentRange);
				break;
		}
		return codeAction;
	}

	private populateAncestorArray(testSymbol: anyDocumentSymbol) {
		const ancestorOrSelfSymbol: vscode.DocumentSymbol[] = [];
		while (testSymbol) {
			ancestorOrSelfSymbol.push(testSymbol);
			const tempSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Parent, testSymbol.range.start);
			if (tempSymbol) {
				testSymbol = tempSymbol;
			} else {
				break;
			}
		}
		return ancestorOrSelfSymbol;
	}

	private estimateSelectionType(document: vscode.TextDocument, initRange: vscode.Range): { rangeTagType: RangeTagType; firstTagName: string; lastTagName: string } {
		let rangeTagType = RangeTagType.unknown,
			firstTagName = '',
			lastTagName = '',
			firstSymbol: possDocumentSymbol | undefined,
			lastSymbol: possDocumentSymbol | undefined;
		let range = initRange;

		const startPosition = range.start;
		const startLine = document.lineAt(startPosition.line).text;
		const startTagIndex = startLine.indexOf('<', startPosition.character);
		const expandText: string[] = [];
		if (startTagIndex < 0 && !range.isEmpty) {
			firstSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.start, expandText);
			lastSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.end);
			const rangeInsideAttributeFirstSymbol = firstSymbol && firstSymbol.range.contains(range);

			if (firstSymbol && lastSymbol && rangeInsideAttributeFirstSymbol) {
				if (firstSymbol.range.isEqual(lastSymbol.range)) {
					let isXPathAttribute = firstSymbol.kind === vscode.SymbolKind.Event;
					if (!isXPathAttribute && firstSymbol.kind === vscode.SymbolKind.Field) {
						// check if AVT
						isXPathAttribute = document.getText(firstSymbol.range).includes('{');
					} else if (!isXPathAttribute) {
						// not an attribute so check if TVT
						let et = expandText[expandText.length - 1];
						et = et.length > 3 ? et.substring(1, et.length - 1) : et;
						const isExpanded = (et === 'yes' || et === 'true' || et === '1');
						if (isExpanded) {
							isXPathAttribute = document.getText(firstSymbol.range).includes('{');
						}
					}
					if (isXPathAttribute) {
						const startCharOfAttrValue = XSLTCodeActions.getAttrStartFromSymbol(document, firstSymbol);
						const startCharOfSelection = document.offsetAt(range.start);
						if (startCharOfSelection >= startCharOfAttrValue) {
							const xpathText = document.getText(range);
							const diagnostics = this.xpathTokenProvider.provideXPathProblems(new CodeActionDocument(document.uri, xpathText));
							const blockingIssue = diagnostics.find((item) => item.severity !== vscode.DiagnosticSeverity.Hint && item.code !== DiagnosticCode.unresolvedGenericRef && item.code !== DiagnosticCode.unresolvedVariableRef);
							if (!blockingIssue) {
								let pass = xpathText.length > 30;
								if (!pass) {
									// we need an expression other than just a name or whitespace
									for (let i = 0; i < xpathText.length; i++) {
										if (Data.estimatorSeparators.indexOf(xpathText.charAt(i)) > -1) {
											pass = true;
											break;
										}
									}
								}
								if (pass) {
									firstTagName = firstSymbol.name;
									lastSymbol = null;
									rangeTagType = RangeTagType.xpathAttribute;
								}
							}
						}
					}
				}
			}
		} else {
			let endPosition = range.end;
			if (endPosition.character === 0) {
				const prevLineIndex = endPosition.line - 1;
				const prevLineEndChar = document.lineAt(prevLineIndex).range.end.character;
				endPosition = endPosition.with({ line: prevLineIndex, character: prevLineEndChar });
				range = range.with({ end: endPosition });
			}
			const endLine = document.lineAt(endPosition.line).text;
			const endTagIndex = endLine.lastIndexOf('>', endPosition.character);
			if (endTagIndex > -1) {
				firstSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.start.with({ character: startTagIndex }), expandText);
				lastSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.end.with({ character: endTagIndex }));
				const firstSymbolInsideRange = firstSymbol && range.contains(firstSymbol.range);
				const lastSymbolInsideRange = lastSymbol && range.contains(lastSymbol.range);
				if (firstSymbol && lastSymbol && firstSymbolInsideRange && lastSymbolInsideRange) {
					const isSameSymbol = firstSymbol.range.isEqual(lastSymbol.range);
					const parentSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Parent, firstSymbol.range.start);

					let allRangeElementsOK = true;
					if (parentSymbol) {                        
						if (isSameSymbol) {
							if (firstSymbol.name.startsWith('xsl:')) {
								const spacePos = firstSymbol.name.indexOf(' ');
								const realName = spacePos > -1 ? firstSymbol.name.substring(0, spacePos) : firstSymbol.name;
								allRangeElementsOK = realName !== 'xsl:param' && this.expectedElementNames.includes(realName);
							}
						} else {
							const parentSymbolLast = XsltSymbolProvider.symbolForXMLElement(SelectionType.Parent, lastSymbol.range.start);
							allRangeElementsOK = !!parentSymbolLast && parentSymbol.range.isEqual(parentSymbolLast.range);
							if (allRangeElementsOK) {
								for (const sibling of parentSymbol.children) {
									if (sibling.kind !== vscode.SymbolKind.Array && sibling.range.end.isAfterOrEqual(firstSymbol.range.start) && sibling.range.start.isBeforeOrEqual(lastSymbol.range.end)) {
										if ((sibling.range.start.isAfterOrEqual(firstSymbol.range.start) && sibling.range.end.isAfter(lastSymbol.range.end)) ||
											(sibling.range.end.isBeforeOrEqual(lastSymbol.range.end) && sibling.range.start.isBefore(firstSymbol.range.start))) {
											allRangeElementsOK = false;
											break;
										} else if (sibling.name.startsWith('xsl:')) {
											const spacePos = sibling.name.indexOf(' ');
											const realName = spacePos > -1 ? sibling.name.substring(0, spacePos) : sibling.name;
											if (realName === 'xsl:param' || !this.expectedElementNames.includes(realName)) {
												allRangeElementsOK = false;
												break;
											}
										}
									}
								}
							}
						}
					}
					if (allRangeElementsOK) {
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
		}

		const expandTextVal: string | undefined = expandText[expandText.length - 1];

		///const lastSymbol = XsltSymbolProvider.symbolForXMLElement(SelectionType.Current, range.end.with({ character: endTagPosition }))!;
		this.actionProps = { document, range, firstSymbol, lastSymbol, expandTextVal };

		return { rangeTagType, firstTagName, lastTagName };
	}

	public static getAttrStartFromSymbol(document: vscode.TextDocument, docSymbol: vscode.DocumentSymbol) {
		const fullText = document.getText(docSymbol.range);
		const sqPos = fullText.indexOf('\'');
		const dqPos = fullText.indexOf('"');
		const bothSingleAndDouble = sqPos > -1 && dqPos > -1;
		const qPos = bothSingleAndDouble ? Math.min(sqPos, dqPos) : Math.max(sqPos, dqPos);
		const startCharOfAttrValue = document.offsetAt(docSymbol.range.start) + qPos + 1;
		return startCharOfAttrValue;
	}

	public static getAttrValueFromSymbol(document: vscode.TextDocument, docSymbol: vscode.DocumentSymbol) {
		const fullText = document.getText(docSymbol.range);
		const sqPos = fullText.indexOf('\'');
		const dqPos = fullText.indexOf('"');
		const bothSingleAndDouble = sqPos > -1 && dqPos > -1;
		const qPos = bothSingleAndDouble ? Math.min(sqPos, dqPos) : Math.max(sqPos, dqPos);
		const attrValue = fullText.substring(qPos + 1, fullText.length - 1);
		const avtMatches = attrValue.match(XSLTCodeActions.regexForAVT);
		if (avtMatches) {
			const parts: string[] = [];
			avtMatches.forEach((avt) => {
				if (avt.charAt(0) === '{') {
					parts.push(avt.substring(1, avt.length - 1));
				} else {
					parts.push('\'' + avt + '\'');
				}
			});
			return parts.join('||');
		} else return '';
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

	private addExtractFunctionEdits(codeAction: vscode.CodeAction, document: vscode.TextDocument, sourceRange: vscode.Range, targetRange: vscode.Range, finalSymbol: anyDocumentSymbol, attrParentRange: vscode.Range|null): vscode.CodeAction {
		const elementSelected = !attrParentRange;
		const forXSLTVariable = codeAction.title === XsltCodeActionKind.extractXsltVariable;
		const forXSLTemplate = codeAction.title === XsltCodeActionKind.extractXsltTemplate;
		const partialRefactor = codeAction.title === XsltCodeActionKind.extractXsltFunctionPartial || codeAction.title === XsltCodeActionKind.extractXsltFunctionFmXPathPartial;
		let fullRange = sourceRange;
		let fullRangeWithoutLeadingWS = sourceRange;
		const firstCharOnFirstLine = document.lineAt(fullRange.start.line).firstNonWhitespaceCharacterIndex;
		if (elementSelected) {
			fullRange = this.extendRangeToFullLines(sourceRange);
			fullRangeWithoutLeadingWS = fullRange.with({ start: fullRange.start.translate(0, firstCharOnFirstLine) });
		}
		const finalSymbolOnFirstLine = sourceRange.start.line === finalSymbol?.range.start.line;

		codeAction.edit = new vscode.WorkspaceEdit();
		//codeAction.edit.replace(document.uri, new vscode.Range(range.start, range.start.translate(0, 2)), text);
		const sequenceInstructionStart = '<xsl:sequence select="';
		const expandTextString = this.actionProps?.expandTextVal ? ' expand-text=' + this.actionProps.expandTextVal : '';
		const instrName = forXSLTemplate ? 'template' : forXSLTVariable ? 'variable' : 'function';
		const callName = forXSLTemplate ? 'dx:extractTemplate' : forXSLTVariable ? 'dx:extractVariable' : 'dx:extractFunction';
		const functionHeadText = `\n\n\t<xsl:${instrName} name="${callName}"${expandTextString} as="item()*">\n`;
		const functionFootText = `\n\t</xsl:${instrName}>`;
		let finalSymbolVariableName: string | null = null;

		let trimmedBodyText = '';
		const functionBodyText = document.getText(fullRange);
		const functionBodyLines = functionBodyText.trimRight().split('\n');
		let functionBodyLinesCount = functionBodyLines.length;
		const indent = elementSelected ? '\t\t' : forXSLTVariable ? '' : '\t\t\t';
		const trimmedLines = functionBodyLines.map((line) => indent + this.trimLeadingWS(line, firstCharOnFirstLine));
		const replacementIsVariable = finalSymbol && finalSymbol.name.startsWith('xsl:variable');

		if (replacementIsVariable) {
			const varNamePos = finalSymbol.name.lastIndexOf(' ');
			finalSymbolVariableName = finalSymbol.name.substring(varNamePos + 1);
			const { text: selectText, lines, isSelect } = this.selectOrContentFromInstructionSymbol(document, finalSymbol);
			const selectTextLines = selectText.split('\n');
			const trimmedSelectTextLines = selectTextLines.map((line) => '\t\t' + this.trimLeadingWS(line, firstCharOnFirstLine));
			const preFinalBodyLines = trimmedLines.slice(0, finalSymbol.range.start.line - (sourceRange.start.line));
			const preFinalBodyText = preFinalBodyLines.join('\n');
			if (isSelect) {
				trimmedSelectTextLines[0] = trimmedSelectTextLines[0].trimLeft();
				const trimmedSelectText = trimmedSelectTextLines.join('\n');
				let finalSequenceText = '\t\t<xsl:sequence';
				if (!finalSymbolOnFirstLine) {
					finalSequenceText = '\n' + finalSequenceText;
					functionBodyLinesCount++;
				}
				const separator = lines === 1 ? ' ' : '\n\t\t\t';
				trimmedBodyText = preFinalBodyText + finalSequenceText + separator + trimmedSelectText + '/>';
			} else {
				const newLine = preFinalBodyText.length > 0 ? '\n' : '';
				trimmedBodyText = preFinalBodyText + newLine + trimmedSelectTextLines.join('\n');
			}
		} else if (elementSelected || forXSLTVariable) {
			trimmedBodyText = trimmedLines.join('\n');
		} else {
			const trimmedLinesText = trimmedLines.join('\n');
			trimmedBodyText = '\t\t' + sequenceInstructionStart + '\n' + trimmedLinesText + '"/>';
			functionBodyLinesCount++; // we've added an extra line
		}

		const interimFunctionText = functionHeadText + trimmedBodyText + functionFootText;
		const { requiredArgNames, requiredParamNames, quickfixDiagnostics, addRegexMapInstruction, addMergeGroupMapInstruction } = this.findEvalContextErrors(document, functionBodyLinesCount, targetRange, interimFunctionText);
		const varTypeMap: Map<string, string> = new Map();
		const mergeNames: string[] = [];
		XsltSymbolProvider.findVariableTypeAtSymbol(finalSymbol, requiredParamNames, varTypeMap, mergeNames);

		let fixedTrimmedBodyTextLines: string[] = [];
		let finalCorrectText: string;
		if (quickfixDiagnostics.length === 0 || partialRefactor) {
			finalCorrectText = trimmedBodyText;
		} else {
			this.fixFunctionBodyProblems(trimmedBodyText, targetRange, quickfixDiagnostics, fixedTrimmedBodyTextLines, addRegexMapInstruction);
			finalCorrectText = fixedTrimmedBodyTextLines.reverse().join('\n');
		}

		// replacement-text:
		let replacementAll = '';
		const prefixWS = this.getWhitespaceBeforeExpression(document, fullRange);
		let fnStartCharacter = -1;
		if (forXSLTemplate) {
			const ctPrefix = replacementIsVariable ? prefixWS + '\t' : prefixWS;
			const firstCtPrefix = replacementIsVariable ? ctPrefix : '';
			const addParams = requiredParamNames.length > 0;
			const selfCloseChar = addParams ? '' : '/';
			const ctReplacementStart = firstCtPrefix + '<xsl:call-template name="';
			const replacementLines: string[] = [ctReplacementStart + callName + '"' + selfCloseChar + '>'];
			fnStartCharacter = firstCharOnFirstLine + ctReplacementStart.length + 2;

			if (addParams) {
				requiredParamNames.forEach((paramName, index) => replacementLines.push(ctPrefix + `\t<xsl:with-param name="${paramName}" select="${requiredArgNames[index]}"/>`));
				replacementLines.push(ctPrefix + '</xsl:call-template>');
			}
			if (replacementIsVariable) {
				// wrap with xsl:variable instruction
				replacementLines.unshift(`<xsl:variable name="${finalSymbolVariableName}" as="item()*">`);
				replacementLines.push(prefixWS + `</xsl:variable>`);
			}
			replacementAll = replacementLines.join('\n') + "\n";
		} else {
			let replacementStart = sequenceInstructionStart;
			replacementStart = replacementIsVariable ? `<xsl:variable name="${finalSymbolVariableName}" as="item()*" select="` : replacementStart;
			const fnArgsString = requiredArgNames.map((arg) => arg).join(', ');
			const replcementFnCall = callName + '(';
			let instrText = '';
			if (forXSLTVariable) {
				replacementAll = '$' + callName;
				instrText = `<xsl:variable name="${callName}" as="item()*" select="${trimmedBodyText}"/>\n`;
			} else if (addRegexMapInstruction) {
				instrText = '<xsl:variable name="regex-group" select="map:merge(for $k in 0 to 99 return map:entry($k, regex-group($k)))"/>\n';
				if (elementSelected) instrText += prefixWS;
			}
			if (addMergeGroupMapInstruction) {
				instrText += `<xsl:variable name="merge-groups" select="map:merge(for $k in (${mergeNames.join(',')}) return map:entry($k, current-merge-group($k)))"/>\n`; 
				if (elementSelected) instrText += prefixWS;
			}
			if (elementSelected) {
				fnStartCharacter = firstCharOnFirstLine + replacementStart.length + 2;
				replacementAll = instrText + replacementStart + replcementFnCall + fnArgsString + ')"/>\n';
			} else {
				fnStartCharacter = prefixWS.length + fullRange.start.character + 2;
				if (!forXSLTVariable) replacementAll = prefixWS + replcementFnCall + fnArgsString + ')';
				const parentStartLine = document.lineAt(attrParentRange.start.line);
				const firstCharOnFirstLine = parentStartLine.firstNonWhitespaceCharacterIndex;
				if (instrText.length > 0) {
					const wsBeforeFirstChar = parentStartLine.text.substring(0, firstCharOnFirstLine);
					instrText += wsBeforeFirstChar;
				}
				codeAction.edit.insert(document.uri, attrParentRange.start, instrText);
			}

		}
		codeAction.edit.replace(document.uri, fullRangeWithoutLeadingWS, replacementAll);

		const functionParamLines = requiredParamNames.map((argName) => {
			let argType = (argName === ExtractFunctionParams.position || argName === ExtractFunctionParams.last) ?
				'xs:integer' :
				argName === ExtractFunctionParams.currentMergeGroupMap ?
					'map(xs:string, item()*)' :
					argName === ExtractFunctionParams.regexGroup ?
						'map(xs:integer, xs:string)' :
						argName.startsWith(ExtractFunctionParams.regexGroup) ?
							'xs:string' :
							'item()*';
			const typeFromMap = varTypeMap.get(argName);
			argType = typeFromMap ? typeFromMap : argType;
			return `\t\t<xsl:param name="${argName}" as="${argType}"/>\n`;
		});

		const allFunctionText = functionHeadText + functionParamLines.join('') + finalCorrectText + functionFootText;
		if (!forXSLTVariable) {
			codeAction.edit.insert(document.uri, targetRange.end, allFunctionText);
		}
		let fnStartLineIncrement = (replacementIsVariable && forXSLTemplate) || addRegexMapInstruction ? 1 : 0;
		if (addMergeGroupMapInstruction) fnStartLineIncrement++;
		this.executeRenameCommand(fullRange.start.line + fnStartLineIncrement, fnStartCharacter, document.uri);
		return codeAction;
	}

	private getWhitespaceBeforeExpression(document: vscode.TextDocument, fullRange: vscode.Range) {
		const expressionLine = document.lineAt(fullRange.start.line);
		const charIndexOfNonWSonLine = expressionLine.firstNonWhitespaceCharacterIndex;
		const wsCharsBeforeSelection = charIndexOfNonWSonLine - fullRange.start.character;
		const prefixWS = expressionLine.text.substring(0, wsCharsBeforeSelection);
		return prefixWS;
	}

	private fixFunctionBodyProblems(trimmedBodyText: string, targetRange: vscode.Range, quickfixDiagnostics: vscode.Diagnostic[], fixedTrimmedBodyTextLines: string[], addRegexMapInstruction: boolean) {
		const finalTrimmedBodyTextLines = trimmedBodyText.split('\n');
		const firstInsertionLine = targetRange.end.line + 3;
		let currentDiagnosticPos = quickfixDiagnostics.length - 1;
		for (let line = finalTrimmedBodyTextLines.length - 1; line > -1; line--) {
			const absLine = firstInsertionLine + line;
			let currentLine = finalTrimmedBodyTextLines[line];
			while (currentDiagnosticPos > -1) {
				let currentDiagnostic = quickfixDiagnostics[currentDiagnosticPos];
				const rangeStart = currentDiagnostic.range.start.character;
				const rangeEnd = currentDiagnostic.range.end.character;
				const rangeLine = currentDiagnostic.range.start.line;
				if (rangeLine < absLine) {
					// dont goto previous diagnostic rangeLine we need to go back to the previous line
					break;
				} else {
					if (rangeLine === absLine && currentDiagnostic.code) {
						const errCode = <DiagnosticCode>currentDiagnostic.code;
						let substitution: undefined | string;
						switch (errCode) {
							case DiagnosticCode.noContextItem:
								const lineRangeText = currentLine.substring(rangeStart, rangeEnd);
								substitution = '$' + ExtractFunctionParams.context;
								if (lineRangeText === '.') {
									currentLine = currentLine.substring(0, rangeStart) + substitution + currentLine.substring(rangeEnd);
								} else {
									substitution += '/';
									currentLine = currentLine.substring(0, rangeStart) + substitution + currentLine.substring(rangeStart);
								}
								break;
							case DiagnosticCode.rootWithNoContextItem:
								// insert '$__c' before /
								substitution = `root($${ExtractFunctionParams.context})`;
								currentLine = currentLine.substring(0, rangeStart) + substitution + currentLine.substring(rangeStart);
								break;
							case DiagnosticCode.fnWithNoContextItem:
								// add context argument
								substitution = ExtractFunctionParams.context;
								const fnEnd = currentLine.indexOf(')', rangeEnd);
								if (fnEnd > -1) {
									currentLine = currentLine.substring(0, fnEnd) + '$' + substitution + currentLine.substring(fnEnd);
								}
								break;
							case DiagnosticCode.groupOutsideMerge:
								substitution = substitution ? substitution : '$' + ExtractFunctionParams.currentMergeGroupMap;
							case DiagnosticCode.rootOnlyWithNoContextItem:
								// replace
								substitution = substitution ? substitution : `root($${ExtractFunctionParams.context})`;
								currentLine = currentLine.substring(0, rangeStart) + substitution + currentLine.substring(rangeEnd);
								break;
							case DiagnosticCode.instrWithNoContextItem:
								const isXslCopy = currentDiagnostic.message.endsWith('\'xsl:copy\'');
								// append select="..."
								substitution = isXslCopy ? ` select="$${ExtractFunctionParams.context}"` : ` select="$${ExtractFunctionParams.context}/node()"`;
								currentLine = currentLine.substring(0, rangeEnd) + substitution + currentLine.substring(rangeEnd);
								break;
							case DiagnosticCode.groupOutsideForEachGroup:
								const groupRangeText = currentLine.substring(rangeStart, rangeEnd);
								switch (groupRangeText) {
									case 'current-group':
										substitution = ExtractFunctionParams.currentGroup;
										break;
									case 'current-grouping-key':
										substitution = ExtractFunctionParams.currentGroupingKey;
										break;
									case 'current-merge-group':
										substitution = ExtractFunctionParams.currentMergeGroup;
										break;
									case 'current-merge-key':
										substitution = ExtractFunctionParams.currentMergeKey;
										break;
								}
							case DiagnosticCode.currentWithNoContextItem:
								substitution = substitution ? substitution : ExtractFunctionParams.context;
							case DiagnosticCode.lastWithNoContextItem:
								substitution = substitution ? substitution : ExtractFunctionParams.last;
							case DiagnosticCode.positionWithNoContextItem:
								// replace with $var reference or root($context)
								substitution = substitution ? substitution : ExtractFunctionParams.position;
								const pEnd = currentLine.indexOf(')', rangeEnd);
								if (pEnd > -1) {
									currentLine = currentLine.substring(0, rangeStart) + '$' + substitution + currentLine.substring(pEnd + 1);
								}
								break;
							case DiagnosticCode.regexNoContextItem:
								if (currentDiagnostic.relatedInformation && !addRegexMapInstruction) {
									const groupNum = currentDiagnostic.relatedInformation[0].message;
									substitution = '$' + ExtractFunctionParams.regexGroup + '.' + groupNum;
									const fnEnd2 = currentLine.indexOf(')', rangeEnd);
									if (fnEnd2 > -1) {
										currentLine = currentLine.substring(0, rangeStart) + substitution + currentLine.substring(fnEnd2 + 1);
									}
								} else {
									substitution = '$' + ExtractFunctionParams.regexGroup; // $c.regex-group()
									currentLine = currentLine.substring(0, rangeStart) + substitution + currentLine.substring(rangeEnd);
								}
								break;
						}
					} else {
						// rangeLine > line so keep going to previous diagnostic rangeLine
					}
					currentDiagnosticPos--;
				}
			}
			fixedTrimmedBodyTextLines.push(currentLine);
		}
	}

	private findEvalContextErrors(document: vscode.TextDocument, lineCount: number, targetRange: vscode.Range, allFunctionText: string) {
		const virtualTextOriginal = document.getText();
		const virtualInseertPos = document.offsetAt(targetRange.end);
		const virtualTextUpdated = virtualTextOriginal.substring(0, virtualInseertPos) + allFunctionText + virtualTextOriginal.substring(virtualInseertPos);

		const caDocument = new CodeActionDocument(document.uri, virtualTextUpdated);
		const diagnostics = XsltSymbolProvider.instanceForXSLT!.calculateVirtualDiagnostics(caDocument);
		const fnStartLine = targetRange.end.line + 2;

		const requiredParamNames: string[] = [];
		const requiredArgNames: string[] = [];
		const quickfixDiagnostics: vscode.Diagnostic[] = [];

		let hasContextParam = false;
		let hasPosParam = false;
		let hasLastParam = false;
		let hasCurrentGroupParam = false;
		let hasCurrentGroupingKeyParam = false;
		let hasCurrentMergeParam = false;
		let hasCurrentMergeKeyParam = false;
		let addRegexMapInstruction = false;
		let addMergeGroupMapInstruction = false;
		let numberedRegexGroupParams: string[] = [];

		diagnostics.forEach((diagnostic) => {
			const errorLine = diagnostic.range.start.line;
			if (errorLine >= fnStartLine + 1 && errorLine <= fnStartLine + lineCount + 1) {
				switch (diagnostic.code) {
					case DiagnosticCode.unresolvedVariableRef:
						const varNameMatch = diagnostic.message.match(XSLTCodeActions.regexForVariable);
						if (varNameMatch && varNameMatch.length === 1) {
							const varName = varNameMatch[0].substring(1);
							if (requiredParamNames.indexOf(varName) < 0) { requiredParamNames.push(varName); requiredArgNames.push('$' + varName); }
						}
						break;
					case DiagnosticCode.groupOutsideMerge:
						addMergeGroupMapInstruction = true;
						quickfixDiagnostics.push(diagnostic);
						break;
					case DiagnosticCode.instrWithNoContextItem:
					case DiagnosticCode.fnWithNoContextItem:
					case DiagnosticCode.noContextItem:
					case DiagnosticCode.rootWithNoContextItem:
					case DiagnosticCode.rootOnlyWithNoContextItem:
					case DiagnosticCode.currentWithNoContextItem:
						quickfixDiagnostics.push(diagnostic);
						hasContextParam = true;
						break;
					case DiagnosticCode.lastWithNoContextItem:
						quickfixDiagnostics.push(diagnostic);
						hasLastParam = true;
						break;
					case DiagnosticCode.positionWithNoContextItem:
						quickfixDiagnostics.push(diagnostic);
						hasPosParam = true;
						break;
					case DiagnosticCode.groupOutsideForEachGroup:
						quickfixDiagnostics.push(diagnostic);
						const text = caDocument.getText(diagnostic.range);
						if (text === 'current-group') {
							hasCurrentGroupParam = true;
						} else if (text === 'current-grouping-key') {
							hasCurrentGroupingKeyParam = true;
						} else if (text === 'current-merge-group') {
							hasCurrentMergeParam = true;
						} else if (text === 'current-merge-key') {
							hasCurrentMergeKeyParam = true;
						}
						break;
					case DiagnosticCode.regexNoContextItem:
						const regexGroupNum = diagnostic.message.match(XSLTCodeActions.regexForRegexGroup);
						if (regexGroupNum && regexGroupNum.length === 2) {
							const groupNum = regexGroupNum[1];
							if (!numberedRegexGroupParams.includes(groupNum)) numberedRegexGroupParams.push(groupNum);
							if (numberedRegexGroupParams.length > 2) addRegexMapInstruction = true;
							const errData = [new vscode.DiagnosticRelatedInformation(new vscode.Location(document.uri, diagnostic.range), groupNum)];
							diagnostic.relatedInformation = errData;
						} else {
							addRegexMapInstruction = true;
						}
						quickfixDiagnostics.push(diagnostic);
						break;
				}
			}
		});
		// put special params before params needed for variables - unshift:
		if (hasCurrentMergeKeyParam) {
			requiredArgNames.unshift('current-merge-key()');
			requiredParamNames.unshift(ExtractFunctionParams.currentMergeKey);
		}
		if (hasCurrentMergeParam) {
			requiredArgNames.unshift('current-merge-group()');
			requiredParamNames.unshift(ExtractFunctionParams.currentMergeGroup);
		}
		if (!addRegexMapInstruction) {
			numberedRegexGroupParams.reverse().forEach((gp) => {
				requiredArgNames.unshift('regex-group(' + gp + ')');
				requiredParamNames.unshift(ExtractFunctionParams.regexGroup + '.' + gp);
			});
		}
		if (addMergeGroupMapInstruction) {
			requiredArgNames.unshift('$merge-groups');
			requiredParamNames.unshift(ExtractFunctionParams.currentMergeGroupMap);
		}
		if (addRegexMapInstruction) {
			requiredArgNames.unshift('$regex-group');
			requiredParamNames.unshift(ExtractFunctionParams.regexGroup);
		}
		if (hasCurrentGroupingKeyParam) {
			requiredArgNames.unshift('current-grouping-key()');
			requiredParamNames.unshift(ExtractFunctionParams.currentGroupingKey);
		}
		if (hasCurrentGroupParam) {
			requiredArgNames.unshift('current-group()');
			requiredParamNames.unshift(ExtractFunctionParams.currentGroup);
		}
		if (hasLastParam) {
			requiredArgNames.unshift('last()');
			requiredParamNames.unshift(ExtractFunctionParams.last);
		}
		if (hasPosParam) {
			requiredArgNames.unshift('position()');
			requiredParamNames.unshift(ExtractFunctionParams.position);
		}
		if (hasContextParam) {
			requiredArgNames.unshift('.');
			requiredParamNames.unshift(ExtractFunctionParams.context);
		}
		return { requiredArgNames, requiredParamNames, quickfixDiagnostics, addRegexMapInstruction, addMergeGroupMapInstruction };
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