/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, GlobalInstructionData, GlobalInstructionType} from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken, ErrorType, Data } from './xpLexer';
import { FunctionData, XSLTnamespaces } from './functionData';

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
	InstructionMode,
	UseAttributeSets,
	ExcludeResultPrefixes
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
	function?: BaseToken;
	functionArity?: number;
	isRangeVar?: boolean;
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
	public static readonly xsltCatchVariables = ['err:code','err:description', 'err:value', 'err:module', 'err:linenumber', 'err:column-number'];
	private static readonly xslVariable = ['xsl:variable', 'xsl:param'];
	private static readonly xslInclude = 'xsl:include';
	private static readonly xslImport = 'xsl:import';
	private static readonly xmlChars = ['lt','gt','quot','apos','amp'];


	private static readonly xslFunction = 'xsl:function';

	private static readonly xslNameAtt = 'name';
	private static readonly xslModeAtt = 'mode';
	private static readonly useAttSet = 'use-attribute-sets';
	private static readonly xslUseAttSet = 'xsl:use-attribute-sets';
	private static readonly excludePrefixes = 'exclude-result-prefixes';
	private static readonly xslExcludePrefixes = 'xsl:exclude-result-prefixes';

	private static validateName(name: string, type: ValidationType, startCharRgx: RegExp, charRgx: RegExp, xmlnsPrefixes: string[]): NameValidationError {
		let valid = NameValidationError.None
		if (name.trim().length === 0) {
			return NameValidationError.NameError;
		}
		if (type === ValidationType.XMLAttribute) {
			if (name === 'xml:space' || name === 'xml:lang' || name === 'xml:base' || name === 'xml:id') {
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


	public static calculateDiagnostics = (isXSLT: boolean, document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], symbols: vscode.DocumentSymbol[]): vscode.Diagnostic[] => {
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
		let unresolvedXsltVariableReferences: BaseToken[] = [];
		let prevToken: BaseToken|null = null;
		let includeOrImport = false;
		let problemTokens: BaseToken[] = [];
		let topLevelSymbols: vscode.DocumentSymbol[] = symbols;
		let tagIdentifierName: string = '';
		let lastTokenIndex = allTokens.length - 1;
		let tagAttributeNames: string[] = [];
		let tagXmlnsNames: string[] = [];
		let rootXmlnsBindings: [string, string][] = [];
		let inheritedPrefixes: string[] = [];
		let globalVariableData: VariableData[] = [];
		let checkedGlobalVarNames: string[] = [];
		let checkedGlobalFnNames: string[] = [];
		let importedGlobalVarNames: string[] = [];
		let importedGlobalFnNames: string[] = [];
		let incrementFunctionArity = false;
		let onRootStartTag = true;
		let rootXmlnsName: string|null = null;
		let xsltPrefixesToURIs = new Map<string, XSLTnamespaces>();
		let isXMLDeclaration = false;
		let dtdStarted = false;
		let dtdEnded = false;
		let namedTemplates: Map<string, string[]> = new Map();
		let globalModes: string[] = ['#current', '#default'];
		let globalKeys: string[] = [];
		let globalAccumulatorNames: string[] = [];
		let globalAttributeSetNames: string[] = [];
		let tagExcludeResultPrefixes: {token: BaseToken, prefixes: string[]}|null = null;

		globalInstructionData.forEach((instruction) => {
			switch (instruction.type) {
				case GlobalInstructionType.Variable:
				case GlobalInstructionType.Parameter:
					if (checkedGlobalVarNames.indexOf(instruction.name) < 0) {
						checkedGlobalVarNames.push(instruction.name);
					} else {
						instruction.token['error'] = ErrorType.DuplicateVarName;
						instruction.token.value = instruction.name;
						problemTokens.push(instruction.token);
					}
					globalVariableData.push({token: instruction.token, name: instruction.name })
					xsltVariableDeclarations.push(instruction.token);
					break;
				case GlobalInstructionType.Function:
					let functionNameWithArity = instruction.name + '#' + instruction.idNumber;
					if (checkedGlobalFnNames.indexOf(functionNameWithArity) < 0) {
						checkedGlobalFnNames.push(functionNameWithArity);
					} else {
						instruction.token['error'] = ErrorType.DuplicateFnName;
						instruction.token.value = functionNameWithArity;
						problemTokens.push(instruction.token);
					}	
					break;
				case GlobalInstructionType.Template:
					if (namedTemplates.get(instruction.name)) {
						instruction.token['error'] = ErrorType.DuplicateTemplateName;
						instruction.token.value = instruction.name;
						problemTokens.push(instruction.token);
					} else {
						let members = instruction.memberNames? instruction.memberNames: [];
						namedTemplates.set(instruction.name, members);
					}
					break;
				case GlobalInstructionType.Mode:
					let modes = instruction.name.split(/\s+/);
					globalModes = globalModes.concat(modes);
					break;
				case GlobalInstructionType.Key:
					globalKeys.push(instruction.name);
					break;
				case GlobalInstructionType.Accumulator:
					if (globalAccumulatorNames.indexOf(instruction.name) < 0) {
						globalAccumulatorNames.push(instruction.name);
					} else {
						instruction.token['error'] = ErrorType.DuplicateAccumulatorName;
						instruction.token.value = instruction.name;
						problemTokens.push(instruction.token);
					}
					break;
				case GlobalInstructionType.AttributeSet:
					globalAttributeSetNames.push(instruction.name);
					break;
				
			}
		});

		importedInstructionData.forEach((instruction) => {
			switch (instruction.type) {
				case GlobalInstructionType.Variable:
				case GlobalInstructionType.Parameter:
					if (checkedGlobalVarNames.indexOf(instruction.name) < 0) {
						checkedGlobalVarNames.push(instruction.name);
						importedGlobalVarNames.push(instruction.name);
					}
					break;
				case GlobalInstructionType.Function:
					let functionNameWithArity = instruction.name + '#' + instruction.idNumber;
					if (checkedGlobalFnNames.indexOf(functionNameWithArity) < 0) {
						checkedGlobalFnNames.push(functionNameWithArity);
						importedGlobalFnNames.push(functionNameWithArity);
					}	
					break;
				case GlobalInstructionType.Template:
					let members = instruction.memberNames? instruction.memberNames: [];
					namedTemplates.set(instruction.name, members);
					break;
				case GlobalInstructionType.Mode:
					let modes = instruction.name.split(/\s+/);
					globalModes = globalModes.concat(modes);
					break;
				case GlobalInstructionType.Key:
					globalKeys.push(instruction.name);
					break;
				case GlobalInstructionType.Accumulator:
					globalAccumulatorNames.push(instruction.name);
					break;
				case GlobalInstructionType.AttributeSet:
					globalAttributeSetNames.push(instruction.name);
					break;
			}
		});
		let nameStartCharRgx = new RegExp(/[A-Z]|_|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);
		let nameCharRgx = new RegExp(/-|\.|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]|[A-Z]|_|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);

		allTokens.forEach((token, index) => {
			lineNumber = token.line;

			let isXMLToken = token.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
			if (isXMLToken) {
				if (prevToken && prevToken.tokenType && prevToken.tokenType === TokenLevelState.operator && !prevToken.error) {
					let isValid = false;
					switch(prevToken.charType) {
						case CharLevelState.rB:
						case CharLevelState.rBr:
						case CharLevelState.rPr:
							isValid = true;
							break;
						case CharLevelState.dSep:
							isValid = prevToken.value === '()';
							break;
						default:
							if (prevToken.value === '/' || prevToken.value === '*' || prevToken.value === '.') {
								// these are ok provided that the previous token was XSLT or previous token was ,;
								let prevToken2 = allTokens[index - 2];
								let tokenBeforePrevWasXSLT = prevToken2.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
								isValid = tokenBeforePrevWasXSLT || prevToken2.value === ',';
							}
							break;
					}
					if (!isValid) {
						prevToken['error'] = ErrorType.XPathOperatorUnexpected;
						problemTokens.push(prevToken);
					}
				}
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
					case XSLTokenLevelState.xmlText:
						if (elementStack.length === 0) {
							token['error'] = ErrorType.ParentLessText;
							token['value'] = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							problemTokens.push(token);
						}
						break;
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
							if (!onRootStartTag && elementStack.length === 0) {
								token['error'] = ErrorType.MultiRoot;
								token['value'] = tagElementName;
								problemTokens.push(token);
							}
						}
						break;
					case XSLTokenLevelState.elementName:
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						if (tagType === TagType.Start) {
							tagType = TagType.XMLstart;
							startTagToken = token;
							if (!onRootStartTag && elementStack.length === 0) {
								token['error'] = ErrorType.MultiRoot;
								token['value'] = tagElementName;
								problemTokens.push(token);
							}
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
								tagExcludeResultPrefixes = null;
								tagType = TagType.Start;
								break;
							case XMLCharState.rStNoAtt:
							case XMLCharState.rSt:
							case XMLCharState.rSelfCt:
							case XMLCharState.rSelfCtNoAtt:
								// start-tag ended, we're now within the new element scope:
								if (isXSLT && onRootStartTag) {
									rootXmlnsBindings.forEach((prefixNsPair) => {
										let pfx = prefixNsPair[0];
										let namespaceURI = prefixNsPair[1];
										let xsltType = FunctionData.namespaces.get(namespaceURI);
										if (xsltType !== undefined) {
											xsltPrefixesToURIs.set(pfx, xsltType);
										}
									});
									if (xsltPrefixesToURIs.get('xsl') !== XSLTnamespaces.XSLT) {
										if (startTagToken !== null) {
											startTagToken['error'] = ErrorType.XSLTNamesapce;
											problemTokens.push(startTagToken);
										}
									}
								}
								onRootStartTag = false;
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
								let problem = false;
								if (tagExcludeResultPrefixes) {
									let missingPrefix;
									if (!(tagExcludeResultPrefixes.prefixes.length === 1 && tagExcludeResultPrefixes.prefixes[0] === '#all')) {
										missingPrefix = tagExcludeResultPrefixes.prefixes.find((pfx) => {
											if (pfx !== '#default' && inheritedPrefixes.indexOf(pfx) < 0) return pfx;
										});
									}
									if (missingPrefix) {
										let xToken = tagExcludeResultPrefixes.token;
										xToken['error'] = ErrorType.MissingPrefixInList;
										xToken.value = missingPrefix;
										problemTokens.push(tagExcludeResultPrefixes.token);
										problem = true;
									}
								}
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

								if (startTagToken && !problem) {
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
									if (tagElementName === 'xsl:accumulator') {
										inScopeVariablesList.push({token: token, name: 'value'});
									} else if (tagElementName === 'xsl:catch') {
										XsltTokenDiagnostics.xsltCatchVariables.forEach((catchVar) => {
											inScopeVariablesList.push({token: token, name: catchVar});
										});
									}
									let inheritedPrefixesCopy = inheritedPrefixes.slice();
									// if top-level element add global variables - these include following variables also:
									let newVariablesList = elementStack.length === 0? globalVariableData: inScopeVariablesList;
									//let newVariablesList = inScopeVariablesList;
									if (variableData !== null) {
										if (elementStack.length > 1) {
											xsltVariableDeclarations.push(variableData.token);
										}
										if (startTagToken){
											// if a top-level element, use global variables instad of inScopeVariablesList;
											elementStack.push({namespacePrefixes: inheritedPrefixesCopy, currentVariable: variableData, variables: newVariablesList, 
												symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: []});
										}
									} else if (startTagToken) {
										elementStack.push({namespacePrefixes: inheritedPrefixesCopy, variables: newVariablesList, symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: []});
									}
									inScopeVariablesList = [];
									newVariablesList = [];
									tagType = TagType.NonStart;

								} else {
									// self-closed tag: xmlns declarations on this are no longer in scope
									inheritedPrefixes = orginalPrefixes;
									if (variableData !== null) {
										if (elementStack.length > 1) {
											inScopeVariablesList.push(variableData);
											xsltVariableDeclarations.push(variableData.token);
										} else {
											inScopeVariablesList = [];
										}
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
											if (prevToken) {
												prevToken['error'] = ErrorType.ElementNestingX;
												prevToken['value'] = tagElementName;
												problemTokens.push(prevToken);
											}
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
									let errToken = (prevToken)? prevToken: token;
									errToken['error'] = ErrorType.ElementNestingX;
									errToken['value'] = tagElementName;
									problemTokens.push(errToken);
								}
								break;
							case XMLCharState.rPi:
								isXMLDeclaration = false;
								break;
						}
						break;

					case XSLTokenLevelState.attributeName:
					case XSLTokenLevelState.xmlnsName:
						rootXmlnsName = null;
						let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let problemReported = false;
						if (prevToken) {
							if (token.line === prevToken.line && token.startCharacter - (prevToken.startCharacter + prevToken.length) === 0) {
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
									if (onRootStartTag) {
										rootXmlnsName = attNameText;
									}
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
							} else if (attNameText === XsltTokenDiagnostics.useAttSet) {
								attType = AttributeType.UseAttributeSets;
							} else if (attNameText === XsltTokenDiagnostics.excludePrefixes || attNameText === XsltTokenDiagnostics.xslExcludePrefixes) {
								attType = AttributeType.ExcludeResultPrefixes;
							} else {
								attType = AttributeType.None;
							}
						} else if (attNameText === XsltTokenDiagnostics.xslUseAttSet) {
								attType = AttributeType.UseAttributeSets;
						}
						break;
					case XSLTokenLevelState.attributeValue:
						let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
						if (rootXmlnsName !== null) {
							let prefix = rootXmlnsName.length === 5? '': rootXmlnsName.substr(6);
							rootXmlnsBindings.push([prefix, variableName]);
						}
						switch (attType) {
							case AttributeType.Variable:
								tagIdentifierName = variableName;
								variableData = {token: token, name: variableName};
								break;
							case AttributeType.InstructionName:
								let slashPos = variableName.lastIndexOf('/');
								if (slashPos > 0) {
									// package name may be URI
									variableName = variableName.substring(slashPos + 1);
								}
								tagIdentifierName = variableName;
								break;
							case AttributeType.InstructionMode:
								if (tagIdentifierName === '') {
									tagIdentifierName = variableName;
								}
								break;
							case AttributeType.ExcludeResultPrefixes:
									let excludePrefixes = variableName.split(/\s+/);
									tagExcludeResultPrefixes = {token: token, prefixes: excludePrefixes};
								break;
						}

						let hasProblem = false;
						if (token.error) {
							problemTokens.push(token);
							hasProblem = true;
						}
						if (!hasProblem && attType === AttributeType.UseAttributeSets) {
							if (globalAttributeSetNames.indexOf(variableName) < 0 && variableName !== 'xsl:original') {
								token['error'] = ErrorType.AttributeSetUnresolved;
								token.value = variableName;
								problemTokens.push(token);
								hasProblem = true;
							}
						}						
						if (!hasProblem && attType === AttributeType.InstructionName && tagElementName === 'xsl:call-template') {
							if (!namedTemplates.get(variableName)) {
								token['error'] = ErrorType.TemplateNameUnresolved;
								token.value = variableName;
								problemTokens.push(token);
								hasProblem = true;
							}
						}
						if (!hasProblem && attType === AttributeType.InstructionMode && tagElementName === 'xsl:apply-templates') {
							if (globalModes.indexOf(variableName) < 0) {
								token['error'] = ErrorType.TemplateModeUnresolved;
								token.value = variableName;
								problemTokens.push(token);
								hasProblem = true;
							}
						}
						if (!hasProblem && attType === AttributeType.InstructionName && elementStack.length > 0 && tagElementName === 'xsl:with-param') {
							let callTemplateName = elementStack[elementStack.length - 1].symbolID;
							let templateParams = namedTemplates.get(callTemplateName);
							if (templateParams) {
								if (templateParams?.indexOf(variableName) < 0) {
									token['error'] = ErrorType.MissingTemplateParam;
									token.value = `${callTemplateName}#${variableName}`;
									problemTokens.push(token);
									hasProblem = true;
								}
							}
						}
						
						if (!hasProblem && attType === AttributeType.Variable || attType === AttributeType.InstructionName) {
							if (!fullVariableName.includes('{')) {
								let vType = tagElementName.endsWith(':attribute')? ValidationType.XMLAttribute: ValidationType.PrefixedName;
								let validateResult = XsltTokenDiagnostics.validateName(variableName, vType, nameStartCharRgx, nameCharRgx, inheritedPrefixes);
								if (validateResult !== NameValidationError.None) {
									token['error'] = validateResult === NameValidationError.NameError? ErrorType.XSLTName: ErrorType.XSLTPrefix;
									token['value'] = fullVariableName;
									problemTokens.push(token);
								}
							}
						}
						attType = AttributeType.None;
						break;
					case XSLTokenLevelState.processingInstrName:
						let piName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let validPiName = true;
						if (piName.toLowerCase() === 'xml') {
							if (lineNumber !== 0) {
								validPiName = false;
							} else {
								isXMLDeclaration = true;
							}
						} else {
							let validateResult = XsltTokenDiagnostics.validateName(piName, ValidationType.Name, nameStartCharRgx, nameCharRgx, inheritedPrefixes);
							validPiName = validateResult === NameValidationError.None;
						}
						if (!validPiName) {
							token['error'] = ErrorType.ProcessingInstructionName;
							token['value'] = piName;
							problemTokens.push(token);
						}
						break;
					case XSLTokenLevelState.entityRef:
						let entityName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let validationResult = NameValidationError.None;
						if (entityName.length > 2 && entityName.endsWith(';')) {
							entityName = entityName.substring(1, entityName.length - 1);
							if (entityName.length > 2 && entityName.charAt(0) === '#') {
								let validNumber;
								if (entityName.charAt(1).toLocaleLowerCase() === 'x') {
									validNumber = /^#[Xx][0-9a-fA-F]+$/.test(entityName);
								} else {
									validNumber = /^#[0-9]+$/.test(entityName);
								}
								validationResult = validNumber? NameValidationError.None: NameValidationError.NameError;
							} else if (!dtdEnded) {
								let isXmlChar = XsltTokenDiagnostics.xmlChars.indexOf(entityName) > -1;
								validationResult = isXmlChar? NameValidationError.None: NameValidationError.NameError;
							} else {
								validationResult = XsltTokenDiagnostics.validateName(entityName, ValidationType.Name, nameStartCharRgx, nameCharRgx, inheritedPrefixes);
							}
						} else {
							validationResult = NameValidationError.NameError;
						}
						if (validationResult !== NameValidationError.None){
							token['error'] = ErrorType.EntityName;
							token['value'] = entityName;
							problemTokens.push(token);
						}
					case XSLTokenLevelState.processingInstrValue:
						if (isXMLDeclaration) {
							XsltTokenDiagnostics.validateXMLDeclaration(lineNumber, token, document, problemTokens);
						}
						break;
					case XSLTokenLevelState.dtdEnd:
						if (dtdEnded) {
							let endDtd = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							token['error'] = ErrorType.DTD;
							token['value'] = endDtd;
							problemTokens.push(token);	
						}
						dtdEnded = true;
						break;
					case XSLTokenLevelState.dtd:						
						if (onRootStartTag && !dtdEnded) {
							dtdStarted = true;
						} else {
							let dtdValue = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							token['error'] = ErrorType.DTD;
							token['value'] = dtdValue;
							problemTokens.push(token);							
						}
						break;
				}
				if (index === lastTokenIndex) {
					if (onRootStartTag) {
						let errorToken = Object.assign({}, token);
						errorToken['error'] = ErrorType.XMLRootMissing;
						problemTokens.push(errorToken);
					}
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;

				switch (xpathTokenType) {
					case TokenLevelState.string:
						if (xpathStack.length > 0) {
							let xp = xpathStack[xpathStack.length - 1];
							if (xp.functionArity === 0 && (xp.function?.value === 'key' || xp.function?.value.startsWith('accumulator-'))) {
								let keyVal = token.value.substring(1, token.value.length - 1);
								if (xp.function.value === 'key') {
									if (globalKeys.indexOf(keyVal) < 0) {
											token['error'] = ErrorType.XSLTKeyUnresolved;
											problemTokens.push(token);
									}
								} else if (globalAccumulatorNames.indexOf(keyVal) < 0) {
									token['error'] = ErrorType.AccumulatorNameUnresolved;
									problemTokens.push(token);
								}
							}
							preXPathVariable = xp.preXPathVariable;
						}
						break;
					case TokenLevelState.axisName:
						if (token.error) {
							problemTokens.push(token);
						}
						break;
					case TokenLevelState.variable:
						if ((preXPathVariable && !xpathVariableCurrentlyBeingDefined) || anonymousFunctionParams) {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let currentVariable = {token: token, name: fullVariableName.substring(1)};
						    if (anonymousFunctionParams) {
								anonymousFunctionParamList.push(currentVariable);
								xsltVariableDeclarations.push(token);
							} else  {
								inScopeXPathVariablesList.push(currentVariable);
								xpathVariableCurrentlyBeingDefined = true;
								xsltVariableDeclarations.push(token);
							}
						} else {
							// don't include any current pending variable declarations when resolving
							let globalVarName: string|null = null;
							if (tagType === TagType.XSLTvar && elementStack.length === 1) {
								globalVarName = tagIdentifierName;
							}
							let unResolvedToken = XsltTokenDiagnostics.resolveXPathVariableReference(globalVarName, document, importedGlobalVarNames, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, 
								xpathStack, inScopeVariablesList, elementStack);
							if (unResolvedToken !== null) {
								unresolvedXsltVariableReferences.push(unResolvedToken);
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
								xpathVariableCurrentlyBeingDefined = false;
								xpathStack.push({token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, isRangeVar: true});
							break;
							case 'then':
								xpathStack.push({token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined});
								inScopeXPathVariablesList = [];
								break;
							case 'return':
							case 'satisfies':
							case 'else':
								if (xpathStack.length > 0) {
									let poppedData = xpathStack.pop();
									if (poppedData) {
										inScopeXPathVariablesList = poppedData.variables;
										if (valueText === 'else') {
											preXPathVariable = poppedData.preXPathVariable;
										} else {
											// todo: if after a return AND a ',' prePathVariable = true; see $pos := $c
											preXPathVariable = false;
										}
										xpathVariableCurrentlyBeingDefined = poppedData.xpathVariableCurrentlyBeingDefined;
									} else {
										inScopeXPathVariablesList =  [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
								}
								break;
						}
						break;
					case TokenLevelState.operator:
						let functionToken: BaseToken|null = null;
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
								if (prevToken?.tokenType === TokenLevelState.function) {
									functionToken = prevToken;
								}
								// intentionally no-break;	
							case CharLevelState.lPr:
								let xpathItem: XPathData = {token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined};
								if (functionToken) {
									xpathItem.function = functionToken;
									if (incrementFunctionArity) {
										xpathItem.functionArity = 1;
										incrementFunctionArity = false;
									} else {
										xpathItem.functionArity = 0;
									}
								}
								xpathStack.push(xpathItem);
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
										inScopeXPathVariablesList = poppedData.variables;
										preXPathVariable = poppedData.preXPathVariable;
										xpathVariableCurrentlyBeingDefined = poppedData.xpathVariableCurrentlyBeingDefined;
										if (poppedData.function && poppedData.functionArity !== undefined) {
											if (prevToken?.charType !== CharLevelState.lB) {
												if (poppedData.functionArity !== undefined) {
													poppedData.functionArity++;
												}
											}
											let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(inheritedPrefixes, xsltPrefixesToURIs, poppedData.function, checkedGlobalFnNames, poppedData.functionArity);
											if (!isValid) {
												poppedData.function['error'] = fErrorType;
												poppedData.function['value'] = qFunctionName;
												problemTokens.push(poppedData.function);
											}
										}
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
									if (xpathStack.length > 0) {
										let xp = xpathStack[xpathStack.length - 1];
										if (xp.functionArity !== undefined) {
											xp.functionArity++;
										}
										if (xp.isRangeVar) {
											preXPathVariable = xp.preXPathVariable;
										}
									}
									xpathVariableCurrentlyBeingDefined = false;
								}
								break;
							case CharLevelState.dSep:
								if (token.value === '()' && prevToken?.tokenType === TokenLevelState.function) {
									const fnArity = incrementFunctionArity? 1: 0;
									incrementFunctionArity = false;
									let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(inheritedPrefixes, xsltPrefixesToURIs, prevToken, checkedGlobalFnNames, fnArity);
									if (!isValid) {
										prevToken['error'] = fErrorType;
										prevToken['value'] = qFunctionName;
										problemTokens.push(prevToken);
									}
								} else if (token.value === '=>') {
									incrementFunctionArity = true;
								}
								break;
						}
						break;
					case TokenLevelState.nodeType:
						if (token.value === ':*' && prevToken && !prevToken.error) {
							let pfx = prevToken.tokenType === TokenLevelState.attributeNameTest? prevToken.value.substring(1): prevToken.value;
							if (inheritedPrefixes.indexOf(pfx) === -1) {
								prevToken['error'] = ErrorType.XPathPrefix;
								problemTokens.push(prevToken);
							}
						}
						break;
					case TokenLevelState.attributeNameTest:
					case TokenLevelState.nodeNameTest:
						if (token.error) {
							problemTokens.push(token);
						} else {
							let tokenValue;
							let validationType;
							let skipValidation = false;
							if (xpathTokenType === TokenLevelState.nodeNameTest) {
								tokenValue = token.value;
								validationType = ValidationType.PrefixedName;
							} else {
								tokenValue = token.value.substr(1);
								validationType= ValidationType.XMLAttribute;
								skipValidation = token.value === '@';
							}
							if (!skipValidation) {
								let validateResult = XsltTokenDiagnostics.validateName(tokenValue, validationType, nameStartCharRgx, nameCharRgx, inheritedPrefixes);
								if (validateResult !== NameValidationError.None) {
									token['error'] = validateResult === NameValidationError.NameError? ErrorType.XPathName: ErrorType.XPathPrefix;
									token['value'] = token.value;
									problemTokens.push(token);
								}
							}
						}
						break;
					case TokenLevelState.functionNameTest:
						let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(inheritedPrefixes, xsltPrefixesToURIs, token, checkedGlobalFnNames);
						if (!isValid) {
							token['error'] = fErrorType;
							token['value'] = qFunctionName;
							problemTokens.push(token);
						}
						break;
					case TokenLevelState.simpleType:
						let tValue = token.value;
						let tParts = tValue.split(':');
						let isValidType = false;
						if (tValue === '*' || tValue === '?' || tValue === '+') {
							// e.g. xs:integer* don't check name
							isValidType = true;
						} else if (tParts.length === 1) {
							let nextToken = allTokens.length > index + 1? allTokens[index + 1]: null;

							if (nextToken && (nextToken.charType === CharLevelState.lB || (nextToken.charType === CharLevelState.dSep && nextToken.value === '()'))) {
								isValidType = Data.nodeTypes.indexOf(tParts[0]) > -1;
								if (!isValidType) {
									isValidType = Data.nonFunctionTypes.indexOf(tParts[0]) > -1;
								}
							}
						} else if (tParts.length === 2) {
							let nsType = xsltPrefixesToURIs.get(tParts[0]);
							if (nsType !== undefined) {
								if (nsType === XSLTnamespaces.XMLSchema) {
									isValidType = FunctionData.schema.indexOf(tParts[1] + '#1') > -1;
								}
							}
						}
						if (!isValidType) {
							token['error'] = ErrorType.XPathTypeName;
							problemTokens.push(token);
						}
						break;
				}
				if (index === lastTokenIndex) {
					// TODO: show error if xpath token is last
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
						let errorToken = Object.assign({}, poppedData.identifierToken);
						errorToken['error'] = ErrorType.ElementNesting;
						problemTokens.push(errorToken);
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
		let variableRefDiagnostics = XsltTokenDiagnostics.getDiagnosticsFromUnusedVariableTokens(document, xsltVariableDeclarations, unresolvedXsltVariableReferences, includeOrImport);
		let allDiagnostics = XsltTokenDiagnostics.appendDiagnosticsFromProblemTokens(variableRefDiagnostics, problemTokens);
		return allDiagnostics;
	}

	private static validateXMLDeclaration(lineNumber: number, token: BaseToken, document: vscode.TextDocument,problemTokens: BaseToken[]) {
		let piValue = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
		let xmlPIrgx = /(=|'|"|\d+\.\d+|[\w|-]+|\s+)/;
		let encodingRgx = /[A-Za-z]([A-Za-z0-9._-])*/;
		let spaceRegx = /\s+/;
		let pState: XMLPIState = XMLPIState.none;
		let pName = XMLPIName.none;
		let names: XMLPIName[] = [];
		let namesWithValues: XMLPIName[] = [];
		let isValid = true;
		let allParts = piValue.split(xmlPIrgx);
		let lastPartIndex = allParts.length - 1;
		allParts.forEach(function (part, index) {
			if (pState !== XMLPIState.invalid && part.length > 0) {
				switch (pState) {
					case XMLPIState.none:
						if (!spaceRegx.test(part)) {
							if (part === 'version' && names.indexOf(XMLPIName.version) < 0) {
								pState = XMLPIState.Name;
								pName = XMLPIName.version;
								names.push(pName);
							}
							else if (part === 'encoding' && names.indexOf(XMLPIName.encoding) < 0) {
								pState = XMLPIState.Name;
								pName = XMLPIName.encoding;
								names.push(pName);
							}
							else if (part === 'standalone' && names.indexOf(XMLPIName.standalone) < 0) {
								pState = XMLPIState.Name;
								pName = XMLPIName.standalone;
								names.push(pName);
							}
							else {
								pState = XMLPIState.invalid;
							}
						}
						break;
					case XMLPIState.Name:
						if (!spaceRegx.test(part)) {
							pState = part === '=' ? XMLPIState.Eq : XMLPIState.invalid;
						}
						break;
					case XMLPIState.Eq:
						if (!spaceRegx.test(part)) {
							pState = part === '"' || part === '\'' ? XMLPIState.Start : XMLPIState.invalid;
						}
						break;
					case XMLPIState.Start:
						switch (pName) {
							case XMLPIName.version:
								pState = part === '1.0' || part === '1.1' ? XMLPIState.End : XMLPIState.invalid;
								break;
							case XMLPIName.encoding:
								pState = encodingRgx.test(part) ? XMLPIState.End : XMLPIState.invalid;
								break;
							case XMLPIName.standalone:
								pState = part === 'yes' || part === 'no' ? XMLPIState.End : XMLPIState.invalid;
								break;
						}
						break;
					case XMLPIState.End:
						pState = part === '"' || part === '\'' ? XMLPIState.none : XMLPIState.invalid;
						namesWithValues.push(pName);
						break;
				}
			}
			if (index === lastPartIndex) {
				if (pState === XMLPIState.invalid) {
					isValid = false;
				}
				else if (isValid) {
					isValid = names.indexOf(XMLPIName.version) > -1 &&
						namesWithValues.indexOf(XMLPIName.version) > -1 &&
						names.indexOf(XMLPIName.encoding) > -1 === namesWithValues.indexOf(XMLPIName.encoding) > -1 &&
						names.indexOf(XMLPIName.standalone) > -1 === namesWithValues.indexOf(XMLPIName.standalone) > -1;
				}
			}
		});

		if (!isValid) {
			token['error'] = ErrorType.XMLDeclaration;
			token['value'] = piValue;
			problemTokens.push(token);
		}
	}

	private static xorInputs(input1: boolean, input2: boolean) {
		if (input1) {
			return input2 === false;
		} else {
			return input2 === true;
		}
	}

	public static isValidFunctionName(xmlnsPrefixes: string[], xmlnsData: Map<string, XSLTnamespaces>, token: BaseToken, checkedGlobalFnNames: string[], arity?: number) {
		let tokenValue;
		if (arity === undefined) {
			let parts = token.value.split('#');
			arity = Number.parseInt(parts[1]);
			tokenValue = parts[0];
		} else {
			tokenValue = token.value;
		}
		let qFunctionName = tokenValue + '#' + arity;
		let fNameParts = qFunctionName.split(':');
		let isValid = false;
		let fErrorType = ErrorType.XPathFunction;
		if (fNameParts.length === 1) {
			if (tokenValue === 'concat') {
				isValid = arity > 0;
			} else {
				isValid = FunctionData.xpath.indexOf(fNameParts[0]) > -1;
			}
		} else {
			let xsltType = xmlnsData.get(fNameParts[0]);
			if (xmlnsPrefixes.indexOf(fNameParts[0]) < 0) {
				// prefix is not declared
				fErrorType = ErrorType.XPathFunctionNamespace;
				isValid = false;
			} else if (xsltType === XSLTnamespaces.NotDefined || xsltType === undefined) {
				isValid = checkedGlobalFnNames.indexOf(qFunctionName) > -1;
			} else {
				switch (xsltType) {
					case XSLTnamespaces.XPath:
						isValid = FunctionData.xpath.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Array:
						isValid = FunctionData.array.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Map:
						isValid = FunctionData.map.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Math:
						isValid = FunctionData.math.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.XMLSchema:
						isValid = FunctionData.schema.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Saxon:
					case XSLTnamespaces.ExpathArchive:
					case XSLTnamespaces.ExpathBinary:
					case XSLTnamespaces.ExpathFile:
						isValid = true;
						break;
				}				
			}
		}
		fErrorType = isValid? ErrorType.None: fErrorType;
		return { isValid, qFunctionName, fErrorType };
	}

	public static getTextForToken(lineNumber: number, token: BaseToken, document: vscode.TextDocument) {
		let startPos = new vscode.Position(lineNumber, token.startCharacter);
		let endPos = new vscode.Position(lineNumber, token.startCharacter + token.length);
		const currentLine = document.lineAt(lineNumber);
		let valueRange = currentLine.range.with(startPos, endPos);
		let valueText = document.getText(valueRange);
		return valueText;
	}

	private static resolveXPathVariableReference(globalVarName: string|null, document: vscode.TextDocument, importedVariables: string[], token: BaseToken, xpathVariableCurrentlyBeingDefined: boolean, inScopeXPathVariablesList: VariableData[], 
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
			if (elementStack.length === 1 && globalVarName === varName) {
				resolved = false;
			} else {
				resolved = this.resolveStackVariableName(elementStack, varName);		
			}
		}
		if (!resolved) {
			resolved = globalVarName !== varName && importedVariables.indexOf(varName) > -1;
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

	public static resolveVariableName(variableList: VariableData[], varName: string, xpathVariableCurrentlyBeingDefined: boolean, globalXsltVariable: VariableData|null): boolean {
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

	public static resolveStackVariableName(elementStack: ElementData[]|XPathData[], varName: string): boolean {
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
			let diagnosticMetadata: vscode.DiagnosticTag[] = [];
			let severity = vscode.DiagnosticSeverity.Error;
			switch (token.error) {
				case ErrorType.AxisName:
					msg = `XPath: Invalid axis name: '${tokenValue}`;
					break;
				case ErrorType.BracketNesting:
					let matchingChar: any = XsltTokenDiagnostics.getMatchingSymbol(tokenValue);
					msg = matchingChar.length === 0? `XPath: No match found for '${tokenValue}'`: `'${tokenValue}' has no matching '${matchingChar}'`;
					diagnosticMetadata = [vscode.DiagnosticTag.Unnecessary];
					break;
				case ErrorType.ElementNesting:
					msg = `XML: Start tag '${tokenValue}' has no matching close tag`;
					break;
				case ErrorType.EntityName:
					msg = `XML: Invalid entity name '${tokenValue}'`;
					break;
				case ErrorType.MultiRoot:
					msg = 'XML: More than one root element';
					break;
				case ErrorType.ProcessingInstructionName:
					msg = `XML: Invalid processing instruction name: '${tokenValue}`
					break;
				case ErrorType.ElementNestingX:
					msg = `XML: Unexpected close tag '${tokenValue}'`;
					break;
				case ErrorType.XPathKeyword:
					msg = `XPath: Found: '${tokenValue}' expected keyword or operator`;
					break;
				case ErrorType.XMLName:
					msg = `XML: Invalid XML name: '${tokenValue}'`;
					break;
				case ErrorType.XMLRootMissing:
					msg = `XML: Root element is missing`;
					break;
				case ErrorType.XSLTName:
					msg = `XSLT: Invalid XSLT name: '${tokenValue}'`;
					break;
				case ErrorType.DuplicateParameterName:
					msg = `XSLT: Duplicate parameter name: '${tokenValue}'`;
					break;
				case ErrorType.MissingTemplateParam:
					let pParts = tokenValue.split('#');
					msg = `XSLT: xsl:param '${pParts[0]}' is not declared for template '${pParts[1]}'`;
					break;
				case ErrorType.TemplateNameUnresolved:
					msg = `XSLT: xsl:template with name '${tokenValue}' not found`;
					break;
				case ErrorType.AttributeSetUnresolved:
					msg = `XSLT: xsl:attribute-set with name '${tokenValue}' not found`;
					break;
				case ErrorType.MissingPrefixInList:
					msg = `XSLT: Namespace prefix '${tokenValue}' is not declared`;
					break;
				case ErrorType.XSLTKeyUnresolved:
					msg = `XSLT: xsl:key declaration with name '${tokenValue}' not found`;
					break;
				case ErrorType.AccumulatorNameUnresolved:
					msg = `XSLT: xsl:accumulator with name '${tokenValue}' not found`;
					break;					
				case ErrorType.TemplateModeUnresolved:
					msg = `XSLT: Template mode '${tokenValue}' not used`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				case ErrorType.ParentLessText:
					msg = `XML: Text found outside root element: '${tokenValue}`
					break;
				case ErrorType.XSLTNamesapce:
					msg = `Expected on the root element: xmlns:xsl='http://www.w3.org/1999/XSL/Transform' prefix/namespace-uri binding`
					break;
				case ErrorType.XSLTPrefix:
					msg = `XSLT: Undeclared prefix in name: '${tokenValue}'`;
					break;
				case ErrorType.XMLDeclaration:
					msg = `XML: Invalid content in XML declaration: '${tokenValue}'`;
					break;
				case ErrorType.XPathName:
					msg = `XPath: Invalid name: '${tokenValue}'`;
					break;
				case ErrorType.XPathOperatorUnexpected:
					msg = `XPath: Operator unexpected at this position: '${tokenValue}'`;
					break;
				case ErrorType.DTD:
					msg = `XML: DTD position error: '${tokenValue}'`;
					break;
				case ErrorType.XPathFunction:
					let parts = tokenValue.split('#');
					msg = `XPath: Function: '${parts[0]}' with ${parts[1]} arguments not found`;
					break;
				case ErrorType.XPathTypeName:
					msg = `XPath: Invalid type: '${tokenValue}'`;
					break;
				case ErrorType.XPathFunctionNamespace:
					let partsNs = tokenValue.split('#');
					msg = `XPath: Undeclared prefix in function: '${partsNs[0]}'`;
					break;
				case ErrorType.XPathPrefix:
					msg = `XPath: Undeclared prefix in name: '${tokenValue}'`;
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
				case ErrorType.DuplicateVarName:
					msg = `XSLT: Duplicate global variable/parameter name: '${tokenValue}'`;
					break;
				case ErrorType.DuplicateFnName:
					msg = `XSLT: Duplicate function name and arity: '${tokenValue}'`;
					break;
				case ErrorType.DuplicateTemplateName:
					msg = `XSLT: Duplicate xsl:template name '${tokenValue}'`;
					break;
				case ErrorType.DuplicateAccumulatorName:
					msg = `XSLT: Duplicate xsl:accumulator name '${tokenValue}'`;
					break;					
				default:
					msg = 'Unexepected Error';
					break;
			}

			variableRefDiagnostics.push({
				code: '',
				message: msg,
				range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
				severity: severity,
				tags: diagnosticMetadata,
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
			case 'let':
				r = 'return'
				break;
			case 'every':
			case 'some':
				r = 'satisfies';
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

	public static createImportDiagnostic(data: GlobalInstructionData): vscode.Diagnostic {
		let token = data.token;
		let line = token.line;
		let endChar = token.startCharacter + token.length;
		return {
			code: '',
			message: `Included/imported file '${data.name}' not found`,
			range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
			severity: vscode.DiagnosticSeverity.Error,
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

enum XMLPIState {
	none,
	invalid,
	Name,
	Eq,
	Start,
	End,
}

enum XMLPIName {
	none,
	version,
	encoding,
	standalone
}
