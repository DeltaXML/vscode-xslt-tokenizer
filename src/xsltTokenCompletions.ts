/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, GlobalInstructionData, GlobalInstructionType, DocumentTypes, LanguageConfiguration } from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken, Data } from './xpLexer';
import { FunctionData, XSLTnamespaces } from './functionData';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { XPathFunctionDetails } from './xpathFunctionDetails';
import { SchemaQuery } from './schemaQuery';
import { XSLTSnippets, Snippet } from './xsltSnippets';
import { XMLSnippets } from './xmlSnippets';
import { XsltSymbolProvider } from './xsltSymbolProvider';

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
	ExcludeResultPrefixes,
	Xmlns
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
	private static readonly sequenceTypes = FunctionData.simpleTypes.concat(Data.nodeTypesBrackets, Data.nonFunctionTypesBrackets);
	private static readonly doubleParts = ['castable as', 'cast as', 'instance of', 'treat as'];

	public static getCompletions = (languageConfig: LanguageConfiguration, xpathDocSymbols: vscode.DocumentSymbol[], xslVariable: string[], attNameTests: string[], elementNameTests: string[], document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], position: vscode.Position): vscode.CompletionItem[] | undefined => {
		let schemaQuery = languageConfig.schemaData ? new SchemaQuery(languageConfig.schemaData) : undefined;
		let lineNumber = -1;
		let docType = languageConfig.docType;
		let isXSLT = docType === DocumentTypes.XSLT;
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
		let attNameText: string = '';

		let tagExcludeResultPrefixes: { token: BaseToken, prefixes: string[] } | null = null;
		let requiredLine = position.line;
		let requiredChar = position.character;
		let isOnRequiredToken = false;
		let awaitingRequiredArity = false;
		let keepProcessing = false;
		let isOnStartOfRequiredToken = false;
		let currentXSLTIterateParams: string[][] = [];
		const lastTokenIndex = allTokens.length - 1;

		let index = -1;
		for (let token of allTokens) {
			index++;
			lineNumber = token.line;
			let isOnRequiredLine = lineNumber === requiredLine;
			if (resultCompletions) {
				return resultCompletions;
			}
			let overranPos = !keepProcessing && (lineNumber > requiredLine || (lineNumber === requiredLine && token.startCharacter > requiredChar));
			if (docType === DocumentTypes.XPath && index === lastTokenIndex && requiredChar > token.startCharacter + token.length) {
				resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prevToken, token, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
				return resultCompletions;
			}
			if (prevToken) {
				if (overranPos) {
					let prevIsXML = prevToken.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
					if (prevIsXML) {
						let prevXmlTokenType = <XSLTokenLevelState>(prevToken.tokenType - XsltTokenCompletions.xsltStartTokenNumber);
						switch (prevXmlTokenType) {
							case XSLTokenLevelState.attributeValue:
								if (prevToken.line === requiredLine && prevToken.startCharacter + prevToken.length > requiredChar) {
									// we're within the attribute value
								} else {
									resultCompletions = XsltTokenCompletions.getXSLTAttributeCompletions(schemaQuery, position, tagElementName, tagAttributeNames);
								}
								break;
							case XSLTokenLevelState.elementName:
							case XSLTokenLevelState.xslElementName:
							case XSLTokenLevelState.attributeName:
								resultCompletions = XsltTokenCompletions.getXSLTAttributeCompletions(schemaQuery, position, tagElementName, tagAttributeNames);
								break;
						}
					} else {
						let prev2Token = prevToken.tokenType === TokenLevelState.operator ? allTokens[index - 2] : null;
						resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
					}
				}
			}
			if (overranPos) {
				return resultCompletions;
			}

			isOnRequiredToken = isOnRequiredLine && requiredChar >= token.startCharacter && requiredChar <= (token.startCharacter + token.length);
			isOnStartOfRequiredToken = isOnRequiredToken && requiredChar === token.startCharacter;
			if (isOnRequiredToken) {
				console.log('--------- on required token ---------');
				console.log('column:' + (position.character + 1) + ' text: ' + token.value + ' prev: ' + prevToken?.value);
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
							if (tagElementName === 'xsl:iterate') {
								currentXSLTIterateParams.push([]);
							}
							tagType = (xslVariable.indexOf(tagElementName) > -1) ? TagType.XSLTvar : TagType.XSLTstart;
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
								if (isOnRequiredToken) {
									if (elementStack.length === 0) {
										resultCompletions = XsltTokenCompletions.getXSLTSnippetCompletions(languageConfig.rootElementSnippets);
									} else {
										resultCompletions = XsltTokenCompletions.getXSLTTagCompletions(docType, languageConfig, schemaQuery, position, elementStack, inScopeVariablesList)
									}
								}
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
								if (isOnRequiredToken) {
									resultCompletions = XsltTokenCompletions.getXSLTAttributeCompletions(schemaQuery, position, tagElementName, tagAttributeNames);
								}
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
									if (tagElementName === 'xsl:accumulator') {
										inScopeVariablesList.push({ token: token, name: 'value' });
									} else if (tagElementName === 'xsl:catch') {
										XsltTokenDiagnostics.xsltCatchVariables.forEach((catchVar) => {
											inScopeVariablesList.push({ token: token, name: catchVar });
										});
									}
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
						attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
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
						if (xmlTokenType === XSLTokenLevelState.attributeName) {
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
						} else {
							attType = AttributeType.Xmlns;
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
								if (elementStack.length > 2) {
									let parentElemmentName = elementStack[elementStack.length - 1].symbolName;
									if (parentElemmentName === 'xsl:iterate' && tagElementName === 'xsl:param') {
										currentXSLTIterateParams[currentXSLTIterateParams.length - 1].push(variableName);
									}
								}
								variableData = { token: token, name: variableName };
								break;
							case AttributeType.InstructionName:
								let slashPos = variableName.lastIndexOf('/');
								if (slashPos > 0) {
									// package name may be URI
									variableName = variableName.substring(slashPos + 1);
								}
								tagIdentifierName = variableName;

								if (isOnRequiredToken) {
									if (tagElementName === 'xsl:call-template') {
										resultCompletions = XsltTokenCompletions.getSpecialCompletions(GlobalInstructionType.Template, globalInstructionData, importedInstructionData);
									} else if (tagElementName === 'xsl:with-param' && elementStack.length > 0) {
										// get name attribute of parent
										let parentElemment = elementStack[elementStack.length - 1];
										if (parentElemment.symbolName === 'xsl:next-iteration' && currentXSLTIterateParams.length > 0) {
											resultCompletions = XsltTokenCompletions.getSimpleInsertCompletions(currentXSLTIterateParams[currentXSLTIterateParams.length - 1], vscode.CompletionItemKind.Variable);
										} else {
											let templateName = parentElemment.symbolID;
											resultCompletions = XsltTokenCompletions.getSpecialCompletions(GlobalInstructionType.Template, globalInstructionData, importedInstructionData, templateName);
										}
									} else if (languageConfig.docType === DocumentTypes.DCP && languageConfig.resourceNames && tagElementName === 'resource') {
										let varCompletionStrings = languageConfig.resourceNames;
										resultCompletions = XsltTokenCompletions.getSimpleInsertCompletions(varCompletionStrings, vscode.CompletionItemKind.Variable);
									} else if (languageConfig.docType === DocumentTypes.DCP && languageConfig.featureNames && tagElementName === 'feature') {
										let varCompletionStrings = languageConfig.featureNames;
										resultCompletions = XsltTokenCompletions.getSimpleInsertCompletions(varCompletionStrings, vscode.CompletionItemKind.Variable);
									} else if (languageConfig.docType === DocumentTypes.DCP && languageConfig.propertyNames && tagElementName === 'property') {
										let varCompletionStrings = languageConfig.propertyNames;
										resultCompletions = XsltTokenCompletions.getSimpleInsertCompletions(varCompletionStrings, vscode.CompletionItemKind.Variable);
									} else {
										resultCompletions = [];
									}
								}
								break;
							case AttributeType.InstructionMode:
								if (tagIdentifierName === '') {
									tagIdentifierName = variableName;
								}
								if (isOnRequiredToken) {
									let completionStrings: string[] = [];
									globalInstructionData.forEach((item) => {
										if (item.type === GlobalInstructionType.Mode) {
											if (completionStrings.indexOf(item.name) === -1 && item.name.charAt(0) !== '#') {
												completionStrings.push(item.name);
											}
										}
									});
									let allCompletions = XsltTokenCompletions.getSimpleInsertCompletions(completionStrings, vscode.CompletionItemKind.Constant);
									let triples: [string, string, string][] = [['default mode', '#default', '#default'], ['current mode', '#current', '#current']];
									XsltTokenCompletions.createNonAlphanumericCompletions(triples, allCompletions);
									resultCompletions = allCompletions;
								}
								break;
							case AttributeType.UseAttributeSets:
								if (isOnRequiredToken) {
									resultCompletions = XsltTokenCompletions.getSpecialCompletions(GlobalInstructionType.AttributeSet, globalInstructionData, importedInstructionData);
								}
								break;
							case AttributeType.ExcludeResultPrefixes:
								let excludePrefixes = variableName.split(/\s+/);
								tagExcludeResultPrefixes = { token: token, prefixes: excludePrefixes };
								break;
							case AttributeType.Xmlns:
								break;
							default:
								if (isOnRequiredToken) {
									if (tagAttributeNames.length > 0) {
										let attName = tagAttributeNames[tagAttributeNames.length - 1];
										if (languageConfig.docType === DocumentTypes.DCP && (attName === 'parameterRef' || attName === 'if' || attName === 'unless')) {
											let varCompletionStrings: string[] = [];
											globalInstructionData.forEach((instruction) => {
												if (instruction.type === GlobalInstructionType.Variable || instruction.type === GlobalInstructionType.Parameter) {
													if (varCompletionStrings.indexOf(instruction.name) < 0) {
														varCompletionStrings.push(instruction.name);
													}
												}
											});
											resultCompletions = XsltTokenCompletions.getSimpleInsertCompletions(varCompletionStrings, vscode.CompletionItemKind.Variable);
										} else if (languageConfig.expressionAtts && languageConfig.expressionAtts.indexOf(attName) !== -1) {
											let prev2Token = allTokens[index - 2];
											resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
										} else if (variableName === '}' && token.startCharacter + 1 === requiredChar) {
											// for avt
											let prev2Token = allTokens[index - 2];
											let prev2IsXML = prev2Token.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
											if (!prev2IsXML) {
												resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
											}
										} else {
											if (attName === 'as') {
												let completionStrings = XsltTokenCompletions.sequenceTypes;
												resultCompletions = XsltTokenCompletions.getSimpleInsertCompletions(completionStrings, vscode.CompletionItemKind.TypeParameter);
											} else {
												resultCompletions = XsltTokenCompletions.getXSLTAttributeValueCompletions(schemaQuery, position, tagElementName, attName);
											}
										}
									}
								}
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
								let instrType = xp.function.value === 'key' ? GlobalInstructionType.Key : GlobalInstructionType.Accumulator;
								resultCompletions = XsltTokenCompletions.getTokenSpecialCompletions(token, instrType, globalInstructionData, importedInstructionData);
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
								let globalVarName: string | null = null;
								if (tagType === TagType.XSLTvar && elementStack.length === 1) {
									globalVarName = tagIdentifierName;
								}
								resultCompletions = XsltTokenCompletions.getVariableCompletions(globalVarName, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList);
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
							resultCompletions = XsltTokenCompletions.getAllTokenCompletions(docType, position, token, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
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
									if (isOnStartOfRequiredToken && prevToken) {
										let prev2Token = prevToken.tokenType === TokenLevelState.operator ? allTokens[index - 2] : null;
										resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
									} else {
										resultCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
									}
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
									if (isOnStartOfRequiredToken && prevToken) {
										let prev2Token = prevToken.tokenType === TokenLevelState.operator ? allTokens[index - 2] : null;
										resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
									} else {
										resultCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
									}
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
												//let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, fnName, GlobalInstructionType.Function, fnArity);
												//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
											}
										}
									} else {
										inScopeXPathVariablesList = [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
								}
								if (isOnStartOfRequiredToken && prevToken) {
									let prev2Token = prevToken.tokenType === TokenLevelState.operator ? allTokens[index - 2] : null;
									resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
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
									if (isOnStartOfRequiredToken && prevToken) {
										let prev2Token = prevToken.tokenType === TokenLevelState.operator ? allTokens[index - 2] : null;
										resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
									} else if (token.value === '/') {
										const pathTokens = XsltSymbolProvider.filterPathTokens(allTokens, index - 1);
										console.log(pathTokens);
										const [elementNames, attrNames] = XsltSymbolProvider.getExpectedForXPathLocation(pathTokens, xpathDocSymbols);
										console.log('elementNames');
										console.log(elementNames);
										console.log('attrtNames');
										console.log(attrNames);
										resultCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
									} else if (token.value === '!') {
										let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XsltTokenCompletions.internalFunctionCompletions(docType));
										let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData);
										resultCompletions = fnCompletions.concat(userFnCompletions);
									}
								}
								break;
							case CharLevelState.dSep:
								if (token.value === '()' && prevToken?.tokenType === TokenLevelState.simpleType) {
									let completionStrings: string[] = [];
									if (isOnRequiredToken && requiredChar === token.startCharacter + 1) {
										if (Data.nonFunctionTypes.indexOf(prevToken.value) !== -1) {
											completionStrings = XsltTokenCompletions.sequenceTypes;
										} else if (prevToken.value === 'element') {
											completionStrings = elementNameTests;
										} else if (prevToken.value === 'attribute') {
											completionStrings = attNameTests.map(t => t.substring(1));
										}
										resultCompletions = XsltTokenCompletions.getNormalCompletions(position, completionStrings, vscode.CompletionItemKind.TypeParameter);

									}
								}
								if (token.value === '()' && prevToken?.tokenType === TokenLevelState.function) {
									if (isOnRequiredToken && requiredChar === token.startCharacter + 1) {
										resultCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
									}
									if (awaitingRequiredArity) {
										const fnArity = incrementFunctionArity ? 1 : 0;
										const fnName = prevToken.value;
										//let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, fnName, GlobalInstructionType.Function, fnArity);
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
							//let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, name, GlobalInstructionType.Function, arity);
							//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
						}
						break;
				}
			}
			prevToken = token;
		}

		return resultCompletions;
	}

	private static createNonAlphanumericCompletions(triples: [string, string, string][], allCompletions: vscode.CompletionItem[]) {
		triples.forEach((pair) => {
			const label = pair[0];
			const text = pair[1];
			const detail = pair[2];
			const newItem = new vscode.CompletionItem(label, vscode.CompletionItemKind.Constant);
			newItem.detail = detail;
			newItem.insertText = text;
			allCompletions.push(newItem);
		});
	}

	private static internalFunctionCompletions(docType: DocumentTypes) {
		if (docType === DocumentTypes.XSLT) {
			return XPathFunctionDetails.data;
		} else {
			return XPathFunctionDetails.xpathData;
		}
	}

	private static getXPathCompletions(docType: DocumentTypes, previous2Token: BaseToken | null, previousToken: BaseToken | null, position: vscode.Position, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]) {
		if (!previousToken || previousToken.tokenType >= XsltTokenCompletions.xsltStartTokenNumber) {
			return XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
		}
		let xpath2TokenType = <TokenLevelState>previousToken.tokenType;
		let xpath2CharType = <CharLevelState>previousToken.charType;
		let xpathCompletions: vscode.CompletionItem[] | undefined;
		switch (xpath2TokenType) {
			case TokenLevelState.operator:
				switch (xpath2CharType) {
					case CharLevelState.rB:
					case CharLevelState.rBr:
					case CharLevelState.rPr:
					case CharLevelState.lBr:
						break;
					default:
						let pValue = previousToken.value;
						let isSimpleType = false;
						if (pValue === 'is' || pValue === 'of') {
							// do nothing
						} else if (pValue === 'as') {
							isSimpleType = previous2Token?.value === 'cast' || previous2Token?.value === 'castable';
						} else {
							xpathCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
						}
						if (!xpathCompletions) {
							let completionStrings = isSimpleType ? FunctionData.simpleTypes : XsltTokenCompletions.sequenceTypes;
							xpathCompletions = XsltTokenCompletions.getNormalCompletions(position, completionStrings, vscode.CompletionItemKind.TypeParameter);
						}
						break;
				}
				break;
			case TokenLevelState.complexExpression:
				switch (previousToken?.value) {
					case ':=':
					case 'return':
					case 'satisfies':
					case 'else':
					case 'then':
					case 'in':
						xpathCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
						break;
				}
				break;
		}
		if (!xpathCompletions) {
			xpathCompletions = [];
		}
		return xpathCompletions;
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

	private static getVariableCompletions(globalVarName: string | null, elementStack: ElementData[], xpathStack: XPathData[], token: BaseToken, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[],
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
		return XsltTokenCompletions.createVariableCompletions('$', completionStrings, token, vscode.CompletionItemKind.Variable);
	}

	private static getTokenSpecialCompletions(token: BaseToken, type: GlobalInstructionType, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]): vscode.CompletionItem[] {
		let completionStrings: string[] = [];
		const quote = type === GlobalInstructionType.AttributeSet ? '"' : '\'';
		globalInstructionData.forEach((instruction) => {
			const name = quote + instruction.name + quote;
			if (instruction.type === type) {
				if (completionStrings.indexOf(name)) {
					completionStrings.push(name);
				}
			}
		});

		importedInstructionData.forEach((instruction) => {
			const name = quote + instruction.name + quote;
			if (instruction.type === type) {
				if (completionStrings.indexOf(name)) {
					completionStrings.push(name);
				}
			}
		});

		let allCompletions = XsltTokenCompletions.getTokenCompletions(token, completionStrings, vscode.CompletionItemKind.Property);
		return allCompletions;
	}

	private static getSpecialCompletions(type: GlobalInstructionType, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], instrName?: string): vscode.CompletionItem[] {
		let completionStrings: string[] = [];

		if (instrName) {
			let gd = globalInstructionData.find(data => data.type === type && data.name === instrName);
			if (!gd) {
				gd = importedInstructionData.find(data => data.type === type && data.name === instrName);
			}
			if (gd && gd.memberNames) {
				completionStrings = gd.memberNames;
			}
		} else {
			globalInstructionData.forEach((instruction) => {
				const name = instruction.name;
				if (instruction.type === type) {
					if (completionStrings.indexOf(name)) {
						completionStrings.push(name);
					}
				}
			});

			importedInstructionData.forEach((instruction) => {
				const name = instruction.name;
				if (instruction.type === type) {
					if (completionStrings.indexOf(name)) {
						completionStrings.push(name);
					}
				}
			});
		}

		let elementCompletions = XsltTokenCompletions.getSimpleInsertCompletions(completionStrings, vscode.CompletionItemKind.Unit);
		return elementCompletions;
	}

	private static getAllCompletions(docType: DocumentTypes, position: vscode.Position, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]) {
		let resultCompletions: vscode.CompletionItem[] | undefined;
		let elementCompletions = XsltTokenCompletions.getNormalCompletions(position, elementNameTests, vscode.CompletionItemKind.Unit);
		let attnamecompletions = XsltTokenCompletions.getNormalCompletions(position, attNameTests, vscode.CompletionItemKind.Unit);
		let axes = Data.cAxes.map(axis => axis + '::');
		let axisCompletions = XsltTokenCompletions.getCommandCompletions(position, axes, vscode.CompletionItemKind.Function);
		let nodeTypes = Data.nodeTypes.map(axis => axis + '()');
		let nodeCompletions = XsltTokenCompletions.getNormalCompletions(position, nodeTypes, vscode.CompletionItemKind.Property);
		let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XsltTokenCompletions.internalFunctionCompletions(docType));
		let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData);
		resultCompletions = elementCompletions.concat(attnamecompletions, axisCompletions, nodeCompletions, fnCompletions, userFnCompletions);
		return resultCompletions;
	}

	private static getAllTokenCompletions(docType: DocumentTypes, position: vscode.Position, token: BaseToken, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]) {
		let resultCompletions: vscode.CompletionItem[] | undefined;
		let elementCompletions = XsltTokenCompletions.getTokenCompletions(token, elementNameTests, vscode.CompletionItemKind.Unit);
		let attnamecompletions = XsltTokenCompletions.getTokenCompletions(token, attNameTests, vscode.CompletionItemKind.Unit);
		let axes = Data.cAxes.map(axis => axis + '::');
		let axisCompletions = XsltTokenCompletions.getTokenCommandCompletions(token, position, axes, vscode.CompletionItemKind.Function);
		let nodeTypes = Data.nodeTypes.map(axis => axis + '()');
		let nodeCompletions = XsltTokenCompletions.getTokenCompletions(token, nodeTypes, vscode.CompletionItemKind.Property);
		let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XsltTokenCompletions.internalFunctionCompletions(docType), token);
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

	private static getTokenCommandCompletions(token: BaseToken, pos: vscode.Position, completionStrings: string[], kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];
		const startPos = new vscode.Position(token.line, token.startCharacter);
		const endPos = new vscode.Position(token.line, token.startCharacter + token.length);
		const range = new vscode.Range(startPos, endPos);
		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = name;
				const newItem = new vscode.CompletionItem(varName, kind);
				newItem.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };
				newItem.range = range;
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
			const suffixBrackets = noArgs ? '()${0}' : '(${0})';
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
				const suffixBrackets = noArgs ? '()${0}' : '(${0})';
				const newItem = new vscode.CompletionItem(item.name, vscode.CompletionItemKind.Function);
				//newItem.documentation = new vscode.MarkdownString(item.description);
				newItem.detail = item.idNumber === 0 ? item.name + '()' : item.name + '( ' + item.memberNames?.join(', ') + ' )';
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

	private static getSimpleInsertCompletions(completionStrings: string[], kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];
		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = name;
				const newItem = new vscode.CompletionItem(varName, kind);
				completionItems.push(newItem);
			}
		});
		return completionItems;
	}

	private static getXSLTTagCompletions(docType: DocumentTypes, languageConfig: LanguageConfiguration, schemaQuery: SchemaQuery | undefined, pos: vscode.Position, elementStack: ElementData[], inScopeVariablesList: VariableData[]) {
		if (!schemaQuery) {
			return XsltTokenCompletions.getXSLTSnippetCompletions(languageConfig.elementSnippets);
		}
		let expectedTags: [string, string][] = [];
		let xsltParent: string | null = null;
		let stackPos = elementStack.length - 1;
		let isXSLT = docType === DocumentTypes.XSLT;
		let isWithinXslIterate = false;
		let isWithinXslNextIteration = false;
		while (stackPos > -1) {
			let elementName = elementStack[stackPos].symbolName;
			if (isXSLT && elementName.startsWith('xsl:')) {
				if (!xsltParent) {
					xsltParent = elementName;
				}
				if (elementName === 'xsl:next-iteration') {
					isWithinXslNextIteration = true;
					break;
				}
				if (!isWithinXslIterate) {
					isWithinXslIterate = elementName === 'xsl:iterate';
				}
			} else if (!isXSLT) {
				xsltParent = elementName;
				break;
			}
			stackPos--;
		}
		expectedTags = xsltParent ? schemaQuery.getExpected(xsltParent).elements : [];

		let completionItems: vscode.CompletionItem[] = [];
		XsltTokenCompletions.addNewCompletionItem(completionItems, 'literal-xml-comment', '', '!-- $0 -->');
		XsltTokenCompletions.addNewCompletionItem(completionItems, 'literal-xml-processing-instruction', '', '?${1:name} ${0:value} ?>');
		if (isWithinXslIterate) {
			const newItem = new vscode.CompletionItem('xsl:next-iteration', vscode.CompletionItemKind.Struct);
			newItem.documentation = "start next iteration with provided xsl:param context";
			newItem.insertText = new vscode.SnippetString('xsl:next-iteration>\n\t<xsl:with-param name="$1" select="$2"/>$0\n</xsl:next-iteration>');
			completionItems.push(newItem);
			const newItem1 = new vscode.CompletionItem('xsl:break', vscode.CompletionItemKind.Struct);
			newItem1.documentation = "terminate the iteration without processing further items in the input sequence";
			newItem1.insertText = new vscode.SnippetString('xsl:break/>');
			completionItems.push(newItem1);
		} else if (isWithinXslNextIteration) {
			const newItem = new vscode.CompletionItem('xsl:with-param', vscode.CompletionItemKind.Struct);
			newItem.documentation = "provide xsl:param context for next iteration";
			newItem.insertText = new vscode.SnippetString('xsl:with-param name="$1" select="$2"/>$0');
			completionItems.push(newItem);
		}
		expectedTags.forEach((tagData) => {
			let tagName = tagData[0];
			let tagDetail = tagData[1];
			let snippetAttrs = schemaQuery.getExpected(tagName).foundAttributes;
			let attrText = '';

			let competionName = tagName;
			let description: string | undefined;
			let useCurrent = true;
			if (docType === DocumentTypes.XSLT) {
				if (tagName === 'xsl:break' || tagName === 'xsl:next-iteration') {
					useCurrent = false;
				} else if (tagName === 'xsl:template') {
					const newItem = new vscode.CompletionItem(tagName + ' match', vscode.CompletionItemKind.Struct);
					newItem.documentation = "xsl:template with 'match' attribute";
					newItem.insertText = new vscode.SnippetString('xsl:template match="$1" mode="${2:#default}">\n\t$0\n</xsl:template>');
					completionItems.push(newItem);
					competionName = tagName + ' name';
					description = "xsl:template with 'name' attribute";
				} else if (xsltParent === 'xsl:function' && tagName === 'xsl:param') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:param name="$1" as="$2"/>$0');
					completionItems.push(newItem);
					competionName = tagName + ' name';
				} else if (tagName === 'xsl:copy') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:copy>\n\t$0\n</xsl:copy>');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:literal-result-element') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem('literal-self-closing-element', vscode.CompletionItemKind.Struct);
					newItem.documentation = "self-closing tag";
					newItem.insertText = new vscode.SnippetString('${1:div} ${2:class}="$3"/>$0');
					completionItems.push(newItem);
					const newItem2 = new vscode.CompletionItem('literal-start-element', vscode.CompletionItemKind.Struct);
					newItem2.documentation = "start tag only";
					newItem2.insertText = new vscode.SnippetString('${1:div}>$0');
					completionItems.push(newItem2);
					const newItem3 = new vscode.CompletionItem('literal-element', vscode.CompletionItemKind.Struct);
					newItem3.documentation = "start and close tags";
					newItem3.insertText = new vscode.SnippetString('${1:div}>\n\t$0\n</${1:div}>');
					completionItems.push(newItem3);
					XsltTokenCompletions.addNewCompletionItem(completionItems, 'literal-xml-CDATA', '', '![CDATA[${0:text}]]>');

				} else if (tagName === 'xsl:message') {
					useCurrent = false;
					if (inScopeVariablesList.length > 0) {
						const newItem = new vscode.CompletionItem(tagName + ' (add watch-variables)', vscode.CompletionItemKind.Struct);
						newItem.documentation = "xsl:message to output in-scope variable values";
						const scopeVarNames = inScopeVariablesList.map((item) => item.name);
						const maxScopeVarLength = scopeVarNames.reduce((a, b) => a.length > b.length ? a : b).length + 5;
						const scopeVariables = scopeVarNames.map((name) => {
							return '\t' + name + ':' + ' '.repeat(maxScopeVarLength - name.length) + '{\\$' + name + '}';
						});
						const header = '==== ${1:Watch Variables} ====\n'
						const scopeVariablesString = header + scopeVariables.join('\n');
						newItem.insertText = new vscode.SnippetString(`xsl:message expand-text="yes">\n${scopeVariablesString}\n</xsl:message>$0`);
						completionItems.push(newItem);
					}
					const newItem = new vscode.CompletionItem(tagName + ' (blank)', vscode.CompletionItemKind.Struct);
					newItem.documentation = "xsl:message";
					newItem.insertText = new vscode.SnippetString(`xsl:message select="\${1:'debug message'}"/>$0`);
					completionItems.push(newItem);
				}
			} else if (docType === DocumentTypes.DCP) {
				if (snippetAttrs.length === 1 && snippetAttrs.indexOf('literalValue') !== -1) {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.documentation = tagDetail;
					newItem.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };
					newItem.insertText = new vscode.SnippetString(tagName + ' $0/>');
					completionItems.push(newItem);
				}
			}
			if (useCurrent) {
				switch (snippetAttrs.length) {
					case 0:
						break;
					case 1:
						attrText = ' ' + snippetAttrs[0] + '="$1"';
						break;
					default:
						schemaQuery.soughtAttributes.forEach((attr, index) => {
							if (snippetAttrs.indexOf(attr) > -1) {
								attrText += ` ${attr}="$${index + 1}"`
							}
						});
						break;
				}

				let selfCloseTag = snippetAttrs.length === 0 ? '/>' : '/>$0';
				let makeEmpty = false;
				if (docType === DocumentTypes.DCP) {
					makeEmpty = (tagName !== 'description' && schemaQuery.getExpected(tagName).elements.length === 0) || schemaQuery.emptyElements.indexOf(tagName) !== -1;
				} else if (docType === DocumentTypes.XSLT) {
					makeEmpty = schemaQuery.emptyElements.indexOf(tagName) !== -1 || schemaQuery.getExpected(tagName).elements.length === 0;
				}
				let tagClose = makeEmpty ? selfCloseTag : ">\n\t$0\n</" + tagName + ">";
				const newItem = new vscode.CompletionItem(competionName, vscode.CompletionItemKind.Struct);
				if (tagDetail.length > 0) {
					newItem.documentation = tagDetail;
				}
				newItem.insertText = new vscode.SnippetString(tagName + attrText + tagClose);
				if (description) {
					newItem.documentation = description;
				}
				completionItems.push(newItem);
			} else {
				useCurrent = true;
			}
		});
		return completionItems;
	}

	private static addNewCompletionItem(completionItems: vscode.CompletionItem[], itemLabel: string, documentation: string, snippetString: string) {
		const newItem4 = new vscode.CompletionItem(itemLabel, vscode.CompletionItemKind.Struct);
		newItem4.documentation = documentation;
		newItem4.insertText = new vscode.SnippetString(snippetString);
		completionItems.push(newItem4);
	}

	private static getXSLTSnippetCompletions(snippets: Snippet[] | undefined) {
		if (!snippets) {
			return [];
		}
		let completionItems: vscode.CompletionItem[] = [];
		snippets.forEach((snippet) => {
			const newItem = new vscode.CompletionItem(snippet.name, vscode.CompletionItemKind.Struct);
			newItem.insertText = new vscode.SnippetString(snippet.body);
			newItem.documentation = new vscode.MarkdownString(snippet.description);
			completionItems.push(newItem);
		});
		return completionItems;
	}


	private static getXSLTAttributeCompletions(schemaQuery: SchemaQuery | undefined, pos: vscode.Position, xsltParent: string, existingAttrs: string[]) {
		if (!schemaQuery) {
			return this.getXSLTSnippetCompletions(XMLSnippets.generalAttributes);
		}
		let expectedAttributes: string[] = [];

		expectedAttributes = xsltParent ? schemaQuery.getExpected(xsltParent).attrs : [];

		let completionItems: vscode.CompletionItem[] = [];
		expectedAttributes.forEach((attrName) => {
			if (existingAttrs.indexOf(attrName) === -1) {
				let isDCP = schemaQuery.docType === DocumentTypes.DCP;
				let attributeDec = isDCP ? attrName + '="$0"' : `${attrName}="$1"$0`;
				const newItem = new vscode.CompletionItem(attrName, vscode.CompletionItemKind.Reference);
				if (isDCP) {
					newItem.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };
				}

				newItem.insertText = new vscode.SnippetString(attributeDec);
				completionItems.push(newItem);
			}
		});
		let xmlnsCompletions: vscode.CompletionItem[] = [];
		if (schemaQuery.docType === DocumentTypes.XSLT && (xsltParent === 'xsl:stylesheet' || xsltParent === 'xsl:transforrm' || xsltParent === 'xsl:package')) {
			xmlnsCompletions = XsltTokenCompletions.getXSLTSnippetCompletions(XSLTSnippets.xsltXMLNS);
		}

		let isXSLT = xsltParent.startsWith('xsl:');
		if (schemaQuery.docType === DocumentTypes.XSLT && !isXSLT) {
			let attributeDec = '${1:name}="$2"$0';
			const newItem = new vscode.CompletionItem('literal-attribute', vscode.CompletionItemKind.Reference);
			newItem.insertText = new vscode.SnippetString(attributeDec);
			completionItems.push(newItem);
		}

		return completionItems.concat(xmlnsCompletions);
	}

	private static getXSLTAttributeValueCompletions(schemaQuery: SchemaQuery | undefined, pos: vscode.Position, xsltParent: string, currentAttribute: string) {
		if (!schemaQuery) {
			return [];
		}
		let expectedAttrValues: [string, string][] = [];

		expectedAttrValues = schemaQuery.getExpected(xsltParent, currentAttribute).attributeValues;

		let completionItems: vscode.CompletionItem[] = [];
		expectedAttrValues.forEach((attrValueData) => {
			let attrName = attrValueData[0];
			let attrDocs = attrValueData[1];
			const newItem = new vscode.CompletionItem(attrName, vscode.CompletionItemKind.Reference);
			if (attrDocs.length > 0) {
				newItem.documentation = attrDocs;
			}
			newItem.insertText = new vscode.SnippetString(attrName);
			completionItems.push(newItem);
		});
		return completionItems;
	}

	private static getTokenCompletions(token: BaseToken, completionStrings: string[], kind: vscode.CompletionItemKind, excludeChar?: string) {
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
			if (index >= startIndex || (index === 1 && (element as ElementData).symbolName === 'xsl:accumulator')) {
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

}

export interface FunctionCompletionData {
	name: string;
	signature: string;
	description: string;
}

