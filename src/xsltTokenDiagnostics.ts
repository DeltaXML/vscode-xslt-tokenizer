/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import { XslLexer, XMLCharState, XSLTokenLevelState, GlobalInstructionData, GlobalInstructionType, DocumentTypes, LanguageConfiguration } from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken, ErrorType, Data, XPathLexer } from './xpLexer';
import { FunctionData, XSLTnamespaces } from './functionData';
import { SchemaQuery } from './schemaQuery';
import { XSLTConfiguration } from './languageConfigurations';
import { SimpleTypeNames } from './xsltSchema';

enum HasCharacteristic {
	unknown,
	yes,
	no
}

export enum TagType {
	XSLTstart,
	XMLstart,
	XSLTvar,
	Start,
	NonStart
}

export enum AttributeType {
	None,
	Variable,
	VariableRef,
	InstructionName,
	InstructionMode,
	UseAttributeSets,
	ExcludeResultPrefixes,
	XPath
}

export enum CurlyBraceType {
	None,
	Map,
	Array
}

export interface XSLTToken extends BaseToken {
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
	expectedChildElements: string[];
}
export interface XPathData {
	token: BaseToken;
	variables: VariableData[];
	preXPathVariable: boolean;
	xpathVariableCurrentlyBeingDefined: boolean;
	function?: BaseToken;
	functionArity?: number;
	isRangeVar?: boolean;
	awaitingMapKey?: boolean;
	curlyBraceType?: CurlyBraceType;
	hasContextItem?: boolean;
}

export interface VariableData {
	token: BaseToken;
	name: string;
}

enum NameValidationError {
	None,
	NamespaceError,
	NameError,
	XSLTElementNameError,
	XSLTAttributeNameError
}

export enum ValidationType {
	XMLAttribute,
	AttributeNameTest,
	XMLElement,
	XSLTAttribute,
	PrefixedName,
	Name
}

export enum DiagnosticCode {
	none,
	unresolvedVariableRef,
	unresolvedGenericRef,
	parseHtmlRef,
	externalPrintRef,
	fnWithNoContextItem,
	currentWithNoContextItem,
	groupOutsideForEachGroup,
	groupOutsideMerge,
	positionWithNoContextItem,
	lastWithNoContextItem,
	rootWithNoContextItem,
	rootOnlyWithNoContextItem,
	instrWithNoContextItem,
	noContextItem,
	regexNoContextItem
}

export class XsltTokenDiagnostics {
	public static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	public static readonly xsltCatchVariables = ['err:code', 'err:description', 'err:value', 'err:module', 'err:line-number', 'err:column-number'];
	public static readonly xslInclude = 'xsl:include';
	public static readonly xslImport = 'xsl:import';
	public static readonly xmlChars = ['lt', 'gt', 'quot', 'apos', 'amp'];


	public static readonly xslFunction = 'xsl:function';

	public static readonly xslNameAtt = 'name';
	public static readonly xslModeAtt = 'mode';
	public static readonly useAttSet = 'use-attribute-sets';
	public static readonly xslUseAttSet = 'xsl:use-attribute-sets';
	public static readonly excludePrefixes = 'exclude-result-prefixes';
	public static readonly xslExcludePrefixes = 'xsl:exclude-result-prefixes';
	public static readonly brackets = [CharLevelState.lB, CharLevelState.lBr, CharLevelState.lPr, CharLevelState.rB, CharLevelState.rBr, CharLevelState.rPr];
	private static isHtmlParserJarSet = false;

	public static isBracket(charState: CharLevelState) {
		return XsltTokenDiagnostics.brackets.indexOf(charState) !== -1;
	}

	public static nameStartCharRgx = new RegExp(/[A-Z]|_|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);
	public static nameCharRgx = new RegExp(/-|\.|[0-9]|\u00B7|[\u0300-\u036F]|[\u203F-\u2040]|[A-Z]|_|[a-z]|[\u00C0-\u00D6]|[\u00D8-\u00F6]|[\u00F8-\u02FF]|[\u0370-\u037D]|[\u037F-\u1FFF]|[\u200C-\u200D]|[\u2070-\u218F]|[\u2C00-\u2FEF]|[\u3001-\uD7FF]|[\uF900-\uFDCF]|[\uFDF0-\uFFFD]/);

