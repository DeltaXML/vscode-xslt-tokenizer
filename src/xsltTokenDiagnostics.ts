/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, GlobalInstructionData, GlobalInstructionType} from './xslLexer';
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
	childSymbols: vscode.DocumentSymbol[],
	namespacePrefixes: string[]
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

enum NameValidationError {
	None,
	NamespaceError,
	NameError
}

enum ValidationType {
	XMLAttribute,
	PrefixedName,
	Name
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

	private static validateName(name: string, type: ValidationType, startCharRgx: RegExp, charRgx: RegExp, xmlnsPrefixes: string[]): NameValidationError {
		let valid = NameValidationError.None
		if (name.trim().length === 0) {
			return NameValidationError.NameError;
		}
		if (type === ValidationType.XMLAttribute) {
			if (name === 'xml:space' || name === 'xml:lang') {
				return NameValidationError.None;
			}
		}
		let nameParts = name.split(':');
		if (nameParts.length > 2) {
			return NameValidationError.NameError;
		} else {
			if (nameParts.length === 2) {
				let prefix = nameParts[0];
				valid = xmlnsPrefixes.indexOf(prefix) > -1? NameValidationError.None: NameValidationError.NamespaceError;
			}
			if (valid === NameValidationError.None) {
				nameParts.forEach(namePart => {
					if (valid === NameValidationError.None) {
						let charsOK = true;
						let firstChar = true;
						let charExists = false;
						for (let s of namePart) {
							if (firstChar) {
								firstChar = false;
								charExists = true;
								charsOK = startCharRgx.test(s);
								if (!charsOK) {
									break;
								}
							} else {
								charsOK = charRgx.test(s);
								if (!charsOK) {
									break;
								}
							}
						}
						valid = charExists && charsOK? NameValidationError.None: NameValidationError.NameError;
					}				
				});
			}
		}
		return valid;
	}


