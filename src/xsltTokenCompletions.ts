/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
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
import { XSLTConfiguration } from './languageConfigurations';
import { SaxonTaskProvider } from './saxonTaskProvider';
import { XMLDocumentFormattingProvider } from './xmlDocumentFormattingProvider';
import { RecordType, RecordTypes } from './recordTypes';

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
	UseAccumulators,
	ExcludeResultPrefixes,
	Xmlns
}

interface XSLTToken extends BaseToken {
	tagType?: TagType;
}

export interface ElementData {
	variables: VariableData[];
	currentVariable?: VariableData;
	xpathVariableCurrentlyBeingDefined?: boolean;
	identifierToken: XSLTToken;
	symbolName: string;
	symbolID: string;
	childSymbols: vscode.DocumentSymbol[];
	namespacePrefixes: string[];
}
export interface XPathData {
	token: BaseToken;
	variables: VariableData[];
	preXPathVariable: boolean;
	xpathVariableCurrentlyBeingDefined: boolean;
	function?: BaseToken;
	functionArity?: number;
	isRangeVar?: boolean;
	// the exact keyword text ('for'/'let'/'some'/'every') that pushed this range-var scope -
	// captured directly at push time since token.value isn't populated for these keyword tokens
	// (their text has to be read via XsltTokenDiagnostics.getTextForToken(document) instead)
	rangeVarKeyword?: string;
	awaitingArity: boolean;
	tokenIndex?: number;
}

export interface VariableData {
	token: BaseToken;
	name: string;
	uri?: string;
	index: number;
	// For xsl:variable/xsl:param declarations only: the token index where the
	// bound expression (the select attribute's value) actually begins. This is
	// captured directly while scanning the element's attributes so that
	// fetchXPathVariableTokens doesn't have to guess a fixed offset from the
	// name attribute, which breaks whenever another attribute (e.g. as=) sits
	// between name= and select=. Left undefined for XPath-level let/for/anonymous
	// function range-variable bindings, which continue to use the index+2 offset.
	selectExprStartIndex?: number;
}

export class XsltTokenCompletions {
	static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	static extXPathVariables: Map<string, string> = new Map();
	private static readonly xslInclude = 'xsl:include';
	private static readonly xslImport = 'xsl:import';
	private static readonly xmlChars = ['lt', 'gt', 'quot', 'apos', 'amp'];


	private static readonly xslFunction = 'xsl:function';

	private static readonly xslNameAtt = 'name';
	private static readonly xslModeAtt = 'mode';
	private static readonly useAttSet = 'use-attribute-sets';
	private static readonly xslUseAttSet = 'xsl:use-attribute-sets';
	private static readonly useAccumulators = 'use-accumulators';
	private static readonly excludePrefixes = 'exclude-result-prefixes';
	private static readonly xslExcludePrefixes = 'xsl:exclude-result-prefixes';
	private static readonly sequenceTypes = FunctionData.simpleTypes.concat(Data.nodeTypesBrackets, Data.nonFunctionTypesBrackets);
	// XPath 3.1 has no jnode() item type
	private static readonly sequenceTypes31 = XsltTokenCompletions.sequenceTypes.filter((t) => t !== 'jnode()');

	// XSLT 4.0 named item types, declared with xsl:item-type - set for each getCompletions call
	private static itemTypeNames: string[] = [];
	// the named item types that may be atomic, for 'cast as' and 'castable as', e.g. as="enum('a', 'b')"
	private static atomicItemTypeNames: string[] = [];

	private static sequenceTypesFor(docType: DocumentTypes) {
		return docType === DocumentTypes.XSLT40 || docType === DocumentTypes.XPath ? XsltTokenCompletions.itemTypeNames.concat(XsltTokenCompletions.sequenceTypes) : XsltTokenCompletions.sequenceTypes31;
	}

