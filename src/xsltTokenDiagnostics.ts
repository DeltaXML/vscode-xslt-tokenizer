/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState} from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken } from './xpLexer';

enum HasCharacteristic {
	unknown,
	yes,
	no
}

enum TagType {
	XSLTstart,
	XMLstart,
	XSLTvar,
	Start,
	NonStart
}

enum AttributeType {
	None,
	Variable
}

interface ElementData {
	variables: VariableData[]
	currentVariable?: VariableData,
	xpathVariableCurrentlyBeingDefined?: boolean;
}
interface XPathData {
	variables: VariableData[];
	preXPathVariable: boolean;
	xpathVariableCurrentlyBeingDefined: boolean;
}

interface VariableData {
	token: BaseToken,
	name: string;
}

export class XsltTokenDiagnostics {
	private static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	private static readonly xslVariable = ['xsl:variable', 'xsl:param'];
	private static readonly xslFunction = 'xsl:function';

	private static readonly xslNameAtt = 'name';

	public static calculateDiagnostics = (document: vscode.TextDocument, allTokens: BaseToken[]): vscode.Diagnostic[] => {
		let lineNumber = -1;

		let inScopeVariablesList: VariableData[] = [];
		let xpathVariableCurrentlyBeingDefined: boolean;
		let elementStack: ElementData[] = [];
		let inScopeXPathVariablesList: VariableData[] = [];
		let anonymousFunctionParamList: VariableData[] = [];
		let xpathStack: XPathData[] = [];
		let tagType = TagType.NonStart;
		let attType = AttributeType.None;
		let tagElementName = '';
		let preXPathVariable = false;
		let anonymousFunctionParams = false;
		let variableData: VariableData|null = null;
		let xsltVariableDeclarations: BaseToken[] = [];
		let prevToken: BaseToken|null = null;

		allTokens.forEach((token) => {
			lineNumber = token.line;

			let isXMLToken = token.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
			if (isXMLToken) {
				inScopeXPathVariablesList = [];
				xpathVariableCurrentlyBeingDefined = false;
				xpathStack = [];
				preXPathVariable = false;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenDiagnostics.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						if (tagType === TagType.Start) {
							tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							tagType = (XsltTokenDiagnostics.xslVariable.indexOf(tagElementName) > -1)? TagType.XSLTvar: TagType.XSLTstart;
						}
						break;
					case XSLTokenLevelState.elementName:
						if (tagType === TagType.Start) tagType = TagType.XMLstart;
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								variableData = null;
								tagElementName = '';
								tagType = TagType.Start;
								break;
							case XMLCharState.rStNoAtt:
							case XMLCharState.rSt:
								// start-tag ended, we're now within the new element scope:
								if (variableData != null) {
									elementStack.push({currentVariable: variableData, variables: inScopeVariablesList});
									xsltVariableDeclarations.push(variableData.token);
								} else {
									elementStack.push({variables: inScopeVariablesList});
								}
								inScopeVariablesList = [];
								tagType = TagType.NonStart;
								break;
							case XMLCharState.rSelfCt:
								// it may be a self-closed variable:
								if (variableData != null) {
									inScopeVariablesList.push(variableData);
									xsltVariableDeclarations.push(variableData.token);
								}
								break;
							case XMLCharState.lCt:
								// start of an element close-tag:
								if (elementStack.length > 0) {
									let poppedData = elementStack.pop();
									inScopeVariablesList = (poppedData)? poppedData.variables: [];
									if (poppedData?.currentVariable) {
										inScopeVariablesList.push(poppedData.currentVariable);
									}
								}
								break;
						}
						break;
					case XSLTokenLevelState.attributeName:
						if (tagType === TagType.XSLTvar) {
							let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							attType = attNameText === XsltTokenDiagnostics.xslNameAtt? AttributeType.Variable: AttributeType.None;
						}
						break;
					case XSLTokenLevelState.attributeValue:
						if (attType === AttributeType.Variable) {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
							variableData = {token: token, name: variableName};
						}
						attType = AttributeType.None;
						break;
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;

				switch (xpathTokenType) {
					case TokenLevelState.variable:
						if (preXPathVariable || anonymousFunctionParams) {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let currentVariable = {token: token, name: fullVariableName.substring(1)};
						    if (anonymousFunctionParams) {
								anonymousFunctionParamList.push(currentVariable);
								xsltVariableDeclarations.push(token);
							} else if (preXPathVariable && !xpathVariableCurrentlyBeingDefined) {
								inScopeXPathVariablesList.push(currentVariable);
								xpathVariableCurrentlyBeingDefined = true;
								xsltVariableDeclarations.push(token);
							} else if (xpathVariableCurrentlyBeingDefined) {
								// e.g.  with 'let $b := $a' the 'let $b' part has already occurred, the $a part needs to be resolved -  preXPathVariable is true also
								XsltTokenDiagnostics.resolveXPathVariableReference(document, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, xpathStack, inScopeVariablesList, elementStack);
							}
						} else {
							// don't include any current pending variable declarations when resolving
							XsltTokenDiagnostics.resolveXPathVariableReference(document, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, xpathStack, inScopeVariablesList, elementStack);
						}
						break;
					case TokenLevelState.complexExpression:
						let valueText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						switch (valueText) {
							case 'every':
							case 'for':
							case 'let':
							case 'some':
								preXPathVariable = true;
								break;
							case 'then':
								xpathStack.push({variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined});
								inScopeXPathVariablesList = [];
								break;
							case 'return':
							case 'satisfies':
								xpathVariableCurrentlyBeingDefined = false;
								preXPathVariable = false;
								break;
							case 'else':
								if (xpathStack.length > 0) {
									let poppedData = xpathStack.pop();
									inScopeXPathVariablesList = (poppedData)? poppedData.variables: [];
									preXPathVariable = false;
								} else {
									inScopeXPathVariablesList = [];
									preXPathVariable = false;
								}
								break;
						}
						break;
					case TokenLevelState.operator:
						switch (xpathCharType) {
							case CharLevelState.lBr:
								xpathStack.push({variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined});
								if (anonymousFunctionParams) {	
									// handle case: function($a) {$a + 8} pass params to inside '{...}'				
									inScopeXPathVariablesList = anonymousFunctionParamList;
									anonymousFunctionParamList = [];
									anonymousFunctionParams = false;
								} else {
									inScopeXPathVariablesList = [];
								}	
								preXPathVariable = false;
								xpathVariableCurrentlyBeingDefined = false;
								break;
							case CharLevelState.lB:
								// handle case: function($a)
								xpathStack.push({variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined});
								preXPathVariable = false;	
								xpathVariableCurrentlyBeingDefined = false;							
								if (!anonymousFunctionParams && prevToken?.tokenType !== TokenLevelState.nodeType) {
									anonymousFunctionParams = prevToken?.tokenType === TokenLevelState.anonymousFunction;
								}
								break;	
							case CharLevelState.lPr:
								xpathStack.push({variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined});
								preXPathVariable = false;	
								inScopeXPathVariablesList = [];
								xpathVariableCurrentlyBeingDefined = false;
								break;
							case CharLevelState.rB:
							case CharLevelState.rPr:
							case CharLevelState.rBr:
								if (xpathStack.length > 0) {
									let poppedData = xpathStack.pop();
									if (poppedData) {
										inScopeXPathVariablesList = poppedData.variables
										preXPathVariable = poppedData.preXPathVariable
										xpathVariableCurrentlyBeingDefined = poppedData.xpathVariableCurrentlyBeingDefined;
									} else {
										inScopeXPathVariablesList =  [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
								} else {
									// TODO: add diagnostics for missing close
								}
								break;
							case CharLevelState.sep:
								if (token.value === ',') {
									xpathVariableCurrentlyBeingDefined = false;
								}
								break;
						}
						break;
				}
			}
			prevToken = token;
		});
		return XsltTokenDiagnostics.getDiagnosticsFromUnusedVariableTokens(xsltVariableDeclarations);
	}

	private static getTextForToken(lineNumber: number, token: BaseToken, document: vscode.TextDocument) {
		let startPos = new vscode.Position(lineNumber, token.startCharacter);
		let endPos = new vscode.Position(lineNumber, token.startCharacter + token.length);
		const currentLine = document.lineAt(lineNumber);
		let valueRange = currentLine.range.with(startPos, endPos);
		let valueText = document.getText(valueRange);
		return valueText;
	}

	static resolveXPathVariableReference(document: vscode.TextDocument, token: BaseToken, xpathVariableCurrentlyBeingDefined: boolean, inScopeXPathVariablesList: VariableData[], xpathStack: XPathData[], inScopeVariablesList: VariableData[], elementStack: ElementData[]) {
		let fullVarName = XsltTokenDiagnostics.getTextForToken(token.line, token, document);
		let varName = fullVarName.substr(1);

		let resolved = this.resolveVariableName(inScopeXPathVariablesList, varName, xpathVariableCurrentlyBeingDefined);
		if (!resolved) {
			resolved = this.resolveStackVariableName(xpathStack, varName);			
		}
		if (!resolved) {
			resolved = this.resolveVariableName(inScopeVariablesList, varName, false);			
		}
		if (!resolved) {
			resolved = this.resolveStackVariableName(elementStack, varName);			
		}
		// TODO: add diagnostic for unresolved token

	}

	private static resolveVariableName(variableList: VariableData[], varName: string, xpathVariableCurrentlyBeingDefined: boolean): boolean {
		let resolved = false;
		let decrementedLength = variableList.length - 1;
		// last items in list of declared parameters must be resolved first:
		for (let i = decrementedLength; i > -1; i--) {
			let data = variableList[i];
			if (xpathVariableCurrentlyBeingDefined && i === decrementedLength) {
				// do nothing: we skip last item in list as it's currently being defined
			} else if (data.name === varName) {
				resolved = true;
				data.token['referenced'] = true;
				break;
			}
		}
		return resolved;
	}

	private static resolveStackVariableName(elementStack: ElementData[]|XPathData[], varName: string): boolean {
		let resolved = false;
		for (let i = elementStack.length - 1; i > -1; i--) {
			let inheritedVariables = elementStack[i].variables;
			let beingDefinedInit = elementStack[i].xpathVariableCurrentlyBeingDefined;
			let beingDefined = !(beingDefinedInit === undefined || beingDefinedInit === false);
			resolved = this.resolveVariableName(inheritedVariables, varName, beingDefined)
			if (resolved) {
				break;
			}
		}
		return resolved;
	}

	private static getDiagnosticsFromUnusedVariableTokens(tokens: BaseToken[]): vscode.Diagnostic[] {
		let result = [];
		for (let token of tokens) {
			if (token.referenced === undefined) {
				result.push(this.createUnusedVarDiagnostic(token));
			}
		}
		return result;
	}


	private static createUnusedVarDiagnostic(token: BaseToken): vscode.Diagnostic {
		let line = token.line;
		let endChar = token.startCharacter + token.length;
		return {
			code: '',
			message: 'variable is unused',
			range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
			severity: vscode.DiagnosticSeverity.Hint,
			tags: [vscode.DiagnosticTag.Unnecessary],
			source: '',
		}
	}

	private static createUnresolvedVarDiagnostic(document: vscode.TextDocument, token: BaseToken): vscode.Diagnostic {
		let line = token.line;
		let endChar = token.startCharacter + token.length;
		return {
			code: '',
			message: 'variable is unused',
			range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
			severity: vscode.DiagnosticSeverity.Hint,
			tags: [vscode.DiagnosticTag.Unnecessary],
			source: '',
			relatedInformation: [
				new vscode.DiagnosticRelatedInformation(new vscode.Location(document.uri, new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 9))), 'first assignment to `x`')
			]
		}
	}
}
