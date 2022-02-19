/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken, ErrorType, Data } from './xpLexer';
import { FunctionData, XSLTnamespaces } from './functionData';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import * as url from 'url';
import { ExtractedImportData, XsltDefinitionProvider } from './xsltDefinitionProvider';
import { XSLTReferenceProvider } from './xsltReferenceProvider';


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
	tagType?: TagType;
}

interface ElementData {
	variables: VariableData[];
	currentVariable?: VariableData;
	xpathVariableCurrentlyBeingDefined?: boolean;
	identifierToken: XSLTToken;
	symbolName: string;
	symbolID: string;
	childSymbols: vscode.DocumentSymbol[];
	namespacePrefixes: string[];
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
	token: BaseToken;
	name: string;
	uri?: string;
}

export interface DefinitionLocation extends vscode.Location {
	instruction?: GlobalInstructionData;
	extractedImportData?: ExtractedImportData;
}

export interface DefinitionData {
	definitionLocation: DefinitionLocation | undefined;
	inputSymbol?: InstructionTokenType | undefined;
}

export interface InstructionTokenType {
	token: BaseToken;
	type: GlobalInstructionType;
}

export class XsltTokenDefinitions {
	public static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
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


	public static findDefinition = (isXSLT: boolean, document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], position: vscode.Position): DefinitionData => {
		let lineNumber = -1;
		let resultLocation: DefinitionLocation | undefined;
		let resultInputToken: InstructionTokenType | undefined;
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
		let importedGlobalVarNames: Map<string, GlobalInstructionData> = new Map();
		let incrementFunctionArity = false;
		let onRootStartTag = true;
		let rootXmlnsName: string | null = null;
		let xsltPrefixesToURIs = new Map<string, XSLTnamespaces>();
		let tagExcludeResultPrefixes: { token: BaseToken; prefixes: string[] } | null = null;
		let requiredLine = position.line;
		let requiredChar = position.character;
		let isOnRequiredToken = false;
		let awaitingRequiredArity = false;
		let keepProcessing = false;
		let currentXSLTIterateParams: VariableData[][] = [];

		globalInstructionData.forEach((instruction) => {
			if (instruction.type === GlobalInstructionType.Variable || instruction.type === GlobalInstructionType.Parameter) {
				if (!importedGlobalVarNames.get(instruction.name)) {
					importedGlobalVarNames.set(instruction.name, instruction);
				}
			}

		});

		importedInstructionData.forEach((instruction) => {
			if (instruction.type === GlobalInstructionType.Variable || instruction.type === GlobalInstructionType.Parameter) {
				if (!importedGlobalVarNames.get(instruction.name)) {
					importedGlobalVarNames.set(instruction.name, instruction);
				}
			}

		});

		let index = -1;
		for (let token of allTokens) {
			index++;
			lineNumber = token.line;
			let isOnRequiredLine = lineNumber === requiredLine;
			if ((isOnRequiredToken && !keepProcessing) || resultLocation || lineNumber > requiredLine) {
				break;
			}

			isOnRequiredToken = isOnRequiredLine && requiredChar >= token.startCharacter && requiredChar <= (token.startCharacter + token.length);
			if (isOnRequiredToken) {
				console.log('onRequiredToken');
			}
			let isXMLToken = token.tokenType >= XsltTokenDefinitions.xsltStartTokenNumber;
			if (isXMLToken) {
				inScopeXPathVariablesList = [];
				xpathVariableCurrentlyBeingDefined = false;

				xpathStack = [];
				preXPathVariable = false;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenDefinitions.xsltStartTokenNumber);
				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						if (tagType === TagType.Start) {
							if (tagElementName === 'xsl:iterate') {
								currentXSLTIterateParams.push([]);
							}
							tagType = (XsltTokenDefinitions.xslVariable.indexOf(tagElementName) > -1) ? TagType.XSLTvar : TagType.XSLTstart;
							let xsltToken: XSLTToken = token;
							xsltToken['tagType'] = tagType;
							startTagToken = token;

							if (!includeOrImport && tagType !== TagType.XSLTvar && elementStack.length === 1) {
								includeOrImport = tagElementName === XsltTokenDefinitions.xslImport || tagElementName === XsltTokenDefinitions.xslInclude;
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
									if (tagElementName === 'xsl:iterate' && currentXSLTIterateParams.length > 0) {
										currentXSLTIterateParams.pop();
									}
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
							attType = attNameText === XsltTokenDefinitions.xslNameAtt ? AttributeType.Variable : AttributeType.None;
						} else if (tagType === TagType.XSLTstart) {
							if (attNameText === XsltTokenDefinitions.xslNameAtt) {
								attType = AttributeType.InstructionName;
							} else if (attNameText === XsltTokenDefinitions.xslModeAtt) {
								attType = AttributeType.InstructionMode;
							} else if (attNameText === XsltTokenDefinitions.useAttSet) {
								attType = AttributeType.UseAttributeSets;
							} else if (attNameText === XsltTokenDefinitions.excludePrefixes || attNameText === XsltTokenDefinitions.xslExcludePrefixes) {
								attType = AttributeType.ExcludeResultPrefixes;
							} else {
								attType = AttributeType.None;
							}
						} else if (attNameText === XsltTokenDefinitions.xslUseAttSet) {
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
								inScopeVariablesList.push(variableData);
								let parentElemmentName = elementStack[elementStack.length - 1].symbolName;
								if (parentElemmentName === 'xsl:iterate') {
									currentXSLTIterateParams[currentXSLTIterateParams.length - 1].push({...variableData});
								}
								if (isOnRequiredToken) {
									const isDefinition = true;
									resultLocation = XsltTokenDefinitions.createLocationFromVariableData(variableData, document, isDefinition);
								}
								break;
							case AttributeType.InstructionName:
								let slashPos = variableName.lastIndexOf('/');
								if (slashPos > 0) {
									// package name may be URI
									variableName = variableName.substring(slashPos + 1);
								}
								tagIdentifierName = variableName;

								if (isOnRequiredToken) {
									let instruction: GlobalInstructionData | undefined = undefined;
									if (tagElementName === 'xsl:call-template') {
										instruction = XsltTokenDefinitions.findMatchingDefintion(globalInstructionData, importedInstructionData, variableName, GlobalInstructionType.Template);
										resultLocation = XsltTokenDefinitions.createLocationFromInstrcution(instruction, document);
										if (resultLocation) {
											resultLocation.instruction = instruction;
										}
										resultInputToken = { token: token, type: GlobalInstructionType.Template };
									} else if (elementStack.length > 0 && tagElementName === 'xsl:with-param') {
										const {symbolName, symbolID} = elementStack[elementStack.length - 1];
										if (symbolName === 'xsl:call-template') {
										  const callTempDefn = XsltTokenDefinitions.findMatchingDefintion(globalInstructionData, importedInstructionData, symbolID, GlobalInstructionType.Template);
											if (callTempDefn && callTempDefn.memberNames) {
												const paramIndex = callTempDefn.memberNames.indexOf(variableName);
												if (paramIndex > -1 && callTempDefn.memberTokens) {
													const paramToken = callTempDefn.memberTokens[paramIndex];
													// reuse callTemplate Definition - but set token to that of the current param
													const uri = callTempDefn.href ? vscode.Uri.parse(url.pathToFileURL(callTempDefn.href).toString()) : document.uri;
													const paramRange = XsltTokenDefinitions.createRangeFromToken(paramToken);
													resultLocation = new vscode.Location(uri, paramRange);
													const paramInstruction = { idNumber: 0, name: variableName, type: GlobalInstructionType.Variable, token: paramToken, href: uri.toString() };
                          resultLocation.instruction = paramInstruction;
												}
											}
										// TODO: this token is a definition so return this as resultLocation
										} else if (symbolName === 'xsl:next-iteration' && currentXSLTIterateParams.length > 0) {
											const definitions = currentXSLTIterateParams[currentXSLTIterateParams.length - 1];
											let resolvedVariable = definitions.find(defn => defn.name === variableName);
											if (resolvedVariable) {
												const isDefinition = true;
												resultLocation = XsltTokenDefinitions.createLocationFromVariableData(resolvedVariable, document, isDefinition);
											}
										}
										resultInputToken = { token: token, type: GlobalInstructionType.Variable };
									}
								}
								break;
							case AttributeType.InstructionMode:
								if (tagIdentifierName === '') {
									tagIdentifierName = variableName;
								}
								break;
							case AttributeType.UseAttributeSets:
								if (isOnRequiredToken) {
									let instruction = XsltTokenDefinitions.findMatchingDefintion(globalInstructionData, importedInstructionData, variableName, GlobalInstructionType.AttributeSet);
									resultLocation = XsltTokenDefinitions.createLocationFromInstrcution(instruction, document);
									resultInputToken = { token: token, type: GlobalInstructionType.AttributeSet };
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
								let instrType = xp.function.value === 'key' ? GlobalInstructionType.Key : GlobalInstructionType.Accumulator;
								let instruction = XsltTokenDefinitions.findMatchingDefintion(globalInstructionData, importedInstructionData, keyVal, instrType);
								resultLocation = XsltTokenDefinitions.createLocationFromInstrcution(instruction, document);
								resultInputToken = { token: token, type: instrType };
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
							if (isOnRequiredToken) {
								const isDefinition = true;
								resultLocation = XsltTokenDefinitions.createLocationFromVariableData(currentVariable, document, isDefinition);
								resultInputToken = { token: token, type: GlobalInstructionType.Variable };
							}
						} else {
							// don't include any current pending variable declarations when resolving
							if (isOnRequiredToken && !(token.value === '$value' && tagElementName === 'xsl:accumulator-rule')) {
								let resolvedVariable = XsltTokenDefinitions.resolveXPathVariableReference(document, importedGlobalVarNames, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList,
									xpathStack, inScopeVariablesList, elementStack);
								if (resolvedVariable) {
									const isDefinition = true;
									resultLocation = XsltTokenDefinitions.createLocationFromVariableData(resolvedVariable, document, isDefinition);
								}
								resultInputToken = { token: token, type: GlobalInstructionType.Variable };
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
												let instruction = XsltTokenDefinitions.findMatchingDefintion(globalInstructionData, importedInstructionData, fnName, GlobalInstructionType.Function, fnArity);
												resultLocation = XsltTokenDefinitions.createLocationFromInstrcution(instruction, document);
												resultInputToken = { token: poppedData.function, type: GlobalInstructionType.Function };
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
								break;
							case CharLevelState.dSep:
								if (token.value === '()' && prevToken?.tokenType === TokenLevelState.function) {
									if (awaitingRequiredArity) {
										const fnArity = incrementFunctionArity ? 1 : 0;
										const fnName = prevToken.value;
										let instruction = XsltTokenDefinitions.findMatchingDefintion(globalInstructionData, importedInstructionData, fnName, GlobalInstructionType.Function, fnArity);
										resultLocation = XsltTokenDefinitions.createLocationFromInstrcution(instruction, document);
										resultInputToken = { token: token, type: GlobalInstructionType.Function };
									}
									awaitingRequiredArity = false;
									incrementFunctionArity = false;
								} else if (token.value === '=>') {
									incrementFunctionArity = true;
								}
								break;
						}
						break;

					case TokenLevelState.functionNameTest:
						if (isOnRequiredToken) {
							let { name, arity } = XsltTokenDefinitions.resolveFunctionName(inheritedPrefixes, xsltPrefixesToURIs, token);
							let instruction = XsltTokenDefinitions.findMatchingDefintion(globalInstructionData, importedInstructionData, name, GlobalInstructionType.Function, arity);
							resultLocation = XsltTokenDefinitions.createLocationFromInstrcution(instruction, document);
							resultInputToken = { token: token, type: GlobalInstructionType.Function };
						}
						break;
				}
			}
			prevToken = token;
		}

		return { definitionLocation: resultLocation, inputSymbol: resultInputToken };
	};

	public static createLocationFromInstrcution(instruction: GlobalInstructionData | undefined, document: vscode.TextDocument) {
		if (instruction) {
			let uri = instruction?.href ? vscode.Uri.parse(url.pathToFileURL(instruction.href).toString()) : document.uri;
			const token = instruction.token;
			let startPos = new vscode.Position(token.line, token.startCharacter + 1);
			let endPos = new vscode.Position(token.line, token.startCharacter + token.length - 1);
			const range = new vscode.Range(startPos, endPos);
			const location: DefinitionLocation = new vscode.Location(uri, range);
			location.instruction = instruction;
			return location;
		}
	}

	public static createLocationFromVariableData(variableData: VariableData | undefined, document: vscode.TextDocument, isDefinition?: boolean) {
		if (variableData) {
			let uri = variableData.uri ? vscode.Uri.parse(url.pathToFileURL(variableData.uri).toString()) : document.uri;
			const sp = isDefinition ? variableData.token.startCharacter + 1 : variableData.token.startCharacter;
			let ep = variableData.token.startCharacter + variableData.token.length;
			ep = isDefinition && variableData.token.tokenType !== TokenLevelState.variable ? ep - 1 : ep;
			let startPos = new vscode.Position(variableData.token.line, sp);
			let endPos = new vscode.Position(variableData.token.line, ep);
			const location: DefinitionLocation = new vscode.Location(uri, new vscode.Range(startPos, endPos));
			location.instruction = { idNumber: 0, name: variableData.name, type: GlobalInstructionType.Variable, token: variableData.token, href: uri.toString() };
			return location;
		}
	}

	public static createLocationFromToken(token: BaseToken, doc: vscode.TextDocument) {
		return this.createLocationFromTokenUri(token, doc.uri);
	}

	public static createLocationFromTokenUri(token: BaseToken, uri: vscode.Uri) {
		const isQuoted = XSLTReferenceProvider.isTokenQuoted(token);
		let range: vscode.Range;
		if (isQuoted) {
			let startPos = new vscode.Position(token.line, token.startCharacter + 1);
			let endPos = new vscode.Position(token.line, token.startCharacter + token.length - 1);
			range = new vscode.Range(startPos, endPos);
		} else if (XSLTReferenceProvider.isTokenVariable(token)) {
			let startPos = new vscode.Position(token.line, token.startCharacter + 1);
			let endPos = new vscode.Position(token.line, token.startCharacter + token.length);
			range = new vscode.Range(startPos, endPos);
		} else {
			range = XsltTokenDefinitions.createRangeFromToken(token);
		}
		return new vscode.Location(uri, range);
	}

	public static createRangeFromToken(token: BaseToken) {
		let startPos = new vscode.Position(token.line, token.startCharacter);
		let endPos = new vscode.Position(token.line, token.startCharacter + token.length);
		return new vscode.Range(startPos, endPos);
	}

	public static createRangeFromTokenVals(line: number, startCharacter: number, length: number) {
		let startPos = new vscode.Position(line, startCharacter);
		let endPos = new vscode.Position(line, startCharacter + length);
		return new vscode.Range(startPos, endPos);
	}

	public static resolveFunctionName(xmlnsPrefixes: string[], xmlnsData: Map<string, XSLTnamespaces>, token: BaseToken) {
		let parts = token.value.split('#');
		let arity = Number.parseInt(parts[1]);
		let name = parts[0];
		return { name, arity };
	}

	private static resolveXPathVariableReference(document: vscode.TextDocument, importedVariables: Map<string, GlobalInstructionData>, token: BaseToken, xpathVariableCurrentlyBeingDefined: boolean, inScopeXPathVariablesList: VariableData[],
		xpathStack: XPathData[], inScopeVariablesList: VariableData[], elementStack: ElementData[]): VariableData | null {
		let fullVarName = XsltTokenDiagnostics.getTextForToken(token.line, token, document);
		let varName = fullVarName.substr(1);
		let resolved: VariableData | null = null;
		let globalVariable = null;

		resolved = this.resolveVariableName(inScopeXPathVariablesList, varName, xpathVariableCurrentlyBeingDefined, globalVariable);
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
			let instruction = importedVariables.get(varName);
			if (instruction) {
				resolved = { name: instruction.name, token: instruction.token, uri: instruction.href };
			}
		}

		return resolved;
	}

	public static resolveVariableName(variableList: VariableData[], varName: string, xpathVariableCurrentlyBeingDefined: boolean, globalXsltVariable: VariableData | null): VariableData | null {
		let resolved = null;
		let decrementedLength = variableList.length - 1;
		let globalVariableName = globalXsltVariable?.name;
		// last items in list of declared parameters must be resolved first:
		for (let i = decrementedLength; i > -1; i--) {
			let data = variableList[i];
			if (xpathVariableCurrentlyBeingDefined && i === decrementedLength) {
				// do nothing: we skip last item in list as it's currently being defined
			} else if (data.name === varName && globalVariableName !== data.name) {
				resolved = data;
				break;
			}
		}
		return resolved;
	}

	public static resolveStackVariableName(elementStack: ElementData[] | XPathData[], varName: string): VariableData | null {
		let resolved = null;
		let globalXsltVariable: VariableData | null = null;

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
			resolved = this.resolveVariableName(inheritedVariables, varName, xpathBeingDefined, globalXsltVariable);
			if (resolved) {
				break;
			}
		}
		return resolved;
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