	private static setItemTypeNames(docType: DocumentTypes, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]) {
		const itemTypes = docType === DocumentTypes.XSLT40 ? globalInstructionData.concat(importedInstructionData).filter((g) => g.type === GlobalInstructionType.ItemType) : [];
		const names = (list: GlobalInstructionData[]) => list.map((g) => g.name).filter((name, index, all) => all.indexOf(name) === index);
		XsltTokenCompletions.itemTypeNames = names(itemTypes);
		const nonAtomic = /^\s*\(?\s*(record|map|array|function|fn|element|attribute|document-node|node|item|text|comment|processing-instruction|namespace-node|jnode|gnode)\s*\(/;
		XsltTokenCompletions.atomicItemTypeNames = names(itemTypes.filter((g) => g.declaredType && !nonAtomic.test(g.declaredType)));
	}
	private static readonly doubleParts = ['castable as', 'cast as', 'instance of', 'treat as'];
	private static useIxslFunctions = false;

	public static getCompletions = (languageConfig: LanguageConfiguration, xpathDocSymbols: vscode.DocumentSymbol[], xslVariable: string[], attNameTests: string[], elementNameTests: string[], document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], position: vscode.Position): vscode.CompletionItem[] | undefined => {
		let schemaQuery: SchemaQuery | undefined;
		let lineNumber = -1;
		let docType = languageConfig.isVersion4 ? DocumentTypes.XSLT40 : languageConfig.docType;
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
		XsltTokenCompletions.useIxslFunctions = false;
		XsltTokenCompletions.setItemTypeNames(docType, globalInstructionData, importedInstructionData);

		let tagExcludeResultPrefixes: { token: BaseToken; prefixes: string[] } | null = null;
		let requiredLine = position.line;
		let requiredChar = position.character;
		let isOnRequiredToken = false;
		let awaitingRequiredArity = false;
		let keepProcessing = false;
		let isOnStartOfRequiredToken = false;
		let currentXSLTIterateParams: string[][] = [];
		// see VariableData.selectExprStartIndex: track, while scanning an
		// xsl:variable/xsl:param start-tag's attributes, the token index where the
		// select attribute's embedded XPath expression begins.
		let awaitingSelectExprStart = false;
		let pendingSelectExprIndex: number | undefined = undefined;
		// don't include imported for path completions:
		let allInstructionData = globalInstructionData;
		const lastTokenIndex = allTokens.length - 1;

		if (languageConfig.isVersion4) {
			schemaQuery = new SchemaQuery(XSLTConfiguration.schemaData4);
		} else if (languageConfig.schemaData) {
			schemaQuery = new SchemaQuery(languageConfig.schemaData);
		}
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
				const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
				resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prevToken, token, position, elementNames, attrNames, globalInstructionData, importedInstructionData, xpathStack);
				if (!XsltTokenCompletions.isKindType(resultCompletions)) {
					resultCompletions = resultCompletions.concat(XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList));
				}
				return resultCompletions;
			}
			if (prevToken) {
				if (overranPos) {
					let treatAsXML = token.tokenType >= XsltTokenCompletions.xsltStartTokenNumber && prevToken.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
					if (treatAsXML) {
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
						const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
						resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNames, attrNames, globalInstructionData, importedInstructionData, xpathStack);
						if (!XsltTokenCompletions.isKindType(resultCompletions)) {
							resultCompletions = resultCompletions.concat(XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList));
						}
					}
				}
			}
			if (overranPos) {
				return resultCompletions;
			}

			isOnRequiredToken = isOnRequiredLine && requiredChar >= token.startCharacter && requiredChar <= (token.startCharacter + token.length);
			isOnStartOfRequiredToken = isOnRequiredToken && requiredChar === token.startCharacter;
			// if (isOnRequiredToken) {
			// 	console.log('--------- on required token ---------');
			// 	console.log('column:' + (position.character + 1) + ' text: ' + token.value + ' prev: ' + prevToken?.value);
			// 	console.log('tokenValue ' + token.value + ' type: ' + TokenLevelState[token.tokenType]);
			// }
			let isXMLToken = token.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
			if (!isXMLToken && awaitingSelectExprStart) {
				// first embedded-XPath token of the select attribute's value
				pendingSelectExprIndex = index;
				awaitingSelectExprStart = false;
			}
			if (isXMLToken) {
				inScopeXPathVariablesList = [];
				xpathVariableCurrentlyBeingDefined = false;
				// preserve a reference to the pre-reset xpathStack: the closing quote of an XPath-bearing
				// attribute value is itself an XML token, so by the time its own case below runs,
				// xpathStack has already been wiped - but a value sitting right at that boundary (e.g.
				// "select=\"let $p := 22 |\"", cursor right before the closing quote) still needs it.
				const xpathStackAtValueBoundary = xpathStack;
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
						if (isOnRequiredToken) {
							// the tag name itself is still being typed (nothing follows it yet), so the
							// token-scan never reaches an exact match for the '<' punctuation token above -
							// without this, the loop falls through to the "past a complete element name"
							// fallback further down, which wrongly offers attribute completions instead.
							if (elementStack.length === 0) {
								resultCompletions = XsltTokenCompletions.getXSLTSnippetCompletions(languageConfig.rootElementSnippets);
							} else {
								const symbolId = elementStack[elementStack.length - 1].symbolID;
								resultCompletions = XsltTokenCompletions.getXSLTTagCompletions(document, docType, languageConfig, schemaQuery, position, elementStack, inScopeVariablesList, symbolId);
							}
						}
						break;
					case XSLTokenLevelState.elementName:
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						if (tagType === TagType.Start) {
							tagType = TagType.XMLstart;
							startTagToken = token;
						}
						if (isOnRequiredToken) {
							// see the matching comment in the xslElementName case above
							if (elementStack.length === 0) {
								resultCompletions = XsltTokenCompletions.getXSLTSnippetCompletions(languageConfig.rootElementSnippets);
							} else {
								const symbolId = elementStack[elementStack.length - 1].symbolID;
								resultCompletions = XsltTokenCompletions.getXSLTTagCompletions(document, docType, languageConfig, schemaQuery, position, elementStack, inScopeVariablesList, symbolId);
							}
						}
						break;
					case XSLTokenLevelState.xmlText:
						if (isOnRequiredToken) {
							const isTVT = !!prevToken && prevToken?.tokenType < XsltTokenDiagnostics.xsltStartTokenNumber;
							if (isTVT) {
								let prev2Token = prevToken?.tokenType === TokenLevelState.operator ? allTokens[index - 2] : null;
								const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
								resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNames, attrNames, globalInstructionData, importedInstructionData, xpathStack);
								if (!XsltTokenCompletions.isKindType(resultCompletions)) {
									resultCompletions = resultCompletions.concat(XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList));
								}
							}
						}
						break;
					case XSLTokenLevelState.xmlPunctuation:
						switch (xmlCharType) {
							case XMLCharState.lSt:
								if (isOnRequiredToken) {
									if (elementStack.length === 0) {
										resultCompletions = XsltTokenCompletions.getXSLTSnippetCompletions(languageConfig.rootElementSnippets);
									} else {
										const symbolId = elementStack[elementStack.length - 1].symbolID;
										resultCompletions = XsltTokenCompletions.getXSLTTagCompletions(document, docType, languageConfig, schemaQuery, position, elementStack, inScopeVariablesList, symbolId);
									}
								}
								tagAttributeNames = [];
								tagXmlnsNames = [];
								tagIdentifierName = '';
								variableData = null;
								tagElementName = '';
								tagExcludeResultPrefixes = null;
								tagType = TagType.Start;
								awaitingSelectExprStart = false;
								pendingSelectExprIndex = undefined;
								break;
							case XMLCharState.rStNoAtt:
							case XMLCharState.rSt:
							case XMLCharState.rSelfCt:
							case XMLCharState.rSelfCtNoAtt:
								// start-tag ended, we're now within the new element scope:
								if (variableData !== null && pendingSelectExprIndex !== undefined) {
									variableData.selectExprStartIndex = pendingSelectExprIndex;
								}
								if (isOnRequiredToken) {
									resultCompletions = XsltTokenCompletions.getXSLTAttributeCompletions(schemaQuery, position, tagElementName, tagAttributeNames);
								}
								tagAttributeNames = [];
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
										inScopeVariablesList.push({ token: token, name: 'value', index: index });
									} else if (tagElementName === 'xsl:catch') {
										XsltTokenDiagnostics.xsltCatchVariables.forEach((catchVar) => {
											inScopeVariablesList.push({ token: token, name: catchVar, index: index });
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
									// copy (not reuse) newVariablesList so that variables still in scope (e.g. from
									// an enclosing xsl:template) remain visible for completions inside this element,
									// while leaving the snapshot on elementStack untouched for restoration on close
									inScopeVariablesList = newVariablesList.slice();
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
							case XMLCharState.lPi:
								if (isOnRequiredToken) {
									resultCompletions = XsltTokenCompletions.createPiTypeCompletions();
								}
								break;
						}
						break;

					case XSLTokenLevelState.attributeName:
					case XSLTokenLevelState.xmlnsName:
						rootXmlnsName = null;
						attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						// track the select attribute of an xsl:variable/xsl:param so its bound
						// expression's start token can be captured precisely (see VariableData.selectExprStartIndex)
						awaitingSelectExprStart = tagType === TagType.XSLTvar && xmlTokenType === XSLTokenLevelState.attributeName && attNameText === 'select';
						let problemReported = false;

						if (!problemReported) {
							if (tagAttributeNames.indexOf(attNameText) > -1) {
								//
							} else {
								if (xmlTokenType === XSLTokenLevelState.xmlnsName) {
									tagXmlnsNames.push(attNameText);
									if (onRootStartTag) {
										rootXmlnsName = attNameText;
										if (attNameText === 'xmlns:ixsl' && schemaQuery) {
											schemaQuery.useIxsl = true;
											XsltTokenCompletions.useIxslFunctions = true;
										}
									}
								} else {
									tagAttributeNames.push(attNameText);
								}
							}
						}
						if (xmlTokenType === XSLTokenLevelState.attributeName) {
							if (tagType === TagType.XSLTvar) {
								attType = attNameText === XsltTokenCompletions.xslNameAtt ? AttributeType.Variable : AttributeType.None;
							} else if (tagType === TagType.XSLTstart && isXSLT) {
								if (attNameText === XsltTokenCompletions.xslNameAtt) {
									attType = AttributeType.InstructionName;
								} else if (attNameText === XsltTokenCompletions.xslModeAtt) {
									attType = AttributeType.InstructionMode;
								} else if (attNameText === XsltTokenCompletions.useAttSet) {
									attType = AttributeType.UseAttributeSets;
								} else if (attNameText === XsltTokenCompletions.useAccumulators) {
									attType = AttributeType.UseAccumulators;
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
								variableData = { token: token, name: variableName, index: index };
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
										if (item.type === GlobalInstructionType.Mode || item.type === GlobalInstructionType.ModeInstruction || item.type === GlobalInstructionType.ModeTemplate) {
											if (completionStrings.indexOf(item.name) === -1 && item.name.charAt(0) !== '#') {
												completionStrings.push(item.name);
											}
										}
									});
									importedInstructionData.forEach((importItem) => {
										if (importItem.type === GlobalInstructionType.Mode || importItem.type === GlobalInstructionType.ModeInstruction || importItem.type === GlobalInstructionType.ModeTemplate) {
											if (completionStrings.indexOf(importItem.name) === -1 && importItem.name.charAt(0) !== '#') {
												completionStrings.push(importItem.name);
											}
										}
									});
									if (XsltTokenCompletions.useIxslFunctions && tagElementName === 'xsl:template') {
										completionStrings = completionStrings.concat(FunctionData.ixslEventName);
									}
									let allCompletions = XsltTokenCompletions.getSimpleInsertCompletions(completionStrings, vscode.CompletionItemKind.Constant);
									let labels: string[] = tagElementName === 'xsl:apply-templates' ? ['default', 'current'] : ['default', 'current', 'all'];
									XsltTokenCompletions.createNonAlphanumericCompletions(document, position, labels, allCompletions);
									resultCompletions = allCompletions;
								}
								break;
							case AttributeType.UseAttributeSets:
								if (isOnRequiredToken) {
									resultCompletions = XsltTokenCompletions.getSpecialCompletions(GlobalInstructionType.AttributeSet, globalInstructionData, importedInstructionData);
								}
								break;
							case AttributeType.UseAccumulators:
								if (isOnRequiredToken) {
									let allCompletions = XsltTokenCompletions.getSpecialCompletions(GlobalInstructionType.Accumulator, globalInstructionData, importedInstructionData);
									XsltTokenCompletions.createNonAlphanumericCompletions(document, position, ['all'], allCompletions);
									resultCompletions = allCompletions;
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
										} else if (
											(languageConfig.expressionAtts && languageConfig.expressionAtts.indexOf(attName) !== -1 && !(attName === 'use' && (tagElementName === 'xsl:context-item' || tagElementName === 'xsl:global-context-item'))) ||
											(fullVariableName.startsWith('}') && (prevToken?.value.endsWith('{') || (prevToken && prevToken?.tokenType < XsltTokenDiagnostics.xsltStartTokenNumber)))) {
											// this is the closing quote of the attribute's value, i.e. we're right at
											// the end of the XPath expression - xpathStack was already reset to []
											// a few lines up (it's an XML-classified token), so use the preserved
											// pre-reset reference to still see e.g. an enclosing for/let/some/every scope
											let prev2Token = allTokens[index - 2];
											const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index - 1, xpathStackAtValueBoundary, xpathDocSymbols, elementNameTests, attNameTests);
											resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNames, attrNames, globalInstructionData, importedInstructionData, xpathStackAtValueBoundary);
											if (!XsltTokenCompletions.isKindType(resultCompletions)) {
												resultCompletions = resultCompletions.concat(XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStackAtValueBoundary, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList));
											}
										} else {
											if (attName === 'as') {
												let completionStrings = XsltTokenCompletions.sequenceTypesFor(docType);
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
					case XSLTokenLevelState.dtd:
						if (isOnRequiredToken) {
							resultCompletions = XsltTokenCompletions.createDtdTypeCompletions(document, position);
						}
						break;
				}
			} else if (isOnRequiredToken && tagAttributeNames.length > 0 && tagAttributeNames[tagAttributeNames.length - 1] === 'as') {
				let tokenRange: vscode.Range|undefined;
				if (token.tokenType === TokenLevelState.simpleType || token.tokenType === TokenLevelState.nodeType) {
					const tokenStart = new vscode.Position(token.line, token.startCharacter);
					const tokenEnd = new vscode.Position(token.line, token.startCharacter + token.length);
					tokenRange = new vscode.Range(tokenStart, tokenEnd);
				}
				let completionStrings = XsltTokenCompletions.sequenceTypesFor(docType);
				resultCompletions = XsltTokenCompletions.getRangeInsertCompletions(completionStrings, tokenRange, vscode.CompletionItemKind.TypeParameter);
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
						if (isOnRequiredToken && XsltTokenCompletions.isInsideString(token, requiredChar)) {
							// only key and accumulator names are completed within a string literal
							if (!resultCompletions) {
								resultCompletions = [];
							}
						} else if (isOnRequiredToken) {
							const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
							resultCompletions = XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList);
							resultCompletions = resultCompletions.concat(XsltTokenCompletions.getAllCompletions(docType, position, elementNames, attrNames, globalInstructionData, importedInstructionData));
						}
						break;
					case TokenLevelState.function:
						if (isOnRequiredToken) {
							awaitingRequiredArity = true;
							keepProcessing = true;
							let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XsltTokenCompletions.internalFunctionCompletions(docType), allTokens[index + 1]);
							let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData, allTokens[index + 1]);
							resultCompletions = fnCompletions.concat(userFnCompletions);
						}
						break;
					case TokenLevelState.attributeNameTest:
						if (isOnRequiredToken) {
							const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index - 1, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
							resultCompletions = XsltTokenCompletions.createVariableCompletions(position, '', attrNames, token, vscode.CompletionItemKind.Unit, '@');
						}
						break;
					case TokenLevelState.variable:
						if ((preXPathVariable && !xpathVariableCurrentlyBeingDefined) || anonymousFunctionParams) {
							let fullVariableName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							let currentVariable = { token: token, name: fullVariableName.substring(1), index: index };
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
								resultCompletions = XsltTokenCompletions.getVariableCompletions(position, globalVarName, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList);
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
								xpathStack.push({ awaitingArity: false, token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, isRangeVar: true, rangeVarKeyword: valueText });
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
					case TokenLevelState.mapNameLookup:
						if (isOnRequiredToken && requiredChar > token.startCharacter && prevToken?.value === '?') {
							// XPath 4.0: the fields of a record, for a partly typed lookup, e.g. $c?r
							const record = XsltTokenCompletions.lookupRecordType(document, allTokens, index - 1, inScopeXPathVariablesList, xpathStack, inScopeVariablesList, elementStack, globalVariableData, globalInstructionData, importedInstructionData);
							if (record) {
								resultCompletions = XsltTokenCompletions.getRecordFieldCompletions(record);
							}
						}
						break;
					case TokenLevelState.nodeNameTest:
						if (isOnRequiredToken && requiredChar > token.startCharacter) {
							const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index - 1, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
							const stepRecord = prevToken?.tokenType === TokenLevelState.operator && prevToken.value === '/' && XsltTokenCompletions.isXPath40(docType) ?
								XsltTokenCompletions.lookupRecordType(document, allTokens, index - 1, inScopeXPathVariablesList, xpathStack, inScopeVariablesList, elementStack, globalVariableData, globalInstructionData, importedInstructionData) : undefined;
							if (stepRecord) {
								// XPath 4.0: a partly typed child step on a value with a record type, e.g. $c/r
								resultCompletions = XsltTokenCompletions.getRecordFieldCompletions(stepRecord, true);
							} else if (prevToken && (prevToken.tokenType === TokenLevelState.operator && ['/', '//', '::'].indexOf(prevToken.value) !== -1)) {
								resultCompletions = XsltTokenCompletions.getTokenPathCompletions(docType, token, elementNames, attrNames, globalInstructionData, importedInstructionData);
								let axes = XsltTokenCompletions.axisCompletionNames(docType);
								let axisCompletions = XsltTokenCompletions.getTokenCommandCompletions(token, true, axes, vscode.CompletionItemKind.Function);
								resultCompletions = resultCompletions.concat(axisCompletions);
							} else {
								resultCompletions = XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList);
								resultCompletions = resultCompletions.concat(XsltTokenCompletions.getAllTokenCompletions(docType, position, token, elementNames, attrNames, globalInstructionData, importedInstructionData));
								if (XsltTokenCompletions.isValueCompletingToken(prevToken)) {
									// e.g. "$test0 i|" or "book i|" - prevToken already completed a value,
									// so 'instance of'/'castable as'/'return'/'satisfies' may also apply here
									resultCompletions = resultCompletions.concat(XsltTokenCompletions.getTokenCommandCompletions(token, true, XsltTokenCompletions.getValueContinuationKeywords(xpathStack), vscode.CompletionItemKind.Keyword));
								}
							}
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
										const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index - 1, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
										resultCompletions = XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNames, attrNames, globalInstructionData, importedInstructionData, xpathStack);
									} else {
										const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index - 1, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
										resultCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNames, attrNames, globalInstructionData, importedInstructionData);
									}
									if (!XsltTokenCompletions.isKindType(resultCompletions)) {
										resultCompletions = resultCompletions.concat(XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList));
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
								xpathItem.tokenIndex = index;
								xpathStack.push(xpathItem);
								preXPathVariable = false;
								inScopeXPathVariablesList = [];
								xpathVariableCurrentlyBeingDefined = false;
								if (isOnRequiredToken) {
									if (requiredChar === token.startCharacter + 1 && prevToken) {
										const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
										resultCompletions = XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList);
										resultCompletions = resultCompletions.concat(XsltTokenCompletions.getAllCompletions(docType, position, elementNames, attrNames, globalInstructionData, importedInstructionData));
									}
								}
								break;
							case CharLevelState.rB:
							case CharLevelState.rPr:
							case CharLevelState.rBr:
								if (isOnStartOfRequiredToken && prevToken) {
									let prev2Token = prevToken.tokenType === TokenLevelState.operator ? allTokens[index - 2] : null;
									const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index - 1, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
									resultCompletions = XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList);
									resultCompletions = resultCompletions.concat(XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNames, attrNames, globalInstructionData, importedInstructionData, xpathStack));
								}
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
									const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
									if (isOnStartOfRequiredToken && prevToken) {
										let prev2Token = prevToken.tokenType === TokenLevelState.operator ? allTokens[index - 2] : null;
										resultCompletions = XsltTokenCompletions.getVariableCompletions(position, null, elementStack, xpathStack, token, globalInstructionData, importedInstructionData, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, inScopeVariablesList);
										resultCompletions = resultCompletions.concat(XsltTokenCompletions.getXPathCompletions(docType, prev2Token, prevToken, position, elementNames, attrNames, globalInstructionData, importedInstructionData, xpathStack));
									} else if (token.value === '/') {
										// XPath 4.0: a child step on a value with a record type, e.g. $c/ - a JNode for each field
										const record = XsltTokenCompletions.isXPath40(docType) && requiredChar === token.startCharacter + 1 ?
											XsltTokenCompletions.lookupRecordType(document, allTokens, index, inScopeXPathVariablesList, xpathStack, inScopeVariablesList, elementStack, globalVariableData, globalInstructionData, importedInstructionData) : undefined;
										resultCompletions = record ? XsltTokenCompletions.getRecordFieldCompletions(record, true) :
											XsltTokenCompletions.getPathCompletions(docType, position, elementNames, attrNames, globalInstructionData, importedInstructionData);
									} else if (token.value === '!') {
										let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XsltTokenCompletions.internalFunctionCompletions(docType));
										let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData);
										resultCompletions = fnCompletions.concat(userFnCompletions);
									} else if (token.value === '?' && requiredChar === token.startCharacter + 1) {
										// XPath 4.0: the fields of a record, for a lookup on a variable declared with a record type, e.g. $c?
										const record = XsltTokenCompletions.lookupRecordType(document, allTokens, index, inScopeXPathVariablesList, xpathStack, inScopeVariablesList, elementStack, globalVariableData, globalInstructionData, importedInstructionData);
										if (record) {
											resultCompletions = XsltTokenCompletions.getRecordFieldCompletions(record);
										}
									}
								}
								break;
							case CharLevelState.dSep:
								if (token.value === '()' && prevToken?.tokenType === TokenLevelState.simpleType) {
									let completionStrings: string[] = [];
									if (isOnRequiredToken && requiredChar === token.startCharacter + 1) {
										if (Data.nonFunctionTypes.indexOf(prevToken.value) !== -1) {
											completionStrings = XsltTokenCompletions.sequenceTypesFor(docType);
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
										const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index - 1, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
										resultCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNames, attrNames, globalInstructionData, importedInstructionData);
									}
									if (awaitingRequiredArity) {
										const fnArity = incrementFunctionArity ? 1 : 0;
										const fnName = prevToken.value;
										//let instruction = XsltTokenCompletions.findMatchingDefintion(globalInstructionData, importedInstructionData, fnName, GlobalInstructionType.Function, fnArity);
										//resultCompletions = XsltTokenCompletions.createLocationFromInstrcution(instruction, document);
									}
									awaitingRequiredArity = false;
									incrementFunctionArity = false;
								} else if (token.value === '=>' || token.value === '=!>') {
									incrementFunctionArity = true;
								} else if (token.value === '::') {
									if (isOnRequiredToken && prevToken) {
										const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index - 1, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
										switch (prevToken.value) {
											case 'attribute':
												resultCompletions = XsltTokenCompletions.getNormalCompletions(position, attrNames, vscode.CompletionItemKind.Unit);
												break;
											default:
												resultCompletions = XsltTokenCompletions.getNormalCompletions(position, elementNames, vscode.CompletionItemKind.Unit);
												let nodeTypes = Data.cNodeTypes.map(nType => nType + '()');
												let nodeCompletions = XsltTokenCompletions.getNormalCompletions(position, nodeTypes, vscode.CompletionItemKind.Property);

												resultCompletions = resultCompletions.concat(nodeCompletions);
												break;
										}
									}
								} else if (isOnRequiredToken && requiredChar === token.startCharacter + 2 && token.value === '//') {
									const [elementNames, attrNames] = XsltSymbolProvider.getCompletionNodeNames(allTokens, allInstructionData, inScopeVariablesList, inScopeXPathVariablesList, index, xpathStack, xpathDocSymbols, elementNameTests, attNameTests);
									resultCompletions = XsltTokenCompletions.getPathCompletions(docType, position, elementNames, attrNames, globalInstructionData, importedInstructionData);
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
					case TokenLevelState.simpleType:
					case TokenLevelState.nodeType:
						// a type name being typed after 'instance of'/'castable as'/'treat as'/'cast as'
						// (the equivalent case for the XML 'as="..."' attribute is handled separately, above,
						// via the isOnRequiredToken && tagAttributeNames[...]==='as' branch)
						if (isOnRequiredToken) {
							const tokenStart = new vscode.Position(token.line, token.startCharacter);
							const tokenEnd = new vscode.Position(token.line, token.startCharacter + token.length);
							const tokenRange = new vscode.Range(tokenStart, tokenEnd);
							resultCompletions = XsltTokenCompletions.getRangeInsertCompletions(XsltTokenCompletions.sequenceTypesFor(docType), tokenRange, vscode.CompletionItemKind.TypeParameter);
						}
						break;
				}
			}
			if (incrementFunctionArity && prevToken?.charType === CharLevelState.dSep && (prevToken.value === '=>' || prevToken.value === '=!>') && token.tokenType !== TokenLevelState.function) {
				// the implicit first argument only applies to a static function call, not to a dynamic call
				incrementFunctionArity = false;
			}
			prevToken = token;
		}

		return resultCompletions;
	};

	private static isKindType(resultCompletions: vscode.CompletionItem[]) {
		if (resultCompletions && resultCompletions.length > 0) {
			resultCompletions[0].kind !== vscode.CompletionItemKind.TypeParameter;
		}
		else {
			return false;
		}
	}

	private static createNonAlphanumericCompletions(doc: vscode.TextDocument, pos: vscode.Position, labels: string[], allCompletions: vscode.CompletionItem[]) {
		let prevText = doc.getText(new vscode.Range(pos.with({ character: pos.character - 1 }), pos));
		const prevTextIsHash = prevText === '#';
		if (prevTextIsHash) {
			allCompletions.length = 0;
		}
		labels.forEach((label) => {
			const newLabel = prevTextIsHash ? label : '#' + label;
			const newItem = new vscode.CompletionItem(newLabel, vscode.CompletionItemKind.Constant);
			//let startPos = replaceCurrentChar? pos.with({ character: pos.character - 1}) : pos;
			//let newRange = new vscode.Range(startPos, pos);
			//newItem.range = newRange;
			allCompletions.push(newItem);
		});
	}

	private static createDtdTypeCompletions(doc: vscode.TextDocument, pos: vscode.Position) {
		const allCompletions: vscode.CompletionItem[] = [];
		let prevText = doc.getText(new vscode.Range(pos.with({ character: pos.character - 1 }), pos));
		const prevTextIsBang = prevText === '!';
		const labelData = [
			{ snippet: '-- ${1} -->${0}', text: '<!-- -->', detail: 'XML comment' },
			{ snippet: '[CDATA[${1}]]>${0}', text: '<![CDATA[]]>', detail: 'CDATA section' }
			// { snippet: `DOCTYPE element-name [\n\t<!ENTITY entity-name "entity-value">\n]>`, text: '<!DOCTYPE...>' },
		];

		labelData.forEach((item) => {
			const { snippet, text, detail } = item;
			const adjustedSnippet = prevTextIsBang ? snippet : '!' + snippet;
			const s = new vscode.SnippetString(adjustedSnippet);
			const newItem = new vscode.CompletionItem(text, vscode.CompletionItemKind.Constant);
			newItem.detail = detail;
			newItem.insertText = s;
			allCompletions.push(newItem);
		});
		return allCompletions;
	}

	private static createPiTypeCompletions() {
		const allCompletions: vscode.CompletionItem[] = [];
		const labelData = [
			{ snippet: '${1:name} ${2:value}?>${0}', text: '<?name value?>', detail: 'XML Processing Instruction' },
			{ snippet: '${1:name}?>${0}', text: '<?name?>', detail: 'XML Processing Instruction - name-only' }
		];

		labelData.forEach((item) => {
			const { snippet, text, detail } = item;
			const s = new vscode.SnippetString(snippet);
			const newItem = new vscode.CompletionItem(text, vscode.CompletionItemKind.Constant);
			newItem.detail = detail;
			newItem.insertText = s;
			allCompletions.push(newItem);
		});
		return allCompletions;
	}

	private static axisCompletionNames(docType: DocumentTypes) {
		const axes = docType === DocumentTypes.XSLT40 || docType === DocumentTypes.XPath ? Data.cAxes40 : Data.cAxes;
		return axes.map(axis => axis + '::');
	}

	private static internalFunctionCompletions(docType: DocumentTypes) {
		if (docType === DocumentTypes.XSLT) {
			return XsltTokenCompletions.useIxslFunctions ? XPathFunctionDetails.dataPlusIxsl : XPathFunctionDetails.data;
		} else if (docType === DocumentTypes.XSLT40) {
			return XsltTokenCompletions.useIxslFunctions ? XPathFunctionDetails.dataPlusIxslPlus40 : XPathFunctionDetails.dataPlus40;
		} else if (docType === DocumentTypes.XPath) {
			// XPath documents use XPath 4.0
			return XPathFunctionDetails.xpathDataPlus40;
		} else {
			return XPathFunctionDetails.xpathData;
		}
	}

	// true when the character position is after the opening quote of a string literal and before its closing quote, if any
	private static isInsideString(token: BaseToken, character: number): boolean {
		const quote = token.value.startsWith('&') ? token.value.substring(0, token.value.indexOf(';') + 1) : token.value.charAt(0);
		const isClosed = token.value.length >= quote.length * 2 && token.value.endsWith(quote);
		return character >= token.startCharacter + quote.length && (!isClosed || character <= token.startCharacter + token.length - quote.length);
	}

	// 'instance of' and 'castable as' are valid after any completed value (a variable/node-name
	// reference, a literal, or a closed predicate/argument-list/parenthesized-expression) -
	// 'return' and 'satisfies' are ALSO only valid there, but additionally only when we're still
	// inside the bound expression of a for/let (-> return) or some/every (-> satisfies) binding.
	private static isValueCompletingToken(token: BaseToken | null): boolean {
		if (!token) {
			return false;
		}
		switch (<TokenLevelState>token.tokenType) {
			case TokenLevelState.variable:
			case TokenLevelState.nodeNameTest:
			case TokenLevelState.nodeType:
			case TokenLevelState.string:
			case TokenLevelState.number:
				return true;
			case TokenLevelState.operator:
				return token.charType === CharLevelState.rB || token.charType === CharLevelState.rBr || token.charType === CharLevelState.rPr;
			default:
				return false;
		}
	}

	private static getValueContinuationKeywords(xpathStack: XPathData[]): string[] {
		const keywords = ['instance of ', 'castable as '];
		const top = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : undefined;
		if (top?.isRangeVar) {
			const introWord = top.rangeVarKeyword;
			if (introWord === 'for' || introWord === 'let') {
				keywords.push('return ');
			} else if (introWord === 'some' || introWord === 'every') {
				keywords.push('satisfies ');
			}
		}
		return keywords;
	}

	private static getXPathCompletions(docType: DocumentTypes, previous2Token: BaseToken | null, previousToken: BaseToken | null, position: vscode.Position, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], xpathStack: XPathData[]) {
		if (!previousToken || previousToken.tokenType >= XsltTokenCompletions.xsltStartTokenNumber) {
			return XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
		}
		if (XsltTokenCompletions.isValueCompletingToken(previousToken)) {
			const xpathCompletions = XsltTokenCompletions.getAllCompletions(docType, position, elementNameTests, attNameTests, globalInstructionData, importedInstructionData);
			const keywordCompletions = XsltTokenCompletions.getNormalCompletions(position, XsltTokenCompletions.getValueContinuationKeywords(xpathStack), vscode.CompletionItemKind.Keyword);
			return xpathCompletions.concat(keywordCompletions);
		}
		let xpath2TokenType = <TokenLevelState>previousToken.tokenType;
		let xpath2CharType = <CharLevelState>previousToken.charType;
		let xpathCompletions: vscode.CompletionItem[] | undefined;
		switch (xpath2TokenType) {
			case TokenLevelState.operator:
				switch (xpath2CharType) {
					// rB/rBr/rPr (closing ')'/']'/'}') are handled by the isValueCompletingToken
					// check above, before this switch is reached
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
							let completionStrings = isSimpleType ? XsltTokenCompletions.atomicItemTypeNames.concat(FunctionData.simpleTypes) : XsltTokenCompletions.sequenceTypesFor(docType);
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

	public static resolveFunctionName(xmlnsPrefixes: string[], xmlnsData: Map<string, XSLTnamespaces>, token: BaseToken) {

		let parts = token.value.split('#');
		let arity = Number.parseInt(parts[1]);
		let name = parts[0];

		return { name, arity };
	}

	// the record type for the value before the '?' or '/' at lookupIndex: a variable declared with a record type, e.g. $c?,
	// or a lookup of a field whose type is a record, e.g. $p?address? - for a child step ('/') the value must be a JNode:
	// jtree($c)/ or a child step, e.g. jtree($p)/address/ (Saxon 13 reports XPTY0019 for $c/ when $c has a record type)
	private static lookupRecordType(document: vscode.TextDocument, allTokens: BaseToken[], lookupIndex: number, inScopeXPathVariablesList: VariableData[], xpathStack: XPathData[],
		inScopeVariablesList: VariableData[], elementStack: ElementData[], globalVariableData: VariableData[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]): RecordType | undefined {
		const globals = globalInstructionData.concat(importedInstructionData);
		const itemTypes = new Map<string, string>();
		globals.filter((g) => g.type === GlobalInstructionType.ItemType && g.declaredType).forEach((g) => itemTypes.set(g.name, g.declaredType!));
		const isChildStep = allTokens[lookupIndex]?.value === '/';
		let operand = lookupIndex > 0 ? allTokens[lookupIndex - 1] : undefined;
		const isJtree = operand?.charType === CharLevelState.rB && lookupIndex > 3 && allTokens[lookupIndex - 2].tokenType === TokenLevelState.variable &&
			allTokens[lookupIndex - 3].charType === CharLevelState.lB && allTokens[lookupIndex - 4].value === 'jtree';
		if (isJtree) {
			// jtree($c)
			operand = allTokens[lookupIndex - 2];
		} else if (isChildStep && !(operand?.tokenType === TokenLevelState.nodeNameTest && allTokens[lookupIndex - 2]?.value === '/')) {
			// not a JNode
			return undefined;
		} else if (!isChildStep && operand?.tokenType === TokenLevelState.nodeNameTest) {
			// a lookup can't follow a path step, e.g. jtree($p)/address?city is a syntax error
			return undefined;
		}
		if (operand?.tokenType === TokenLevelState.variable) {
			const name = operand.value.substring(1);
			if (inScopeXPathVariablesList.some((v) => v.name === name) || xpathStack.some((x) => x.variables.some((v) => v.name === name))) {
				// a variable declared in the XPath expression, e.g. by 'let', has no declared type
				return undefined;
			}
			const findIn = (list: VariableData[]) => [...list].reverse().find((v) => v.name === name);
			let localVariable = findIn(inScopeVariablesList);
			for (let i = elementStack.length - 1; !localVariable && i > -1; i--) {
				if (elementStack[i].variables !== globalVariableData) {
					localVariable = findIn(elementStack[i].variables);
				}
			}
			let declaredType: string | undefined;
			if (localVariable) {
				const token = localVariable.token;
				declaredType = RecordTypes.attributeOfElementAt(document.getText(), document.offsetAt(new vscode.Position(token.line, token.startCharacter)), 'as');
			} else {
				declaredType = globals.find((g) => (g.type === GlobalInstructionType.Variable || g.type === GlobalInstructionType.Parameter) && g.name === name)?.declaredType;
			}
			return declaredType ? RecordTypes.resolve(declaredType, itemTypes) : undefined;
		} else if ((operand?.tokenType === TokenLevelState.mapNameLookup && allTokens[lookupIndex - 2]?.value === '?') ||
			(operand?.tokenType === TokenLevelState.nodeNameTest && allTokens[lookupIndex - 2]?.value === '/')) {
			// e.g. $p?address? or jtree($p)/address/ for record(address as record(...))
			const record = XsltTokenCompletions.lookupRecordType(document, allTokens, lookupIndex - 2, inScopeXPathVariablesList, xpathStack, inScopeVariablesList, elementStack, globalVariableData, globalInstructionData, importedInstructionData);
			const field = record?.fields.find((f) => f.name === operand.value);
			return field ? RecordTypes.fieldRecord(field, itemTypes) : undefined;
		}
		return undefined;
	}

	// XPath 4.0: at the start of a new entry in a map constructor, e.g. after '{' or ',', the fields of the record type
	// that aren't yet entries - for the select of an element declared with a record type, such as xsl:variable, or an
	// xsl:sequence that is the result of an xsl:function declared with one - undefined if it's not such a position
	public static getRecordEntryCompletions(document: vscode.TextDocument, allTokens: BaseToken[], position: vscode.Position, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]): vscode.CompletionItem[] | undefined {
		const isXPathToken = (t: BaseToken) => t.tokenType < XsltTokenDiagnostics.xsltStartTokenNumber;
		const offset = document.offsetAt(position);
		const tokenEnd = (t: BaseToken) => document.offsetAt(new vscode.Position(t.line, t.startCharacter + t.length));
		let cursorIndex = allTokens.findIndex((t) => tokenEnd(t) > offset);
		if (cursorIndex === -1) {
			cursorIndex = allTokens.length;
		}
		// the XPath tokens of the attribute value at the cursor: tokens[first..last - 1]
		const anchor = cursorIndex < allTokens.length && isXPathToken(allTokens[cursorIndex]) ? cursorIndex : cursorIndex - 1;
		if (anchor < 1 || !isXPathToken(allTokens[anchor])) {
			return undefined;
		}
		let first = anchor;
		while (first > 0 && isXPathToken(allTokens[first - 1])) {
			first--;
		}
		let last = anchor + 1;
		while (last < allTokens.length && isXPathToken(allTokens[last])) {
			last++;
		}
		// the XSLT attribute name token before the attribute value
		const attributeNameToken = [...allTokens.slice(0, first)].reverse().find((t) => t.tokenType === XSLTokenLevelState.attributeName + XsltTokenDiagnostics.xsltStartTokenNumber);
		const attributeName = attributeNameToken ? document.getText(new vscode.Range(attributeNameToken.line, attributeNameToken.startCharacter, attributeNameToken.line, attributeNameToken.startCharacter + attributeNameToken.length)) : '';
		if (attributeName !== 'select') {
			return undefined;
		}
		let xpathTokens = allTokens.slice(first, last);
		let xpathCursor = cursorIndex - first;
		const cursorToken = allTokens[cursorIndex];
		if (cursorToken && cursorToken.value === '{}' && cursorToken.charType === CharLevelState.dSep && document.offsetAt(new vscode.Position(cursorToken.line, cursorToken.startCharacter)) < offset) {
			// an empty map constructor, e.g. {|}
			const openBrace: BaseToken = { ...cursorToken, value: '{', length: 1, charType: CharLevelState.lBr };
			const closeBrace: BaseToken = { ...cursorToken, value: '}', length: 1, startCharacter: cursorToken.startCharacter + 1, charType: CharLevelState.rBr };
			xpathTokens = xpathTokens.slice(0, xpathCursor).concat([openBrace, closeBrace], xpathTokens.slice(xpathCursor + 1));
			xpathCursor++;
		}
		const entryPosition = RecordTypes.mapEntryPosition(xpathTokens, xpathCursor);
		if (!entryPosition) {
			return undefined;
		}
		const text = document.getText();
		const attributeOffset = document.offsetAt(new vscode.Position(attributeNameToken!.line, attributeNameToken!.startCharacter));
		const declaredType = XsltTokenCompletions.declaredTypeForSelect(text, attributeOffset);
		const globals = globalInstructionData.concat(importedInstructionData);
		const itemTypes = new Map<string, string>();
		globals.filter((g) => g.type === GlobalInstructionType.ItemType && g.declaredType).forEach((g) => itemTypes.set(g.name, g.declaredType!));
		let record = declaredType ? RecordTypes.resolve(declaredType, itemTypes) : undefined;
		for (const key of entryPosition.keyPath) {
			const field = record?.fields.find((f) => f.name === key);
			record = field ? RecordTypes.fieldRecord(field, itemTypes) : undefined;
		}
		if (!record) {
			return undefined;
		}
		const charBefore = offset > 0 ? text.charAt(offset - 1) : '';
		const leadingSpace = charBefore === ',' || charBefore === '{' ? ' ' : '';
		return record.fields.filter((field) => !entryPosition.usedKeys.includes(field.name)).map((field, index) => {
			const item = new vscode.CompletionItem(`'${field.name}'`, vscode.CompletionItemKind.Field);
			item.insertText = new vscode.SnippetString(`${leadingSpace}'${field.name.replace(/[$}\\]/g, '\\$&')}': $0`);
			item.detail = (field.type ?? 'item()*') + (field.optional ? ' (optional)' : '');
			item.documentation = `Field of the record type: ${record!.name}`;
			// required fields first, in declaration order
			item.sortText = (field.optional ? '1' : '0') + String(index).padStart(4, '0');
			item.preselect = index === 0;
			return item;
		});
	}

	// XPath 4.0 record types: within an xsl:map whose result has a record type, an xsl:map-entry for each field that
	// isn't yet an entry - for an element name after '<', e.g. <xsl:map><| - undefined if it's not such a position
	public static getMapEntryElementCompletions(document: vscode.TextDocument, position: vscode.Position, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]): vscode.CompletionItem[] | undefined {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const nameStart = /<([\w.:-]*)$/.exec(text.substring(Math.max(0, offset - 100), offset));
		if (!nameStart) {
			return undefined;
		}
		const tagStart = offset - nameStart[0].length;
		const markup = RecordTypes.blankMarkup(text);
		const ancestors = RecordTypes.openElements(markup, tagStart);
		const mapIndex = ancestors.length - 1;
		if (mapIndex < 0 || ancestors[mapIndex].name !== 'xsl:map') {
			return undefined;
		}
		const itemTypes = XsltTokenCompletions.itemTypeDeclarations(globalInstructionData, importedInstructionData);
		const record = RecordTypes.xslMapRecord(text, ancestors, mapIndex, itemTypes);
		if (!record) {
			return undefined;
		}
		const usedKeys = RecordTypes.mapEntryKeys(text, markup, ancestors[mapIndex].offset).map((k) => k.key);
		const range = new vscode.Range(document.positionAt(tagStart + 1), position);
		return record.fields.filter((field) => !usedKeys.includes(field.name)).map((field, index) => {
			const key = XsltTokenCompletions.snippetEscape(`'${field.name}'`);
			const item = new vscode.CompletionItem(`xsl:map-entry '${field.name}'`, vscode.CompletionItemKind.Field);
			// a field with a record type gets an xsl:map for its value
			item.insertText = new vscode.SnippetString(RecordTypes.fieldRecord(field, itemTypes) ?
				`xsl:map-entry key="${key}">\n\t<xsl:map>\n\t\t$0\n\t</xsl:map>\n</xsl:map-entry>` :
				`xsl:map-entry key="${key}" select="$1"/>$0`);
			item.range = range;
			item.filterText = `xsl:map-entry ${field.name}`;
			item.detail = (field.type ?? 'item()*') + (field.optional ? ' (optional)' : '');
			item.documentation = `Field of the record type: ${record.name}`;
			// before other element completions: required fields first, in declaration order
			item.sortText = '!' + (field.optional ? '1' : '0') + String(index).padStart(4, '0');
			return item;
		});
	}

	// XPath 4.0 record types: within the key attribute of an xsl:map-entry in an xsl:map whose result has a record type,
	// the fields that aren't yet entries, as string literals - undefined if it's not such a position
	public static getMapEntryKeyCompletions(document: vscode.TextDocument, position: vscode.Position, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]): vscode.CompletionItem[] | undefined {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const tagStart = text.lastIndexOf('<', offset - 1);
		const tagText = text.substring(tagStart, offset);
		// the attribute value typed so far may be the start of a string literal, e.g. key="'na
		const keyValue = /^<xsl:map-entry\s(?:[^<>]*\s)?key\s*=\s*(["'])((?:(?!\1)[^<>])*)$/.exec(tagText);
		if (tagStart < 0 || !keyValue) {
			return undefined;
		}
		const markup = RecordTypes.blankMarkup(text);
		const ancestors = RecordTypes.openElements(markup, tagStart);
		const mapIndex = ancestors.length - 1;
		if (mapIndex < 0 || ancestors[mapIndex].name !== 'xsl:map') {
			return undefined;
		}
		const itemTypes = XsltTokenCompletions.itemTypeDeclarations(globalInstructionData, importedInstructionData);
		const record = RecordTypes.xslMapRecord(text, ancestors, mapIndex, itemTypes);
		if (!record) {
			return undefined;
		}
		// the keys of the other xsl:map-entry elements
		const usedKeys = RecordTypes.mapEntryKeys(text, markup, ancestors[mapIndex].offset).filter((k) => k.offset !== tagStart).map((k) => k.key);
		// the string literal's quote is the other quote character from the attribute's
		const quote = keyValue[1] === '"' ? '\'' : '"';
		const range = new vscode.Range(document.positionAt(offset - keyValue[2].length), position);
		return record.fields.filter((field) => !usedKeys.includes(field.name)).map((field, index) => {
			const item = new vscode.CompletionItem(`${quote}${field.name}${quote}`, vscode.CompletionItemKind.Field);
			item.range = range;
			item.detail = (field.type ?? 'item()*') + (field.optional ? ' (optional)' : '');
			item.documentation = `Field of the record type: ${record.name}`;
			item.sortText = (field.optional ? '1' : '0') + String(index).padStart(4, '0');
			return item;
		});
	}

	private static itemTypeDeclarations(globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]) {
		const itemTypes = new Map<string, string>();
		globalInstructionData.concat(importedInstructionData).filter((g) => g.type === GlobalInstructionType.ItemType && g.declaredType).forEach((g) => itemTypes.set(g.name, g.declaredType!));
		return itemTypes;
	}

	private static snippetEscape(text: string) {
		return text.replace(/[$}\\]/g, '\\$&');
	}

	// the 'as' for the select attribute at the offset: the element's own 'as', e.g. on xsl:variable, or for an xsl:sequence,
	// the 'as' of the xsl:function whose result it is - within any xsl:if or xsl:choose etc.
	private static declaredTypeForSelect(text: string, attributeOffset: number): string | undefined {
		const tagStart = text.lastIndexOf('<', attributeOffset);
		const elementName = /^<([\w.:-]+)/.exec(text.substring(tagStart, tagStart + 100))?.[1];
		if (elementName === 'xsl:variable' || elementName === 'xsl:param' || elementName === 'xsl:with-param') {
			return RecordTypes.attributeOfElementAt(text, attributeOffset, 'as');
		} else if (elementName !== 'xsl:sequence') {
			return undefined;
		}
		const ancestors = RecordTypes.openElements(RecordTypes.blankMarkup(text.substring(0, tagStart)), tagStart);
		for (let i = ancestors.length - 1; i > -1; i--) {
			if (ancestors[i].name === 'xsl:function') {
				return RecordTypes.attributeOfElementAt(text, ancestors[i].offset + 1, 'as');
			} else if (!RecordTypes.conditionalInstructions.includes(ancestors[i].name)) {
				return undefined;
			}
		}
		return undefined;
	}

	private static isXPath40(docType: DocumentTypes) {
		return docType === DocumentTypes.XSLT40 || docType === DocumentTypes.XPath;
	}

	private static getRecordFieldCompletions(record: RecordType, isChildStep = false): vscode.CompletionItem[] {
		return record.fields.map((field, index) => {
			// a field name that isn't an NCName is looked up with a string literal, e.g. $p?'first name', or in a child step with get(), e.g. $p/get('first name')
			const isNCName = /^[A-Za-z_][\w.-]*$/.test(field.name);
			const label = isNCName ? field.name : isChildStep ? `get('${field.name}')` : `'${field.name}'`;
			const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Field);
			item.detail = (field.type ?? 'item()*') + (field.optional ? ' (optional)' : '');
			item.documentation = `Field of the record type: ${record.name}`;
			// keep the declaration order
			item.sortText = String(index).padStart(4, '0');
			return item;
		});
	}

	private static getVariableCompletions(pos: vscode.Position, globalVarName: string | null, elementStack: ElementData[], xpathStack: XPathData[], token: BaseToken, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[],
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
		return XsltTokenCompletions.createVariableCompletions(pos, '$', completionStrings, token, vscode.CompletionItemKind.Variable);
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
					if (completionStrings.indexOf(name) === -1) {
						completionStrings.push(name);
					}
				}
			});

			importedInstructionData.forEach((instruction) => {
				const name = instruction.name;
				if (instruction.type === type) {
					if (completionStrings.indexOf(name) === -1) {
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
		let axes = XsltTokenCompletions.axisCompletionNames(docType);
		let axisCompletions = XsltTokenCompletions.getCommandCompletions(position, axes, vscode.CompletionItemKind.Function);
		let nodeTypes = Data.nodeTypes.map(nType => nType + '()');
		let nodeCompletions = XsltTokenCompletions.getNormalCompletions(position, nodeTypes, vscode.CompletionItemKind.Property);
		let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XsltTokenCompletions.internalFunctionCompletions(docType));
		let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData);
		resultCompletions = elementCompletions.concat(attnamecompletions, axisCompletions, nodeCompletions, fnCompletions, userFnCompletions);
		return resultCompletions;
	}

	private static getPathCompletions(docType: DocumentTypes, position: vscode.Position, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]) {
		let resultCompletions: vscode.CompletionItem[] | undefined;
		let elementCompletions = XsltTokenCompletions.getNormalCompletions(position, elementNameTests, vscode.CompletionItemKind.Unit);
		let attnamecompletions = XsltTokenCompletions.getNormalCompletions(position, attNameTests, vscode.CompletionItemKind.Unit);
		let axes = XsltTokenCompletions.axisCompletionNames(docType);
		let axisCompletions = XsltTokenCompletions.getNormalCompletions(position, axes, vscode.CompletionItemKind.Function);
		resultCompletions = elementCompletions.concat(attnamecompletions, axisCompletions);
		return resultCompletions;
	}
	private static getTokenPathCompletions(docType: DocumentTypes, token: BaseToken, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]) {
		let resultCompletions: vscode.CompletionItem[] | undefined;
		let elementCompletions = XsltTokenCompletions.getTokenCompletions(token, elementNameTests, vscode.CompletionItemKind.Unit);
		let attnamecompletions = XsltTokenCompletions.getTokenCompletions(token, attNameTests, vscode.CompletionItemKind.Unit);
		resultCompletions = elementCompletions.concat(attnamecompletions);
		return resultCompletions;
	}

	private static getAllTokenCompletions(docType: DocumentTypes, position: vscode.Position, token: BaseToken, elementNameTests: string[], attNameTests: string[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]) {
		let resultCompletions: vscode.CompletionItem[] | undefined;
		let elementCompletions = XsltTokenCompletions.getTokenCommandCompletions(token, false, elementNameTests, vscode.CompletionItemKind.Unit);
		let attnamecompletions = XsltTokenCompletions.getTokenCommandCompletions(token, false, attNameTests, vscode.CompletionItemKind.Unit);
		let axes = XsltTokenCompletions.axisCompletionNames(docType);
		let axisCompletions = XsltTokenCompletions.getTokenCommandCompletions(token, true, axes, vscode.CompletionItemKind.Function);
		let nodeTypes = Data.nodeTypes.map(axis => axis + '()');
		let nodeCompletions = XsltTokenCompletions.getTokenCompletions(token, nodeTypes, vscode.CompletionItemKind.Property);
		let fnCompletions = XsltTokenCompletions.getFnCompletions(position, XsltTokenCompletions.internalFunctionCompletions(docType), token);
		let userFnCompletions = XsltTokenCompletions.getUserFnCompletions(position, globalInstructionData, importedInstructionData, token);
		resultCompletions = elementCompletions.concat(attnamecompletions, axisCompletions, nodeCompletions, fnCompletions, userFnCompletions);
		return resultCompletions;
	}

	private static createVariableCompletions(pos: vscode.Position, char: string, completionStrings: string[], token: BaseToken, kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];

		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = char + name;
				const newItem = new vscode.CompletionItem(varName, kind);
				completionItems.push(newItem);
			}
		});
		return completionItems;
	}

	private static getTokenCommandCompletions(token: BaseToken, addCommand: boolean, completionStrings: string[], kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];
		const startPos = new vscode.Position(token.line, token.startCharacter);
		const endPos = new vscode.Position(token.line, token.startCharacter + token.length);
		const range = new vscode.Range(startPos, endPos);
		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = name;
				const newItem = new vscode.CompletionItem(varName, kind);
				if (addCommand) {
					newItem.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };
				}
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
		let useRange = false;
		const posImmediatelyBeforeToken = !!(token) && token.length == 1 && pos.line === token.line && pos.character === token.startCharacter;
		if (token && !(posImmediatelyBeforeToken)) {
			const startPos = new vscode.Position(token.line, token.startCharacter);
			const endPos = new vscode.Position(token.line, token.startCharacter + token.length);
			range = new vscode.Range(startPos, endPos);
			useRange = true;
		}

		dataItems.forEach((item) => {
			const noArgs = item.signature.startsWith(item.name + '()');
			let suffixBrackets = noArgs ? '()${0}' : posImmediatelyBeforeToken ? '${0}' : '(${0})';
			const newItem = new vscode.CompletionItem(item.name, vscode.CompletionItemKind.Function);
			newItem.documentation = new vscode.MarkdownString(item.description);
			newItem.detail = item.signature;
			newItem.insertText = new vscode.SnippetString(item.name + suffixBrackets);
			//if (useRange) newItem.range = range;
			if (!noArgs) {
				newItem.command = { command: 'editor.action.triggerParameterHints', title: 'Trigger Parameter Hints' };
			}
			completionItems.push(newItem);
		});
		return completionItems;
	}

	private static getUserFnCompletions(pos: vscode.Position, globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], token?: BaseToken) {
		let completionItems: vscode.CompletionItem[] = [];
		let range: vscode.Range;
		let useRange = false;
		const posImmediatelyBeforeToken = !!(token) && token.length > 1 && pos.line === token.line && pos.character - 1 === token.startCharacter;
		if (token && !(posImmediatelyBeforeToken)) {
			const startPos = new vscode.Position(token.line, token.startCharacter);
			const endPos = new vscode.Position(token.line, token.startCharacter + token.length);
			range = new vscode.Range(startPos, endPos);
			useRange = true;
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
				if (useRange) {
					newItem.range = range;
				}
				if (!noArgs) {
					newItem.command = { command: 'editor.action.triggerParameterHints', title: 'Trigger Parameter Hints' };
				}
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

	private static getRangeInsertCompletions(completionStrings: string[], range: vscode.Range|undefined, kind: vscode.CompletionItemKind, excludeChar?: string) {
		let completionItems: vscode.CompletionItem[] = [];
		completionStrings.forEach((name) => {
			if (!excludeChar || name !== excludeChar) {
				const varName = name;
				const newItem = new vscode.CompletionItem(varName, kind);
				if (range) {
					newItem.range = range;
				}
				completionItems.push(newItem);
			}
		});
		return completionItems;
	}

	private static getXSLTTagCompletions(document: vscode.TextDocument, docType: DocumentTypes, languageConfig: LanguageConfiguration, schemaQuery: SchemaQuery | undefined, pos: vscode.Position, elementStack: ElementData[], inScopeVariablesList: VariableData[], symbolId: string) {
		if (!schemaQuery) {
			return XsltTokenCompletions.getXSLTSnippetCompletions(languageConfig.elementSnippets);
		}
		let expectedTags: [string, string][] = [];
		let xsltParent: string | null = null;
		let stackPos = elementStack.length - 1;
		let isXSLT = docType === DocumentTypes.XSLT || docType === DocumentTypes.XSLT40;
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
			if (docType === DocumentTypes.XSLT || docType === DocumentTypes.XSLT40) {
				if (tagName === 'xsl:break' || tagName === 'xsl:next-iteration') {
					useCurrent = false;
				} else if (tagName === 'xsl:template' && xsltParent === 'xsl:mode') {
					// XSLT 4.0 enclosed mode: a template rule has a match attribute, but no mode or name attribute
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName + ' match', vscode.CompletionItemKind.Struct);
					newItem.documentation = "template rule for the enclosing xsl:mode";
					newItem.insertText = new vscode.SnippetString('xsl:template match="$1">\n\t$0\n</xsl:template>');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:template') {
					const newItem = new vscode.CompletionItem(tagName + ' match', vscode.CompletionItemKind.Struct);
					newItem.documentation = "xsl:template with 'match' attribute";
					newItem.insertText = new vscode.SnippetString('xsl:template match="$1" mode="${2:#default}">\n\t$0\n</xsl:template>');
					completionItems.push(newItem);
					competionName = tagName + ' name';
					description = "xsl:template with 'name' attribute";
				} else if (tagName === 'xsl:text') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString(`xsl:text>$1</xsl:text>$0`);
					completionItems.push(newItem);
				} else if (tagName === 'xsl:choose') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:choose>\n\t<xsl:when test="${1:$expr}">\n\t\t$2\n\t</xsl:when>\n</xsl:choose>');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:try') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName + ' select=""', vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:try select="${1:$expr1}">\n\t<xsl:catch select="${2:$expr2}"/>\n</xsl:try>$0');
					completionItems.push(newItem);
					const newItem2 = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem2.insertText = new vscode.SnippetString('xsl:try>\n\t$0\n\t<xsl:catch>\n\t\t\n\t</xsl:catch>\n</xsl:try>');
					completionItems.push(newItem2);
				} else if (tagName === 'xsl:switch') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:switch select="${1:$expr}">\n\t<xsl:when test="${2:value}">\n\t\t$3\n\t</xsl:when>\n</xsl:switch>');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:key') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:key name="${1:name}" match="${2:pattern}" use="${3:xpath}"/>$0');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:map') {
					// the select attribute is rarely used, so it's not included
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:map>\n\t$0\n</xsl:map>');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:array') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName + ' select', vscode.CompletionItemKind.Struct);
					newItem.documentation = "xsl:array - each item selected is an array member";
					newItem.insertText = new vscode.SnippetString('xsl:array select="${1:$expr}"/>$0');
					completionItems.push(newItem);
					const newItem2 = new vscode.CompletionItem(tagName + ' members', vscode.CompletionItemKind.Struct);
					newItem2.documentation = "xsl:array - each xsl:array-member is an array member, which may be any sequence";
					newItem2.insertText = new vscode.SnippetString('xsl:array>\n\t<xsl:array-member select="${1:$expr}"/>$0\n</xsl:array>');
					completionItems.push(newItem2);
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
				} else if (tagName === 'xsl:accumulator-rule') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:accumulator-rule match="${1:pattern}" select="${2:xpath}"/>$0');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:accumulator') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:accumulator name="${1:name}" initial-value="${2:value}">\n\t<xsl:accumulator-rule match="${3:pattern}" select="${4:xpath}"/>$0\n</xsl:accumulator>');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:function') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:function name="${1:prefix:name}" as="${2:item()*}">\n\t<xsl:param name="${3:name}" as="${4:item()*}"/>\n\t$0\n</xsl:function>');
					completionItems.push(newItem);
				} else if (docType === DocumentTypes.XSLT40 && tagName === 'xsl:if') {
					useCurrent = true;
					const newItem = new vscode.CompletionItem(tagName + ' then else', vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('xsl:if test="$1" then="$2" else="$3"/>$0');
					completionItems.push(newItem);
				} else if (tagName === 'xsl:literal-result-element') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem('literal-self-closing-element', vscode.CompletionItemKind.Struct);
					newItem.documentation = "self-closing tag";
					newItem.insertText = new vscode.SnippetString('${1:div} ${2:class}="$3"/>$0');
					completionItems.push(newItem);
					const newItem2 = new vscode.CompletionItem('literal-element (inline)', vscode.CompletionItemKind.Struct);
					newItem2.documentation = "start and close tags";
					newItem2.insertText = new vscode.SnippetString('${1:element}>${0}</element>');
					completionItems.push(newItem2);
					const newItem3 = new vscode.CompletionItem('literal-element (block)', vscode.CompletionItemKind.Struct);
					newItem3.documentation = "start and close tags";
					newItem3.insertText = new vscode.SnippetString('${1:element}>\n\t${0}\n</element>');
					completionItems.push(newItem3);
				} else if (tagName === 'xsl:message') {
					useCurrent = false;
					if (inScopeVariablesList.length > 0) {
						const newItem0 = new vscode.CompletionItem(tagName + ' - adaptive serialization', vscode.CompletionItemKind.Struct);
						const newItem = new vscode.CompletionItem(tagName + ' - simple variables', vscode.CompletionItemKind.Struct);
						const newItem2 = new vscode.CompletionItem(tagName + ' - xdm:debug variables', vscode.CompletionItemKind.Struct);
						const newItem3 = new vscode.CompletionItem(tagName + ' - xdm:debug-color variables', vscode.CompletionItemKind.Struct);
						newItem0.documentation = "xsl:message adaptive serialize fn";
						newItem.documentation = "xsl:message simple in-scope variable types";
						newItem2.documentation = "xsl:message via xdm:debug - labelled variables, one formatted block";
						newItem3.documentation = "xsl:message via xdm:debug-color - as xdm:debug, with ANSI color";
						const scopeVarNames = inScopeVariablesList.map((item) => item.name);
						let maxScopeVarLength = scopeVarNames.reduce((a, b) => a.length > b.length ? a : b).length + 3;
						let currentIndentLength = XMLDocumentFormattingProvider.currentIndentString.length;
						if (currentIndentLength === 0) currentIndentLength = 2;
						const maxScopeLengthRemainder = maxScopeVarLength % currentIndentLength;
						maxScopeVarLength = maxScopeLengthRemainder === 0 ? maxScopeVarLength : maxScopeVarLength + (currentIndentLength - (maxScopeVarLength % currentIndentLength));
						maxScopeVarLength--;
						const scopeVariables = scopeVarNames.map((name) => {
							return '\t' + name + ':' + ' '.repeat(maxScopeVarLength - name.length) + '{\\$' + name + '}';
						});
						const debugLabelEntries = scopeVarNames.map((name, index) => {
							const comma = index < scopeVarNames.length - 1 ? ',' : '';
							return '\t\t\'' + name + '\': \\$' + name + comma;
						});
						const title = (symbolId && symbolId.length > 0) ? "Watch: " + symbolId : "Watch Variables";
						const header = '==== ${1:' + title + '} ====\n';
						const titleTabstop = '${1:' + title + '}';

						const scopeVariablesString0 = scopeVarNames.length > 0? scopeVarNames[scopeVarNames.length - 1] : 'variable';
						const scopeVariablesString = header + scopeVariables.join('\n');
						const debugLabelsMap = 'map {\n' + debugLabelEntries.join('\n') + '\n\t}';
						newItem0.insertText = new vscode.SnippetString(`xsl:message select="serialize($\${1:${scopeVariablesString0}}, map{'method':'adaptive'})"/>$0`);
						newItem.insertText = new vscode.SnippetString(`xsl:message expand-text="yes">\n${scopeVariablesString}\n</xsl:message>$0`);
						newItem2.insertText = new vscode.SnippetString(`xsl:message select="xdm:debug('${titleTabstop}', ${debugLabelsMap})"/>$0`);
						newItem3.insertText = new vscode.SnippetString(`xsl:message select="xdm:debug-color('${titleTabstop}', ${debugLabelsMap})"/>$0`);
						completionItems.push(newItem0);
						completionItems.push(newItem);
						completionItems.push(newItem2);
						completionItems.push(newItem3);
					}
					const newItem = new vscode.CompletionItem(tagName + ' (blank)', vscode.CompletionItemKind.Struct);
					newItem.documentation = "xsl:message";
					newItem.insertText = new vscode.SnippetString(`xsl:message select="\${1:'debug message'}"/>$0`);
					completionItems.push(newItem);
				} else if (tagName === 'ixsl:schedule-action') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('ixsl:schedule-action>\n\t<xsl:call-template name="$1">\n\t\t$0\n\t</xsl:call-template>\n</ixsl:schedule-action>');
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
				} else if (tagName === 'subtreeProcessingMode') {
					useCurrent = false;
					const newItem = new vscode.CompletionItem(tagName, vscode.CompletionItemKind.Struct);
					newItem.insertText = new vscode.SnippetString('subtreeProcessingMode defaultMode="${1:text}">\n\t<subtrees>\n\t\t<subtree elemXpath="${3:/container}" mode="${4:data}"/>$0\n\t</subtrees>\n</subtreeProcessingMode>');
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
						let tabStop = 1;
						schemaQuery.soughtAttributes.forEach((attr) => {
							if (snippetAttrs.indexOf(attr) > -1) {
								attrText += ` ${attr}="$${tabStop++}"`;
							}
						});
						break;
				}

				let selfCloseTag = snippetAttrs.length === 0 ? '/>' : '/>$0';
				let makeEmpty = false;
				if (docType === DocumentTypes.DCP) {
					makeEmpty = (tagName !== 'description' && schemaQuery.getExpected(tagName).elements.length === 0) || schemaQuery.emptyElements.indexOf(tagName) !== -1;
				} else if (docType === DocumentTypes.XSLT || docType === DocumentTypes.XSLT40) {
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
			if (attrDocs && attrDocs.length > 0) {
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
						varNames.push(varName);
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