	private static findInvalidNames(nameListStr: string, docType: DocumentTypes, inheritedPrefixes: string[]) {
		const nameList = nameListStr.split(/\s+/).filter(item => item.length > 0);
		const invalidNames: string[] = [];
		for (let i = 0; i < nameList.length; i++) {
			const elName = nameList[i];
			let validationError = XsltTokenDiagnostics.validateName(elName, ValidationType.PrefixedName, docType, inheritedPrefixes);
			if (validationError !== NameValidationError.None) {
				invalidNames.push(elName);
			}
		}
		return invalidNames;
	}
	private static validateName(origNname: string, origType: ValidationType, docType: DocumentTypes, xmlnsPrefixes: string[], elementStack?: ElementData[], expectedAttributes?: string[]): NameValidationError {
		const type = origType === ValidationType.AttributeNameTest ? ValidationType.PrefixedName : origType;
		const name = origType === ValidationType.AttributeNameTest && origNname.startsWith('@') ? origNname.substring(1) : origNname;
		const isSchematron = docType === DocumentTypes.SCH;
		const isDCP = docType === DocumentTypes.DCP;
		let valid = NameValidationError.None;
		if (name.trim().length === 0) {
			return NameValidationError.NameError;
		}
		if (type === ValidationType.XMLAttribute || type === ValidationType.XSLTAttribute || origType === ValidationType.AttributeNameTest) {
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
				let suffix = nameParts[1];
				if (type === ValidationType.XMLElement) {
					// TODO: when within literal result element, iterate up stack until we get to an XSLT instruction:
					const expectedNames: string[] = elementStack && elementStack.length > 0 ? elementStack[elementStack.length - 1].expectedChildElements : ['xsl:transform', 'xsl:stylesheet', 'xsl:package'];
					if (prefix === 'xsl' || prefix === 'ixsl') {
						if (isSchematron) {
							// TODO: check xslt elements within schematron
							valid = NameValidationError.None;
						} else if (expectedNames.length === 0 && elementStack) {
							const withinNextIteration = elementStack[elementStack.length - 1].symbolName === 'xsl:next-iteration';
							valid = name === 'xsl:with-param' && withinNextIteration ? NameValidationError.None : NameValidationError.XSLTElementNameError;
						} else {
							valid = expectedNames.indexOf(name) > -1 ? NameValidationError.None : NameValidationError.XSLTElementNameError;
							if (valid !== NameValidationError.None && (name === 'xsl:next-iteration' || name === 'xsl:break')) {
								const withinIterarator = elementStack?.find(item => item.symbolName === 'xsl:iterate');
								if (withinIterarator) {
									valid = NameValidationError.None;
								}
							}
						}
						return valid;
					} else if (isSchematron) {
						if (prefix === 'sch') {
							if (elementStack?.length === 0) {
								valid = name === 'sch:schema' ? NameValidationError.None : NameValidationError.XSLTElementNameError;
							} else {
								valid = expectedNames.indexOf(name) > -1 ? NameValidationError.None : NameValidationError.XSLTElementNameError;
							}
						}
					} else {
						valid = xmlnsPrefixes.indexOf(prefix) > -1 ? NameValidationError.None : NameValidationError.NamespaceError;
					}
				} else if (type === ValidationType.PrefixedName) {
					if (prefix === '*') {
						nameParts = [suffix];
					} else {
						valid = xmlnsPrefixes.indexOf(prefix) > -1 ? NameValidationError.None : NameValidationError.NamespaceError;
						if (suffix === '*') {
							nameParts = [prefix];
						};
					}

				} else if (type === ValidationType.XSLTAttribute && prefix === 'xsl') {
					// TODO: for attributes on non-xsl instructions, check that name is in the attributeGroup: xsl:literal-result-element-attributes (e.g. xsl:expand-text)
					//valid = xmlnsPrefixes.indexOf(prefix) > -1? NameValidationError.None: NameValidationError.NamespaceError;
				} else {
					valid = xmlnsPrefixes.indexOf(prefix) > -1 ? NameValidationError.None : NameValidationError.NamespaceError;
				}
			} else if (isSchematron && type === ValidationType.XMLElement) {
				if (elementStack?.length === 0) {
					valid = name === 'schema' ? NameValidationError.None : NameValidationError.XSLTElementNameError;
				} else {
					const expectedNames: string[] = elementStack && elementStack.length > 0 ? elementStack[elementStack.length - 1].expectedChildElements : [];
					valid = expectedNames.indexOf('sch:' + name) > -1 ? NameValidationError.None : NameValidationError.XSLTElementNameError;
				}
			} else if (isDCP && type === ValidationType.XMLElement) {
				if (elementStack?.length === 0) {
					valid = name === 'documentComparator' ? NameValidationError.None : NameValidationError.XSLTElementNameError;
				} else {
					const expectedNames: string[] = elementStack && elementStack.length > 0 ? elementStack[elementStack.length - 1].expectedChildElements : [];
					valid = expectedNames.indexOf(name) > -1 ? NameValidationError.None : NameValidationError.XSLTElementNameError;
				}
			} else if ((type === ValidationType.XSLTAttribute || ((isSchematron || isDCP) && type === ValidationType.XMLAttribute)) && expectedAttributes) {
				valid = expectedAttributes.indexOf(name) > -1 ? NameValidationError.None : NameValidationError.XSLTAttributeNameError;
				return valid;
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
								charsOK = XsltTokenDiagnostics.nameStartCharRgx.test(s);
								if (!charsOK) {
									break;
								}
							} else {
								charsOK = XsltTokenDiagnostics.nameCharRgx.test(s);
								if (!charsOK) {
									break;
								}
							}
						}
						valid = charExists && charsOK ? NameValidationError.None : NameValidationError.NameError;
					}
				});
			}
		}
		return valid;
	}

	public static validateSimpleName(name: string) {
		let valid = false;
		const nameParts = name.split(':');
		if (nameParts.length > 2) {
			return false;
		}
		nameParts.forEach(namePart => {
			let charsOK = true;
			let firstChar = true;
			let charExists = false;
			for (let s of namePart) {
				if (firstChar) {
					firstChar = false;
					charExists = true;
					charsOK = XsltTokenDiagnostics.nameStartCharRgx.test(s);
					if (!charsOK) {
						break;
					}
				} else {
					charsOK = XsltTokenDiagnostics.nameCharRgx.test(s);
					if (!charsOK) {
						break;
					}
				}
			}
			valid = charExists && charsOK;
		});
		return valid;
	}

	public static calculateDiagnostics = (languageConfig: LanguageConfiguration, docType: DocumentTypes, document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], symbols: vscode.DocumentSymbol[]): vscode.Diagnostic[] => {
		let lineNumber = -1;
		let xslVariable = languageConfig.variableElementNames;
		let inScopeVariablesList: VariableData[] = [];
		let xpathVariableCurrentlyBeingDefined: boolean;
		let elementStack: ElementData[] = [];
		let inScopeXPathVariablesList: VariableData[] = [];
		let anonymousFunctionParamList: VariableData[] = [];
		let xpathStack: XPathData[] = [];
		let tagType = TagType.NonStart;
		let attType = AttributeType.None;
		let tagElementName = '';
		let tagElementId: number = -1;
		let tagElementAttributes: string[] = [];
		let tagElementChildren: string[] = [];
		let startTagToken: XSLTToken | null = null;
		let preXPathVariable = false;
		let anonymousFunctionParams = false;
		let variableData: VariableData | null = null;
		let xsltVariableDeclarations: BaseToken[] = [];
		let unresolvedXsltVariableReferences: BaseToken[] = [];
		let prevToken: BaseToken | null = null;
		let includeOrImport = false;
		let problemTokens: BaseToken[] = [];
		let topLevelSymbols: vscode.DocumentSymbol[] = symbols;
		let tagIdentifierName: string = '';
		let lastTokenIndex = allTokens.length - 1;
		let tagAttributeNames: string[] = [];
		let isGroupingAttribute = false;
		let tagAttributeSymbols: vscode.DocumentSymbol[] = [];
		let tagXmlnsNames: string[] = [];
		let rootXmlnsBindings: [string, string][] = [];
		let inheritedPrefixes: string[] = [];
		let inheritedPrefixesCopy: string[] = [];
		let globalVariableData: VariableData[] = [];
		let checkedGlobalVarNames: string[] = [];
		let checkedGlobalFnNames: string[] = [];
		let importedGlobalVarNames: string[] = [];
		let importedGlobalFnNames: string[] = [];
		let incrementFunctionArity = false;
		let onRootStartTag = true;
		let rootXmlnsName: string | null = null;
		let xsltPrefixesToURIs = new Map<string, XSLTnamespaces>();
		let isXMLDeclaration = false;
		let dtdStarted = false;
		let dtdEnded = false;
		let namedTemplates: Map<string, string[]> = new Map();
		let globalModes: string[] = ['#current', '#default'];
		let globalKeys: string[] = [];
		let globalAccumulatorNames: string[] = [];
		let globalAttributeSetNames: string[] = [];
		let tagExcludeResultPrefixes: { token: BaseToken; prefixes: string[] } | null = null;
		let ifThenStack: BaseToken[] = [];
		let currentXSLTIterateParams: string[][] = [];
		let schemaQuery: SchemaQuery | undefined;
		let xsltSchemaQuery: SchemaQuery | undefined;
		let insideGlobalFunction = false;
		const isSchematron = docType === DocumentTypes.SCH;
		let pendingTemplateParamErrors: BaseToken[] = [];
		const htmlParserString = <string | undefined>vscode.workspace.getConfiguration('XSLT.tasks').get('htmlParserJar');
		XsltTokenDiagnostics.isHtmlParserJarSet = !!htmlParserString && htmlParserString.trim().length > 0;

		if (languageConfig.isVersion4) {
			schemaQuery = new SchemaQuery(XSLTConfiguration.schemaData4);
			docType = DocumentTypes.XSLT40;
		} else if (languageConfig.schemaData) {
			schemaQuery = new SchemaQuery(languageConfig.schemaData);
		}

		if (isSchematron && XSLTConfiguration.configuration.schemaData) {
			xsltSchemaQuery = new SchemaQuery(XSLTConfiguration.configuration.schemaData);
		}

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
					globalVariableData.push({ token: instruction.token, name: instruction.name });
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
						let members = instruction.memberNames ? instruction.memberNames : [];
						namedTemplates.set(instruction.name, members);
					}
					break;
				case GlobalInstructionType.ModeInstruction:
				case GlobalInstructionType.ModeTemplate:
					globalModes.push(instruction.name);
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
				case GlobalInstructionType.RootXMLNS:
					if (docType === DocumentTypes.XPath) {
						inheritedPrefixes.push(instruction.name);
					}
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
					let members = instruction.memberNames ? instruction.memberNames : [];
					namedTemplates.set(instruction.name, members);
					break;
				case GlobalInstructionType.ModeInstruction:
				case GlobalInstructionType.ModeTemplate:
					globalModes.push(instruction.name);
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

		if (docType === DocumentTypes.XPath) {
			xsltPrefixesToURIs.set('array', XSLTnamespaces.Array);
			xsltPrefixesToURIs.set('map', XSLTnamespaces.Map);
			xsltPrefixesToURIs.set('math', XSLTnamespaces.Map);
			xsltPrefixesToURIs.set('xs', XSLTnamespaces.XMLSchema);
			xsltPrefixesToURIs.set('fn', XSLTnamespaces.XPath);
			xsltPrefixesToURIs.set('xsl', XSLTnamespaces.XSLT);
			xsltPrefixesToURIs.set('ixsl', XSLTnamespaces.IXSL);
			inheritedPrefixes = inheritedPrefixes.concat(['array', 'map', 'math', 'xs', 'fn', 'xsl', 'ixsl']);
		}

		allTokens.forEach((token, index) => {
			lineNumber = token.line;
			let isXMLToken = token.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
			if (isXMLToken) {
				if (ifThenStack.length > 0) {
					let ifToken = ifThenStack[0];
					ifToken['error'] = ErrorType.BracketNesting;
					problemTokens.push(ifToken);
					ifThenStack = [];
				}
				if (prevToken && prevToken.tokenType === TokenLevelState.operator && !prevToken.error) {
					XsltTokenDiagnostics.checkFinalXPathToken(prevToken, allTokens, index, problemTokens);
				} else if (prevToken && prevToken.tokenType === TokenLevelState.complexExpression && !prevToken.error) {
					prevToken['error'] = ErrorType.XPathAwaiting;
					problemTokens.push(prevToken);
				}
				inScopeXPathVariablesList = [];
				xpathVariableCurrentlyBeingDefined = false;
				if (xpathStack.length > 0) {
					// report last issue with nesting in each xpath:
					let errorToken: BaseToken | undefined;
					for (let index = xpathStack.length - 1; index > -1; index--) {
						const trailingToken = xpathStack[index].token;
						const tv = trailingToken.value;
						const allowedToken = (tv === 'return' || tv === 'else' || tv === 'satisfies');
						if (!allowedToken) {
							errorToken = trailingToken;
							break;
						}
					}
					if (errorToken) {
						errorToken['error'] = ErrorType.BracketNesting;
						problemTokens.push(errorToken);
					}
				}
				xpathStack = [];
				preXPathVariable = false;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenDiagnostics.xsltStartTokenNumber);

				switch (xmlTokenType) {
					case XSLTokenLevelState.xmlText:
						if (elementStack.length === 0 && token.startCharacter > -1) {
							const tValue = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
							if (tValue.trim().length !== 0) {
								token['error'] = ErrorType.ParentLessText;
								token['value'] = tValue;
								problemTokens.push(token);
							}
						}
						break;
					case XSLTokenLevelState.xslElementName:
						// this is xslt or schematron element
						incrementFunctionArity = false;
						pendingTemplateParamErrors = [];
						tagElementName = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						tagElementId++;
						inheritedPrefixesCopy = inheritedPrefixes.slice();
						const isXsltElementName = tagElementName.startsWith('xsl:');
						const isSchElementName = tagElementName.startsWith('sch:');
						const lookupElementName = isSchematron && !isXsltElementName && !isSchElementName ? 'sch:' + tagElementName : tagElementName;
						const realSchemaQuery = xsltSchemaQuery && tagElementName.startsWith('xsl:') ? xsltSchemaQuery : schemaQuery;

						[tagElementChildren, tagElementAttributes] = XsltTokenDiagnostics.getExpectedElementNames(lookupElementName, realSchemaQuery, elementStack);

						if (tagType === TagType.Start) {
							if (tagElementName === 'xsl:iterate') {
								currentXSLTIterateParams.push([]);
							}
							tagType = (xslVariable.indexOf(tagElementName) > -1) ? TagType.XSLTvar : TagType.XSLTstart;
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
						tagElementId++;
						inheritedPrefixesCopy = inheritedPrefixes.slice();
						if (isSchematron || tagElementName.startsWith('ixsl:')) {
							// this must be an xsl element
							[tagElementChildren, tagElementAttributes] = XsltTokenDiagnostics.getExpectedElementNames(tagElementName, xsltSchemaQuery, elementStack);
						}
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
								tagAttributeSymbols = [];
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
								isGroupingAttribute = false;
								// start-tag ended, we're now within the new element scope:
								if ((docType === DocumentTypes.XSLT || docType === DocumentTypes.XSLT40) && onRootStartTag) {
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
								let xsltAttsWithNameErrors: string[] = [];
								const attrValType = tagElementName.startsWith('xsl:') ? ValidationType.XSLTAttribute : ValidationType.XMLAttribute;

								let tunnelAttributeFound = false;
								const checkPendingErrors = pendingTemplateParamErrors.length !== 0;
								tagAttributeNames.forEach((attName) => {
									if (checkPendingErrors && !tunnelAttributeFound) {
										tunnelAttributeFound = attName === 'tunnel';
									}
									let validateResult = XsltTokenDiagnostics.validateName(attName, attrValType, docType, inheritedPrefixes, elementStack, tagElementAttributes);
									if (validateResult === NameValidationError.NameError) {
										attsWithNameErrors.push(attName);
									} else if (validateResult === NameValidationError.NamespaceError) {
										attsWithXmlnsErrors.push(attName);
									} else if (validateResult === NameValidationError.XSLTAttributeNameError) {
										xsltAttsWithNameErrors.push(attName);
									}
								});
								if (checkPendingErrors && !tunnelAttributeFound) {
									pendingTemplateParamErrors.forEach((item) => problemTokens.push(item));
								}
								pendingTemplateParamErrors = [];


								if (startTagToken && !problem) {
									let validationError = XsltTokenDiagnostics.validateName(tagElementName, ValidationType.XMLElement, docType, inheritedPrefixes, elementStack);
									if (validationError !== NameValidationError.None) {
										startTagToken['error'] = validationError === NameValidationError.NameError ? ErrorType.XMLName : validationError === NameValidationError.NamespaceError ? ErrorType.XMLXMLNS : ErrorType.XSLTInstrUnexpected;
										startTagToken['value'] = tagElementName;
										problemTokens.push(startTagToken);
									}
									else if (attsWithNameErrors.length > 0) {
										startTagToken['error'] = ErrorType.XMLAttributeName;
										startTagToken['value'] = tagElementName + '\': \'' + attsWithNameErrors.join('\', ');
										problemTokens.push(startTagToken);
									}
									else if (attsWithXmlnsErrors.length > 0) {
										startTagToken['error'] = ErrorType.XMLAttributeXMLNS;
										startTagToken['value'] = tagElementName + '\': \'' + attsWithXmlnsErrors.join('\', ');
										problemTokens.push(startTagToken);
									}
									else if (xsltAttsWithNameErrors.length > 0) {
										startTagToken['error'] = ErrorType.XSLTAttrUnexpected;
										startTagToken['value'] = tagElementName + '\': \'' + xsltAttsWithNameErrors.join('\', ');
										problemTokens.push(startTagToken);
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
									// if top-level element add global variables - these include following variables also:
									let newVariablesList = elementStack.length === 0 ? globalVariableData : inScopeVariablesList;
									const stackElementChildren = isSchematron || docType === DocumentTypes.DCP ?
										tagElementChildren :
										attrValType === ValidationType.XMLAttribute && elementStack.length > 0 ?
											elementStack[elementStack.length - 1].expectedChildElements :
											tagElementChildren;
									//let newVariablesList = inScopeVariablesList;

									const childSymbols: vscode.DocumentSymbol[] = XsltTokenDiagnostics.initChildrenSymbols(tagAttributeSymbols);

									if (variableData !== null) {
										if (elementStack.length > 1) {
											xsltVariableDeclarations.push(variableData.token);
										}
										if (startTagToken) {
											// if a top-level element, use global variables instad of inScopeVariablesList;
											if (tagElementName === 'xsl:function') insideGlobalFunction = true;
											elementStack.push({
												namespacePrefixes: inheritedPrefixesCopy, currentVariable: variableData, variables: newVariablesList,
												symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: childSymbols, expectedChildElements: stackElementChildren
											});
										}
									} else if (startTagToken) {
										if (tagElementName === 'xsl:function') insideGlobalFunction = true;
										elementStack.push({ namespacePrefixes: inheritedPrefixesCopy, variables: newVariablesList, symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: childSymbols, expectedChildElements: stackElementChildren });
									}
									inScopeVariablesList = [];
									newVariablesList = [];
									tagType = TagType.NonStart;

								} else {
									// self-closed tag: xmlns declarations on this are no longer in scope
									inheritedPrefixes = inheritedPrefixesCopy;
									if (variableData !== null) {
										if (elementStack.length > 1) {
											if (docType === DocumentTypes.DCP) {
												importedGlobalVarNames.push(variableData.name);
												globalVariableData.push(variableData);
											} else {
												inScopeVariablesList.push(variableData);
											}
											xsltVariableDeclarations.push(variableData.token);
										} else {
											inScopeVariablesList = [];
										}
									}
									if (startTagToken) {
										let symbol = XsltTokenDiagnostics.createSymbolFromElementTokens(tagElementName, tagIdentifierName, startTagToken, token);
										if (symbol !== null) {
											const childSymbols: vscode.DocumentSymbol[] = XsltTokenDiagnostics.initChildrenSymbols(tagAttributeSymbols);
											symbol.children = childSymbols;
											if (elementStack.length > 0) {
												if (insideGlobalFunction) {
													XsltTokenDiagnostics.addProblemIfMissingContextSC(true, tagElementName, tagAttributeSymbols, elementStack, xpathStack, startTagToken, problemTokens);
													XsltTokenDiagnostics.addCallTemplateProbIfMissingContext(true, startTagToken, tagElementName, elementStack, xpathStack, problemTokens);
												}
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
									let poppedData = elementStack.pop()!;
									inheritedPrefixes = poppedData.namespacePrefixes;
									if (tagElementName === 'xsl:function') insideGlobalFunction = false;
									if (tagElementName === 'xsl:iterate') {
										currentXSLTIterateParams.pop();
									} else if (tagElementName === 'xsl:function') {
										insideGlobalFunction = false;
									} else if (insideGlobalFunction) {
										XsltTokenDiagnostics.addProblemIfMissingContext(true, tagElementName, poppedData, elementStack, xpathStack, problemTokens);
										XsltTokenDiagnostics.addCallTemplateProbIfMissingContext(true, poppedData.identifierToken, tagElementName, elementStack, xpathStack, problemTokens);

									}
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
												poppedData = elementStack.pop()!;
												inheritedPrefixes = poppedData.namespacePrefixes;
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
										inScopeVariablesList = (poppedData) ? poppedData.variables : [];
										if (poppedData.currentVariable) {
											if (docType === DocumentTypes.DCP) {
												importedGlobalVarNames.push(poppedData.currentVariable.name);
												globalVariableData.push(poppedData.currentVariable);
											} else if (elementStack.length > 1) {
												// reset inscope variables - unless at global-variable stack-level
												inScopeVariablesList.push(poppedData.currentVariable);
											}
										}
									}
								} else {
									let errToken = (prevToken) ? prevToken : token;
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
							if (xmlTokenType === XSLTokenLevelState.xmlnsName) {
								if (tagXmlnsNames.indexOf(attNameText) > -1) {
									token['error'] = ErrorType.XMLDupllicateAtt;
									token['value'] = attNameText;
									problemTokens.push(token);
								}
								tagXmlnsNames.push(attNameText);
								if (attNameText.length > 6) {
									let prefix = attNameText.substring(6);
									if (inheritedPrefixes.indexOf(prefix) < 0) {
										// in case xmlns comes after xpath expression in same element - remove problem tokens caused by this
										problemTokens = problemTokens.filter(p => !((p.error === ErrorType.XPathPrefix || p.error === ErrorType.XSLTPrefix) && (p.value.startsWith(prefix + ':') || p.value.startsWith('@' + prefix + ':')) && p.tagElementId === tagElementId));
										inheritedPrefixes.push(prefix);
									}
									if (prefix === 'ixsl') {
										if (schemaQuery) {
											schemaQuery.useIxsl = true;
										}
										if (xsltSchemaQuery) {
											xsltSchemaQuery.useIxsl = true;
										}
									}
								}
								if (onRootStartTag) {
									rootXmlnsName = attNameText;
								}
							} else {
								if (tagAttributeNames.indexOf(attNameText) > -1) {
									token['error'] = ErrorType.XMLDupllicateAtt;
									token['value'] = attNameText;
									problemTokens.push(token);
								}
								tagAttributeSymbols.push(XsltTokenDiagnostics.createSymbolForAttribute(token, attNameText));
								isGroupingAttribute = attNameText === 'group-by' || attNameText === 'group-adjacent' || attNameText === 'group-starting-with' || attNameText === 'group-ending-with';
								tagAttributeNames.push(attNameText);
							}
						}
						if (tagType === TagType.XSLTvar) {
							attType = attNameText === XsltTokenDiagnostics.xslNameAtt ? AttributeType.Variable : AttributeType.None;
						} else if (tagType === TagType.XSLTstart) {
							if (docType === DocumentTypes.DCP && (attNameText === 'parameterRef' || attNameText === 'if' || attNameText === 'unless')) {
								attType = AttributeType.VariableRef;
							} else if (attNameText === XsltTokenDiagnostics.xslNameAtt) {
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
						if (tagAttributeSymbols.length > 0) {
							const symbolClone = { ...tagAttributeSymbols[tagAttributeSymbols.length - 1] };
							const extendedRange = symbolClone.range.with({ end: new vscode.Position(token.line, token.startCharacter + token.length) });
							symbolClone.range = extendedRange;
							tagAttributeSymbols[tagAttributeSymbols.length - 1] = symbolClone;
							if (fullVariableName.length !== 1) {
								tagAttributeSymbols[tagAttributeSymbols.length - 1].detail = fullVariableName;
							} else {
								tagAttributeSymbols[tagAttributeSymbols.length - 1].kind = vscode.SymbolKind.Event;
							}
						}
						let variableName = fullVariableName.substring(1, fullVariableName.length - 1);
						let hasProblem = false;
						if (rootXmlnsName !== null) {
							let prefix = rootXmlnsName.length === 5 ? '' : rootXmlnsName.substr(6);
							rootXmlnsBindings.push([prefix, variableName]);
						}
						switch (attType) {
							case AttributeType.Variable:
								tagIdentifierName = variableName;
								if (elementStack.length > 2) {
									let parentElemmentName = elementStack[elementStack.length - 1].symbolName;
									if (parentElemmentName === 'xsl:iterate') {
										currentXSLTIterateParams[currentXSLTIterateParams.length - 1].push(variableName);
									}
								}
								variableData = { token: token, name: variableName };
								break;
							case AttributeType.VariableRef:
								let unResolvedToken = XsltTokenDiagnostics.resolveXPathVariableReference('', document, importedGlobalVarNames, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList,
									xpathStack, inScopeVariablesList, elementStack);
								if (unResolvedToken !== null) {
									unresolvedXsltVariableReferences.push(unResolvedToken);
								}
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
								tagExcludeResultPrefixes = { token: token, prefixes: excludePrefixes };
								break;
							case AttributeType.None:
								const tagAttributeName = tagAttributeNames.length > 0 ? tagAttributeNames[tagAttributeNames.length - 1] : undefined;
								let isAVTbracket = token.length === 2 && (fullVariableName.charAt(1) === '{' || fullVariableName.charAt(0) === '}');
								if (!isAVTbracket && schemaQuery && tagAttributeName && variableName.indexOf('{') === -1) {
									const expectedValues = schemaQuery.getExpected(tagElementName, tagAttributeName);
									const expectedSimpleType = schemaQuery.lastEnumSimpleType;
									if (expectedValues.attributeValues && expectedValues.attributeValues.length > 0) {
										const matchingNameAndDesc = expectedValues.attributeValues.find(arr => arr[0] === variableName);
										if (!matchingNameAndDesc) {
											const isNameTest = SimpleTypeNames.nametests === expectedSimpleType;
											if (isNameTest) {
												const invalidNames = XsltTokenDiagnostics.findInvalidNames(variableName, docType, inheritedPrefixes);
												if (invalidNames.length > 0) {
													const quotedNames = invalidNames.map((uName) => '\'' + uName + '\'');
													token['error'] = ErrorType.XMLNameList;
													token.value = tagAttributeName + ' ' + quotedNames.join(',');
												}
											} else {
												const isHashedExpected = expectedValues.attributeValues[0][0].charAt(0) === '#';
												const isHashedValue = (variableName.charAt(0) === '#');
												const ignoreHashNoMatch = isHashedExpected && !isHashedValue;
												if (!ignoreHashNoMatch) {
													token['error'] = ErrorType.XMLAttributeValueUnexpected;
													const expectedNames = expectedValues.attributeValues.map(arr => arr[0]);
													token.value = variableName + '!' + tagAttributeName + '!' + expectedNames.join(', ');
												}
											}
										}
									}
								}
								if (prevToken && prevToken.length === 1 && prevToken.tokenType === XsltTokenDiagnostics.xsltStartTokenNumber + XSLTokenLevelState.attributeValue) {
									token['error'] = ErrorType.XPathEmpty;
								}
								break;
						}

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
						if (!hasProblem && attType === AttributeType.InstructionName && tagElementName === 'xsl:function') {
							if (!variableName.includes(':')) {
								token['error'] = ErrorType.XSLTFunctionNamePrefix;
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
									pendingTemplateParamErrors.push(token);
								}
							} else if (currentXSLTIterateParams.length > 0 && elementStack.length > 2 && elementStack[elementStack.length - 1].symbolName === 'xsl:next-iteration') {
								const params = currentXSLTIterateParams[currentXSLTIterateParams.length - 1];
								if (params.indexOf(variableName) < 0) {
									token['error'] = ErrorType.IterateParamInvalid;
									token.value = variableName;
									problemTokens.push(token);
									hasProblem = true;
								}
							}
						}

						if (!hasProblem && (attType === AttributeType.Variable || attType === AttributeType.InstructionName)) {
							if (!fullVariableName.includes('{')) {
								let vType = tagElementName.endsWith(':attribute') ? ValidationType.XMLAttribute : ValidationType.PrefixedName;
								const nameToTest = tagElementName === "xsl:namespace" && variableName === '' ? 'empty' : variableName;
								let validateResult = XsltTokenDiagnostics.validateName(nameToTest, vType, docType, inheritedPrefixes);
								if (validateResult !== NameValidationError.None) {
									token['error'] = validateResult === NameValidationError.NameError ? ErrorType.XSLTName : ErrorType.XSLTPrefix;
									token['value'] = variableName;
									token.tagElementId = tagElementId;
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
							let validateResult = XsltTokenDiagnostics.validateName(piName, ValidationType.Name, docType, inheritedPrefixes);
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
						let validationResult;
						if (token.error) {
							problemTokens.push(token);
						} else {
							({ validationResult, entityName } = XsltTokenDiagnostics.validateEntityRef(entityName, dtdEnded, inheritedPrefixes));
							if (validationResult !== NameValidationError.None) {
								token['error'] = ErrorType.EntityName;
								token['value'] = entityName;
								problemTokens.push(token);
							}
						}
						break;
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
				if (xpathStack.length > 0) {
					const tv = xpathStack[xpathStack.length - 1].token.value;
					if (prevToken?.charType === CharLevelState.sep && prevToken.value === ',' && (tv === 'for' || tv === 'let' || tv === 'every')) {
						if (xpathTokenType !== TokenLevelState.variable) {
							const realType = (xpathTokenType === TokenLevelState.comment && index + 1 < allTokens.length) ? allTokens[index + 1].tokenType : xpathTokenType;
							if (realType != TokenLevelState.variable) {
								token['error'] = ErrorType.ExpectedDollarAfterComma;
								problemTokens.push(token);
							}
						}
					}
				}
				if (insideGlobalFunction && !isGroupingAttribute) {
					const tv = token.value;
					const isRootSelector = tv === '/' || tv === '//';
					if (prevToken && (isRootSelector || xpathTokenType === TokenLevelState.nodeNameTest || xpathTokenType === TokenLevelState.attributeNameTest || xpathTokenType === TokenLevelState.axisName)) {
						if (!XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction)) {
							if (isRootSelector) {
								if (!XsltTokenDiagnostics.providesContext(prevToken)) {
									let isRootOnly = true;
									if (index < allTokens.length - 2) {
										const nt = allTokens[index + 1];
										const ntt = <TokenLevelState>nt.tokenType;
										const ntv = nt.value;
										isRootOnly = !(ntt === TokenLevelState.nodeNameTest || ntt === TokenLevelState.anonymousFunction || ntt === TokenLevelState.axisName ||
											ntt === TokenLevelState.function || ntt === TokenLevelState.variable || ntv === '*' || ntv === '()' || ntv === '(' || ntv === '=>');
									}
									token.error = isRootOnly ? ErrorType.MissingContextItemForRootOnly : ErrorType.MissingContextItemForRoot;
									problemTokens.push(token);
								}
							} else {
								const hasPrecedingSlash = (prevToken.charType === CharLevelState.sep && (prevToken.value === '/' || prevToken.value === '!')) ||
									(prevToken.charType === CharLevelState.dSep && (prevToken.value === '//'));
								let hasContext = hasPrecedingSlash;
								if (!hasContext && xpathTokenType !== TokenLevelState.axisName) {
									hasContext = (prevToken.charType === CharLevelState.dSep && prevToken.value === '::');
								}
								if (!hasContext) {
									token.error = ErrorType.MissingContextItemGeneral;
								}
							}
						}
					}
				}

				switch (xpathTokenType) {
					case TokenLevelState.string:
						if (token.error) {
							problemTokens.push(token);
						}
						XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
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
						}
						break;
					case TokenLevelState.axisName:
						if (token.error) {
							problemTokens.push(token);
						}
						XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
						break;
					case TokenLevelState.variable:
						if ((preXPathVariable && !xpathVariableCurrentlyBeingDefined) || anonymousFunctionParams) {
							let fullVariableName = token.value;
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
							let prefixEnd = token.value.indexOf(':');
							if (prefixEnd !== -1) {
								let prefix = token.value.substring(1, prefixEnd);
								if (inheritedPrefixes.indexOf(prefix) === -1) {
									token['error'] = ErrorType.XPathPrefix;
									problemTokens.push(token);
								}
							}
							// don't include any current pending variable declarations when resolving
							let globalVarName: string | null = null;
							if (tagType === TagType.XSLTvar && elementStack.length === 1) {
								globalVarName = tagIdentifierName;
							}
							let unResolvedToken = XsltTokenDiagnostics.resolveXPathVariableReference(globalVarName, document, importedGlobalVarNames, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList,
								xpathStack, inScopeVariablesList, elementStack);
							if (unResolvedToken !== null) {
								unresolvedXsltVariableReferences.push(unResolvedToken);
							}
							XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
						}
						break;
					case TokenLevelState.complexExpression:
						let valueText = token.value;
						let testStartOfExpression = false;
						switch (valueText) {
							case 'if':
								ifThenStack.push(token);
								testStartOfExpression = true;
								break;
							case 'every':
							case 'for':
							case 'let':
							case 'some':
							case 'member':
								testStartOfExpression = true;
								if (allTokens.length > index + 2) {
									const nextToken = allTokens[index + 1];
									const isForMember = valueText === 'for' && nextToken.value === 'member';
									if (!isForMember) {
										const opToken = allTokens[index + 2];
										const expectedOp = valueText === 'let' ? ':=' : 'in';
										if (opToken.value !== expectedOp) {
											opToken['error'] = ErrorType.XPathExpectedComplex;
											problemTokens.push(opToken);
										}
									}
								}
								if (index > 0) {
									XsltTokenDiagnostics.checkTokenIsExpected(prevToken, allTokens[index - 1], problemTokens, TokenLevelState.Unset);
								}
								if (valueText !== 'member') {
									preXPathVariable = true;
									xpathVariableCurrentlyBeingDefined = false;
									xpathStack.push({ token: token, variables: inScopeXPathVariablesList.slice(), preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, isRangeVar: true });
								}
								break;
							case 'then':
								if (ifThenStack.length > 0) {
									ifThenStack.pop();
								} else {
									token.error = ErrorType.XPathUnexpected;
									problemTokens.push(token);
								}
								xpathStack.push({ token: token, variables: inScopeXPathVariablesList.slice(), preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined });
								inScopeXPathVariablesList = [];
								break;
							case 'return':
							case 'satisfies':
							case 'else':
								let tokenValBeforeDelete = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1].token.value : '';
								if (xpathStack.length === 0) {
									token['error'] = ErrorType.BracketNesting;
									problemTokens.push(token);
								}
								if (xpathStack.length > 1) {
									let deleteCount = 0;
									for (let i = xpathStack.length - 1; i > -1; i--) {
										const stackItem = xpathStack[i];
										const sv = stackItem.token.value;
										if (sv === 'return' || sv === 'else' || sv === 'satisfies') {
											inScopeXPathVariablesList = stackItem.variables;
											xpathVariableCurrentlyBeingDefined = stackItem.xpathVariableCurrentlyBeingDefined;
											preXPathVariable = stackItem.xpathVariableCurrentlyBeingDefined;
											deleteCount++;
										} else {
											break;
										}
									}
									if (deleteCount > 0) {
										xpathStack.splice(xpathStack.length - deleteCount);
									}
								}

								if (xpathStack.length > 0) {
									let peekedStack = xpathStack[xpathStack.length - 1];
									if (peekedStack) {
										if (valueText === 'else') {
											preXPathVariable = peekedStack.preXPathVariable;
										} else {
											// todo: if after a return AND a ',' prePathVariable = true; see $pos := $c.
											preXPathVariable = false;
										}
										xpathVariableCurrentlyBeingDefined = peekedStack.xpathVariableCurrentlyBeingDefined;
										let matchingToken: string = XsltTokenDiagnostics.getMatchingToken(peekedStack.token.value);
										if (!token.error && matchingToken !== token.value) {
											token['error'] = ErrorType.BracketNesting;
											problemTokens.push(token);
										} else {
											//const ptv = peekedStack.token.value;
											//peekedStack.hasContextItem = ptv === 'for' || ptv === 'every' || ptv === 'some';
											peekedStack.token = token;
										}
									} else {
										inScopeXPathVariablesList = [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
								} else if (tokenValBeforeDelete !== '') {
									let matchingToken: string = XsltTokenDiagnostics.getMatchingToken(tokenValBeforeDelete);
									if (!token.error && matchingToken !== token.value) {
										token['error'] = ErrorType.BracketNesting;
										problemTokens.push(token);
									}
								}
								break;
						}
						if (!token.error && testStartOfExpression && prevToken) {

						}
						break;
					case TokenLevelState.mapKey:
						if (!(prevToken && prevToken.tokenType === TokenLevelState.operator
							&& (prevToken.value === ',' || prevToken.value === '{'))) {
							token['error'] = ErrorType.XPathUnexpected;
							problemTokens.push(token);
						}
						break;
					case TokenLevelState.operator:
						let isXPathError = false;
						let tv = token.value;

						// start checks
						let stackItem: XPathData | undefined = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : undefined;
						const sv = stackItem?.token.value;
						const tokenIsComma = tv === ',';
						const popStackLaterForComma = sv && tokenIsComma && (sv === 'return' || sv === 'else' || sv === 'satisfies');
						if (popStackLaterForComma && xpathStack.length > 1) {
							stackItem = xpathStack[xpathStack.length - 2];
							if (xpathStack.length > 1) {
								let deleteCount = 0;
								for (let i = xpathStack.length - 1; i > -1; i--) {
									const stackItem = xpathStack[i];
									const sv = stackItem.token.value;
									if (sv === 'return' || sv === 'else' || sv === 'satisfies') {
										inScopeXPathVariablesList = stackItem.variables;
										xpathVariableCurrentlyBeingDefined = stackItem.xpathVariableCurrentlyBeingDefined;
										preXPathVariable = stackItem.xpathVariableCurrentlyBeingDefined;
										deleteCount++;
									} else {
										break;
									}
								}
								if (deleteCount > 0) {
									xpathStack.splice(xpathStack.length - deleteCount);
								}
							}
						}
						if (stackItem && stackItem.curlyBraceType === CurlyBraceType.Map) {
							if (tokenIsComma) {
								if (stackItem.awaitingMapKey) {
									isXPathError = true;
								} else {
									stackItem.awaitingMapKey = true;
								}
							} else if (tv === '}' && stackItem.awaitingMapKey) {
								isXPathError = prevToken?.value !== '{';
							}
						}
						if (prevToken?.tokenType === TokenLevelState.complexExpression) {
							let currCharType = <CharLevelState>token.charType;
							if (currCharType === CharLevelState.rB || currCharType === CharLevelState.rBr || currCharType === CharLevelState.rPr) {
								if (prevToken.value === 'return' || prevToken.value === 'satisfies' || prevToken.value === 'else' || prevToken.value === 'then') {
									prevToken['error'] = ErrorType.XPathAwaiting;
									problemTokens.push(prevToken);
								}
							} else if (tokenIsComma) {
								prevToken['error'] = ErrorType.XPathAwaiting;
								problemTokens.push(prevToken);
							}
						} else if (prevToken?.tokenType === TokenLevelState.uriLiteral) {
							token['error'] = ErrorType.XPathUnexpected;
							problemTokens.push(token);
						} else if (prevToken && prevToken.value === '/' && !prevToken.error) {
							let fwdSlashAtEndError = false;
							const preSlashtoken = allTokens[index - 2];
							let slashHasContext = preSlashtoken && XsltTokenDiagnostics.providesContext(preSlashtoken);
							if (slashHasContext) {
								switch (<CharLevelState>token.charType) {
									case CharLevelState.rB:
									case CharLevelState.rBr:
									case CharLevelState.rPr:
									case CharLevelState.sep:
										fwdSlashAtEndError = true;
										break;
									case CharLevelState.dSep:
										if (tv !== '()' && tv !== '[]') {
											fwdSlashAtEndError = true;
										}
										break;
								}
							}
							if (fwdSlashAtEndError) {
								token['error'] = ErrorType.XPathUnexpected;
								problemTokens.push(token);
								isXPathError = true;
							}
						} else if (prevToken && tv !== '/' && prevToken.value !== '/' && !prevToken.error) {
							let isXMLToken = prevToken.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
							let currCharType = <CharLevelState>token.charType;
							let nextToken = index + 1 < allTokens.length ? allTokens[index + 1] : undefined;
							if (tv === ':') {
								if (stackItem && stackItem.curlyBraceType === CurlyBraceType.Map) {
									if (stackItem.awaitingMapKey) {
										stackItem.awaitingMapKey = false;
									} else {
										isXPathError = true;
									}
								} else if (prevToken.tokenType === TokenLevelState.nodeNameTest || prevToken.tokenType === TokenLevelState.attributeNameTest) {
									isXPathError = !(prevToken.startCharacter + prevToken.length === token.startCharacter && nextToken?.value === '*');
								} else {
									isXPathError = true;
								}
							}
							if (tv === 'map' || tv === 'array') {
								XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens, TokenLevelState.function);
							} else if ((tv === '+' || tv === '-') && nextToken && nextToken.tokenType !== TokenLevelState.string) {
								// either a number of an operator so show no error
							} else if (tv === '?') {
								if (isXMLToken || prevToken.value === '.' || prevToken.tokenType === TokenLevelState.variable || prevToken.tokenType === TokenLevelState.comment || prevToken.tokenType === TokenLevelState.mapNameLookup) {
									// don't check
								} else if (prevToken.tokenType === TokenLevelState.operator) {
									if (prevToken.charType === CharLevelState.sep) {
										const illegalPrevOperators = ['{', ':', '?'];
										isXPathError = illegalPrevOperators.indexOf(prevToken.value) !== -1;
									} else if (prevToken.charType === CharLevelState.dSep) {
										const illegalPrevOperators = ['=>', '//', '..', '*:', '::'];
										isXPathError = illegalPrevOperators.indexOf(prevToken.value) !== -1;
									}
								} else {
									isXPathError = true;
								}

							} else if (isXMLToken) {
								switch (currCharType) {
									case CharLevelState.rB:
									case CharLevelState.rBr:
									case CharLevelState.rPr:
										isXPathError = true;
										break;
									case CharLevelState.sep:
										if (tv !== '?' && tv !== '/') {
											isXPathError = true;
										}
										break;
									case CharLevelState.dSep:
										if (tv !== '()' && tv !== '[]' && tv !== '//' && tv !== '*:' && tv != '//') {
											isXPathError = true;
										}
										break;
								}
							} else if (prevToken.tokenType === TokenLevelState.operator) {
								// current type is operator and previous type is operator
								let prevCharType = <CharLevelState>prevToken.charType;
								let pv = prevToken.value;

								switch (currCharType) {
									case CharLevelState.rB:
									case CharLevelState.rBr:
									case CharLevelState.rPr:
										if (!XsltTokenDiagnostics.isBracket(prevCharType)) {
											// +) is not ok but )) or ( ) is ok
											if (!(
												(prevToken.charType === CharLevelState.sep && pv === '?' && tv === ')')
												|| (prevToken.charType === CharLevelState.dSep && (pv === '{}' || pv === '()' || pv === '[]')))
											) {
												isXPathError = true;
											}
										}
										break;
									case CharLevelState.dSep:
										if (prevCharType === CharLevelState.rB || prevCharType === CharLevelState.rPr || prevCharType === CharLevelState.rBr ||
											(prevCharType === CharLevelState.dSep && (pv === '()' || pv === '[]' || pv === '{}'))
										) {
											// allow: ) !=
											isXPathError = tv === '*:';
										} else if (tv === '*:' || tv === '//') {
											// no error
										} else if (!((tv === '{}' && (pv === 'map' || pv === 'array')) || tv === '()' || tv === '[]')) {
											isXPathError = true;
										}
										break;
									case CharLevelState.lB:
									case CharLevelState.lBr:
									case CharLevelState.lPr:
										// +( is ok
										break;
									default:
										switch (prevCharType) {
											case CharLevelState.rB:
											case CharLevelState.rBr:
											case CharLevelState.rPr:
												// ), or )+ are ok
												break;
											case CharLevelState.dSep:
												if (!(pv === '()' || pv === '{}' || pv === '[]')) {
													isXPathError = true;
												}
												break;
											default:
												// (+ or ++ are not ok
												if ((pv === '&gt;' && (tv === '&gt;' || tv === '=')) || (pv === '&lt;' && (tv === '&lt;' || tv === '&gt;' || tv === '='))) {
													// allow << <> >> <= >=
												} else if (tv === 'as') {
													isXPathError = pv !== 'castable' && pv !== 'cast' && pv !== 'treat';
												} else if (tv === 'of') {
													isXPathError = pv !== 'instance';
												} else if (!(
													(pv === '?' && (tv === ',' || tv === ')')) ||
													(tv === '?' && (pv === '(' || pv === ')' || pv === ',')) ||
													(pv === '!' && tv === '?') ||
													(pv === '[' && tv === '?')
												)) {
													isXPathError = true;
												}
												break;
										}
								}

							}
							if (isXPathError) {
								token['error'] = ErrorType.XPathUnexpected;
								problemTokens.push(token);
								// token is pushed onto problemTokens later
							}
						} else if (tv === '/' && prevToken && prevToken.tokenType < XsltTokenDiagnostics.xsltStartTokenNumber) {
							const pv = prevToken.value;
							const pt = prevToken.tokenType;
							let fwdSlashError = true;
							switch (pt) {
								case TokenLevelState.operator:
									fwdSlashError = (pv === '//' || pv === '!' || pv === '::');
									break;
								case TokenLevelState.variable:
								case TokenLevelState.axisName:
								case TokenLevelState.comment:
								case TokenLevelState.attributeNameTest:
								case TokenLevelState.nodeNameTest:
								case TokenLevelState.mapNameLookup:
								case TokenLevelState.nodeType:
									fwdSlashError = false;
									break;
							}
							if (fwdSlashError) {
								token['error'] = ErrorType.XPathUnexpected;
								problemTokens.push(token);
							}
						}
						// end checks
						let functionToken: BaseToken | null = null;
						const isBrackets = xpathCharType === CharLevelState.lB;
						const isSquareBr = xpathCharType === CharLevelState.lPr;
						switch (xpathCharType) {
							case CharLevelState.lBr:
								let curlyBraceType = CurlyBraceType.None;
								let setContextItemProp = false;
								if (prevToken && prevToken.tokenType === TokenLevelState.operator) {
									if (prevToken.value === 'map') {
										curlyBraceType = CurlyBraceType.Map;
									} else if (prevToken.value === 'array') {
										curlyBraceType = CurlyBraceType.Array;
									}
									if (curlyBraceType === CurlyBraceType.Map || curlyBraceType === CurlyBraceType.Array) {
										const prevToken2Val = index > 2 ? allTokens[index - 2].value : '';
										setContextItemProp = prevToken2Val === '!' || prevToken2Val === '/';
									}
								} else if (prevToken && prevToken.tokenType === TokenLevelState.anonymousFunction) {
									setContextItemProp = prevToken.value === '->';
								}
								const stackItem: XPathData = { token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, curlyBraceType };
								if (curlyBraceType === CurlyBraceType.Map) {
									stackItem.awaitingMapKey = true;
								}
								if (setContextItemProp) {
									stackItem.hasContextItem = true;
								}
								xpathStack.push(stackItem);
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
								} else if (prevToken?.tokenType === TokenLevelState.variable) {
									// TODO: check arity of variables of type 'function'
									incrementFunctionArity = false;
								}
							// intentionally no-break;	
							case CharLevelState.lPr:
								let hasContextItem = false;
								if (prevToken) {
									if (isBrackets || isSquareBr) {
										// e.g. brackets /div/(@class) or predicate (array constructor) /div![@class]
										hasContextItem = prevToken.charType === CharLevelState.sep && (prevToken.value === '/' || prevToken.value === '!');
										if (!hasContextItem) hasContextItem = prevToken.tokenType === TokenLevelState.simpleType;
										if (!hasContextItem && index > 2 && (prevToken.tokenType === TokenLevelState.function || prevToken.tokenType === TokenLevelState.variable)) {
											const prevToken2 = allTokens[index - 2];
											hasContextItem = prevToken2.charType === CharLevelState.sep && (prevToken2.value === '/' || prevToken2.value === '!');
										}
									}
									if (!isBrackets && !hasContextItem) {
										hasContextItem = XsltTokenDiagnostics.providesContext(prevToken);
									}
								}
								let xpathItem: XPathData = { token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, hasContextItem };
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
								if (xpathCharType === CharLevelState.rB && xpathStack.length > 0) {
									const lastStackToken = xpathStack[xpathStack.length - 1];
									const ctx = lastStackToken.token.context;
									if (ctx) {
										const isIfExpr = ctx.tokenType === TokenLevelState.complexExpression && ctx.value === 'if';
										if (isIfExpr) {
											const tokenAfterIf = XsltTokenDiagnostics.nextNonCommentToken(allTokens, index);
											if (tokenAfterIf && tokenAfterIf.value !== 'then') {
												tokenAfterIf['error'] = ErrorType.XPathIfAwaitingThen;
												problemTokens.push(tokenAfterIf);
											}
										}
									}
								}

								if (xpathStack.length > 1) {
									let deleteCount = 0;
									for (let i = xpathStack.length - 1; i > -1; i--) {
										const sv = xpathStack[i].token.value;
										if (sv === 'return' || sv === 'else' || sv === 'satisfies') {
											deleteCount++;
										} else {
											break;
										}
									}
									if (deleteCount > 0) {
										xpathStack.splice(xpathStack.length - deleteCount);
									}
								}

								if (xpathStack.length > 0) {
									let poppedData = xpathStack.pop();
									if (poppedData) {
										if (poppedData.token.value === 'then') {
											poppedData.token['error'] = ErrorType.BracketNesting;
											problemTokens.push(poppedData.token);
										} else if (xpathCharType === CharLevelState.rB && poppedData.token.context?.tokenType !== TokenLevelState.simpleType && poppedData.token.context?.tokenType === TokenLevelState.anonymousFunction) {
											let hasProblem = false;
											if (index === allTokens.length - 1) {
												hasProblem = true;
											} else {
												const nextToken = XsltTokenDiagnostics.nextNonCommentToken(allTokens, index)?.value;
												hasProblem = !(nextToken === '{' || nextToken === '{}');
											}
											if (hasProblem) {
												const t = poppedData.token.context!;
												t.error = ErrorType.AnonymousFunctionSyntax;
												problemTokens.push(t);
											}
										}

										let regexSpecial = false;
										inScopeXPathVariablesList = poppedData.variables;
										preXPathVariable = poppedData.preXPathVariable;
										xpathVariableCurrentlyBeingDefined = poppedData.xpathVariableCurrentlyBeingDefined;
										if (poppedData.function && poppedData.functionArity !== undefined) {
											if (prevToken?.charType !== CharLevelState.lB) {
												if (poppedData.functionArity !== undefined) {
													poppedData.functionArity++;
													const functionName = poppedData.function.value;
													const isRegexGroup = functionName === 'regex-group';
													if (insideGlobalFunction && (isRegexGroup || functionName === 'current-merge-group') && poppedData.functionArity === 1) {
														const contextInstruction = isRegexGroup ? 'xsl:matching-substring' : 'xsl:merge-action';
														const elementContextOK = elementStack.find((item) => item.symbolName === contextInstruction);
														if (!elementContextOK) {
															poppedData.function.error = isRegexGroup ? ErrorType.MissingContextItemForRegex : ErrorType.MissingContextItemForMerge;
															if (prevToken?.tokenType) {
																const prevToken2 = allTokens[index - 2];
																if (prevToken2.charType === CharLevelState.lB) {
																	poppedData.function.value = functionName + `(${prevToken.value})`;
																} else {
																	const startPos = new vscode.Position(poppedData.function.line, poppedData.function.startCharacter + poppedData.function.length);
																	const endPos = new vscode.Position(token.line, token.startCharacter);
																	const argString = document.getText(new vscode.Range(startPos, endPos));
																	poppedData.function.value = functionName + `(${argString})`;
																}
															}
															regexSpecial = true;
															problemTokens.push(poppedData.function);
														}
													}
												}
											}
											if (!regexSpecial) {
												let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(docType, inheritedPrefixes, xsltPrefixesToURIs, poppedData.function, checkedGlobalFnNames, poppedData.functionArity);
												if (!isValid) {
													poppedData.function['error'] = fErrorType;
													poppedData.function['value'] = qFunctionName;
													problemTokens.push(poppedData.function);
												}
											}
										}
									} else {
										inScopeXPathVariablesList = [];
										preXPathVariable = false;
										xpathVariableCurrentlyBeingDefined = false;
									}
								}
								if (token.error && !isXPathError) {
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
										let nonBracketedThen = -1;
										for (let i = xpathStack.length - 1; i > -1; i--) {
											const xpathItem = xpathStack[i].token;
											const val = xpathItem.value;
											if (!(val === 'return' || val === 'else' || val === 'satisfies' || val === 'then')) {
												break;
											} else if (val === 'then') {
												nonBracketedThen = i;
											}
										}
										if (nonBracketedThen > -1) {
											//xpathStack.splice(nonBracketedThen, 1);
											token['error'] = ErrorType.ExpectedElseAfterThen;
											problemTokens.push(token);
										}
										const sv = xp.token.value;
										if (sv === 'return' || sv === 'else' || sv === 'satisfies') {
											let poppedData = xpathStack.pop();
											if (poppedData) {
												inScopeXPathVariablesList = poppedData.variables;
												if (sv === 'else') {
													preXPathVariable = poppedData.preXPathVariable;
												} else {
													// todo: if after a return AND a ',' prePathVariable = true; see $pos := $c.
													preXPathVariable = false;
												}
												xpathVariableCurrentlyBeingDefined = false;
											}
										}
									}
									xpathVariableCurrentlyBeingDefined = false;
								}
								break;
							case CharLevelState.dSep:
								const isEmptyBracketsToken = token.value === '()';
								if (isEmptyBracketsToken && prevToken?.tokenType === TokenLevelState.function) {
									const fnArity = incrementFunctionArity ? 1 : 0;
									incrementFunctionArity = false;
									let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(docType, inheritedPrefixes, xsltPrefixesToURIs, prevToken, checkedGlobalFnNames, fnArity);
									if (!isValid) {
										prevToken['error'] = fErrorType;
										prevToken['value'] = qFunctionName;
										problemTokens.push(prevToken);
									} else if (fnArity === 0) {
										const isCurrentFunction = prevToken.value === 'current';
										if (!isGroupingAttribute && !XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction, isCurrentFunction)) {
											if (FunctionData.contextFunctions.indexOf(prevToken.value) > -1) {
												const prevToken2 = allTokens[index - 2];
												if (isCurrentFunction) {
													prevToken.error = ErrorType.MissingContextItemForCurrent;
													prevToken.value += '()';
													problemTokens.push(prevToken);
												} else if (!(prevToken2.value === '/' || prevToken2.value === '!' || prevToken2.value === '//')) {
													let newTokenError = ErrorType.MissingContextItemForFn;
													const fnName = prevToken.value;
													if (fnName === 'position') {
														newTokenError = ErrorType.MissingContextItemForPosition;
													} else if (fnName === 'last') {
														newTokenError = ErrorType.MissingContextItemForLast;
													}
													prevToken.error = newTokenError;
													prevToken.value += '()';
													problemTokens.push(prevToken);
												}
											} else if (FunctionData.contextGroupingFunctions.indexOf(prevToken.value) > -1) {
												prevToken.error = ErrorType.MissingContextItemForGrouping;
												prevToken.value += '()';
												problemTokens.push(prevToken);
											} else if (insideGlobalFunction) {
												if (prevToken.value === 'current-merge-key' || prevToken.value === 'current-merge-group') {
													if (!elementStack.find((es) => es.symbolName === 'xsl:merge-action')) {
														prevToken.error = ErrorType.MissingContextItemForMerge;
														prevToken.value += '()';
														problemTokens.push(prevToken);
													}
												}
											}
										}
									}
								} else if (isEmptyBracketsToken && prevToken?.tokenType === TokenLevelState.variable) {
									// TODO: check arity of variable of type 'function'
									incrementFunctionArity = false;
								} else if (isEmptyBracketsToken && prevToken?.tokenType === TokenLevelState.complexExpression && prevToken.value === 'if') {
									token.error = ErrorType.XPathConditionExpected;
									problemTokens.push(token);
								} else if (isEmptyBracketsToken && prevToken?.tokenType === TokenLevelState.anonymousFunction) {
									const nexttoken = XsltTokenDiagnostics.nextNonCommentToken(allTokens, index);
									if (nexttoken && nexttoken.value.charAt(0) !== '{') {
										prevToken.error = ErrorType.AnonymousFunctionSyntax;
										problemTokens.push(prevToken);
									}
								} else if (isEmptyBracketsToken && prevToken?.charType === CharLevelState.dSep && prevToken.value === '()') {
									const prevToken2 = XsltTokenDiagnostics.prevNonCommentToken(allTokens, index - 1);
									let isError = false;
									if (prevToken2) {
										if (prevToken2.tokenType === TokenLevelState.function) {
											const v2 = prevToken2.value;
											// current() is only built-in fn that may return a function:
											isError = !v2.includes(':') && v2 !== 'current';
										}
									}
									if (isError) {
										token.error = ErrorType.XPathUnexpected;
										problemTokens.push(token);
									}
								} else if (token.value === '=>') {
									incrementFunctionArity = true;
								}
								break;
						}
						break;
					case TokenLevelState.nodeType:
						if (token.value === ':*' && prevToken && !prevToken.error) {
							let pfx = prevToken.tokenType === TokenLevelState.attributeNameTest ? prevToken.value.substring(1) : prevToken.value;
							if (inheritedPrefixes.indexOf(pfx) === -1 && pfx !== 'xml') {
								prevToken['error'] = ErrorType.XPathPrefix;
								problemTokens.push(prevToken);
							}
						} else if (prevToken && insideGlobalFunction && !isGroupingAttribute) {
							const prevToken2 = allTokens[index - 2];
							if (!isGroupingAttribute && !XsltTokenDiagnostics.isRequiredNodeTypeContext(prevToken, prevToken2) && !XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction)) {
								if (!(token.value === '?' || token.value === '+' || (token.value === '*' && prevToken.value === ')' || prevToken.value === '()'))) {
									token.error = ErrorType.MissingContextItemGeneral;
									problemTokens.push(token);
								}
							}
						}
						break;
					case TokenLevelState.attributeNameTest:
					case TokenLevelState.nodeNameTest:
					case TokenLevelState.mapNameLookup:
						if (token.error && token.error !== ErrorType.XPathIfAwaitingThen) {
							problemTokens.push(token);
						} else {
							let tokenValue;
							let validationType;
							let skipValidation = false;
							if (xpathTokenType !== TokenLevelState.attributeNameTest) {
								tokenValue = token.value;
								validationType = ValidationType.PrefixedName;
							} else {
								tokenValue = token.value;
								validationType = ValidationType.AttributeNameTest;
								skipValidation = token.value === '@xml' || token.value === '@*';
							}
							if (!skipValidation) skipValidation = xpathTokenType === TokenLevelState.mapNameLookup && xpathCharType === CharLevelState.sep; // for '*' lookup
							if (!skipValidation) {
								let validateResult = XsltTokenDiagnostics.validateName(tokenValue, validationType, docType, inheritedPrefixes);
								if (validateResult !== NameValidationError.None) {
									token['error'] = validateResult === NameValidationError.NameError ? ErrorType.XPathName : ErrorType.XPathPrefix;
									token['value'] = token.value;
									token['tagElementId'] = tagElementId;
									problemTokens.push(token);
								}
							}
						}
						XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
						break;
					case TokenLevelState.functionNameTest:
						let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(docType, inheritedPrefixes, xsltPrefixesToURIs, token, checkedGlobalFnNames);
						if (!isValid) {
							token['error'] = fErrorType;
							token['value'] = qFunctionName;
							problemTokens.push(token);
						}
						break;
					case TokenLevelState.function:
					case TokenLevelState.number:
						XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
						break;
					case TokenLevelState.simpleType:
						let tValue = token.value;
						let tParts = tValue.split(':');
						let isValidType = false;
						if (tValue === '*' || tValue === '?' || tValue === '+') {
							// e.g. xs:integer* don't check name
							isValidType = true;
						} else if (tParts.length === 1) {
							let nextToken = allTokens.length > index + 1 ? allTokens[index + 1] : null;

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
									if (tParts[1] === 'numeric') {
										isValidType = true;
									} else {
										isValidType = FunctionData.schema.indexOf(tParts[1] + '#1') > -1;
									}
								}
							}
						}
						if (!isValidType) {
							token['error'] = ErrorType.XPathTypeName;
							problemTokens.push(token);
						}
						break;
					case TokenLevelState.entityRef:
						if (token.error) {
							problemTokens.push(token);
						} else {
							let validationResult, entityName;
							({ validationResult, entityName } = XsltTokenDiagnostics.validateEntityRef(token.value, dtdEnded, inheritedPrefixes));
							if (validationResult !== NameValidationError.None) {
								token['error'] = ErrorType.EntityName;
								token['value'] = entityName;
								problemTokens.push(token);
							}
						}
						break;
				}
				if (index === lastTokenIndex && !token.error) {
					if (token.tokenType === TokenLevelState.operator) {
						XsltTokenDiagnostics.checkFinalXPathToken(token, allTokens, index, problemTokens);
					}
					if (xpathStack.length > 0 && !token.error) {
						let disallowedStackItem: BaseToken | undefined;
						for (let index = xpathStack.length - 1; index > -1; index--) {
							const trailingToken = xpathStack[index].token;
							const tv = trailingToken.value;
							const allowedToken = (tv === 'return' || tv === 'else' || tv === 'satisfies');
							if (!allowedToken) {
								disallowedStackItem = trailingToken;
								break;
							}
						}
						if (disallowedStackItem) {
							disallowedStackItem['error'] = ErrorType.BracketNesting;
							problemTokens.push(disallowedStackItem);
						}
					}
					if (token.tokenType === TokenLevelState.string && !token.error) {
						XPathLexer.checkStringLiteralEnd(token);
						if (token.error) {
							problemTokens.push(token);
						}

					}
				}
				if (!token.error && prevToken?.charType === CharLevelState.dSep && prevToken.value === '=>') {
					let isValid = false;
					if (xpathCharType === CharLevelState.lB || xpathTokenType === TokenLevelState.function) {
						isValid = true;
					} else if (xpathTokenType === TokenLevelState.variable) {
						if (allTokens.length > index + 2) {
							const nextToken = allTokens[index + 1];
							isValid = (nextToken.charType === CharLevelState.lB || (nextToken.charType === CharLevelState.dSep) && nextToken.value === '()');
						}
					}
					if (!isValid) {
						token['error'] = ErrorType.FunctionAfterArrowOp;
						problemTokens.push(token);
					}
				}
			}
			prevToken = token.tokenType === TokenLevelState.comment ? prevToken : token;
			if (index === lastTokenIndex) {
				// xml is not well-nested if items still on the stack at the end
				// but report errors and try to keep some part of the tree:
				if (token.tokenType === TokenLevelState.complexExpression) {
					token['error'] = ErrorType.XPathAwaiting;
					problemTokens.push(token);
				}
				if (elementStack.length > 0) {
					let usedtoken = false;
					while (elementStack.length > 0) {
						if (tagElementName === 'xsl:function') insideGlobalFunction = false;
						let poppedData = elementStack.pop()!;
						inheritedPrefixes = poppedData.namespacePrefixes;
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
			}
		});
		let variableRefDiagnostics = XsltTokenDiagnostics.getDiagnosticsFromUnusedVariableTokens(document, xsltVariableDeclarations, unresolvedXsltVariableReferences, includeOrImport);
		let allDiagnostics = XsltTokenDiagnostics.appendDiagnosticsFromProblemTokens(variableRefDiagnostics, problemTokens);
		return allDiagnostics;
	};

	private static addProblemIfMissingContextSC(insideGlobalFunction: boolean, tagElementName: string, tagAttributeSymbols: vscode.DocumentSymbol[], elementStack: ElementData[], xpathStack: XPathData[], startTagToken: XSLTToken, problemTokens: BaseToken[]) {
		if (insideGlobalFunction && (tagElementName === 'xsl:copy' || tagElementName === 'xsl:apply-templates')) {
			const selectAttr = tagAttributeSymbols.find((item) => item.name === 'select');
			if (!selectAttr && !XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction)) {
				const instrToken = startTagToken;
				instrToken.value = tagElementName;
				instrToken.error = ErrorType.MissingContextItemForInstr;
				problemTokens.push(instrToken);
			}
		}
	}

	private static addProblemIfMissingContext(insideGlobalFunction: boolean, tagElementName: string, poppedData: ElementData, elementStack: ElementData[], xpathStack: XPathData[], problemTokens: BaseToken[]) {
		if (insideGlobalFunction && (tagElementName === 'xsl:copy' || tagElementName === 'xsl:apply-templates')) {
			const attributes = poppedData.childSymbols.find((item) => item.kind === vscode.SymbolKind.Array && item.name === 'attributes');
			const selectAttr = attributes ? attributes.children.find((item) => item.name === 'select') : undefined;
			if (!selectAttr && !XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction)) {
				const instrToken = poppedData.identifierToken;
				instrToken.value = tagElementName;
				instrToken.error = ErrorType.MissingContextItemForInstr;
				problemTokens.push(instrToken);
			}
		}
	}

	private static addCallTemplateProbIfMissingContext(insideGlobalFunction: boolean, instrToken: XSLTToken, tagElementName: string, elementStack: ElementData[], xpathStack: XPathData[], problemTokens: BaseToken[]) {
		if (insideGlobalFunction && tagElementName === 'xsl:call-template') {
			if (!XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction)) {
				instrToken.value = tagElementName;
				instrToken.error = ErrorType.MissingContextItemForCallTemplate;
				problemTokens.push(instrToken);
			}
		}
	}

	private static contextItemExists(elementStack: ElementData[], xpathStack: XPathData[], insideGlobalFunction: boolean, forFunctionNamedCurrent = false) {
		if (!insideGlobalFunction) return true;

		const foundForEach = elementStack.find((item) => item.symbolName === 'xsl:for-each' || item.symbolName === 'xsl:for-each-group' ||
			item.symbolName === 'xsl:source-document' || item.symbolName === 'xsl:merge-source' ||
			item.symbolName === 'xsl:iterate' || item.symbolName === 'xsl:copy' || item.symbolName === 'xsl:analyze-string' || item.symbolName === 'xsl:perform-sort');
		if (foundForEach) return true;
		let foundContextBracketsOrPredicate: boolean;
		if (forFunctionNamedCurrent) {
			// need to ignore predicates from xpath stack
			foundContextBracketsOrPredicate = !!xpathStack.find((item) => item.token.charType !== CharLevelState.lPr && item.hasContextItem === true);
		} else {
			foundContextBracketsOrPredicate = !!xpathStack.find((item) => item.hasContextItem === true);
		}
		return foundContextBracketsOrPredicate;
	}

	private static providesContext(token: BaseToken) {
		const result =
			token.tokenType === TokenLevelState.attributeNameTest ||
			token.tokenType === TokenLevelState.nodeNameTest ||
			token.tokenType === TokenLevelState.nodeType ||
			token.tokenType === TokenLevelState.variable ||
			token.tokenType === TokenLevelState.mapNameLookup ||
			token.charType === CharLevelState.rB ||
			token.charType === CharLevelState.rPr ||
			(
				token.charType === CharLevelState.dSep && (token.value === '()' || token.value === '//')
			) ||
			(token.charType === CharLevelState.sep && token.value === '/');
		return result;
	}

	private static isRequiredNodeTypeContext(token: BaseToken, prevToken: BaseToken) {
		let result =
			(token.tokenType === TokenLevelState.nodeType) || // for case of text() - the () is a second nodeType token following the first
			(token.tokenType === TokenLevelState.attributeNameTest && token.value === '@') ||
			(token.charType === CharLevelState.dSep && (token.value === '::' || token.value === '//')) ||
			(token.charType === CharLevelState.sep && (token.value === '/' || token.value === '!'));
		if (!result) result = prevToken.tokenType === TokenLevelState.operator && prevToken.value === 'instance' && token.tokenType === TokenLevelState.operator && token.value === 'of';
		return result;
	}

	public static checkFinalXPathToken(prevToken: BaseToken, allTokens: BaseToken[], index: number, problemTokens: BaseToken[]) {
		let isValid = false;
		switch (prevToken.charType) {
			case CharLevelState.rB:
			case CharLevelState.rBr:
			case CharLevelState.rPr:
				isValid = true;
				break;
			case CharLevelState.dSep:
				isValid = prevToken.value === '()' || prevToken.value === '[]' || prevToken.value === '{}';
				break;
			default:
				if (prevToken.value === '%') {
					isValid = true;
				} else if (prevToken.value === '/' || prevToken.value === '.') {
					// these are ok provided that the previous token was XSLT or previous token was ,;
					let prevToken2 = allTokens[index - 2];
					let tokenBeforePrevWasXSLT = prevToken2.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
					isValid = tokenBeforePrevWasXSLT || (
						prevToken2.tokenType === TokenLevelState.operator &&
						prevToken2.charType !== CharLevelState.rB &&
						prevToken2.charType !== CharLevelState.rBr &&
						prevToken2.charType !== CharLevelState.rPr
					);
				}
				break;
		}
		if (!isValid) {
			prevToken['error'] = ErrorType.XPathOperatorUnexpected;
			problemTokens.push(prevToken);
		}
	}

	public static getExpectedElementNames(parentName: string, schemaQuery: SchemaQuery | undefined, elementStack: ElementData[]) {
		let expectedElements: string[] = [];
		let expectedAttributes: string[] = [];

		if (schemaQuery?.docType === DocumentTypes.DCP ||
			(parentName.startsWith('xsl:') && schemaQuery && schemaQuery.docType === DocumentTypes.XSLT) ||
			(parentName.startsWith('sch:') && schemaQuery && schemaQuery.docType === DocumentTypes.SCH)) {
			const allExpected = schemaQuery.getExpected(parentName);
			const nameDetailArray = allExpected.elements;
			expectedElements = nameDetailArray.map(item => item[0]);
			expectedAttributes = allExpected.attrs;
		} else if (elementStack.length > 0) {
			expectedElements = elementStack[elementStack.length - 1].expectedChildElements;
		} else {
			expectedElements = [];
		}
		return [expectedElements, expectedAttributes];
	}

	private static validateEntityRef(entityName: string, dtdEnded: boolean, inheritedPrefixes: string[]) {
		let validationResult = NameValidationError.None;
		if (entityName.length > 2 && entityName.endsWith(';')) {
			entityName = entityName.substring(1, entityName.length - 1);
			if (entityName.length > 1 && entityName.charAt(0) === '#') {
				let validNumber;
				if (entityName.charAt(1).toLocaleLowerCase() === 'x') {
					validNumber = /^#[Xx][0-9a-fA-F]+$/.test(entityName);
				} else {
					validNumber = /^#[0-9]+$/.test(entityName);
				}
				validationResult = validNumber ? NameValidationError.None : NameValidationError.NameError;
			} else if (!dtdEnded) {
				let isXmlChar = XsltTokenDiagnostics.xmlChars.indexOf(entityName) > -1;
				validationResult = isXmlChar ? NameValidationError.None : NameValidationError.NameError;
			} else {
				validationResult = XsltTokenDiagnostics.validateName(entityName, ValidationType.Name, DocumentTypes.Other, inheritedPrefixes);
			}
		} else {
			validationResult = NameValidationError.NameError;
		}
		return { validationResult, entityName };
	}

	private static checkTokenIsExpected(prevToken: BaseToken | null, token: BaseToken, problemTokens: BaseToken[], overridType?: TokenLevelState) {
		if (token.error) {
			return;
		}
		let tokenType = overridType ? overridType : token.tokenType;
		let errorSingleSeparators: string[];
		if (tokenType === TokenLevelState.number) {
			errorSingleSeparators = ['|'];
		} else if (tokenType === TokenLevelState.string) {
			errorSingleSeparators = ['|', '+', '-', '*'];
		} else {
			errorSingleSeparators = [];
		}
		let errDoubleSeparators;
		if (tokenType === TokenLevelState.nodeNameTest) {
			errDoubleSeparators = ['{}', '[]', '()'];
		} else if (tokenType === TokenLevelState.number || tokenType === TokenLevelState.string) {
			errDoubleSeparators = ['{}', '[]', '()', '*:', '::', '//'];
		} else {
			errDoubleSeparators = ['{}', '[]', '()', '*:', '::'];
		}
		if (prevToken) {
			let isXMLToken = prevToken.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber;
			if (!isXMLToken) {
				let isXPathError = false;
				if (prevToken.tokenType === TokenLevelState.complexExpression || prevToken.tokenType === TokenLevelState.entityRef) {
					// no error
				} else if (prevToken.tokenType === TokenLevelState.uriLiteral && tokenType !== TokenLevelState.nodeNameTest) {
					isXPathError = true;
				} else if (prevToken.tokenType === TokenLevelState.operator) {
					if (prevToken.charType === CharLevelState.rB || prevToken.charType === CharLevelState.rPr || prevToken.charType === CharLevelState.rPr) {
						isXPathError = true;
					}
					else if (prevToken.charType === CharLevelState.dSep) {
						if (errDoubleSeparators.indexOf(prevToken.value) !== -1) {
							isXPathError = true;
						}
					} else if (prevToken.charType === CharLevelState.sep) {
						if (errorSingleSeparators.indexOf(prevToken.value) !== -1) {
							isXPathError = true;
						}
					}
				}
				else if (tokenType === TokenLevelState.nodeNameTest && prevToken.tokenType === TokenLevelState.uriLiteral) {
					// no error
				} else if (tokenType === TokenLevelState.string && prevToken.tokenType === TokenLevelState.string) {
					const currentTokenFirstChar = token.value.charAt(0);
					if (currentTokenFirstChar === '"' || currentTokenFirstChar === '\'') {
						isXPathError = true;
					}
				} else {
					isXPathError = true;
				}
				if (isXPathError) {
					let errType: ErrorType = tokenType === TokenLevelState.function ? ErrorType.XPathFunctionUnexpected : ErrorType.XPathUnexpected;
					token.error = errType;
					problemTokens.push(token);
				}
			}
		}
	}

	private static validateXMLDeclaration(lineNumber: number, token: BaseToken, document: vscode.TextDocument, problemTokens: BaseToken[]) {
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

	public static isValidFunctionName(docType: DocumentTypes, xmlnsPrefixes: string[], xmlnsData: Map<string, XSLTnamespaces>, token: BaseToken, checkedGlobalFnNames: string[], arity?: number) {
		const useXPath40 = docType === DocumentTypes.XSLT40;
		let isParseHTMLFnWarning = false;
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
			if (tokenValue === 'concat' || tokenValue === 'codepoints-to-string') {
				isValid = arity > 0;
			} else if (useXPath40) {
				isValid = FunctionData.xpath40.indexOf(fNameParts[0]) > -1;
				if (isValid) {
					isParseHTMLFnWarning = tokenValue === 'parse-html';
				}
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
			} else if (useXPath40) {
				switch (xsltType) {
					case XSLTnamespaces.XPath:
						if (tokenValue.endsWith(':concat') || tokenValue.endsWith(':codepoints-to-string')) {
							isValid = arity > 0;
						} else {
							isValid = FunctionData.xpath40.indexOf(fNameParts[1]) > -1;
						}
						if (isValid) {
							isParseHTMLFnWarning = tokenValue.endsWith(':parse-html');
						}
						break;
					case XSLTnamespaces.Array:
						if (tokenValue.endsWith(':members') || tokenValue.endsWith(':of')) {
							isValid = arity > 0;
						} else {
							isValid = FunctionData.array40.indexOf(fNameParts[1]) > -1;
						}
						break;
					case XSLTnamespaces.Map:
						isValid = FunctionData.map40.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Math:
						isValid = FunctionData.math.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.SQL:
						isValid = FunctionData.sql.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.XMLSchema:
						isValid = FunctionData.schema.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.IXSL:
						isValid = FunctionData.ixsl.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Saxon:
					case XSLTnamespaces.ExpathArchive:
					case XSLTnamespaces.ExpathBinary:
					case XSLTnamespaces.ExpathFile:
					case XSLTnamespaces.Exslt:
					case XSLTnamespaces.ExsltMath:
					case XSLTnamespaces.ExsltRegex:
					case XSLTnamespaces.ExsltSets:
					case XSLTnamespaces.ExsltStrings:
						isValid = true;
						break;
				}
			} else {
				switch (xsltType) {
					case XSLTnamespaces.XPath:
						if (tokenValue.endsWith(':concat') || tokenValue.endsWith(':codepoints-to-string')) {
							isValid = arity > 0;
						} else {
							isValid = FunctionData.xpath40.indexOf(fNameParts[1]) > -1;
						}
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
					case XSLTnamespaces.SQL:
						isValid = FunctionData.sql.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.XMLSchema:
						isValid = FunctionData.schema.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.IXSL:
						isValid = FunctionData.ixsl.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Saxon:
					case XSLTnamespaces.ExpathArchive:
					case XSLTnamespaces.ExpathBinary:
					case XSLTnamespaces.ExpathFile:
					case XSLTnamespaces.Exslt:
					case XSLTnamespaces.ExsltMath:
					case XSLTnamespaces.ExsltRegex:
					case XSLTnamespaces.ExsltSets:
					case XSLTnamespaces.ExsltStrings:
						isValid = true;
						break;
				}
			}
		}
		if (isParseHTMLFnWarning) {
			isParseHTMLFnWarning = !XsltTokenDiagnostics.isHtmlParserJarSet;
			isValid = !isParseHTMLFnWarning;
		}
		fErrorType = isParseHTMLFnWarning ? ErrorType.XPathFunctionParseHtml : isValid ? ErrorType.None : fErrorType;
		if (!isValid && (fErrorType === ErrorType.XPathFunction || fErrorType === ErrorType.XPathFunctionNamespace) && tokenValue.startsWith('ext:print')) {
			fErrorType = ErrorType.XPathFunctionExternalPrint;
		}
		return { isValid, qFunctionName, fErrorType };
	}

	public static getTextForToken(lineNumber: number, token: BaseToken, document: vscode.TextDocument) {
		let start = token.startCharacter;
		if (start < 0) {
			console.error("ERROR: Found illegal token for document: " + document.fileName);
			console.error("token.startCharacter less than zero: " + token.startCharacter);
			console.error(token);
			start = 0;
		}

		let startPos = new vscode.Position(lineNumber, start);
		let endPos = new vscode.Position(lineNumber, start + token.length);
		const currentLine = document.lineAt(lineNumber);
		let valueRange = currentLine.range.with(startPos, endPos);
		let valueText = document.getText(valueRange);
		return valueText;
	}

	public static resolveXPathVariableReference(globalVarName: string | null, document: vscode.TextDocument, importedVariables: string[], token: BaseToken, xpathVariableCurrentlyBeingDefined: boolean, inScopeXPathVariablesList: VariableData[],
		xpathStack: XPathData[], inScopeVariablesList: VariableData[], elementStack: ElementData[]): BaseToken | null {
		let fullVarName = XsltTokenDiagnostics.getTextForToken(token.line, token, document);
		let varName = fullVarName.startsWith('$') ? fullVarName.substring(1) : fullVarName.substring(1, fullVarName.length - 1);
		let result: BaseToken | null = null;
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
				// don't asign
			} else {
				resolved = this.resolveStackVariableName(elementStack, varName);
			}
		}
		let importedResolved = false;
		if (!resolved) {
			importedResolved = globalVarName !== varName && importedVariables.indexOf(varName) > -1;
		}
		if (!resolved && !importedResolved) {
			result = token;
		}
		return result;
	}

	public static getXPathVariableDefnToken(globalVarName: string | null, document: vscode.TextDocument, importedVariables: string[], token: BaseToken, xpathVariableCurrentlyBeingDefined: boolean, inScopeXPathVariablesList: VariableData[],
		xpathStack: XPathData[], inScopeVariablesList: VariableData[], elementStack: ElementData[]) {
		let fullVarName = XsltTokenDiagnostics.getTextForToken(token.line, token, document);
		let varName = fullVarName.startsWith('$') ? fullVarName.substring(1) : fullVarName.substring(1, fullVarName.length - 1);
		let result: BaseToken | undefined;
		let globalVariable = null;

		result = this.resolveVariableName(inScopeXPathVariablesList, varName, xpathVariableCurrentlyBeingDefined, globalVariable);
		if (!result) {
			result = this.resolveStackVariableName(xpathStack, varName);
		}
		if (!result) {
			result = this.resolveVariableName(inScopeVariablesList, varName, false, globalVariable);
		}
		if (!result) {
			if (elementStack.length === 1 && globalVarName === varName) {
				// don't assign
			} else {
				result = this.resolveStackVariableName(elementStack, varName);
			}
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
				kind = vscode.SymbolKind.Module;
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
						kind = vscode.SymbolKind.Object;
						break;
					case 'xsl:value-of':
					case 'xsl:text':
						kind = vscode.SymbolKind.String;
						break;
					case 'xsl:for-each':
					case 'xsl:for-each-group':
					case 'xsl:apply-templates':
					case 'xsl:iterate':
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
		let startCharPos = fullStartToken.startCharacter > 0 ? fullStartToken.startCharacter - 1 : 0;
		let startPos = new vscode.Position(fullStartToken.line, startCharPos);
		let endPos = new vscode.Position(fullEndToken.line, fullEndToken.startCharacter + fullEndToken.length);
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
			innerEndPos = new vscode.Position(fullStartToken.line, fullStartToken.startCharacter + fullStartToken.length);
			innerRange = new vscode.Range(innerStartPos, innerEndPos);
		}
		let detail = '';
		let fullSymbolName = id.length > 0 ? name + ' \u203A ' + id : name;

		if (fullRange.contains(innerRange)) {
			return new vscode.DocumentSymbol(fullSymbolName, detail, kind, fullRange, innerRange);
		} else {
			return null;
		}
	}

	public static createSymbolForAttribute(innerToken: BaseToken, attrName: string) {
		const startPos = new vscode.Position(innerToken.line, innerToken.startCharacter);
		const endPos = new vscode.Position(innerToken.line, innerToken.startCharacter + innerToken.length);
		const range = new vscode.Range(startPos, endPos);
		const detail = '';
		return new vscode.DocumentSymbol(attrName, detail, vscode.SymbolKind.Field, range, range);
	}

	public static initChildrenSymbols(attrSymbols: vscode.DocumentSymbol[]) {
		if (attrSymbols.length === 0) {
			return [];
		}
		const startPos = new vscode.Position(attrSymbols[0].range.start.line, attrSymbols[0].range.start.character);
		const endPos = new vscode.Position(attrSymbols[attrSymbols.length - 1].range.end.line, attrSymbols[attrSymbols.length - 1].range.end.character);
		const range = new vscode.Range(startPos, endPos);
		const detail = '';
		const attrSymbol = new vscode.DocumentSymbol('attributes', detail, vscode.SymbolKind.Array, range, range);
		attrSymbol.children = attrSymbols;
		return [attrSymbol];
	}

	public static resolveVariableName(variableList: VariableData[], varName: string, xpathVariableCurrentlyBeingDefined: boolean, globalXsltVariable: VariableData | null) {
		let resolved = false;
		let decrementedLength = variableList.length - 1;
		let globalVariableName = globalXsltVariable?.name;
		let defnData: VariableData | undefined = undefined;
		// last items in list of declared parameters must be resolved first:
		for (let i = decrementedLength; i > -1; i--) {
			let data = variableList[i];
			if (xpathVariableCurrentlyBeingDefined && i === decrementedLength) {
				// do nothing: we skip last item in list as it's currently being defined
			} else if (data.name === varName && globalVariableName !== data.name) {
				defnData = data;
				data.token['referenced'] = true;
				break;
			}
		}
		return defnData?.token;
	}

	public static resolveStackVariableName(elementStack: ElementData[] | XPathData[], varName: string) {
		let resolvedDefnToken: BaseToken | undefined;
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
			resolvedDefnToken = this.resolveVariableName(inheritedVariables, varName, xpathBeingDefined, globalXsltVariable);
			if (resolvedDefnToken) {
				break;
			}
		}
		return resolvedDefnToken;
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

	private static nextNonCommentToken(allTokens: BaseToken[], index: number) {
		let item: BaseToken | undefined;
		for (let i = index + 1; i < allTokens.length; i++) {
			const newItem = allTokens[i];
			if (newItem.tokenType !== TokenLevelState.comment) {
				item = newItem;
				break;
			}
		}
		return item;
	}

	private static prevNonCommentToken(allTokens: BaseToken[], index: number) {
		let item: BaseToken | undefined;
		for (let i = index - 1; i > 0; i--) {
			const newItem = allTokens[i];
			if (newItem.tokenType !== TokenLevelState.comment) {
				item = newItem;
				break;
			}
		}
		return item;
	}

	private static appendDiagnosticsFromProblemTokens(variableRefDiagnostics: vscode.Diagnostic[], tokens: BaseToken[]): vscode.Diagnostic[] {
		tokens.forEach(token => {
			let line = token.line;
			let endChar = token.startCharacter + token.length;
			let tokenValue = token.value;
			let msg: string;
			let diagnosticMetadata: vscode.DiagnosticTag[] = [];
			let severity = vscode.DiagnosticSeverity.Error;
			let errCode = DiagnosticCode.none;
			let isFunctionContextProblem = false;
			switch (token.error) {
				case ErrorType.AxisName:
					msg = `XPath: Invalid axis name: '${tokenValue}`;
					break;
				case ErrorType.BracketNesting:
					let matchingChar: any = XsltTokenDiagnostics.getMatchingSymbol(tokenValue);
					msg = matchingChar.length === 0 ? `XPath: No match found for '${tokenValue}'` : `'${tokenValue}' has no matching '${matchingChar}'`;
					diagnosticMetadata = [vscode.DiagnosticTag.Unnecessary];
					break;
				case ErrorType.ElementNesting:
					msg = `XML: Start tag '${tokenValue}' has no matching close tag`;
					break;
				case ErrorType.ExpectedElseAfterThen:
					msg = `XML: Expected 'else' but found '${tokenValue}'`;
					break;
				case ErrorType.ExpectedDollarAfterComma:
					msg = `XML: Expected '$' but found '${tokenValue}'`;
					break;
				case ErrorType.EntityName:
					msg = `XML: Invalid entity name '${tokenValue}'`;
					break;
				case ErrorType.MultiRoot:
					msg = 'XML: More than one root element';
					break;
				case ErrorType.ProcessingInstructionName:
					msg = `XML: Invalid processing instruction name: '${tokenValue}`;
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
				case ErrorType.XMLNameList:
					let nameParts = tokenValue.split(' ');
					msg = `XSLT: Expected list of valid names (with declared prefixes) in '${nameParts[0]}' but found ${nameParts[1]}`;
					break;
				case ErrorType.XMLRootMissing:
					msg = `XML: Root element is missing`;
					break;
				case ErrorType.XSLTName:
					msg = `XSLT: Invalid XSLT name: '${tokenValue}'`;
					break;
				case ErrorType.XSLTInstrUnexpected:
					msg = `XSLT: instruction: ${tokenValue} not valid in this context`;
					break;
				case ErrorType.DuplicateParameterName:
					msg = `XSLT: Duplicate parameter name: '${tokenValue}'`;
					break;
				case ErrorType.MissingTemplateParam:
					let pParts = tokenValue.split('#');
					msg = `XSLT: xsl:param '${pParts[1]}' is not declared for template '${pParts[0]}'`;
					break;
				case ErrorType.XMLAttributeValueUnexpected:
					let aParts = tokenValue.split('!');
					msg = `ATTRIBUTE: value '${aParts[0]}' is invalid for attribute '${aParts[1]}' - expected values: ${aParts[2]}`;
					break;
				case ErrorType.IterateParamInvalid:
					msg = `XSLT: param name '${tokenValue}' in xsl:with-param is not declared in parent xsl:instruction:`;
					break;
				case ErrorType.TemplateNameUnresolved:
					msg = `XSLT: xsl:template with name '${tokenValue}' not found`;
					break;
				case ErrorType.XSLTFunctionNamePrefix:
					errCode = DiagnosticCode.unresolvedGenericRef;
					msg = `XSLT: missing namespace prefox in xsl:function name '${tokenValue}'`;
					break;
				case ErrorType.AttributeSetUnresolved:
					errCode = DiagnosticCode.unresolvedGenericRef;
					msg = `XSLT: xsl:attribute-set with name '${tokenValue}' not found`;
					break;
				case ErrorType.MissingPrefixInList:
					errCode = DiagnosticCode.unresolvedGenericRef;
					msg = `XSLT: Namespace prefix '${tokenValue}' is not declared`;
					break;
				case ErrorType.XSLTKeyUnresolved:
					errCode = DiagnosticCode.unresolvedGenericRef;
					msg = `XSLT: xsl:key declaration with name '${tokenValue}' not found`;
					break;
				case ErrorType.AccumulatorNameUnresolved:
					errCode = DiagnosticCode.unresolvedGenericRef;
					msg = `XSLT: xsl:accumulator with name '${tokenValue}' not found`;
					break;
				case ErrorType.TemplateModeUnresolved:
					msg = `XSLT: Template mode '${tokenValue}' not used`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				case ErrorType.ParentLessText:
					msg = `XML: Text found outside root element: '${tokenValue}`;
					break;
				case ErrorType.XSLTNamesapce:
					msg = `Expected on the root element: xmlns:xsl='http://www.w3.org/1999/XSL/Transform' prefix/namespace-uri binding`;
					break;
				case ErrorType.XSLTPrefix:
					msg = `XSLT: Undeclared prefix in name: '${tokenValue}'`;
					break;
				case ErrorType.XMLDeclaration:
					msg = `XML: Invalid content in XML declaration: '${tokenValue}'`;
					break;
				case ErrorType.XPathUnexpected:
					msg = `XPath: Expression context - unexpected token here: ${tokenValue} `;
					break;
				case ErrorType.XPathFunctionUnexpected:
					msg = `XPath: Unexpected function after expression: '${tokenValue}()' `;
					break;
				case ErrorType.FunctionAfterArrowOp:
					msg = `XPath: Expected function after arrow operator`;
					break;
				case ErrorType.XPathEmpty:
					msg = 'XSLT: Expected XPath expression';
					break;
				case ErrorType.XPathName:
					msg = `XPath: Invalid name: '${tokenValue}'`;
					break;
				case ErrorType.MissingContextItemForFn:
					errCode = DiagnosticCode.fnWithNoContextItem;
					msg = `XPath: Context-item is missing for function: '${tokenValue}'`;
					break;
				case ErrorType.MissingContextItemForCurrent:
					errCode = DiagnosticCode.currentWithNoContextItem;
					msg = `XPath: Context-item is missing for: '${tokenValue}'`;
					break;
				case ErrorType.MissingContextItemGeneral:
					errCode = DiagnosticCode.noContextItem;
					msg = `XPath: Context-item is missing for: '${tokenValue}'`;
					break;
				case ErrorType.MissingContextItemForPosition:
					errCode = DiagnosticCode.positionWithNoContextItem;
					msg = `XPath: Context-item is missing for: ''position()`;
					break;
				case ErrorType.MissingContextItemForGrouping:
					errCode = DiagnosticCode.groupOutsideForEachGroup;
					msg = `XSLT: Outside a 'xsl:for-each-group' - will always return an empty sequence: ${tokenValue}`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				case ErrorType.MissingContextItemForMerge:
					errCode = tokenValue.includes('()') ? DiagnosticCode.groupOutsideForEachGroup : DiagnosticCode.groupOutsideMerge;
					msg = `XSLT: Outside a 'xsl:merge-action' - will always return an empty sequence: ${tokenValue}`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				case ErrorType.MissingContextItemForLast:
					errCode = DiagnosticCode.lastWithNoContextItem;
					msg = `XPath: Context-item is missing for: 'last(')`;
					break;
				case ErrorType.MissingContextItemForRoot:
					errCode = DiagnosticCode.rootWithNoContextItem;
					msg = `XPath: Context-item is missing for root: '${tokenValue}'`;
					break;
				case ErrorType.MissingContextItemForRootOnly:
					errCode = DiagnosticCode.rootOnlyWithNoContextItem;
					msg = `XPath: Context-item is missing for root selector: '${tokenValue}'`;
					break;
				case ErrorType.MissingContextItemForInstr:
					errCode = DiagnosticCode.instrWithNoContextItem;
					msg = `XSLT: Context-item is missing ('select' attribute needed here): '${tokenValue}'`;
					break;
				case ErrorType.MissingContextItemForCallTemplate:
					msg = `XSLT: No context-item present for 'xsl:call-template' instruction`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				case ErrorType.MissingContextItemForRegex:
					errCode = DiagnosticCode.regexNoContextItem;
					msg = `XSLT: Outside <xsl:matching-substring> will always be empty: '${tokenValue}'`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				case ErrorType.XPathOperatorUnexpected:
					msg = `XPath: Operator unexpected at this position: '${tokenValue}'`;
					break;
					break;
				case ErrorType.XPathIfAwaitingThen:
					msg = `XPath: 'then' expected after 'if ($condition)' but found: '${tokenValue}'`;
					break;
				case ErrorType.XPathAwaiting:
					msg = `XPath: Expected expression following: '${tokenValue}'`;
					break;
				case ErrorType.XPathConditionExpected:
					msg = `XPath: Expected '($expression)' but found: '()'`;
					break;
				case ErrorType.DTD:
					msg = `XML: DTD position error: '${tokenValue}'`;
					break;
				case ErrorType.XPathStringLiteral:
					msg = `String literal not terminated properly: ${tokenValue}`;
					break;
				case ErrorType.XPathFunction:
					errCode = DiagnosticCode.unresolvedGenericRef;
					let parts = tokenValue.split('#');
					msg = `XPath: Function: '${parts[0]}' with ${parts[1]} arguments not found`;
					break;
				case ErrorType.XPathFunctionParseHtml:
					errCode = DiagnosticCode.parseHtmlRef;
					severity = vscode.DiagnosticSeverity.Warning;
					msg = `XPath: The 'parse-html' function requires the 'htmlParserJar' setting when invoked from VS Code`;
					break;
				case ErrorType.XPathFunctionExternalPrint:
					errCode = DiagnosticCode.externalPrintRef;
					severity = vscode.DiagnosticSeverity.Warning;
					msg = `XPath: 'ext:print/println' function not defined - use QuickFix`;
					break;
				case ErrorType.XPathTypeName:
					msg = `XPath: Invalid type: '${tokenValue}'`;
					break;
				case ErrorType.XPathFunctionNamespace:
					errCode = DiagnosticCode.unresolvedGenericRef;
					let partsNs = tokenValue.split('#');
					msg = `XPath: Undeclared prefix in function: '${partsNs[0]}'`;
					break;
				case ErrorType.XPathExpectedComplex:
					const expected = tokenValue === ':=' ? 'in' : ':=';
					msg = `XPath: '${tokenValue}' is invalid here, expected  '${expected}'`;
					break;
				case ErrorType.XPathPrefix:
					errCode = DiagnosticCode.unresolvedGenericRef;
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
				case ErrorType.AnonymousFunctionSyntax:
					msg = `XPath: Expected syntax: 'function($v) {expression}'`;
					break;
				case ErrorType.XMLAttributeXMLNS:
					msg = `XML: Invalid prefix for attribute on element '${tokenValue}'`;
					break;
				case ErrorType.XSLTAttrUnexpected:
					msg = `XSLT: Invalid attribute on element '${tokenValue}'`;
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
			if (token.startCharacter > -1 && endChar > -1) {
				variableRefDiagnostics.push({
					code: errCode,
					message: msg,
					range: new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar)),
					severity: severity,
					tags: diagnosticMetadata,
					source: ''
				});
			}
		});
		return variableRefDiagnostics;
	}

	private static getMatchingSymbol(text: string) {
		let r = '';
		switch (text) {
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
			case 'if':
				r = 'then';
				break;
			case 'then':
				r = 'else';
				break;
			case 'let':
			case 'for':
				r = 'return';
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

	private static getMatchingToken(text: string) {
		let r = '';
		switch (text) {
			case 'let':
			case 'for':
			case 'member':
				r = 'return';
				break;
			case 'every':
			case 'some':
				r = 'satisfies';
				break;
			case 'then':
				r = 'else';
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
		};
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
		};
	}

	private static createUnresolvedVarDiagnostic(document: vscode.TextDocument, token: BaseToken, includeOrImport: boolean): vscode.Diagnostic {
		let line = token.line;
		const endChar = token.startCharacter + token.length;
		const errRange = new vscode.Range(new vscode.Position(line, token.startCharacter), new vscode.Position(line, endChar));
		const errCode = DiagnosticCode.unresolvedVariableRef;
		if (includeOrImport) {
			return {
				code: errCode,
				message: `XPath: The variable/parameter: ${token.value} cannot be resolved here, but it may be defined in an external module.`,
				range: errRange,
				severity: vscode.DiagnosticSeverity.Warning,

			};
		} else {
			return {
				code: errCode,
				message: `XPath: The variable/parameter ${token.value} cannot be resolved`,
				range: errRange,
				severity: vscode.DiagnosticSeverity.Error,
			};
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
