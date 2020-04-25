/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState} from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken, ErrorType } from './xpLexer';

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
	Variable,
	InstructionName,
	InstructionMode
}

interface XSLTToken extends BaseToken {
	tagType?: TagType
}

interface ElementData {
	variables: VariableData[]
	currentVariable?: VariableData,
	xpathVariableCurrentlyBeingDefined?: boolean;
	identifierToken: XSLTToken;
	symbolName: string;
	symbolID: string,
	childSymbols: vscode.DocumentSymbol[]
}
interface XPathData {
	token: BaseToken;
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
	private static readonly xslInclude = 'xsl:include';
	private static readonly xslImport = 'xsl:import';


	private static readonly xslFunction = 'xsl:function';
	private static xsltVariableReferences: BaseToken[] = [];


	private static readonly xslNameAtt = 'name';
	private static readonly xslModeAtt = 'mode';


	public static calculateDiagnostics = (document: vscode.TextDocument, allTokens: BaseToken[], symbols: vscode.DocumentSymbol[]): vscode.Diagnostic[] => {
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
		let startTagToken: XSLTToken|null = null;
		let preXPathVariable = false;
		let anonymousFunctionParams = false;
		let variableData: VariableData|null = null;
		let xsltVariableDeclarations: BaseToken[] = [];
		let xsltVariableReferences: BaseToken[] = [];
		let prevToken: BaseToken|null = null;
		let includeOrImport = false;
		let problemTokens: BaseToken[] = [];
		let topLevelSymbols: vscode.DocumentSymbol[] = symbols;
		let tagIdentifierName: string = '';
		let lastTokenIndex = allTokens.length - 1;

		allTokens.forEach((token, index) => {
			lineNumber = token.line;

			let isXMLToken = token.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
			if (isXMLToken) {
				inScopeXPathVariablesList = [];
				xpathVariableCurrentlyBeingDefined = false;
				if(xpathStack.length > 0) {
					// report last issue with nesting in each xpath:
					let lastLeftOver = xpathStack[xpathStack.length - 1].token;
					lastLeftOver['error'] = ErrorType.BracketNesting;
					problemTokens.push(lastLeftOver);
				};
				xpathStack = [];
				preXPathVariable = false;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenDiagnostics.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						if (tagType === TagType.Start) {
							tagType = (XsltTokenDiagnostics.xslVariable.indexOf(tagElementName) > -1)? TagType.XSLTvar: TagType.XSLTstart;
							let xsltToken: XSLTToken = token;
							xsltToken['tagType'] = tagType;
							startTagToken = token;

							if (!includeOrImport && tagType !== TagType.XSLTvar && elementStack.length === 1) {
								includeOrImport = tagElementName === XsltTokenDiagnostics.xslImport || tagElementName === XsltTokenDiagnostics.xslInclude;
							}
						}
						break;
					case XSLTokenLevelState.elementName:
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						if (tagType === TagType.Start) {
							tagType = TagType.XMLstart;
							startTagToken = token;
						}
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								tagIdentifierName = '';
								variableData = null;
								tagElementName = '';
								tagType = TagType.Start;
								break;
							case XMLCharState.rStNoAtt:
							case XMLCharState.rSt:
								// start-tag ended, we're now within the new element scope:
								if (variableData !== null) {
									if (startTagToken){
										elementStack.push({currentVariable: variableData, variables: inScopeVariablesList, 
											symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: []});
									}
									xsltVariableDeclarations.push(variableData.token);
								} else if (startTagToken) {
									elementStack.push({variables: inScopeVariablesList, symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: []});
								}
								inScopeVariablesList = [];
								tagType = TagType.NonStart;
								break;
							case XMLCharState.rSelfCt:
							case XMLCharState.rSelfCtNoAtt:
								// it may be a self-closed variable:
								if (variableData !== null) {
									inScopeVariablesList.push(variableData);
									xsltVariableDeclarations.push(variableData.token);
								}
								if (startTagToken) {
									let symbol = XsltTokenDiagnostics.createSymbolFromElementTokens(tagElementName, tagIdentifierName, startTagToken, token);
									if (symbol !== null) {
										if (elementStack.length > 0) {
											elementStack[elementStack.length - 1].childSymbols.push(symbol);
										} else {
											topLevelSymbols.push(symbol);
										}
									}
								}
								break;
							case XMLCharState.rCt:
								// end of an element close-tag:
								if (elementStack.length > 0) {
									let poppedData = elementStack.pop();
									if (poppedData) {
										if (poppedData.symbolName !== tagElementName) {
											let errorToken = poppedData.identifierToken;
											errorToken['error'] = ErrorType.ElementNesting;
											errorToken['value'] = poppedData.symbolName;
											problemTokens.push(errorToken);
											// not well-nested
											if (elementStack.length > 0 && elementStack[elementStack.length - 1].symbolName === tagElementName) {
												// recover for benefit of outline view
												poppedData = elementStack.pop();
											}
										}
								    }
									if (poppedData) {
										let symbol = XsltTokenDiagnostics.createSymbolFromElementTokens(poppedData.symbolName, poppedData.symbolID, poppedData.identifierToken, token);
										if (symbol !== null) {
											symbol.children = poppedData.childSymbols;
											// the parent symbol hasn't yet been created, but the elementStack parent is now the top item
											if (elementStack.length > 0) {
												elementStack[elementStack.length - 1].childSymbols.push(symbol);
											} else {
												topLevelSymbols.push(symbol);
											}
										}
										inScopeVariablesList = (poppedData)? poppedData.variables: [];
										if (poppedData.currentVariable) {
											inScopeVariablesList.push(poppedData.currentVariable);
										}
									}
								} else {

								}
								break;
						}
						break;
					case XSLTokenLevelState.attributeName:
						if (tagType === TagType.XSLTvar) {
							let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							attType = attNameText === XsltTokenDiagnostics.xslNameAtt? AttributeType.Variable: AttributeType.None;
						} else if (tagType === TagType.XSLTstart) {
							let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							if (attNameText === XsltTokenDiagnostics.xslNameAtt) {
								attType = AttributeType.InstructionName;
							} else if (attNameText === XsltTokenDiagnostics.xslModeAtt) {
								attType = AttributeType.InstructionMode;
							} else {
								attType = AttributeType.None;
							}
						}
						break;
					case XSLTokenLevelState.attributeValue:
						if (attType === AttributeType.Variable) {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
							tagIdentifierName = variableName;
							variableData = {token: token, name: variableName};
						} else if (attType === AttributeType.InstructionName) {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
							let slashPos = variableName.lastIndexOf('/');
							if (slashPos > 0) {
								// package name may be URI
								variableName = variableName.substring(slashPos + 1);
							}
							tagIdentifierName = variableName;
						} else if (attType === AttributeType.InstructionMode && tagIdentifierName === '') {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
							tagIdentifierName = variableName;
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
								let unResolvedToken = XsltTokenDiagnostics.resolveXPathVariableReference(document, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, 
									xpathStack, inScopeVariablesList, elementStack);
								if (unResolvedToken !== null) {
									xsltVariableReferences.push(unResolvedToken);
								}
							}
						} else {
							// don't include any current pending variable declarations when resolving
							let unResolvedToken = XsltTokenDiagnostics.resolveXPathVariableReference(document, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, xpathStack, inScopeVariablesList, elementStack);
							if (unResolvedToken !== null) {
								xsltVariableReferences.push(unResolvedToken);
							}
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
								xpathStack.push({token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined});
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
								xpathStack.push({token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined});
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
								if (!anonymousFunctionParams && prevToken?.tokenType !== TokenLevelState.nodeType) {
									anonymousFunctionParams = prevToken?.tokenType === TokenLevelState.anonymousFunction;
								}
								// intentionally no-break;	
							case CharLevelState.lPr:
								xpathStack.push({token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined});
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
								}
								if (token.error) {
									// any error should already have been added by lexer:
									problemTokens.push(token);
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
			if (index === lastTokenIndex && elementStack.length > 0) {
				// xml is now well-nested if items still on the stack at the end
				// but try to keep some part of the tree:
				let usedtoken = false;
				while (elementStack.length > 0) {
					let poppedData = elementStack.pop();
					let endToken: BaseToken;
					if (poppedData) {
						if (usedtoken) {
							// use final token as we don't know what the end token is 
							// but reduce lendth by one on each iteration - so its well nested
							endToken = token;
							endToken.length = endToken.length - 1;
						} else {
							endToken = token;
							usedtoken = true;
						}
						let symbol = XsltTokenDiagnostics.createSymbolFromElementTokens(poppedData.symbolName, poppedData.symbolID, poppedData.identifierToken, endToken);
						if (symbol !== null) {
							if (elementStack.length > 0) {
								console.log('**' + elementStack.length)
								elementStack[elementStack.length - 1].childSymbols.push(symbol);
							} else {
								console.log('-----tidied up------')
								topLevelSymbols.push(symbol);
							}
						}
					}

				}
			}
		});
		let variableRefDiagnostics = XsltTokenDiagnostics.getDiagnosticsFromUnusedVariableTokens(document, xsltVariableDeclarations, xsltVariableReferences, includeOrImport);
		let allDiagnostics = XsltTokenDiagnostics.appendDiagnosticsFromProblemTokens(variableRefDiagnostics, problemTokens);
		return allDiagnostics;
	}

