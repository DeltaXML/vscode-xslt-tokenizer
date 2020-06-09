/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken, ErrorType, Data, XPathLexer } from './xpLexer';
import { FunctionData, XSLTnamespaces } from './functionData';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { XPathFunctionDetails } from './xpathFunctionDetails';

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
	awaitingArity: boolean;
}

interface VariableData {
	token: BaseToken,
	name: string;
	uri?: string
}

export class XsltTokenCompletions {
	private static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	private static readonly xslVariable = ['xsl:variable', 'xsl:param'];
	private static readonly xslInclude = 'xsl:include';
	private static readonly xslImport = 'xsl:import';
	private static readonly xmlChars = ['lt', 'gt', 'quot', 'apos', 'amp'];


	private static readonly xslFunction = 'xsl:function';

	private static readonly xslNameAtt = 'name';
	private static readonly xslModeAtt = 'mode';
	private static readonly useAttSet = 'use-attribute-sets';
	private static readonly xslUseAttSet = 'xsl:use-attribute-sets';
	private static readonly excludePrefixes = 'exclude-result-prefixes';
	private static readonly xslExcludePrefixes = 'xsl:exclude-result-prefixes';

	public static getCompletions = (attNameTests: string[], elementNameTests: string[], isXSLT: boolean, document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], position: vscode.Position): vscode.CompletionItem[] | undefined => {
		let lineNumber = -1;
		let resultCompletions: vscode.CompletionItem[] | undefined;

		let inScopeVariablesList: VariableData[] = [];
		let xpathVariableCurrentlyBeingDefined = false;
		let elementStack: ElementData[] = [];
		let inScopeXPathVariablesList: VariableData[] = [];
		let anonymousFunctionParamList: VariableData[] = [];
		let xpathStack: XPathData[] = [];
		let tagType = TagType.NonStart;
		let attType = AttributeType.None;
		let tagElementName = '';
		let startTagToken: XSLTToken | null = null;
		let preXPathVariable = false;
		let anonymousFunctionParams = false;
		let variableData: VariableData | null = null;
		let xsltVariableDeclarations: BaseToken[] = [];
		let prevToken: BaseToken | null = null;
		let includeOrImport = false;
		let tagIdentifierName: string = '';
		let tagAttributeNames: string[] = [];
		let tagXmlnsNames: string[] = [];
		let rootXmlnsBindings: [string, string][] = [];
		let inheritedPrefixes: string[] = [];
		let globalVariableData: VariableData[] = [];
		let incrementFunctionArity = false;
		let onRootStartTag = true;
		let rootXmlnsName: string | null = null;
		let xsltPrefixesToURIs = new Map<string, XSLTnamespaces>();
		let namedTemplates: Map<string, string[]> = new Map();
		let globalModes: string[] = ['#current', '#default'];

		let tagExcludeResultPrefixes: { token: BaseToken, prefixes: string[] } | null = null;
		let requiredLine = position.line;
		let requiredChar = position.character;
		let isOnRequiredToken = false;
		let awaitingRequiredArity = false;
		let keepProcessing = false;


		let index = -1;
		for (let token of allTokens) {
			index++;
			lineNumber = token.line;
			let isOnRequiredLine = lineNumber === requiredLine;
			if (resultCompletions) {
				return resultCompletions;
			}
			let overranPos = !keepProcessing && (lineNumber > requiredLine || (lineNumber === requiredLine && token.startCharacter > requiredChar));
			if (prevToken) {
				if (overranPos) {
					let prevIsXML = prevToken.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
					if (prevIsXML) {
						let xmlTokenType = <XSLTokenLevelState>(prevToken.tokenType - XsltTokenCompletions.xsltStartTokenNumber);
						let xmlCharType = <XMLCharState>prevToken.charType;
						switch (xmlTokenType) {
							case XSLTokenLevelState.attributeValue:
								let prev2Token = allTokens[index - 2];
								let prev2IsXML = prev2Token.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
								if (!prev2IsXML) {
									let xpath2TokenType = <TokenLevelState>prev2Token.tokenType;
									let xpath2CharType = <CharLevelState>prev2Token.charType;
									switch (xpath2TokenType) {
										case TokenLevelState.operator:
											switch (xpath2CharType) {
												case CharLevelState.rB:
												case CharLevelState.rBr:
												case CharLevelState.rPr:
												case CharLevelState.lBr:
													break;
												default:
													resultCompletions = XsltTokenCompletions.getAllCompletions(position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData, resultCompletions);
													break;
											}
											break;
									}
								}
								break;
							case XSLTokenLevelState.xmlPunctuation:
								switch (xmlCharType) {
									case XMLCharState.rSq:
									case XMLCharState.rDq:
										// TODO:
										break;
								}
								break;
						}
					} else {
						switch (prevToken.tokenType) {
							case TokenLevelState.operator:
								resultCompletions = XsltTokenCompletions.getAllCompletions(position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData, resultCompletions);
								break;
						}
					}
				}
			}
			if (overranPos) {
				return resultCompletions;
			}

			isOnRequiredToken = isOnRequiredLine && requiredChar >= token.startCharacter && requiredChar <= (token.startCharacter + token.length);
			if (isOnRequiredToken) {
				//console.log('on completion token: column:' + (position.character + 1) + ' text: ' + token.value + ' prev: ' + prevToken?.value);
			}
			let isXMLToken = token.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
			if (isXMLToken) {
				inScopeXPathVariablesList = [];
				xpathVariableCurrentlyBeingDefined = false;

				xpathStack = [];
				preXPathVariable = false;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenCompletions.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						if (tagType === TagType.Start) {
							const isVar = 
							tagType = (XsltTokenCompletions.xslVariable.indexOf(tagElementName) > -1) ? TagType.XSLTvar : TagType.XSLTstart;
							let xsltToken: XSLTToken = token;
							xsltToken['tagType'] = tagType;
							startTagToken = token;

							if (!includeOrImport && tagType !== TagType.XSLTvar && elementStack.length === 1) {
								includeOrImport = tagElementName === XsltTokenCompletions.xslImport || tagElementName === XsltTokenCompletions.xslInclude;
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
								}

								if (xmlCharType === XMLCharState.rStNoAtt || xmlCharType === XMLCharState.rSt) {
									// on a start tag
									let inheritedPrefixesCopy = inheritedPrefixes.slice();
									// if top-level element add global variables - these include following variables also:
									let newVariablesList = elementStack.length === 0 ? globalVariableData : inScopeVariablesList;
									//let newVariablesList = inScopeVariablesList;
									if (variableData !== null) {
										if (elementStack.length > 1) {
											xsltVariableDeclarations.push(variableData.token);
										}
										if (startTagToken) {
											// if a top-level element, use global variables instad of inScopeVariablesList;
											elementStack.push({
												namespacePrefixes: inheritedPrefixesCopy, currentVariable: variableData, variables: newVariablesList,
												symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: []
											});
										}
									} else if (startTagToken) {
										elementStack.push({ namespacePrefixes: inheritedPrefixesCopy, variables: newVariablesList, symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: [] });
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
											inScopeVariablesList = globalVariableData;
										}
									}
									if (startTagToken) {

									}
								}

								break;
							case XMLCharState.rCt:
								// end of an element close-tag:
								if (elementStack.length > 0) {
									let poppedData = elementStack.pop();
									if (poppedData) {
										if (poppedData.symbolName !== tagElementName) {
											// not well-nested
											if (elementStack.length > 0 && elementStack[elementStack.length - 1].symbolName === tagElementName) {
												// recover for benefit of outline view
												poppedData = elementStack.pop();
											}
										}
									}
									if (poppedData) {
										inheritedPrefixes = poppedData.namespacePrefixes.slice();

										inScopeVariablesList = (poppedData) ? poppedData.variables : [];
										if (poppedData.currentVariable) {
											inScopeVariablesList.push(poppedData.currentVariable);
										}
									}
								}
								break;
						}
						break;

					case XSLTokenLevelState.attributeName:
					case XSLTokenLevelState.xmlnsName:
						rootXmlnsName = null;
						let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let problemReported = false;

						if (!problemReported) {
							if (tagAttributeNames.indexOf(attNameText) > -1) {
								//
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
							attType = attNameText === XsltTokenCompletions.xslNameAtt ? AttributeType.Variable : AttributeType.None;
						} else if (tagType === TagType.XSLTstart) {
							if (attNameText === XsltTokenCompletions.xslNameAtt) {
								attType = AttributeType.InstructionName;
							} else if (attNameText === XsltTokenCompletions.xslModeAtt) {
								attType = AttributeType.InstructionMode;
							} else if (attNameText === XsltTokenCompletions.useAttSet) {
								attType = AttributeType.UseAttributeSets;
							} else if (attNameText === XsltTokenCompletions.excludePrefixes || attNameText === XsltTokenCompletions.xslExcludePrefixes) {
								attType = AttributeType.ExcludeResultPrefixes;
							} else {
								attType = AttributeType.None;
							}
						} else if (attNameText === XsltTokenCompletions.xslUseAttSet) {
							attType = AttributeType.UseAttributeSets;
						}
						break;
					case XSLTokenLevelState.attributeValue:
						let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
						if (rootXmlnsName !== null) {
							let prefix = rootXmlnsName.length === 5 ? '' : rootXmlnsName.substr(6);
							rootXmlnsBindings.push([prefix, variableName]);
						}
						switch (attType) {
							case AttributeType.Variable:
								tagIdentifierName = variableName;
								variableData = { token: token, name: variableName };
								break;
							case AttributeType.InstructionName:
								let slashPos = variableName.lastIndexOf('/');
								if (slashPos > 0) {
									// package name may be URI
									variableName = variableName.substring(slashPos + 1);
								}
								tagIdentifierName = variableName;

								if (isOnRequiredToken && tagElementName === 'xsl:call-template') {
									let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, variableName, GlobalInstructionType.Template);
									//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
								}
								break;
							case AttributeType.InstructionMode:
								if (tagIdentifierName === '') {
									tagIdentifierName = variableName;
								}
								break;
							case AttributeType.UseAttributeSets:
								if (isOnRequiredToken) {
									let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, variableName, GlobalInstructionType.AttributeSet);
									//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
								}
								break;
							case AttributeType.ExcludeResultPrefixes:
								let excludePrefixes = variableName.split(/\s+/);
								tagExcludeResultPrefixes = { token: token, prefixes: excludePrefixes };
								break;
						}

						attType = AttributeType.None;
						break;
				}

			} else {
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;

				switch (xpathTokenType) {
					case TokenLevelState.string:
						if (xpathStack.length > 0) {
							let xp = xpathStack[xpathStack.length - 1];
							if (isOnRequiredToken && (
								xp.functionArity === 0 && (
									xp.function?.value === 'key' || xp.function?.value.startsWith('accumulator-')
								)
							)) {
								let keyVal = token.value.substring(1, token.value.length - 1);
								let instrType = xp.function.value === 'key'? GlobalInstructionType.Key: GlobalInstructionType.Accumulator;
								let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, keyVal, instrType);
								//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
							}
							preXPathVariable = xp.preXPathVariable;
						}
						break;
					case TokenLevelState.function:
						if (isOnRequiredToken) {
							awaitingRequiredArity = true;
							keepProcessing = true;
						}
						break;
					case TokenLevelState.attributeNameTest:
						if (isOnRequiredToken) {
							resultCompletions = XsltTokenCompletions.createVariableCompletions('', attNameTests, token, vscode.CompletionItemKind.Unit, '@');
						}
						break;
					case TokenLevelState.variable:
						if ((preXPathVariable && !xpathVariableCurrentlyBeingDefined) || anonymousFunctionParams) {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let currentVariable = { token: token, name: fullVariableName.substring(1) };
							if (anonymousFunctionParams) {
								anonymousFunctionParamList.push(currentVariable);
								xsltVariableDeclarations.push(token);
							} else {
								inScopeXPathVariablesList.push(currentVariable);
								xpathVariableCurrentlyBeingDefined = true;
								xsltVariableDeclarations.push(token);
							}
						} else {
							// don't include any current pending variable declarations when resolving
							if (isOnRequiredToken) {
								let globalVarName: string|null = null;
								if (tagType === TagType.XSLTvar && elementStack.length === 1) {
									globalVarName = tagIdentifierName;
								}
								resultCompletions = XsltTokenCompletions.getVariableCompletions(globalVarName, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList);
								if (tagElementName === 'xsl:accumulator-rule') {
									resultCompletions.push(new vscode.CompletionItem('value', vscode.CompletionItemKind.Variable));
								}
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
								xpathStack.push({ awaitingArity: false, token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, isRangeVar: true });
								break;
							case 'then':
								xpathStack.push({ awaitingArity: false, token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined });
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
										inScopeXPathVariablesList = [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
								}
								break;
						}
						break;
					case TokenLevelState.nodeNameTest:
						if (isOnRequiredToken) {
							resultCompletions = XsltTokenCompletions.getAllTokenCompletions(position, token, elementNameTests, attNameTests, globalInstructionData, importedInstructionData, resultCompletions);
						}
						break;
					case TokenLevelState.operator:
						let functionToken: BaseToken | null = null;
						switch (xpathCharType) {
							case CharLevelState.lBr:
								xpathStack.push({ awaitingArity: false, token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined });
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
								if (isOnRequiredToken) {
									resultCompletions = XsltTokenCompletions.getAllCompletions(position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData, resultCompletions);
								}
							// intentionally no-break;	
							case CharLevelState.lPr:
								let xpathItem: XPathData = { awaitingArity: awaitingRequiredArity, token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined };
								awaitingRequiredArity = false;
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
								if (isOnRequiredToken) {
									resultCompletions = XsltTokenCompletions.getAllCompletions(position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData, resultCompletions);
								}
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
											if (poppedData.awaitingArity && prevToken) {
												keepProcessing = false;
												const fnArity = poppedData.functionArity;
												const fnName = poppedData.function.value;
												let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, fnName, GlobalInstructionType.Function, fnArity);
												//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
											}
										}
									} else {
										inScopeXPathVariablesList = [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
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
								if (isOnRequiredToken) {
									if (token.value === '/') {
										resultCompletions = XsltTokenCompletions.getAllCompletions(position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData, resultCompletions);
									} else if (token.value === '!') {
										let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XPathFunctionDetails.data);
										let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData);
										resultCompletions = fnCompletions.concat(userFnCompletions);
									}
								}
								break;
							case CharLevelState.dSep:
								if (token.value === '()' && prevToken?.tokenType === TokenLevelState.function) {
									if (awaitingRequiredArity) {
										const fnArity = incrementFunctionArity ? 1 : 0;
										const fnName = prevToken.value;
										let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, fnName, GlobalInstructionType.Function, fnArity);
										//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
									}
									awaitingRequiredArity = false;
									incrementFunctionArity = false;
								} else if (token.value === '=>') {
									incrementFunctionArity = true;
								} else if (token.value === '::') {
									if (isOnRequiredToken && prevToken) {
										switch (prevToken.value) {
											case 'attribute':
												let attNames = attNameTests.map((name) => name.substring(1));
												resultCompletions = XsltTokenCompletions.getNormalCompletions(position, attNames, vscode.CompletionItemKind.Unit);
												break;
											default:
												resultCompletions = XsltTokenCompletions.getNormalCompletions(position, elementNameTests, vscode.CompletionItemKind.Unit);					
												let nodeTypes = Data.cNodeTypes.map(axis => axis + '()');
												let nodeCompletions = XsltTokenCompletions.getNormalCompletions(position, nodeTypes, vscode.CompletionItemKind.Property);
					
												resultCompletions = resultCompletions.concat(nodeCompletions);
												break;
										}
									}
								}
								break;
						}
						break;

					case TokenLevelState.functionNameTest:
						if (isOnRequiredToken) {
							let { name, arity } = XsltTokenCompletions.resolveFunctionName(inheritedPrefixes, xsltPrefixesToURIs, token);
							let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, name, GlobalInstructionType.Function, arity);
							//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
						}
						break;
				}
			}
			prevToken = token;
		}

		return resultCompletions;
	}

	public static createLocationFromInstrcution(instruction: GlobalInstructionData | undefined, document: vscode.TextDocument) {
		if (instruction) {
			let uri = instruction?.href ? vscode.Uri.parse(instruction.href) : document.uri;
			let startPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter);
			let endPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter + instruction.token.length);
			return new vscode.Location(uri, new vscode.Range(startPos, endPos));
		}
	}

	public static resolveFunctionName(xmlnsPrefixes: string[], xmlnsData: Map<string, XSLTnamespaces>, token: BaseToken) {

		let parts = token.value.split('#');
		let arity = Number.parseInt(parts[1]);
		let name = parts[0];

		return { name, arity };
	}

	private static getVariableCompletions(globalVarName: string|null, elementStack: ElementData[], xpathStack: XPathData[], token: BaseToken, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], 
		xpathVariableCurrentlyBeingDefined: boolean, inScopeXPathVariablesList: VariableData[], inScopeVariablesList: VariableData[]): vscode.CompletionItem[] {

		let completionStrings: string[] = [];

		globalInstructionData.forEach((instruction) => {
			if (instruction.type === GlobalInstructionType.Variable || instruction.type === GlobalInstructionType.Parameter) {
				if (completionStrings.indexOf(instruction.name) < 0 && globalVarName !== instruction.name) {
					completionStrings.push(instruction.name);
				}
			}

		});

		importedInstructionData.forEach((instruction) => {
			if (instruction.type === GlobalInstructionType.Variable || instruction.type === GlobalInstructionType.Parameter) {
				if (completionStrings.indexOf(instruction.name) < 0) {
					completionStrings.push(instruction.name);
				}
			}

		});
		let lastIndex = inScopeXPathVariablesList.length - 1;
		inScopeXPathVariablesList.forEach((instruction, index) => {
			if (lastIndex === index && xpathVariableCurrentlyBeingDefined) {
				// do not add
			} else if (completionStrings.indexOf(instruction.name) < 0) {
				completionStrings.push(instruction.name);
			}	
		});

		inScopeVariablesList.forEach((instruction, index) => {
			if (completionStrings.indexOf(instruction.name) < 0) {
				completionStrings.push(instruction.name);
			}	
		});

		XsltTokenCompletions.pushStackVariableNames(0, xpathStack, completionStrings);
		// startIndex = 2 - so we miss out globals
		XsltTokenCompletions.pushStackVariableNames(2, elementStack, completionStrings);
		console.log('var completions: ' + completionStrings.length);
		return XsltTokenCompletions.createVariableCompletions('$', completionStrings, token, vscode.CompletionItemKind.Variable);
	}

	private static getAllCompletions(position: vscode.Position, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], resultCompletions: vscode.CompletionItem[] | undefined) {
		let elementCompletions = XsltTokenCompletions.getNormalCompletions(position, elementNameTests, vscode.CompletionItemKind.Unit);
		let attnamecompletions = XsltTokenCompletions.getNormalCompletions(position, attNameTests, vscode.CompletionItemKind.Unit);
		let axes = Data.cAxes.map(axis => axis + '::');
		let axisCompletions = XsltTokenCompletions.getCommandCompletions(position, axes, vscode.CompletionItemKind.Operator);
		let nodeTypes = Data.nodeTypes.map(axis => axis + '()');
		let nodeCompletions = XsltTokenCompletions.getNormalCompletions(position, nodeTypes, vscode.CompletionItemKind.Property);
		let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XPathFunctionDetails.data);
		let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData);
		resultCompletions = elementCompletions.concat(attnamecompletions, axisCompletions, nodeCompletions, fnCompletions, userFnCompletions);
		return resultCompletions;
	}

	private static getAllTokenCompletions(position: vscode.Position, token: BaseToken, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], resultCompletions: vscode.CompletionItem[] | undefined) {
		let elementCompletions = XsltTokenCompletions.getTokenCompletions(position, token, elementNameTests, vscode.CompletionItemKind.Unit);
		let attnamecompletions = XsltTokenCompletions.getTokenCompletions(position, token, attNameTests, vscode.CompletionItemKind.Unit);
		let axes = Data.cAxes.map(axis => axis + '::');
		let axisCompletions = XsltTokenCompletions.getCommandCompletions(position, axes, vscode.CompletionItemKind.Operator);
		let nodeTypes = Data.nodeTypes.map(axis => axis + '()');
		let nodeCompletions = XsltTokenCompletions.getTokenCompletions(position, token, nodeTypes, vscode.CompletionItemKind.Property);
		let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XPathFunctionDetails.data, token);
		let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData, token);
		resultCompletions = elementCompletions.concat(attnamecompletions, axisCompletions, nodeCompletions, fnCompletions, userFnCompletions);
		return resultCompletions;
	}

	private static createVariableCompletions(char: string, completionStrings: string[], token: BaseToken, kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];
		const startPos = new vscode.Position(token.line, token.startCharacter);
		const endPos = new vscode.Position(token.line, token.startCharacter + token.length);
		const tokenRange = new vscode.Range(startPos, endPos);

		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = char + name;
				const newItem = new vscode.CompletionItem(varName, kind);
	
				newItem.textEdit = vscode.TextEdit.replace(tokenRange, varName);
				completionItems.push(newItem);
			}
		});
		return completionItems;
	}

	private static getCommandCompletions(pos: vscode.Position, completionStrings: string[], kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];

		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = name;
				const newItem = new vscode.CompletionItem(varName, kind);
				newItem.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };
				newItem.textEdit = vscode.TextEdit.insert(pos, varName);
				completionItems.push(newItem);
			}
		});
		return completionItems;
	}

	private static getFnCompletions(pos: vscode.Position, dataItems: FunctionCompletionData[], token?: BaseToken) {
		let completionItems: vscode.CompletionItem[] = [];
		let range: vscode.Range;
		if (token) {
			const startPos = new vscode.Position(token.line, token.startCharacter);
			const endPos = new vscode.Position(token.line, token.startCharacter + token.length);
			range = new vscode.Range(startPos, endPos);
		} else {
			const startPos = new vscode.Position(pos.line, pos.character);
			range = new vscode.Range(startPos, startPos);
		}

		dataItems.forEach((item) => {
			const noArgs = item.signature.startsWith(item.name + '()');
			const suffixBrackets = noArgs? '()${0}': '(${0})';
			const newItem = new vscode.CompletionItem(item.name, vscode.CompletionItemKind.Function);
			newItem.documentation = new vscode.MarkdownString(item.description);
			newItem.detail = item.signature;
			newItem.insertText = new vscode.SnippetString(item.name + suffixBrackets);
			newItem.range = range;
			//newItem.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };
			completionItems.push(newItem);
		});
		return completionItems;
	}

	private static getUserFnCompletions(pos: vscode.Position, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], token?: BaseToken) {
		let completionItems: vscode.CompletionItem[] = [];
		let range: vscode.Range;
		if (token) {
			const startPos = new vscode.Position(token.line, token.startCharacter);
			const endPos = new vscode.Position(token.line, token.startCharacter + token.length);
			range = new vscode.Range(startPos, endPos);
		} else {
			const startPos = new vscode.Position(pos.line, pos.character);
			range = new vscode.Range(startPos, startPos);
		}


		let filteredFunctions: GlobalInstructionData[] = [];
		this.pushFunctionsOnMaxArity(filteredFunctions, globalInstructionData);
		this.pushFunctionsOnMaxArity(filteredFunctions, importedInstructionData);

		filteredFunctions.forEach((item) => {
			if (item.type === GlobalInstructionType.Function) {
				const noArgs = !item.idNumber || item.idNumber === 0;
				const suffixBrackets = noArgs? '()${0}': '(${0})';
				const newItem = new vscode.CompletionItem(item.name, vscode.CompletionItemKind.Function);
				//newItem.documentation = new vscode.MarkdownString(item.description);
				newItem.detail = item.idNumber === 0? item.name + '()' : item.name + '( ' + item.memberNames?.join(', ') + ' )';
				newItem.insertText = new vscode.SnippetString(item.name + suffixBrackets);
				newItem.range = range;
				//newItem.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };
				completionItems.push(newItem);
			}
		});
		return completionItems;
	}

	private static pushFunctionsOnMaxArity(filteredFunctionData: GlobalInstructionData[], instructionData: GlobalInstructionData[]) {
		instructionData.forEach((item) => {
			if (item.type === GlobalInstructionType.Function) {
				let existing = filteredFunctionData.find(pre => pre.name === item.name);
				if (existing && existing.idNumber > item.idNumber) {
					// keep existing data
				} else if (existing) {
					existing.idNumber = item.idNumber;
					existing.memberNames = item.memberNames;
				} else {
					filteredFunctionData.push(item);
				}
			}
		});
		return filteredFunctionData;
	}

	private static getNormalCompletions(pos: vscode.Position, completionStrings: string[], kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];
		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = name;
				const newItem = new vscode.CompletionItem(varName, kind);
				newItem.textEdit = vscode.TextEdit.insert(pos, varName);
				completionItems.push(newItem);
			}
		});
		return completionItems;
	}

	private static getTokenCompletions(pos: vscode.Position, token: BaseToken, completionStrings: string[], kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];
		const startPos = new vscode.Position(token.line, token.startCharacter);
		const endPos = new vscode.Position(token.line, token.startCharacter + token.length);
		const tokenRange = new vscode.Range(startPos, endPos);


		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = name;
				const newItem = new vscode.CompletionItem(varName, kind);
				newItem.textEdit = vscode.TextEdit.replace(tokenRange, varName);
				completionItems.push(newItem);
			}
		});
		return completionItems;
	}

	private static pushStackVariableNames(startIndex: number, elementStack: ElementData[] | XPathData[], varNames: string[]): void {
		elementStack.forEach((element: ElementData | XPathData, index: number) => {
			if (index >= startIndex) {
				// we have global variables already
				let inheritedVariables = element.variables;
				inheritedVariables.forEach((varData: VariableData) => {
					const varName = varData.name;
					if (varNames.indexOf(varName) < 0) {
						varNames.push(varName)
					}
				});
			}
		});
	}

	public static findMatchingDefintion(globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], name: string, type: GlobalInstructionType, arity?: number) {
		let findFunction = type === GlobalInstructionType.Function;

		let found = globalInstructionData.find((instruction) => {
			if (type !== instruction.type) {
				return;
			} else if (findFunction && arity) {
				return instruction.name === name && instruction.idNumber === arity;
			} else {
				return instruction.name === name;
			}
		});
		if (!found) {
			found = importedInstructionData.find((instruction) => {
				if (type !== instruction.type) {
					return;
				} else if (findFunction && arity) {
					return instruction.name === name && instruction.idNumber === arity;
				} else {
					return instruction.name === name;
				}
			});
		}
		return found;
	}

}

export interface FunctionCompletionData {
	name: string;
	signature: string;
	description: string;
}