	public static calculateDiagnostics = (document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], symbols: vscode.DocumentSymbol[]): vscode.Diagnostic[] => {
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
		let tagAttributeNames: string[] = [];
		let tagXmlnsNames: string[] = [];
		let inheritedPrefixes: string[] = [];
		let globalVariableData: VariableData[] = [];
		globalInstructionData.forEach((instruction) => {
			if (instruction.type === GlobalInstructionType.Variable || instruction.type === GlobalInstructionType.Parameter) {
				globalVariableData.push({token: instruction.token, name: instruction.name })
			}
		});
		let nameStartCharRgx = new RegExp(/[A-Z]|_|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);
		let nameCharRgx = new RegExp(/-|\.|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]|[A-Z]|_|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);


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
								tagAttributeNames = [];
								tagXmlnsNames = [];
								tagIdentifierName = '';
								variableData = null;
								tagElementName = '';
								tagType = TagType.Start;
								break;
							case XMLCharState.rStNoAtt:
							case XMLCharState.rSt:
							case XMLCharState.rSelfCt:
							case XMLCharState.rSelfCtNoAtt:
								// start-tag ended, we're now within the new element scope:
								let orginalPrefixes = inheritedPrefixes.slice();
								tagXmlnsNames.forEach((attName) => {
									// only need 'xmlns:pfx' - not default xmlns
									if (attName.length > 6) {
										let prefix = attName.substring(6);
										if (inheritedPrefixes.indexOf(prefix) < 0) {
											inheritedPrefixes.push(prefix);
										}
									}
								});
								let attsWithXmlnsErrors: string[] = [];
								let attsWithNameErrors: string[] = [];
								tagAttributeNames.forEach((attName) => {
									let validateResult = XsltTokenDiagnostics.validateName(attName, ValidationType.XMLAttribute, nameStartCharRgx, nameCharRgx, inheritedPrefixes);
									if (validateResult === NameValidationError.NameError) {
										attsWithNameErrors.push(attName);
									} else if (validateResult === NameValidationError.NamespaceError) {
										attsWithXmlnsErrors.push(attName);
									}
								});

								if (startTagToken) {
									if (attsWithNameErrors.length > 0) {
										startTagToken['error'] = ErrorType.XMLAttributeName;
										startTagToken['value'] = tagElementName + '\': \'' + attsWithNameErrors.join('\', ');
										problemTokens.push(startTagToken);
									} else if (attsWithXmlnsErrors.length > 0) {
										startTagToken['error'] = ErrorType.XMLAttributeXMLNS;
										startTagToken['value'] = tagElementName + '\': \'' + attsWithXmlnsErrors.join('\', ');
										problemTokens.push(startTagToken);
									} else {
										let validationError = XsltTokenDiagnostics.validateName(tagElementName, ValidationType.PrefixedName, nameStartCharRgx, nameCharRgx, inheritedPrefixes);
										if (validationError !== NameValidationError.None) {
											startTagToken['error'] = validationError === NameValidationError.NameError? ErrorType.XMLName: ErrorType.XMLXMLNS;
											startTagToken['value'] = tagElementName;
											problemTokens.push(startTagToken);
										}
									}
								}

								if (xmlCharType === XMLCharState.rStNoAtt || xmlCharType === XMLCharState.rSt) {
									// on a start tag
									let inheritedPrefixesCopy = inheritedPrefixes.slice();
									// if top-level element add global variables - these include following variables also:
									let newVariablesList = elementStack.length === 0? globalVariableData: inScopeVariablesList;
									//let newVariablesList = inScopeVariablesList;
									if (variableData !== null) {
										if (startTagToken){
											// TODO: if a top-level element, use global variables instad of inScopeVariablesList;
											elementStack.push({namespacePrefixes: inheritedPrefixesCopy, currentVariable: variableData, variables: newVariablesList, 
												symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: []});
										}
										xsltVariableDeclarations.push(variableData.token);
									} else if (startTagToken) {
										elementStack.push({namespacePrefixes: inheritedPrefixesCopy, variables: newVariablesList, symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: []});
									}
									inScopeVariablesList = [];
									tagType = TagType.NonStart;

								} else {
									// self-closed tag: xmlns declarations on this are no longer in scope
									inheritedPrefixes = orginalPrefixes;
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
								}

								break;
							case XMLCharState.rCt:
								// end of an element close-tag:
								if (elementStack.length > 0) {
									let poppedData = elementStack.pop();
									if (poppedData) {
										if (poppedData.symbolName !== tagElementName) {											
											let errorToken = Object.assign({}, poppedData.identifierToken);
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
										inheritedPrefixes = poppedData.namespacePrefixes.slice();
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
					case XSLTokenLevelState.xmlnsName:
						let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let problemReported = false;
						if (prevToken) {
							if (token.startCharacter - (prevToken.startCharacter + prevToken.length) === 0) {
								problemReported = true;
								token['error'] = ErrorType.XMLAttNameSyntax;
								token['value'] = attNameText;
								problemTokens.push(token);
							}
						}
						if (!problemReported && token.charType === XMLCharState.syntaxError && prevToken && !prevToken.error) {
							problemReported = true;
							prevToken['error'] = ErrorType.XMLAttEqualExpected;
							prevToken['value'] = XsltTokenDiagnostics.getTextForToken(prevToken.line, prevToken, document);
							problemTokens.push(prevToken);
						}
						if (!problemReported) {
							if (tagAttributeNames.indexOf(attNameText) > -1) {
								token['error'] = ErrorType.XMLDupllicateAtt;
								token['value'] = attNameText;
								problemTokens.push(token);
							} else {
								if (xmlTokenType === XSLTokenLevelState.xmlnsName) {
									tagXmlnsNames.push(attNameText);
								} else {
									tagAttributeNames.push(attNameText);
								}
							}
						}
						if (tagType === TagType.XSLTvar) {
							attType = attNameText === XsltTokenDiagnostics.xslNameAtt? AttributeType.Variable: AttributeType.None;
						} else if (tagType === TagType.XSLTstart) {
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
							let unResolvedToken = XsltTokenDiagnostics.resolveXPathVariableReference(document, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, 
								xpathStack, inScopeVariablesList, elementStack);
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
				// xml is not well-nested if items still on the stack at the end
				// but report errors and try to keep some part of the tree:
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
						poppedData.identifierToken['error'] = ErrorType.ElementNesting;
						problemTokens.push(poppedData.identifierToken);
						let symbol = XsltTokenDiagnostics.createSymbolFromElementTokens(poppedData.symbolName, poppedData.symbolID, poppedData.identifierToken, endToken);
						if (symbol !== null) {
							if (elementStack.length > 0) {
								elementStack[elementStack.length - 1].childSymbols.push(symbol);
							} else {
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

	static resolveXPathVariableReference(document: vscode.TextDocument, token: BaseToken, xpathVariableCurrentlyBeingDefined: boolean, inScopeXPathVariablesList: VariableData[], 
		                                 xpathStack: XPathData[], inScopeVariablesList: VariableData[], elementStack: ElementData[]): BaseToken|null {
		let fullVarName = XsltTokenDiagnostics.getTextForToken(token.line, token, document);
		let varName = fullVarName.substr(1);
		let result: BaseToken|null = null;
		let globalVariable = null;

		let resolved = this.resolveVariableName(inScopeXPathVariablesList, varName, xpathVariableCurrentlyBeingDefined, globalVariable);
		if (!resolved) {
			resolved = this.resolveStackVariableName(xpathStack, varName);			
		}
		if (!resolved) {
			resolved = this.resolveVariableName(inScopeVariablesList, varName, false, globalVariable);			
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

	private static resolveVariableName(variableList: VariableData[], varName: string, xpathVariableCurrentlyBeingDefined: boolean, globalXsltVariable: VariableData|null): boolean {
		let resolved = false;
		let decrementedLength = variableList.length - 1;
		let globalVariableName = globalXsltVariable?.name;
		// last items in list of declared parameters must be resolved first:
		for (let i = decrementedLength; i > -1; i--) {
			let data = variableList[i];
			if (xpathVariableCurrentlyBeingDefined && i === decrementedLength) {
				// do nothing: we skip last item in list as it's currently being defined
			} else if (data.name === varName && globalVariableName !== data.name) {
				resolved = true;
				data.token['referenced'] = true;
				break;
			}
		}
		return resolved;
	}

	private static resolveStackVariableName(elementStack: ElementData[]|XPathData[], varName: string): boolean {
		let resolved = false;
		let globalXsltVariable: VariableData|null = null;

		for (let i = elementStack.length - 1; i > -1; i--) {
			let inheritedVariables = elementStack[i].variables;
			let xpathBeingDefinedInit = elementStack[i].xpathVariableCurrentlyBeingDefined;
			let xpathBeingDefined = !(xpathBeingDefinedInit === undefined || xpathBeingDefinedInit === false);
			if (i === 1) {
				// at the level of a global variable declaration
				let elementData: ElementData = <ElementData>elementStack[i];
				let currentVar = elementData.currentVariable;
				if (currentVar) {
					// must be inside a global variable declaration - keep this:
					globalXsltVariable = currentVar;
				}
			}
			resolved = this.resolveVariableName(inheritedVariables, varName, xpathBeingDefined, globalXsltVariable)
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
				case ErrorType.XMLName:
					msg = `XML: Invalid name: '${tokenValue}'`;
					break;
				case ErrorType.XMLAttNameSyntax:
					msg = `XML: Missing whitespace before attribute '${tokenValue}'`;
					break;
				case ErrorType.XMLAttEqualExpected:
					msg = `XML: Missing '=' after attribute '${tokenValue}'`;
					break;
				case ErrorType.XMLDupllicateAtt:
					msg = `XML: Attribute '${tokenValue}' is a duplicate`;
					break;
				case ErrorType.XMLXMLNS:
					msg = `XML: Undeclared prefix found for element '${tokenValue}'`;
					break;
				case ErrorType.XMLAttributeName:
					msg = `XML: Invalid attribute names on element '${tokenValue}'`;
					break;
				case ErrorType.XMLAttributeXMLNS:
					msg = `XML: Invalid prefix for attribute on element '${tokenValue}'`;
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
				message: `XPath: The variable/parameter: ${token.value} cannot be resolved here, but it may be defined in an external module.`,
				range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
				severity: vscode.DiagnosticSeverity.Warning
			}
		} else {
			return {
				code: '',
				message: `XPath: The variable/parameter ${token.value} cannot be resolved`,
				range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
				severity: vscode.DiagnosticSeverity.Error
			}
		}
	}
}