	private static getTextForToken(lineNumber: number, token: BaseToken, document: vscode.TextDocument) {
		let startPos = new vscode.Position(lineNumber, token.startCharacter);
		let endPos = new vscode.Position(lineNumber, token.startCharacter + token.length);
		const currentLine = document.lineAt(lineNumber);
		let valueRange = currentLine.range.with(startPos, endPos);
		let valueText = document.getText(valueRange);
		return valueText;
	}

	static resolveXPathVariableReference(document: vscode.TextDocument, token: BaseToken, xpathVariableCurrentlyBeingDefined: boolean, inScopeXPathVariablesList: VariableData[], xpathStack: XPathData[], inScopeVariablesList: VariableData[], elementStack: ElementData[]): BaseToken|null {
		let fullVarName = XsltTokenDiagnostics.getTextForToken(token.line, token, document);
		let varName = fullVarName.substr(1);
		let result: BaseToken|null = null;

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
		if (!resolved) {
			result = token;
		}
		return result;
	}

	private static createSymbolFromElementTokens(name: string, id: string, fullStartToken: XSLTToken, fullEndToken: BaseToken, innerToken?: BaseToken) {
		// innerToken to be used if its an attribute-value for example
		let kind: vscode.SymbolKind;
		if (name.trim().length === 0) {
			return null;
		}
		switch (fullStartToken.tagType) {
			case TagType.XSLTvar:
				kind = vscode.SymbolKind.Enum;
				break;
			case TagType.XSLTstart:
				switch (name) {
					case 'xsl:package':
					case 'xsl:stylesheet':
					case 'xsl:transform':
						kind = vscode.SymbolKind.Package;
						break;
					case 'xsl:function':
						kind = vscode.SymbolKind.Function;
						break;
					case 'xsl:template':
						kind = vscode.SymbolKind.Interface;
						break;
					case 'xsl:if':
					case 'xsl:when':
					case 'xsl:otherwise':
						kind = vscode.SymbolKind.Namespace;
						break;
					case 'xsl:key':
						kind = vscode.SymbolKind.Key;
						break;
					case 'xsl:sequence':
						kind = vscode.SymbolKind.Module;
						break;
					case 'xsl:value-of':
					case 'xsl:text':
						kind = vscode.SymbolKind.String;
						break;
					case 'xsl:for-each':
					case 'xsl:for-each-group':
					case 'xsl:apply-templates':
						kind = vscode.SymbolKind.EnumMember;
						break;
					case 'xsl:import':
					case 'xsl:include':
						kind = vscode.SymbolKind.File;
						break;
					case 'xsl:choose':
						kind = vscode.SymbolKind.TypeParameter;
						break;
					default:
						kind = vscode.SymbolKind.Object;
						break;
				}
				break;
			case TagType.XMLstart:
				kind = vscode.SymbolKind.Object;
				break;
			default:
				kind = vscode.SymbolKind.Null;
				break;

		}
		let startCharPos = fullStartToken.startCharacter > 0? fullStartToken.startCharacter - 1: 0;
		let startPos = new vscode.Position(fullStartToken.line, startCharPos);
		let endPos = new vscode.Position(fullEndToken.line, fullEndToken.startCharacter + fullEndToken.length + 1);
		let innerStartPos;
		let innerEndPos;
		if (innerToken) {
			innerStartPos = new vscode.Position(innerToken.line, innerToken.startCharacter);
			innerEndPos = new vscode.Position(innerToken.line, innerToken.startCharacter + innerToken.length);		
		} else {
			innerStartPos = new vscode.Position(fullStartToken.line, fullStartToken.startCharacter);
			innerEndPos = new vscode.Position(fullEndToken.line, fullStartToken.startCharacter + fullStartToken.length);	
		}
		let fullRange = new vscode.Range(startPos, endPos);
		let innerRange = new vscode.Range(innerStartPos, innerEndPos);
		// check for error!
		if (!fullRange.contains(innerRange)) {
			innerStartPos = new vscode.Position(fullStartToken.line, fullStartToken.startCharacter);
			innerEndPos= new vscode.Position(fullStartToken.line, fullStartToken.startCharacter + fullStartToken.length);
			innerRange = new vscode.Range(innerStartPos, innerEndPos);
		}
		let detail = '';
		let fullSymbolName = id.length > 0? name + ' \u203A ' + id: name;

		if (fullRange.contains(innerRange)) {
			return new vscode.DocumentSymbol(fullSymbolName, detail, kind, fullRange, innerRange);
		} else {
			return null;
		}
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

	private static getDiagnosticsFromUnusedVariableTokens(document: vscode.TextDocument, unusedVariableTokens: BaseToken[], unresolvedVariableTokens: BaseToken[], includeOrImport: boolean): vscode.Diagnostic[] {
		let result = [];
		for (let token of unusedVariableTokens) {
			if (token.referenced === undefined) {
				result.push(this.createUnusedVarDiagnostic(token));
			}
		}
		for (let token of unresolvedVariableTokens) {
				result.push(this.createUnresolvedVarDiagnostic(document, token, includeOrImport));
		}
		return result;
	}

	private static appendDiagnosticsFromProblemTokens(variableRefDiagnostics: vscode.Diagnostic[], tokens: BaseToken[]): vscode.Diagnostic[] {
		tokens.forEach(token => {
			let line = token.line;
			let endChar = token.startCharacter + token.length;
			let tokenValue = token.value;
			let msg: string;
			switch (token.error) {
				case ErrorType.BracketNesting:
					let matchingChar: any = XsltTokenDiagnostics.getMatchingSymbol(tokenValue);
					msg = matchingChar.length === 0? `XPath: No match found for '${tokenValue}'`: `'${tokenValue}' has no matching '${matchingChar}'`;
					break;
				case ErrorType.ElementNesting:
					msg = `XML: Start tag '${tokenValue} has no matching close tag`;
					break;
				default:
					msg = 'Unexepected Error';
					break;
			}

			variableRefDiagnostics.push({
				code: '',
				message: msg,
				range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
				severity: vscode.DiagnosticSeverity.Error,
				tags: [vscode.DiagnosticTag.Unnecessary],
				source: ''
			});
		});
		return variableRefDiagnostics;
	}



	private static getMatchingSymbol(text: string) {
		let r = '';
		switch(text) {
			case '(':
				r = ')';
				break;
			case '[':
				r = ']';
				break;
			case '{':
				r = '}';
				break;
			case ')':
				r = '(';
				break;
			case ']':
				r = '[';
				break;
			case '}':
				r = '{';
				break;
			case 'then':
				r = 'else';
				break;
			case 'else':
				r = 'then';
				break;
			default:
				r = '';
				break;				
		}
		return r;	
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

	private static createUnresolvedVarDiagnostic(document: vscode.TextDocument, token: BaseToken, includeOrImport: boolean): vscode.Diagnostic {
		let line = token.line;
		let endChar = token.startCharacter + token.length;
		if (includeOrImport) {
			return {
				code: '',
				message: `The variable/parameter: ${token.value} cannot be resolved here, but it may be defined in an external module.`,
				range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
				severity: vscode.DiagnosticSeverity.Warning
			}
		} else {
			return {
				code: '',
				message: `The variable/parameter ${token.value} cannot be resolved`,
				range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
				severity: vscode.DiagnosticSeverity.Error
			}
		}
	}
}
