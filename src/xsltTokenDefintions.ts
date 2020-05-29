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
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';

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

export class XsltTokenDefinitions {
	private static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
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


	public static findDefinition = (isXSLT: boolean, document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], position: vscode.Position): vscode.Location|undefined => {
		let lineNumber = -1;
		let resultLocation: vscode.Location|undefined;

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
		let tagIdentifierName: string = '';
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
					}
					globalVariableData.push({token: instruction.token, name: instruction.name })
					xsltVariableDeclarations.push(instruction.token);
					break;
				case GlobalInstructionType.Function:
					let functionNameWithArity = instruction.name + '#' + instruction.idNumber;
					if (checkedGlobalFnNames.indexOf(functionNameWithArity) < 0) {
						checkedGlobalFnNames.push(functionNameWithArity);
					}
					break;
				case GlobalInstructionType.Template:
					if (namedTemplates.get(instruction.name)) {

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
							tagType = (XsltTokenDefinitions.xslVariable.indexOf(tagElementName) > -1)? TagType.XSLTvar: TagType.XSLTstart;
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

										inScopeVariablesList = (poppedData)? poppedData.variables: [];
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
							attType = attNameText === XsltTokenDefinitions.xslNameAtt? AttributeType.Variable: AttributeType.None;
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
					
						if (!hasProblem && attType === AttributeType.InstructionName && tagElementName === 'xsl:call-template') {
							if (!namedTemplates.get(variableName)) {

							}
						}
						if (!hasProblem && attType === AttributeType.InstructionMode && tagElementName === 'xsl:apply-templates') {
							if (globalModes.indexOf(variableName) < 0) {

							}
						}
						if (!hasProblem && attType === AttributeType.InstructionName && elementStack.length > 0 && tagElementName === 'xsl:with-param') {
							let callTemplateName = elementStack[elementStack.length - 1].symbolID;
							let templateParams = namedTemplates.get(callTemplateName);
							if (templateParams) {

							}
						}
						
						if (!hasProblem && attType === AttributeType.Variable || attType === AttributeType.InstructionName) {

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
							if (xp.functionArity === 0 && (xp.function?.value === 'key' || xp.function?.value.startsWith('accumulator-'))) {
								let keyVal = token.value.substring(1, token.value.length - 1);
								if (xp.function.value === 'key') {
									if (globalKeys.indexOf(keyVal) > -1) {

									}
								} else if (globalAccumulatorNames.indexOf(keyVal) > -1) {

								}
							}
							preXPathVariable = xp.preXPathVariable;
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
							if (!(token.value === '$value' && tagElementName === 'xsl:accumulator-rule' )) {
								let unResolvedToken = XsltTokenDiagnostics.resolveXPathVariableReference(document, importedGlobalVarNames, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList, 
									xpathStack, inScopeVariablesList, elementStack);
								if (unResolvedToken !== null) {
									unresolvedXsltVariableReferences.push(unResolvedToken);
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
											if (isValid) {

											}
										}
									} else {
										inScopeXPathVariablesList =  [];
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
									const fnArity = incrementFunctionArity? 1: 0;
									incrementFunctionArity = false;
									let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(inheritedPrefixes, xsltPrefixesToURIs, prevToken, checkedGlobalFnNames, fnArity);
									if (isValid) {

									}
								} else if (token.value === '=>') {
									incrementFunctionArity = true;
								}
								break;
						}
						break;

					case TokenLevelState.functionNameTest:
						let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(inheritedPrefixes, xsltPrefixesToURIs, token, checkedGlobalFnNames);
						if (isValid) {

						}
						break;
				}
			}
			prevToken = token;
		});

		return resultLocation;
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
