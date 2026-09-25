/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - xsltTokenDiagnostics
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { XslLexer, XMLCharState, XSLTokenLevelState, GlobalInstructionData, GlobalInstructionType, DocumentTypes, LanguageConfiguration } from './xslLexer';
import { CharLevelState, TokenLevelState, BaseToken, ErrorType, Data, XPathLexer, ExitCondition } from './xpLexer';
import { FunctionData, XSLTnamespaces } from './functionData';
import { SchemaQuery } from './schemaQuery';
import { XSLTConfiguration } from './languageConfigurations';
import { SimpleTypeNames } from './xsltSchema';
import { XPathFunctionDetails } from './xpathFunctionDetails';
import { RecordType, RecordTypes } from './recordTypes';

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
	// a list of accumulator names, e.g. on xsl:mode or xsl:source-document
	UseAccumulators,
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
// context value set by the pipeline operator '->' or the simple map operator '!' for their right-hand operand
export interface OperandContext {
	hasPipelineContext?: boolean;
	hasSimpleMapContext?: boolean;
}

export interface XPathData extends OperandContext {
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
	// XPath 4.0 keyword arguments, e.g. subsequence($s, start := 2)
	keywordNames?: string[];
	// XPath 4.0 map constructor without the 'map' keyword
	isBareMap?: boolean;
	anonFnSyntaxErrorReported?: boolean;
}

export interface VariableData {
	token: BaseToken;
	name: string;
	// XPath 4.0: the record type from the declaration's 'as' attribute, for checking lookups such as $c?r
	recordType?: RecordType;
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
	xdmDebugRef,
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
	static oneCharOps = new Set([')', ']', '}', '-', '+', '|', '*', '.']);
	static twoCharOps = new Set(['as', '//', '{}', '[]', '()', '*:', '::', '<<', '>>', '=>']);
	static threeCharOps = new Set(['div', 'mod', '=!>']);
	static otherOps = new Set(['idiv', 'union', 'except', 'intersect', '&lt;&lt;', '&gt;&gt;']);
	static anonFunctionOps = new Set([')', '(', 'as', 'map', 'array', ',']);
	static anonFunctionVarOps = new Set([')','as', ',']);
	static anonFunctionTokenTypes = new Set([TokenLevelState.operator, TokenLevelState.variable, TokenLevelState.simpleType]);
	// operators within a path expression, all other binary operators end the right-hand operand of the simple map operator '!'
	static pathExprOps = new Set(['/', '//', '!', '?', '::', '()', '[]', '{}', '*:', '..']);
	// binary operators with lower precedence than the pipeline operator '->', these end the pipeline's right-hand operand
	static endPipelineOps = new Set([',', '??', '!!', '+', '-', '*', '|', '||', '=', '!=', '<', '<=', '>', '>=', '<<', '>>', '&lt;', '&lt;=', '&gt;', '&gt;=', '&lt;&lt;', '&gt;&gt;',
		'and', 'or', 'div', 'idiv', 'mod', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'is', 'to', 'union', 'intersect', 'except', 'otherwise', 'cast', 'castable', 'treat', 'instance']);
	static checkStringIsExpected(prevToken: BaseToken | null, token: BaseToken, problemTokens: BaseToken[]) {
		if (!prevToken || prevToken.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber ||
			token.charType === CharLevelState.mBt || token.charType === CharLevelState.rBt) {
			// string template middle/closing parts always follow the '}' of a variable part
			return;
		}
		let isXPathError = false;
		const pt = prevToken.value;
		if (prevToken.tokenType === TokenLevelState.operator) {
			// check string is permitted to follow a string - not a node or numeric operator:
			switch (pt.length) {
				case 1:
					isXPathError = XsltTokenDiagnostics.oneCharOps.has(pt);
					break;
				case 2:
					isXPathError = XsltTokenDiagnostics.twoCharOps.has(pt);
					break;
				case 3:
					isXPathError = XsltTokenDiagnostics.threeCharOps.has(pt);
					break;
				default:
					isXPathError = XsltTokenDiagnostics.otherOps.has(pt);
					break;
			}
		} else if (prevToken.tokenType === TokenLevelState.complexExpression) {
			isXPathError = false;
		} else if (prevToken.tokenType === TokenLevelState.string || prevToken.tokenType === TokenLevelState.entityRef) {
			// string tokens may be split by newline characters
			const currentTokenFirstChar = token.value.charAt(0);
			// a template split by newlines continues on a new line, so only a same-line back-tick starts a new template
			const startsTemplate = currentTokenFirstChar === '`' && prevToken.line === token.line && (token.charType === CharLevelState.lBt || token.charType === CharLevelState.sBt);
			isXPathError = startsTemplate || (token.value.length > 1 && (currentTokenFirstChar === '"' || currentTokenFirstChar === '\''));
		} else {
			isXPathError = true;
		}
		if (isXPathError) {
			token.error = ErrorType.XPathUnexpected;
			problemTokens.push(token);
		}
	}
	public static readonly xsltStartTokenNumber = XslLexer.getXsltStartTokenNumber();
	public static readonly xsltCatchVariables = ['err:code', 'err:description', 'err:value', 'err:module', 'err:line-number', 'err:column-number'];
	public static readonly xslInclude = 'xsl:include';
	public static readonly xslImport = 'xsl:import';
	public static readonly xmlChars = ['lt', 'gt', 'quot', 'apos', 'amp'];
	public static readonly typesWithMaxArity2 = ['map', 'attribute', 'element'];
	public static readonly typesWithMinArity0 = ['element', 'attribute'];
	public static readonly typesWithArity1 = ['array', 'map'];
	public static readonly typesInXPath4_specialArgs = ['record', 'enum', 'tuple'];
	// item types added in XPath 4.0, and obsolete Saxon extension item types (dropped in Saxon 13)
	public static readonly itemTypes40 = ['record', 'enum', 'fn', 'jnode'];
	public static readonly obsoleteItemTypes = ['union', 'type', 'tuple'];


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
						} else if (name === 'xsl:note' || elementStack?.find(item => item.symbolName === 'xsl:note')) {
							// xsl:note is permitted anywhere and its content is not checked
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

	public static calculateDiagnostics = (languageConfig: LanguageConfiguration, docType: DocumentTypes, document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], symbols: vscode.DocumentSymbol[], testingAsAttribute = false): vscode.Diagnostic[] => {
		let lineNumber = -1;
		let xslVariable = languageConfig.variableElementNames;
		let inScopeVariablesList: VariableData[] = [];
		let xpathVariableCurrentlyBeingDefined: boolean;
		let elementStack: ElementData[] = [];
		let inScopeXPathVariablesList: VariableData[] = [];
		let anonymousFunctionParamList: VariableData[] = [];
		let xpathStack: XPathData[] = [];
		// the operand context when the xpathStack is empty:
		let rootOperandContext: OperandContext = {};
		// XPath 4.0 namespace declarations at the start of an expression: the prefixes are in scope only for that expression
		let prologSavedPrefixes: { prefixes: string[], prefixesToURIs: Map<string, XSLTnamespaces> } | null = null;
		let prologNamespaceDeclared = false;
		let prologUriToken: BaseToken | null = null;
		let tagType = TagType.NonStart;
		let attType = AttributeType.None;
		let tagElementName = '';
		let tagElementId: number = -1;
		let tagElementAttributes: string[] | undefined = [];
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
		let withinTypeDeclarationAttr = false;
		let isGroupingAttribute = false;
		let isWithinCDATA = false;
		let tagAttributeSymbols: vscode.DocumentSymbol[] = [];
		let tagXmlnsNames: string[] = [];
		let rootXmlnsBindings: [string, string][] = [];
		let inheritedPrefixes: string[] = [];
		let inheritedPrefixesCopy: string[] = [];
		let globalVariableData: VariableData[] = [];
		let checkedGlobalVarNames: string[] = [];
		let checkedGlobalFnNames: string[] = [];
		// parameter names for each declaration of a user-defined function, for XPath 4.0 keyword arguments
		let userFunctionParams = new Map<string, string[][]>();
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
		// names declared with xsl:item-type
		let globalItemTypeNames: string[] = [];
		// XPath 4.0 record types: xsl:item-type declarations, and the 'as' of global variables and parameters
		let itemTypeDeclarations = new Map<string, string>();
		let globalVariableTypes = new Map<string, string>();
		// the 'as' and 'select' attributes of the current start tag, as allTokens index ranges
		let currentAttName = '';
		let tagAsRange: [number, number] | null = null;
		let tagSelectRange: [number, number] | null = null;
		// the record type of the current xsl:function, and the 'select' of its last xsl:sequence (a direct child)
		let functionResult: { record: RecordType | undefined, select: [number, number] | null } | null = null;
		// lookups and child steps whose value is a record, e.g. $a?b for record(b as record(c)), so $a?b?c can be checked -
		// isJNode is true for a child step, e.g. jtree($a)/b, whose result can be used with '/' again
		let lookupRecords = new Map<BaseToken, { record: RecordType, isJNode: boolean }>();
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

		globalInstructionData.concat(importedInstructionData).forEach((instruction) => {
			if (instruction.declaredType && (instruction.type === GlobalInstructionType.Variable || instruction.type === GlobalInstructionType.Parameter) && !globalVariableTypes.has(instruction.name)) {
				globalVariableTypes.set(instruction.name, instruction.declaredType);
			}
		});
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
					XsltTokenDiagnostics.checkOptionalParams(instruction, docType, problemTokens);
					XsltTokenDiagnostics.addUserFunctionParams(userFunctionParams, instruction);
					// with XSLT 4.0 optional parameters, a function has an arity range
					for (const functionNameWithArity of XsltTokenDiagnostics.functionNamesWithArity(instruction)) {
						if (checkedGlobalFnNames.indexOf(functionNameWithArity) < 0) {
							checkedGlobalFnNames.push(functionNameWithArity);
						} else {
							instruction.token['error'] = ErrorType.DuplicateFnName;
							instruction.token.value = functionNameWithArity;
							problemTokens.push(instruction.token);
							break;
						}
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
				case GlobalInstructionType.ItemType:
					globalItemTypeNames.push(instruction.name);
					if (instruction.declaredType) {
						itemTypeDeclarations.set(instruction.name, instruction.declaredType);
					}
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
					XsltTokenDiagnostics.addUserFunctionParams(userFunctionParams, instruction);
					for (const functionNameWithArity of XsltTokenDiagnostics.functionNamesWithArity(instruction)) {
						if (checkedGlobalFnNames.indexOf(functionNameWithArity) < 0) {
							checkedGlobalFnNames.push(functionNameWithArity);
							importedGlobalFnNames.push(functionNameWithArity);
						}
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
				case GlobalInstructionType.ItemType:
					globalItemTypeNames.push(instruction.name);
					if (instruction.declaredType) {
						itemTypeDeclarations.set(instruction.name, instruction.declaredType);
					}
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
			xsltPrefixesToURIs.set('math', XSLTnamespaces.Math);
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
				if (prologSavedPrefixes) {
					inheritedPrefixes = prologSavedPrefixes.prefixes;
					xsltPrefixesToURIs = prologSavedPrefixes.prefixesToURIs;
					prologSavedPrefixes = null;
				}
				prologNamespaceDeclared = false;
				if (prologUriToken) {
					// expected ';' after the namespace URI
					prologUriToken.error = ErrorType.NamespaceDeclSemicolon;
					problemTokens.push(prologUriToken);
					prologUriToken = null;
				}
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
				rootOperandContext = {};
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
								withinTypeDeclarationAttr = false;
								currentAttName = '';
								tagAsRange = null;
								tagSelectRange = null;
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
								const startTagAttributeNames = tagAttributeNames;
								tagAttributeNames = [];
								withinTypeDeclarationAttr = false;
								// e.g. a text value template in the element's content is not part of the last attribute
								currentAttName = '';
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
								startTagAttributeNames.forEach((attName) => {
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


								if (startTagToken && !problem && !startTagToken.error) {
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

								const enclosingMode = elementStack.length > 0 && elementStack[elementStack.length - 1].symbolName === 'xsl:mode' ? elementStack[elementStack.length - 1] : undefined;
								if (startTagToken && !problem && !startTagToken.error && enclosingMode && tagElementName === 'xsl:template' && XsltTokenDiagnostics.isXPath40(docType)) {
									// XSLT 4.0 enclosed mode: a template rule within xsl:mode has a match but no mode or name, and the mode must be named
									const disallowedAttribute = ['mode', 'name'].find((attName) => startTagAttributeNames.includes(attName));
									if (disallowedAttribute) {
										startTagToken.error = ErrorType.EnclosedTemplateAttribute;
										startTagToken.value = disallowedAttribute;
										problemTokens.push(startTagToken);
									} else if (!startTagAttributeNames.includes('match')) {
										startTagToken.error = ErrorType.EnclosedTemplateMatch;
										problemTokens.push(startTagToken);
									}
									const modeToken = enclosingMode.identifierToken;
									if (enclosingMode.symbolID === '' && modeToken && !modeToken.error) {
										modeToken.error = ErrorType.EnclosedModeName;
										problemTokens.push(modeToken);
									}
								}

								if (XsltTokenDiagnostics.isXPath40(docType)) {
									// XPath 4.0 record types: check a map constructor against the declared record type
									const asText = tagAsRange ? XsltTokenDiagnostics.textForTokenRange(document, allTokens, tagAsRange) : undefined;
									const record = asText && ['xsl:variable', 'xsl:param', 'xsl:with-param', 'xsl:function'].includes(tagElementName) ? RecordTypes.resolve(asText, itemTypeDeclarations) : undefined;
									const parentName = elementStack.length > 0 ? elementStack[elementStack.length - 1].symbolName : '';
									if (tagElementName === 'xsl:function') {
										functionResult = { record, select: null };
									} else if (functionResult && parentName === 'xsl:function' && tagElementName !== 'xsl:param') {
										// the function result is the last instruction, if it's an xsl:sequence
										functionResult.select = tagElementName === 'xsl:sequence' ? tagSelectRange : null;
									}
									if (record && tagSelectRange && tagElementName !== 'xsl:function') {
										RecordTypes.checkMapConstructor(allTokens.slice(tagSelectRange[0], tagSelectRange[1] + 1), record, itemTypeDeclarations, problemTokens);
									}
									if (record && variableData) {
										variableData.recordType = record;
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
									if (tagElementName === 'xsl:function' && functionResult) {
										if (functionResult.record && functionResult.select) {
											RecordTypes.checkMapConstructor(allTokens.slice(functionResult.select[0], functionResult.select[1] + 1), functionResult.record, itemTypeDeclarations, problemTokens);
										}
										functionResult = null;
									}
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
							case XMLCharState.lCdataEnd:
								isWithinCDATA = true;
								break;
							case XMLCharState.rCdataEnd:
								isWithinCDATA = false;
								break;
						}
						break;

					case XSLTokenLevelState.attributeName:
					case XSLTokenLevelState.xmlnsName:
						rootXmlnsName = null;
						let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);
						withinTypeDeclarationAttr = attNameText === 'as';
						currentAttName = attNameText;
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
							} else if (attNameText === 'use-accumulators') {
								attType = AttributeType.UseAccumulators;
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
						if (!hasProblem && attType === AttributeType.UseAccumulators) {
							// each name must be a declared accumulator (XTSE3300)
							XslLexer.tokensInsideToken(token, variableName).forEach((nameToken) => {
								if (nameToken.value !== '#all' && !globalAccumulatorNames.includes(nameToken.value)) {
									problemTokens.push({ ...nameToken, tokenType: token.tokenType, error: ErrorType.AccumulatorNameUnresolved });
								}
							});
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
				withinTypeDeclarationAttr = testingAsAttribute ? true : withinTypeDeclarationAttr;
				if (isWithinCDATA && !!prevToken) {
					// reset prevToken if this token is preceded by a '{' char that is not in a token
					try {
						const startPos = new vscode.Position(prevToken.line, prevToken.startCharacter + prevToken.length);
						const endPos = new vscode.Position(token.line, token.startCharacter);
						const beteenRange = new vscode.Range(startPos, endPos);
						const betweenText = document.getText(beteenRange).trimRight();
						if (betweenText.endsWith('{')) {
							prevToken = null;
						}
					} catch (e) {
						console.error("betweenText calculation error");
					}
				}
				let xpathCharType = <CharLevelState>token.charType;
				let xpathTokenType = <TokenLevelState>token.tokenType;
				const stackItem: XPathData | undefined = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : undefined;

				if (currentAttName === 'as') {
					tagAsRange = tagAsRange ? [tagAsRange[0], index] : [index, index];
				} else if (currentAttName === 'select') {
					tagSelectRange = tagSelectRange ? [tagSelectRange[0], index] : [index, index];
				}
				const isStepPosition = prevToken?.tokenType === TokenLevelState.operator && (prevToken.value === '/' || prevToken.value === '//' || prevToken.value === '::');
				if (isStepPosition && (xpathTokenType === TokenLevelState.function || xpathTokenType === TokenLevelState.nodeNameTest) && token.value.startsWith('~') && !token.error) {
					// e.g. $tree//~record(a, b) or child::~xs:string - shown in the Saxon 13 JNodes documentation, but rejected by Saxon 13
					token.error = ErrorType.TypeNodeTestNotSupported;
					if (xpathTokenType === TokenLevelState.function) {
						// a name test token's error is reported with the name test checks
						problemTokens.push(token);
					}
				}
				const isRecordStep = xpathTokenType === TokenLevelState.nodeNameTest && prevToken?.tokenType === TokenLevelState.operator && prevToken.value === '/';
				if ((isRecordStep || (xpathTokenType === TokenLevelState.mapNameLookup && prevToken?.value === '?')) && XsltTokenDiagnostics.isXPath40(docType)) {
					// XPath 4.0: a lookup on a value declared with a record type, e.g. $c?r, or a child step on a JNode for one, e.g. jtree($c)/r
					const variableRecord = (variableToken: BaseToken) => {
						const variableName = variableToken.value.substring(1);
						const isXPathVariable = inScopeXPathVariablesList.some((v) => v.name === variableName) || xpathStack.some((x) => x.variables.some((v) => v.name === variableName));
						if (isXPathVariable) {
							return undefined;
						}
						const localVariable = XsltTokenDiagnostics.findLocalVariable(variableName, inScopeVariablesList, elementStack, globalVariableData);
						const globalType = globalVariableTypes.get(variableName);
						return localVariable ? localVariable.recordType : globalType ? RecordTypes.resolve(globalType, itemTypeDeclarations) : undefined;
					};
					const operandIndex = index - 2;
					const operand = operandIndex > -1 ? allTokens[operandIndex] : undefined;
					let operandRecord: { record: RecordType | undefined, isJNode: boolean } | undefined;
					if (operand?.tokenType === TokenLevelState.variable) {
						operandRecord = { record: variableRecord(operand), isJNode: false };
					} else if (operand?.charType === CharLevelState.rB && operandIndex > 2 && allTokens[operandIndex - 1].tokenType === TokenLevelState.variable &&
						allTokens[operandIndex - 2].charType === CharLevelState.lB && allTokens[operandIndex - 3].value === 'jtree') {
						// jtree($c)
						operandRecord = { record: variableRecord(allTokens[operandIndex - 1]), isJNode: true };
					} else if (operand) {
						operandRecord = lookupRecords.get(operand);
					}
					const record = operandRecord?.record;
					if (record && isRecordStep && !operandRecord!.isJNode) {
						// Saxon 13 requires a node on the left of '/' when the static type is a record type (XPTY0019)
						problemTokens.push(RecordTypes.problemToken(prevToken!, ErrorType.RecordStepNeedsJtree, record.name));
					} else if (record && /^[\w.-]+$/.test(token.value) && !/^\d+$/.test(token.value)) {
						const field = record.fields.find((f) => f.name === token.value);
						if (!field) {
							problemTokens.push(RecordTypes.problemToken(token, isRecordStep ? ErrorType.RecordStepUnknown : ErrorType.RecordLookupUnknown, token.value, record.name));
						} else {
							const fieldRecord = RecordTypes.fieldRecord(field, itemTypeDeclarations);
							if (fieldRecord) {
								lookupRecords.set(token, { record: fieldRecord, isJNode: isRecordStep });
							}
						}
					}
				}

				if (prologUriToken && xpathTokenType !== TokenLevelState.comment) {
					if (!(xpathCharType === CharLevelState.sep && token.value === ';')) {
						prologUriToken.error = ErrorType.NamespaceDeclSemicolon;
						problemTokens.push(prologUriToken);
					}
					prologUriToken = null;
				} else if (xpathCharType === CharLevelState.sep && token.value === ';') {
					// ';' is only permitted after a namespace declaration
					token.error = ErrorType.XPathUnexpected;
					problemTokens.push(token);
				}
				const isKeywordName = xpathTokenType === TokenLevelState.mapKey && allTokens[index + 1]?.value === ':=';
				if (stackItem?.keywordNames && prevToken?.charType === CharLevelState.sep && prevToken.value === ',' && !isKeywordName && xpathTokenType !== TokenLevelState.comment) {
					token.error = ErrorType.PositionalArgumentAfterKeyword;
					problemTokens.push(token);
				}

				if (stackItem) {
					const tv = stackItem.token.value;
					if (prevToken?.charType === CharLevelState.sep && prevToken.value === ',' && (tv === 'for' || tv === 'let' || tv === 'every' || tv === 'some')) {
						if (xpathTokenType !== TokenLevelState.variable) {
							const realType = (xpathTokenType === TokenLevelState.comment && index + 1 < allTokens.length) ? allTokens[index + 1].tokenType : xpathTokenType;
							if (realType != TokenLevelState.variable) {
								token['error'] = ErrorType.ExpectedDollarAfterComma;
								problemTokens.push(token);
							}
						}
					}
				}
				let isTypeError = false;
				if (token.choiceSeparator && !XsltTokenDiagnostics.isXPath40(docType)) {
					token.error = ErrorType.ChoiceTypeRequiresXPath40;
					problemTokens.push(token);
				}
				if (withinTypeDeclarationAttr) {
					const tType = token.tokenType;
					if (!(tType === TokenLevelState.nodeType || tType === TokenLevelState.simpleType)) {
						if (token.tokenType === TokenLevelState.nodeNameTest && token.value === 'as') {
								token.error = ErrorType.XPathUnexpected;
								isTypeError = true;
						} else if (!(token.value === 'as' || token.value === ',' || token.charType === CharLevelState.lB || token.charType === CharLevelState.rB)) {
							const lastStackEntry = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : undefined;
							const typeName = !lastStackEntry ? undefined : lastStackEntry.function ? lastStackEntry.function.value : undefined;
							const isRecord = typeName === 'record' || typeName === 'tuple';
							const isValidXPath4SpecialArg = (typeName === 'enum' && tType === TokenLevelState.string) ||
								(isRecord && (tType === TokenLevelState.nodeNameTest || tType === TokenLevelState.string)) ||
								(isRecord && XsltTokenDiagnostics.isOptionalFieldMarker(token, prevToken)) ||
								(token.value === '()' && prevToken?.value === 'record') || !!token.choiceSeparator;
							if (!isValidXPath4SpecialArg) {
								token['error'] = ErrorType.XPathUnexpected;
								problemTokens.push(token);
								isTypeError = true;
							}
						}
						if (token.charType === CharLevelState.rB && xpathStack.length > 0) {
							// check arity is true for type: map(xs:integer, xs:integer)
							const lastStackEntry = xpathStack[xpathStack.length - 1];
							if (lastStackEntry.function && lastStackEntry.functionArity !== undefined && lastStackEntry.function.tokenType !== TokenLevelState.function) {
								const typeName = lastStackEntry.function.value;
								if (!this.typesInXPath4_specialArgs.includes(lastStackEntry.function.value)) {
									const maxArityNumber = this.typesWithMaxArity2.includes(typeName) ? 2 : 1;
									const minArityNumber = this.typesWithArity1.includes(typeName) ? 1 : 0;
									const actualArity = (prevToken?.charType !== CharLevelState.lB)? lastStackEntry.functionArity + 1 : 0;
									if ((actualArity > maxArityNumber) || actualArity < minArityNumber ) {
										const arityText = 
											minArityNumber === 0 && maxArityNumber === 1 ? '0 or 1' :
											minArityNumber === 1 && maxArityNumber === 1 ? '1' :
											minArityNumber === 1 && maxArityNumber === 2 ? '1 or 2' : '0 or 1 (or 2 if schema-aware)'; 
										const errToken = lastStackEntry.function;
										errToken.error = ErrorType.XPathTypeFullArity;
										errToken.value = errToken.value + '#' + actualArity + '#' + arityText;
										problemTokens.push(errToken);
									}
								}
							}
						}
					} else {
						const prevType = prevToken?.tokenType;
						if (token.value === '..' || (token.value == '()' && prevToken?.value === '()') ||
							(token.value.length !== 1 && token.value !== '()' && (prevType === TokenLevelState.nodeType || prevType === TokenLevelState.simpleType))) {
							token['error'] = ErrorType.XPathUnexpected;
							problemTokens.push(token);
						}
					}
				} else if (XsltTokenDiagnostics.isAnonymousFunctionParams(stackItem)) {
					let invalidTokenForAnonFunction = !XsltTokenDiagnostics.anonFunctionTokenTypes.has(token.tokenType);
					// nodeType is also permitted except when value is '*'
					if (invalidTokenForAnonFunction && token.tokenType === TokenLevelState.nodeType && token.value !== '*') {
						invalidTokenForAnonFunction = false;
					}
					if (invalidTokenForAnonFunction && !stackItem.anonFnSyntaxErrorReported) {
						token.error = ErrorType.AnonymousFunctionSyntax;
						problemTokens.push(token);
						stackItem.anonFnSyntaxErrorReported = true;
					}
				}
				if (isTypeError) {
				} else if (insideGlobalFunction && !isGroupingAttribute) {
					const tv = token.value;
					const isRootSelector = tv === '/' || tv === '//';
					if (prevToken && (tv === '?' && !(prevToken.tokenType === TokenLevelState.variable || prevToken.tokenType === TokenLevelState.mapNameLookup || prevToken.tokenType === TokenLevelState.simpleType || prevToken.charType === CharLevelState.rB || prevToken.charType === CharLevelState.rPr || prevToken.charType === CharLevelState.rBr))) {
						let isNoArgFunctionCall = false;
						if (prevToken.charType == CharLevelState.dSep && prevToken.value == '()' && index > 2) {
							let prevToken2 = allTokens[index - 2];
							isNoArgFunctionCall = prevToken2.tokenType === TokenLevelState.function;
						}
						const parentXPath = xpathStack.length === 0 ? undefined : xpathStack[xpathStack.length - 1];
						let isPartialFunctionArg = !!parentXPath && (
							!!parentXPath.function || 
							(!!parentXPath.token.context && parentXPath.token.context.tokenType === TokenLevelState.variable));
						if (isPartialFunctionArg && allTokens.length > index) {
							const nextToken = allTokens[index + 1];
							isPartialFunctionArg = (nextToken.charType === CharLevelState.rB  || nextToken.value === ',');
						}
						if (!withinTypeDeclarationAttr && !isNoArgFunctionCall && !isPartialFunctionArg && !XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction, false, rootOperandContext)) {
							token.error = ErrorType.MissingContextItemGeneral;
							problemTokens.push(token);
						}
					} else if (prevToken && (isRootSelector || xpathTokenType === TokenLevelState.nodeNameTest || xpathTokenType === TokenLevelState.attributeNameTest || xpathTokenType === TokenLevelState.axisName)) {
						if (!XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction, false, rootOperandContext)) {
							if (isRootSelector) {
								if (!XsltTokenDiagnostics.providesContext(prevToken)) {
									let isRootOnly = true;
									if (index < allTokens.length - 2) {
										const nt = allTokens[index + 1];
										const ntt = <TokenLevelState>nt.tokenType;
										const ntv = nt.value;
										isRootOnly = !(ntt === TokenLevelState.nodeNameTest || ntt === TokenLevelState.anonymousFunction || ntt === TokenLevelState.axisName ||
											ntt === TokenLevelState.function || ntt === TokenLevelState.variable || ntv === '*' || ntv === '()' || ntv === '(' || ntv === '=>' || ntv === '=!>');
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
						if (token.error && !isTypeError) {
							problemTokens.push(token);
						}
						if (prevToken?.tokenType === TokenLevelState.complexExpression && prevToken.value === 'namespace' && allTokens[index - 2]?.value === 'element') {
							// declare default element namespace 'uri';
							prologUriToken = token;
							break;
						} else if (prevToken?.value === '=' && allTokens[index - 2]?.tokenType === TokenLevelState.mapKey && allTokens[index - 3]?.value === 'namespace' &&
							allTokens[index - 3].tokenType === TokenLevelState.complexExpression) {
							// declare namespace prefix = 'uri';
							const prefix = allTokens[index - 2].value;
							if (!prologSavedPrefixes) {
								prologSavedPrefixes = { prefixes: inheritedPrefixes, prefixesToURIs: xsltPrefixesToURIs };
								xsltPrefixesToURIs = new Map(xsltPrefixesToURIs);
							}
							inheritedPrefixes = inheritedPrefixes.includes(prefix) ? inheritedPrefixes : inheritedPrefixes.concat([prefix]);
							const nsType = FunctionData.namespaces.get(token.value.substring(1, token.value.length - 1));
							if (nsType === undefined) {
								xsltPrefixesToURIs.delete(prefix);
							} else {
								xsltPrefixesToURIs.set(prefix, nsType);
							}
							prologUriToken = token;
							break;
						}
						XsltTokenDiagnostics.checkStringIsExpected(prevToken, token, problemTokens);
						if (xpathStack.length > 0 && !isTypeError) {
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
						if (!token.error && !withinTypeDeclarationAttr && !XsltTokenDiagnostics.isXPath40(docType) && Data.axes40.includes(token.value)) {
							token.error = ErrorType.AxisRequiresXPath40;
						}
						if (token.error && !withinTypeDeclarationAttr) {
							problemTokens.push(token);
						}
						XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
						break;
					case TokenLevelState.variable:
						if (withinTypeDeclarationAttr) {
						} else if ((preXPathVariable && !xpathVariableCurrentlyBeingDefined) || anonymousFunctionParams) {
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
							// XSLT 4.0: $group and $next are in scope only within the split-when attribute of xsl:for-each-group
							// (and 'break-when', its Saxon 12 name, still accepted by Saxon 13)
							const isSplitWhenVariable = tagElementName === 'xsl:for-each-group' && (currentAttName === 'split-when' || currentAttName === 'break-when') &&
								(token.value === '$group' || token.value === '$next');
							if (isSplitWhenVariable) {
								XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
								break;
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
						if (token.value === 'declare' && (allTokens[index + 1]?.value === 'namespace' || allTokens[index + 1]?.value === 'default')) {
							// XPath 4.0 namespace declaration
							const isDefault = allTokens[index + 1].value === 'default';
							if (!XsltTokenDiagnostics.isXPath40(docType)) {
								token.error = ErrorType.NamespaceDeclRequiresXPath40;
								problemTokens.push(token);
							} else if (isDefault && prologNamespaceDeclared) {
								token.error = ErrorType.NamespaceDeclOrder;
								problemTokens.push(token);
							}
							prologNamespaceDeclared = true;
							break;
						} else if (['namespace', 'default', 'element'].includes(token.value) && allTokens[index - 1]?.tokenType === TokenLevelState.complexExpression) {
							break;
						}
						let valueText = withinTypeDeclarationAttr? '' : token.value;
						let testStartOfExpression = false;
						switch (valueText) {
							case '':
								break;
							case 'if':
								ifThenStack.push(token);
								testStartOfExpression = true;
								if (index > 0) {
									XsltTokenDiagnostics.checkTokenIsExpected(prevToken, allTokens[index - 1], problemTokens, TokenLevelState.Unset);
								}
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
									// XPath 4.0: for key $k value $v in map-expression
									const isForKeyValue = valueText === 'for' && (nextToken.value === 'key' || nextToken.value === 'value') && nextToken.tokenType === TokenLevelState.complexExpression;
									if (isForKeyValue && !XsltTokenDiagnostics.isXPath40(docType)) {
										nextToken.error = ErrorType.ForKeyValueRequiresXPath40;
										problemTokens.push(nextToken);
									} else if (!isForMember && !isForKeyValue) {
										const opToken = allTokens[index + 2];
										const expectedOp = valueText === 'let' ? ':=' : 'in';
										if (opToken.value === 'as' && valueText !== 'member') {
											// XPath 4.0 typed variable binding, e.g. let $x as xs:integer := 3
											if (!XsltTokenDiagnostics.isXPath40(docType)) {
												opToken.error = ErrorType.TypedBindingRequiresXPath40;
												problemTokens.push(opToken);
											} else {
												// the ':=' or 'in' follows the type
												const afterType = allTokens.slice(index + 3).find((t) => t.tokenType === TokenLevelState.complexExpression);
												if (afterType && afterType.value !== expectedOp) {
													afterType['error'] = ErrorType.XPathExpectedComplex;
													problemTokens.push(afterType);
												}
											}
										} else if (opToken.value !== expectedOp) {
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
							case 'key':
							case 'value':
								// XPath 4.0: for key $k value $v in map-expression - the variable after 'value' is a new binding
								if (xpathStack.length > 0 && xpathStack[xpathStack.length - 1].isRangeVar) {
									preXPathVariable = xpathStack[xpathStack.length - 1].preXPathVariable;
								}
								xpathVariableCurrentlyBeingDefined = false;
								break;
							case 'then':
								if (ifThenStack.length > 0) {
									if (xpathStack.length > 0) {
										let if1 = ifThenStack[ifThenStack.length - 1];
										let if2 = xpathStack[xpathStack.length - 1].token.context;
										if (if1.startCharacter === if2?.startCharacter && if1.line === if2.line) {
											token.error = ErrorType.XPathUnexpected;
											problemTokens.push(token);
										}
									}
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
											peekedStack.hasPipelineContext = false;
											peekedStack.hasSimpleMapContext = false;
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
						if (isKeywordName) {
							// XPath 4.0 keyword argument, e.g. subsequence($s, start := 2)
							if (!token.error) {
								XsltTokenDiagnostics.checkKeywordArgument(token, stackItem, docType, userFunctionParams, xsltPrefixesToURIs);
							}
							if (token.error) {
								problemTokens.push(token);
							}
						} else if (prevToken?.tokenType === TokenLevelState.complexExpression && prevToken.value === 'namespace') {
							// namespace prefix in: declare namespace prefix = 'uri';
						} else if (!(prevToken && prevToken.tokenType === TokenLevelState.operator
							&& (prevToken.value === ',' || prevToken.value === '{'))) {
							token['error'] = ErrorType.XPathUnexpected;
							problemTokens.push(token);
						}
						break;
					case TokenLevelState.anonymousFunction:
						if (!XsltTokenDiagnostics.isXPath40(docType)) {
							const isFocusFunction = allTokens[index + 1]?.charType === CharLevelState.lBr;
							if (isFocusFunction || token.value === 'fn') {
								token.error = isFocusFunction ? ErrorType.FocusFunctionRequiresXPath40 : ErrorType.InlineFunctionFnRequiresXPath40;
								problemTokens.push(token);
							}
						}
						break;
					case TokenLevelState.operator:
						let isXPathError = false;
						let tv = token.value;

						// start checks
						let latestStackItem = stackItem;
						const sv = latestStackItem?.token.value;
						const tokenIsComma = tv === ',';
						const popStackLaterForComma = sv && tokenIsComma && (sv === 'return' || sv === 'else' || sv === 'satisfies');
						if (popStackLaterForComma && xpathStack.length > 1) {
							latestStackItem = xpathStack[xpathStack.length - 2];
							if (xpathStack.length > 1) {
								let deleteCount = 0;
								for (let i = xpathStack.length - 1; i > -1; i--) {
									const loopStackItem = xpathStack[i];
									const sv = loopStackItem.token.value;
									if (sv === 'return' || sv === 'else' || sv === 'satisfies') {
										inScopeXPathVariablesList = loopStackItem.variables;
										xpathVariableCurrentlyBeingDefined = loopStackItem.xpathVariableCurrentlyBeingDefined;
										preXPathVariable = loopStackItem.xpathVariableCurrentlyBeingDefined;
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
						// XPath 4.0 empty map constructor without the 'map' keyword
						const isBareEmptyMap = tv === '{}' && token.charType === CharLevelState.dSep && XsltTokenDiagnostics.isOperandExpected(prevToken);
						// the pipeline operator '->' and simple map operator '!' set the context value for their right-hand operand
						const operandContext: OperandContext = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : rootOperandContext;
						const isBinaryOperator = !!prevToken && XsltTokenDiagnostics.isEndOfOperand(prevToken);
						if (tv === '->' && token.charType === CharLevelState.dSep) {
							operandContext.hasPipelineContext = true;
						} else if (operandContext.hasPipelineContext && isBinaryOperator && XsltTokenDiagnostics.endPipelineOps.has(tv)) {
							operandContext.hasPipelineContext = false;
						}
						if (tv === '!' && token.charType === CharLevelState.sep) {
							operandContext.hasSimpleMapContext = true;
						} else if (operandContext.hasSimpleMapContext && isBinaryOperator && !XsltTokenDiagnostics.pathExprOps.has(tv) && !XsltTokenDiagnostics.isBracket(<CharLevelState>token.charType)) {
							// the right-hand operand of '!' is a path expression, including any predicates, lookups and dynamic function calls
							operandContext.hasSimpleMapContext = false;
						}
						if (latestStackItem && latestStackItem.curlyBraceType === CurlyBraceType.Map) {
							// in XPath 4.0 a map constructor entry without ':' is a sequence of maps to be merged, e.g. { $map1, $map2 }
							if (tokenIsComma) {
								if (latestStackItem.awaitingMapKey) {
									isXPathError = !XsltTokenDiagnostics.isXPath40(docType) && !latestStackItem.isBareMap;
								} else {
									latestStackItem.awaitingMapKey = true;
								}
							} else if (tv === '}' && latestStackItem.awaitingMapKey) {
								isXPathError = prevToken?.value !== '{' && !XsltTokenDiagnostics.isXPath40(docType) && !latestStackItem.isBareMap;
							}
						}
						if (XsltTokenDiagnostics.isAnonymousFunctionParams(latestStackItem)) {
							let isFnError = false;
							if (prevToken?.tokenType === TokenLevelState.variable) {
								isFnError = !XsltTokenDiagnostics.anonFunctionVarOps.has(tv);
							} else {
								isFnError = !XsltTokenDiagnostics.anonFunctionOps.has(tv);
							}
							if (isFnError && !latestStackItem.anonFnSyntaxErrorReported) {
								token.error = ErrorType.AnonymousFunctionSyntax;
								problemTokens.push(token);
								latestStackItem.anonFnSyntaxErrorReported = true;
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
								if (latestStackItem && latestStackItem.curlyBraceType === CurlyBraceType.Map) {
									if (latestStackItem.awaitingMapKey) {
										latestStackItem.awaitingMapKey = false;
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
							} else if (tv === '?' && XsltTokenDiagnostics.enclosingTypeName(xpathStack) === 'record' && XsltTokenDiagnostics.isOptionalFieldMarker(token, prevToken)) {
								// optional record field, e.g. record(a? as xs:string)
							} else if (tv === '?') {
								if (isXMLToken || prevToken.value === '.' || prevToken.tokenType === TokenLevelState.variable || prevToken.tokenType === TokenLevelState.comment || prevToken.tokenType === TokenLevelState.mapNameLookup) {
									// don't check
								} else if (prevToken.tokenType === TokenLevelState.operator) {
									if (prevToken.charType === CharLevelState.sep) {
										const invalidPrevOperators = ['{', '?'];
										isXPathError = invalidPrevOperators.indexOf(prevToken.value) !== -1;
									} else if (prevToken.charType === CharLevelState.dSep) {
										const illegalPrevOperators = ['=>', '=!>', '//', '..', '*:', '::'];
										isXPathError = illegalPrevOperators.indexOf(prevToken.value) !== -1;
									}
								} else {
									isXPathError = true;
								}
							} else if (tv === '::') {
								isXPathError = prevToken.tokenType !== TokenLevelState.axisName;
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
							} else if (tv === '{' && (prevToken.charType === CharLevelState.lBt || prevToken.charType === CharLevelState.mBt)) {
								// string template variable part
							} else if (!isXPathError && prevToken?.tokenType === TokenLevelState.string) {
								// check operator is permitted to follow a string - not a node or numeric operator:
								switch (tv.length) {
									case 1:
										isXPathError = (tv === '(' || tv === '[' || tv === '{' || tv === '-' || tv === '+' || tv === '|' || tv === '?' || tv === '*' || tv === '.');
										break;
									case 2:
										isXPathError = (tv === 'as' || tv === 'of' || tv === '//' || tv === '{}' || tv === '[]' || tv === '()' || tv === '*:' || tv === '::' || tv === '<<' || tv === '>>');
										if (tv === 'as' && XsltTokenDiagnostics.enclosingTypeName(xpathStack) === 'record') {
											// a quoted record field name with a type, e.g. record('nick name' as xs:string)
											isXPathError = false;
										}
										break;
									case 3:
										isXPathError = (tv === 'div' || tv === 'mod');
										break;
									default:
										isXPathError = (tv === 'idiv' || tv === 'union' || tv === 'except' || tv === 'intersect' || tv === '&lt;&lt;' || tv === '&gt;&gt;');
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
													// also permitted after an optional record field, e.g. record(a? as xs:string)
													isXPathError = pv !== 'castable' && pv !== 'cast' && pv !== 'treat' &&
														!(pv === '?' && XsltTokenDiagnostics.enclosingTypeName(xpathStack) === 'record');
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
							if (isXPathError && !isTypeError && !isBareEmptyMap) {
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
						if (isBareEmptyMap && !XsltTokenDiagnostics.isXPath40(docType) && !token.error) {
							token.error = ErrorType.MapConstructorRequiresXPath40;
							problemTokens.push(token);
						}
						if (token.charType === CharLevelState.dSep && (tv === '??' || tv === '!!') && !token.error) {
							// deep lookup '??' and the draft ternary conditional '?? !!' are not supported by Saxon 13
							token.error = ErrorType.OperatorNotSupported;
							problemTokens.push(token);
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
								}
								const isBareMap = curlyBraceType === CurlyBraceType.None && XsltTokenDiagnostics.isOperandExpected(prevToken);
								if (isBareMap) {
									// XPath 4.0 map constructor without the 'map' keyword, e.g. { 'a': 1 }
									curlyBraceType = CurlyBraceType.Map;
									setContextItemProp = !!prevToken && (prevToken.value === '!' || prevToken.value === '/');
									if (!XsltTokenDiagnostics.isXPath40(docType)) {
										token.error = ErrorType.MapConstructorRequiresXPath40;
										problemTokens.push(token);
									}
								}
								const stackItem: XPathData = { token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, curlyBraceType };
								if (curlyBraceType === CurlyBraceType.Map) {
									stackItem.awaitingMapKey = true;
								}
								if (setContextItemProp) {
									stackItem.hasContextItem = true;
								}
								if (isBareMap) {
									stackItem.isBareMap = true;
								}
								if (prevToken?.tokenType === TokenLevelState.anonymousFunction) {
									// XPath 4.0 focus function, e.g. fn { @code }
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
								if (prevToken?.tokenType === TokenLevelState.function || (withinTypeDeclarationAttr && prevToken && 
									(this.typesWithMaxArity2.includes(prevToken.value) || this.typesWithArity1.includes(prevToken.value) || this.typesInXPath4_specialArgs.includes(prevToken.value)))) {
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
											const isBracedAction = !!tokenAfterIf && (tokenAfterIf.charType === CharLevelState.lBr || (tokenAfterIf.charType === CharLevelState.dSep && tokenAfterIf.value === '{}'));
											if (isBracedAction) {
												// XPath 4.0 braced action: if ($condition) { ... } has no 'then' or 'else'
												ifThenStack.pop();
												if (!XsltTokenDiagnostics.isXPath40(docType)) {
													tokenAfterIf['error'] = ErrorType.BracedIfRequiresXPath40;
													problemTokens.push(tokenAfterIf);
												}
											} else if (tokenAfterIf && tokenAfterIf.value !== 'then') {
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
												let foundDeclaration = XsltTokenDiagnostics.findFunctionDeclaration(allTokens, index);
												hasProblem = !foundDeclaration;
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
											if (!(regexSpecial || withinTypeDeclarationAttr)) {
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
								if (withinTypeDeclarationAttr && isEmptyBracketsToken && (prevToken?.value === 'function' || prevToken?.tokenType === TokenLevelState.simpleType) && prevToken?.value !== 'record') {
									prevToken['error'] = ErrorType.XPathTypeEmptyArity;
									problemTokens.push(prevToken);
								} else if (isEmptyBracketsToken && prevToken?.tokenType === TokenLevelState.function) {
									const fnArity = incrementFunctionArity ? 1 : 0;
									incrementFunctionArity = false;
									let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(docType, inheritedPrefixes, xsltPrefixesToURIs, prevToken, checkedGlobalFnNames, fnArity);
									if (!isValid) {
										prevToken['error'] = fErrorType;
										prevToken['value'] = qFunctionName;
										problemTokens.push(prevToken);
									} else if (fnArity === 0) {
										const isCurrentFunction = prevToken.value === 'current';
										if (!isGroupingAttribute && !XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction, isCurrentFunction, rootOperandContext)) {
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
									let foundDeclaration = XsltTokenDiagnostics.findFunctionDeclaration(allTokens, index);
									if (!foundDeclaration) {
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
								} else if (token.value === '=>' || token.value === '=!>') {
									incrementFunctionArity = true;
								}
								break;
						}
						break;
					case TokenLevelState.nodeType:
						if ((token.value === 'fn' || token.value === 'jnode') && XsltTokenDiagnostics.checkItemTypeVersion(token, docType)) {
							problemTokens.push(token);
						} else if (token.value === 'get' && !token.error && !XsltTokenDiagnostics.isXPath40(docType)) {
							token.error = ErrorType.NodeTestRequiresXPath40;
							problemTokens.push(token);
						} else if (token.value === '*' && XsltTokenDiagnostics.enclosingTypeName(xpathStack) === 'record') {
							// Saxon 13 has dropped extensible record types, e.g. record(*) or record(a, *)
							token.error = ErrorType.ExtensibleRecordType;
							problemTokens.push(token);
						}
						const isChoiceOccurrence = prevToken?.charType === CharLevelState.rB && token.charType === CharLevelState.lName &&
							(token.value === '?' || token.value === '*' || token.value === '+');
						if (token.error) {
							// already reported
						} else if (isChoiceOccurrence && !withinTypeDeclarationAttr) {
							// e.g. castable as (xs:date | xs:time)? - only '?' is permitted for 'cast as' and 'castable as'
							const castOperator = XsltTokenDiagnostics.typeOperatorBeforeParen(allTokens, index - 1);
							if (token.value !== '?' && (castOperator === 'cast' || castOperator === 'castable')) {
								token.error = ErrorType.XPathTypeName;
								problemTokens.push(token);
							}
						} else if (token.value === ':*' && prevToken && !prevToken.error) {
							let pfx = prevToken.tokenType === TokenLevelState.attributeNameTest ? prevToken.value.substring(1) : prevToken.value;
							if (inheritedPrefixes.indexOf(pfx) === -1 && pfx !== 'xml') {
								prevToken['error'] = ErrorType.XPathPrefix;
								problemTokens.push(prevToken);
							}
						} else if (!withinTypeDeclarationAttr) {
							XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
						}
						if (prevToken && insideGlobalFunction && !isGroupingAttribute) {
							const prevToken2 = allTokens[index - 2];
							if (!withinTypeDeclarationAttr && !isGroupingAttribute && !XsltTokenDiagnostics.isRequiredNodeTypeContext(prevToken, prevToken2) && !XsltTokenDiagnostics.contextItemExists(elementStack, xpathStack, insideGlobalFunction, false, rootOperandContext)) {
								if (!(token.value === '?' || token.value === '+' || (token.value === '*' && prevToken.value === ')' || prevToken.value === '()' || prevToken.value === 'as'))) {
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
						if (token.value.startsWith('#')) {
							// XPath 4.0 QName literal, e.g. #xml:lang
							const qNamePrefixEnd = token.value.indexOf(':');
							const qNamePrefix = qNamePrefixEnd === -1 ? '' : token.value.substring(1, qNamePrefixEnd);
							if (!XsltTokenDiagnostics.isXPath40(docType)) {
								token.error = ErrorType.QNameLiteralRequiresXPath40;
								problemTokens.push(token);
							} else if (qNamePrefix !== '' && qNamePrefix !== 'xml' && inheritedPrefixes.indexOf(qNamePrefix) === -1) {
								token.error = ErrorType.XPathPrefix;
								problemTokens.push(token);
							} else {
								XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
							}
							break;
						}
						let { isValid, qFunctionName, fErrorType } = XsltTokenDiagnostics.isValidFunctionName(docType, inheritedPrefixes, xsltPrefixesToURIs, token, checkedGlobalFnNames);
						if (!isValid) {
							token['error'] = fErrorType;
							token['value'] = qFunctionName;
							problemTokens.push(token);
						}
						break;
					case TokenLevelState.function:
						XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
						break;
					case TokenLevelState.number:
						if (!XsltTokenDiagnostics.isXPath40(docType) && XsltTokenDiagnostics.isXPath40Number(token.value)) {
							token.error = ErrorType.NumberRequiresXPath40;
							problemTokens.push(token);
						} else if (XsltTokenDiagnostics.validateNumber(token.value)) {
							XsltTokenDiagnostics.checkTokenIsExpected(prevToken, token, problemTokens);
						} else {
							token.error = ErrorType.XPathNumber;
							problemTokens.push(token);
						}
						break;
					case TokenLevelState.simpleType:
						let tValue = token.value;
						let tParts = tValue.split(':');
						let isValidType = false;
						let isNodeName = false;
						if (withinTypeDeclarationAttr && prevToken?.charType === CharLevelState.lB && index > 1) {
							const prevToken2 = allTokens[index - 2];
							isNodeName = prevToken2.tokenType === TokenLevelState.nodeType && (prevToken2.value === 'element' || prevToken2.value === 'attribute');
						}
						if (isNodeName) {
							isValidType = true;
							let validationError = XsltTokenDiagnostics.validateName(tValue, ValidationType.Name, docType, inheritedPrefixes, undefined);
							if (validationError !== NameValidationError.None) {
								token['error'] = validationError === NameValidationError.NameError ? ErrorType.XMLName : validationError === NameValidationError.NamespaceError ? ErrorType.XMLXMLNS : ErrorType.XSLTInstrUnexpected;
								token['value'] = tValue;
								problemTokens.push(token);
							}
						} else if ((tValue === '*' || tValue === '?' || tValue === '+') && index > 2 && prevToken?.tokenType === TokenLevelState.simpleType &&
							!(prevToken.value === '*' || prevToken.value === '?' || prevToken.value === '+')) {
							// occurrence indicator on the type in 'treat as', 'instance of', 'cast as' or 'castable as' - e.g. 5 instance of xs:integer+
							// only '?' is permitted for the single type in 'cast as' and 'castable as'
							const typeOperator = allTokens[index - 3].value;
							isValidType = tValue === '?' || !(typeOperator === 'cast' || typeOperator === 'castable');
						} else if ((withinTypeDeclarationAttr || XsltTokenDiagnostics.isAnonymousFunctionParams(stackItem)) && (tValue === '*' || tValue === '?' || tValue === '+' || tValue.startsWith('~'))) {
							// e.g. xs:integer* don't check name - also valid for an anonymous function's inline 'as' type declaration, e.g. function($i as xs:integer*) {...}
							isValidType = true;
						} else if (tParts.length === 1) {
							let nextToken = allTokens.length > index + 1 ? allTokens[index + 1] : null;

							if (nextToken && (nextToken.charType === CharLevelState.lB || (nextToken.charType === CharLevelState.dSep && nextToken.value === '()'))) {
								isValidType = Data.nodeTypes.indexOf(tParts[0]) > -1;
								if (!isValidType) {
									isValidType = Data.nonFunctionTypes.indexOf(tParts[0]) > -1 || tParts[0] === 'fn';
								}
								if (isValidType && XsltTokenDiagnostics.checkItemTypeVersion(token, docType)) {
									problemTokens.push(token);
									isTypeError = true;
								}
							} else {
								// XPath 4.0 named item type, declared with xsl:item-type
								isValidType = XsltTokenDiagnostics.isXPath40(docType) && globalItemTypeNames.includes(tValue);
							}
						} else if (tParts.length === 2) {
							let nsType = xsltPrefixesToURIs.get(tParts[0]);
							if (nsType !== undefined) {
								if (nsType === XSLTnamespaces.XMLSchema) {
									const part2 = tParts[1];
									if (part2 === 'numeric' || part2 === 'anyAtomicType') {
										isValidType = true;
									} else {
										isValidType = FunctionData.schema.indexOf(tParts[1] + '#1') > -1;
									}
								} 
							} else if (inheritedPrefixes.indexOf(tParts[0]) !== -1) {
								// the namespace prefix is declared: in XSLT 4.0 the type must be declared with xsl:item-type,
								// except for the type annotation in element(*, my:type) - schema-aware processing is not supported
								const isTypeAnnotation = ['element', 'attribute', 'schema-element', 'schema-attribute'].includes(XsltTokenDiagnostics.enclosingTypeName(xpathStack) ?? '');
								isValidType = docType !== DocumentTypes.XSLT40 || isTypeAnnotation || globalItemTypeNames.includes(tValue);
								if (!isValidType) {
									token.error = ErrorType.UndeclaredItemType;
									problemTokens.push(token);
								}
							}
						}
						if (!isValidType && !token.error) {
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
				if (!token.error && prevToken?.charType === CharLevelState.dSep && (prevToken.value === '=>' || prevToken.value === '=!>')) {
					let isValid = false;
					if (xpathTokenType !== TokenLevelState.function) {
						// the implicit first argument only applies to a static function call, not to a dynamic call
						incrementFunctionArity = false;
					}
					if (xpathCharType === CharLevelState.lB || xpathTokenType === TokenLevelState.function) {
						isValid = true;
					} else if (xpathTokenType === TokenLevelState.anonymousFunction || xpathTokenType === TokenLevelState.functionNameTest ||
						xpathCharType === CharLevelState.lPr || xpathCharType === CharLevelState.lBr ||
						(xpathTokenType === TokenLevelState.operator && (token.value === 'map' || token.value === 'array'))) {
						// XPath 4.0 dynamic call on an inline function, named function reference, map or array constructor
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
		XsltTokenDiagnostics.checkAccumulatorsApplicable(globalInstructionData, importedInstructionData, problemTokens);
		if (docType === DocumentTypes.XSLT40) {
			XsltTokenDiagnostics.checkItemTypeDeclarations(globalInstructionData, importedInstructionData, itemTypeDeclarations, xsltPrefixesToURIs, document.uri.fsPath, problemTokens);
		}
		let variableRefDiagnostics = XsltTokenDiagnostics.getDiagnosticsFromUnusedVariableTokens(document, xsltVariableDeclarations, unresolvedXsltVariableReferences, includeOrImport);
		// a lexical '<' in XPath within XML, marked by the lexer on any type of token
		const reportedTokens = new Set(problemTokens);
		allTokens.forEach((token) => {
			if ((token.error === ErrorType.XPathLessThanInAttribute || token.error === ErrorType.XPathLessThanTagStart) && !reportedTokens.has(token)) {
				problemTokens.push(token);
			}
		});
		let allDiagnostics = XsltTokenDiagnostics.appendDiagnosticsFromProblemTokens(variableRefDiagnostics, problemTokens);
		return allDiagnostics;
	};

	private static findFunctionDeclaration(allTokens: BaseToken[], index: number) {
		const nextToken = XsltTokenDiagnostics.nextNonCommentToken(allTokens, index)?.value;
		let foundDeclaration = (nextToken === '{' || nextToken === '{}');
		if (!foundDeclaration && nextToken === 'as') {
			// crude test to get '{' in next 20 tokens
			// allows for fairly complex types like map{map(xs:string, xs:string)}
			// without texting the type properly
			for (let i = 1; i < 30; i++) {
				const b = XsltTokenDiagnostics.nextNonCommentToken(allTokens, index + i);
				if (!b || b.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber) {
					break;
				}
				const s = b?.value;
				if (s) {
					foundDeclaration = (s === '{' || s === '{}');
					if (foundDeclaration) {
						break;
					}
				} else {
					break;
				}
			}
		}
		return foundDeclaration;
	}

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

	private static contextItemExists(elementStack: ElementData[], xpathStack: XPathData[], insideGlobalFunction: boolean, forFunctionNamedCurrent = false, rootOperandContext: OperandContext = {}) {
		if (!insideGlobalFunction) return true;

		const foundForEach = elementStack.find((item) => item.symbolName === 'xsl:for-each' || item.symbolName === 'xsl:for-each-group' ||
			item.symbolName === 'xsl:source-document' || item.symbolName === 'xsl:merge-source' ||
			item.symbolName === 'xsl:iterate' || item.symbolName === 'xsl:copy' || item.symbolName === 'xsl:analyze-string' || item.symbolName === 'xsl:perform-sort');
		if (foundForEach) return true;
		let foundContextBracketsOrPredicate: boolean;
		if (forFunctionNamedCurrent) {
			// need to ignore predicates, pipeline and simple map operators from xpath stack
			foundContextBracketsOrPredicate = !!xpathStack.find((item) => item.token.charType !== CharLevelState.lPr && item.hasContextItem === true);
		} else {
			const hasOperandContext = (item: OperandContext) => item.hasPipelineContext === true || item.hasSimpleMapContext === true;
			foundContextBracketsOrPredicate = hasOperandContext(rootOperandContext) || !!xpathStack.find((item) => item.hasContextItem === true || hasOperandContext(item));
		}
		return foundContextBracketsOrPredicate;
	}

	// xsl:item-type declarations in this document:
	// - XTSE4030: no two with the same name and import precedence - i.e. in this document, or in a module it includes (a module it imports
	//   has lower precedence, so a declaration here overrides it). Saxon 13 doesn't report this, and uses the last declaration, so it's a warning
	// - the name must not be in a reserved namespace, e.g. xs:point (Saxon 13 reports XTSE0080)
	// - XTSE4035: a named item type must not refer to itself, directly or through other named item types
	private static checkItemTypeDeclarations(globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], itemTypeDeclarations: Map<string, string>,
		xsltPrefixesToURIs: Map<string, XSLTnamespaces>, documentPath: string, problemTokens: BaseToken[]) {
		const localItemTypes = globalInstructionData.filter((g) => g.type === GlobalInstructionType.ItemType);
		const includedPaths = globalInstructionData.filter((g) => g.type === GlobalInstructionType.Include).map((g) => path.resolve(path.dirname(documentPath), g.name));
		const includedItemTypeNames = importedInstructionData.filter((g) => g.type === GlobalInstructionType.ItemType && g.href && includedPaths.includes(path.resolve(g.href))).map((g) => g.name);
		const reservedNamespaces = [XSLTnamespaces.XMLSchema, XSLTnamespaces.XPath, XSLTnamespaces.XSLT, XSLTnamespaces.Map, XSLTnamespaces.Array, XSLTnamespaces.Math];
		const seenNames: string[] = [];
		localItemTypes.forEach((itemType) => {
			const prefix = itemType.name.includes(':') ? itemType.name.substring(0, itemType.name.indexOf(':')) : undefined;
			const nsType = prefix ? xsltPrefixesToURIs.get(prefix) : undefined;
			if (nsType !== undefined && reservedNamespaces.includes(nsType)) {
				problemTokens.push({ ...itemType.token, error: ErrorType.ItemTypeReservedNamespace, value: itemType.name });
			} else if (XsltTokenDiagnostics.isCircularItemType(itemType.name, itemTypeDeclarations)) {
				problemTokens.push({ ...itemType.token, error: ErrorType.ItemTypeCircular, value: itemType.name });
			} else if (seenNames.includes(itemType.name) || includedItemTypeNames.includes(itemType.name)) {
				problemTokens.push({ ...itemType.token, error: ErrorType.ItemTypeDuplicate, value: itemType.name });
			}
			seenNames.push(itemType.name);
		});
	}

	// true if the named item type refers to itself, e.g. record(a as t) for t, or through other named item types
	private static isCircularItemType(name: string, itemTypeDeclarations: Map<string, string>) {
		const referencedNames = (typeName: string) => {
			const declaredType = itemTypeDeclarations.get(typeName);
			if (!declaredType) {
				return [];
			}
			// the item type names in the 'as' attribute - lexed as a type declaration, so record field names aren't included
			const tokens = new XPathLexer().analyse(declaredType, ExitCondition.None, { line: 0, startCharacter: 0, documentOffset: 0 }, true);
			return tokens.filter((t) => t.tokenType === TokenLevelState.simpleType && itemTypeDeclarations.has(t.value)).map((t) => t.value);
		};
		const visited = new Set<string>();
		const pending = referencedNames(name);
		while (pending.length > 0) {
			const next = pending.pop()!;
			if (next === name) {
				return true;
			}
			if (!visited.has(next)) {
				visited.add(next);
				pending.push(...referencedNames(next));
			}
		}
		return false;
	}

	// an accumulator is only applicable to the principal source document if it's listed in the initial mode's use-accumulators
	// (otherwise XTDE3362 is raised at run time), or to an xsl:source-document or xsl:merge-source tree if listed there -
	// it's applicable to documents loaded with doc() etc. regardless. So a warning, for accumulators declared in this document
	// that aren't listed in any use-accumulators attribute, here or in an included or imported module
	private static checkAccumulatorsApplicable(globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[], problemTokens: BaseToken[]) {
		const usedNames = globalInstructionData.concat(importedInstructionData).filter((g) => g.type === GlobalInstructionType.AccumulatorUse).map((g) => g.name);
		if (usedNames.includes('#all')) {
			return;
		}
		globalInstructionData.filter((g) => g.type === GlobalInstructionType.Accumulator && !usedNames.includes(g.name)).forEach((accumulator) => {
			problemTokens.push({ ...accumulator.token, error: ErrorType.AccumulatorNotApplicable, value: accumulator.name });
		});
	}

	private static textForTokenRange(document: vscode.TextDocument, allTokens: BaseToken[], range: [number, number]) {
		const first = allTokens[range[0]];
		const last = allTokens[range[1]];
		return document.getText(new vscode.Range(first.line, first.startCharacter, last.line, last.startCharacter + last.length));
	}

	// the xsl:variable or xsl:param in scope with the name, not including globals - these are resolved from the global instruction data
	private static findLocalVariable(name: string, inScopeVariablesList: VariableData[], elementStack: ElementData[], globalVariableData: VariableData[]) {
		const findIn = (list: VariableData[]) => {
			for (let i = list.length - 1; i > -1; i--) {
				if (list[i].name === name) {
					return list[i];
				}
			}
			return undefined;
		};
		let found = findIn(inScopeVariablesList);
		for (let i = elementStack.length - 1; !found && i > -1; i--) {
			if (elementStack[i].variables !== globalVariableData) {
				found = findIn(elementStack[i].variables);
			}
		}
		return found;
	}

	private static isAnonymousFunctionParams(item: XPathData | undefined): item is XPathData {
		// within the parameter list of an inline function: function($a, $b) or fn($a, $b)
		const ctx = item?.token.context;
		return !!ctx && item?.token.charType === CharLevelState.lB && (ctx.value === 'function' || (ctx.value === 'fn' && ctx.tokenType === TokenLevelState.anonymousFunction));
	}

	private static functionNamesWithArity(instruction: GlobalInstructionData) {
		// e.g. ['f:add#1', 'f:add#2'] for a function with one required and one optional parameter
		const total = instruction.idNumber;
		const optionalCount = instruction.memberOptional ? instruction.memberOptional.filter((o) => o).length : 0;
		const names: string[] = [];
		for (let arity = total - optionalCount; arity <= total; arity++) {
			names.push(instruction.name + '#' + arity);
		}
		return names;
	}

	private static addUserFunctionParams(userFunctionParams: Map<string, string[][]>, instruction: GlobalInstructionData) {
		const paramLists = userFunctionParams.get(instruction.name) ?? [];
		paramLists.push(instruction.memberNames ?? []);
		userFunctionParams.set(instruction.name, paramLists);
	}

	private static checkOptionalParams(instruction: GlobalInstructionData, docType: DocumentTypes, problemTokens: BaseToken[]) {
		// XSLT 4.0: optional function parameters, xsl:param required="no", must follow any required parameters
		const optional = instruction.memberOptional ?? [];
		const tokens = instruction.memberTokens ?? [];
		const names = instruction.memberNames ?? [];
		let optionalFound = false;
		optional.forEach((isOptional, i) => {
			const paramToken = tokens[i];
			if (!paramToken) {
				return;
			}
			paramToken.value = names[i] ?? paramToken.value;
			if (isOptional && docType !== DocumentTypes.XSLT40) {
				paramToken.error = ErrorType.OptionalParamRequiresXSLT40;
				problemTokens.push(paramToken);
			} else if (!isOptional && optionalFound) {
				paramToken.error = ErrorType.RequiredParamAfterOptional;
				problemTokens.push(paramToken);
			}
			optionalFound = optionalFound || isOptional;
		});
	}

	private static builtInParamNamesCache = new Map<typeof XPathFunctionDetails.data, Map<string, string[]>>();

	private static builtInParamNames(docType: DocumentTypes, functionName: string) {
		// parameter names from the function signatures, e.g. subsequence($input as item()*, $start as xs:numeric, ...)
		const data = XsltTokenDiagnostics.isXPath40(docType) ? XPathFunctionDetails.dataPlus40 : XPathFunctionDetails.data;
		let names = XsltTokenDiagnostics.builtInParamNamesCache.get(data);
		if (!names) {
			names = new Map();
			for (const item of data) {
				const params = XsltTokenDiagnostics.signatureParamNames(item.signature);
				names.set(item.name, (names.get(item.name) ?? []).concat(params));
			}
			XsltTokenDiagnostics.builtInParamNamesCache.set(data, names);
		}
		return names.get(functionName);
	}

	private static signatureParamNames(signature: string) {
		// the '$name' of each top-level parameter in the signature's parameter list
		const params: string[] = [];
		let depth = 0;
		for (let i = signature.indexOf('('); i > -1 && i < signature.length; i++) {
			const ch = signature[i];
			if (ch === '(' || ch === '[' || ch === '{') {
				depth++;
			} else if (ch === ')' || ch === ']' || ch === '}') {
				if (--depth === 0) {
					break;
				}
			} else if (ch === '$' && depth === 1) {
				const match = /^\$([\w.-]+)/.exec(signature.substring(i));
				if (match) {
					params.push(match[1]);
				}
			}
		}
		return params;
	}

	private static checkKeywordArgument(token: BaseToken, callItem: XPathData | undefined, docType: DocumentTypes, userFunctionParams: Map<string, string[][]>, xsltPrefixesToURIs: Map<string, XSLTnamespaces>) {
		if (!XsltTokenDiagnostics.isXPath40(docType)) {
			token.error = ErrorType.KeywordArgumentRequiresXPath40;
			return;
		}
		const functionToken = callItem?.function;
		if (!callItem || !functionToken) {
			return;
		}
		const keywordNames = callItem.keywordNames ?? [];
		if (keywordNames.includes(token.value)) {
			token.error = ErrorType.KeywordArgumentDuplicate;
			return;
		}
		callItem.keywordNames = keywordNames.concat([token.value]);
		// the known parameter names for the function, if any
		let paramNames: string[] | undefined;
		const userParams = userFunctionParams.get(functionToken.value);
		if (userParams) {
			paramNames = userParams.flat();
		} else {
			const parts = functionToken.value.split(':');
			const nsType = parts.length === 2 ? xsltPrefixesToURIs.get(parts[0]) : XSLTnamespaces.XPath;
			const prefix = nsType === XSLTnamespaces.Map ? 'map:' : nsType === XSLTnamespaces.Array ? 'array:' : nsType === XSLTnamespaces.Math ? 'math:' : nsType === XSLTnamespaces.XPath ? '' : undefined;
			if (prefix !== undefined) {
				paramNames = XsltTokenDiagnostics.builtInParamNames(docType, prefix + parts[parts.length - 1]);
			}
		}
		if (paramNames && !paramNames.includes(token.value)) {
			token.error = ErrorType.KeywordArgumentUnknown;
			token.value = token.value + '#' + functionToken.value;
		}
	}

	// the item type whose parentheses enclose the current token, e.g. 'record' for record(a as xs:string)
	private static enclosingTypeName(xpathStack: XPathData[]) {
		const lastStackEntry = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : undefined;
		if (!lastStackEntry || lastStackEntry.token.charType !== CharLevelState.lB) {
			return undefined;
		}
		return lastStackEntry.function ? lastStackEntry.function.value : lastStackEntry.token.context?.value;
	}

	private static isOptionalFieldMarker(token: BaseToken, prevToken: BaseToken | null) {
		// e.g. record(a? as xs:string, 'b c'? as xs:integer)
		return token.value === '?' && !!prevToken && (prevToken.tokenType === TokenLevelState.nodeNameTest || prevToken.tokenType === TokenLevelState.string);
	}

	// sets an error on an XPath 4.0 item type used with XPath 3.1, or an obsolete Saxon item type, returning true if set
	private static checkItemTypeVersion(token: BaseToken, docType: DocumentTypes) {
		if (XsltTokenDiagnostics.obsoleteItemTypes.includes(token.value)) {
			token.error = ErrorType.ObsoleteItemType;
		} else if (XsltTokenDiagnostics.itemTypes40.includes(token.value) && !XsltTokenDiagnostics.isXPath40(docType)) {
			token.error = ErrorType.ItemTypeRequiresXPath40;
		}
		return !!token.error;
	}

	// for the ')' at closeIndex, the operator before its '(', e.g. 'castable' for castable as (xs:date | xs:time)
	private static typeOperatorBeforeParen(allTokens: BaseToken[], closeIndex: number) {
		let depth = 0;
		for (let i = closeIndex; i > -1; i--) {
			const t = allTokens[i];
			if (t.charType === CharLevelState.rB) {
				depth++;
			} else if (t.charType === CharLevelState.lB && --depth === 0) {
				return i > 1 && allTokens[i - 1].value === 'as' ? allTokens[i - 2].value : undefined;
			}
		}
		return undefined;
	}

	// XSLT 4.0 stylesheets and XPath documents (e.g. .xpath files) use XPath 4.0
	private static isXPath40(docType: DocumentTypes) {
		return docType === DocumentTypes.XSLT40 || docType === DocumentTypes.XPath;
	}

	private static isOperandExpected(prevToken: BaseToken | null) {
		// true if the previous token cannot end an operand - so a '{' here starts a map constructor rather than an enclosed expression
		// e.g. a function body, as in function($a) as xs:integer* { $a }, or the braced action in if ($a) { 1 }
		if (!prevToken || prevToken.tokenType >= XsltTokenDiagnostics.xsltStartTokenNumber || prevToken.tokenType === TokenLevelState.complexExpression) {
			return true;
		}
		if (prevToken.tokenType !== TokenLevelState.operator) {
			return false;
		}
		switch (prevToken.charType) {
			case CharLevelState.lB:
			case CharLevelState.lPr:
			case CharLevelState.lBr:
			case CharLevelState.sep:
				return true;
			case CharLevelState.dSep:
				return !(prevToken.value === '()' || prevToken.value === '[]' || prevToken.value === '{}' || prevToken.value === '..');
			case CharLevelState.lName:
				// e.g. 'and', 'div', 'to' - but not 'map' or 'array' which have their own braces
				return !(prevToken.value === 'map' || prevToken.value === 'array');
			default:
				return false;
		}
	}

	private static isEndOfOperand(token: BaseToken) {
		// used to distinguish a binary operator from a unary operator or wildcard
		if (token.tokenType !== TokenLevelState.operator) {
			return token.tokenType !== TokenLevelState.complexExpression;
		}
		return token.charType === CharLevelState.rB || token.charType === CharLevelState.rPr || token.charType === CharLevelState.rBr ||
			(token.charType === CharLevelState.dSep && (token.value === '()' || token.value === '[]' || token.value === '{}'));
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
		let expectedAttributes: string[] | undefined = [];

		if (schemaQuery?.docType === DocumentTypes.DCP ||
			(parentName.startsWith('xsl:') && schemaQuery && schemaQuery.docType === DocumentTypes.XSLT) ||
			(parentName.startsWith('sch:') && schemaQuery && schemaQuery.docType === DocumentTypes.SCH)) {
			const allExpected = schemaQuery.getExpected(parentName);
			const nameDetailArray = allExpected.elements;
			expectedElements = nameDetailArray.map(item => item[0]);
			// undefined: attribute names are not checked against the schema
			expectedAttributes = allExpected.anyAttribute ? undefined : allExpected.attrs;
		} else if (elementStack.length > 0) {
			expectedElements = elementStack[elementStack.length - 1].expectedChildElements;
		} else {
			expectedElements = [];
		}
		return [expectedElements, expectedAttributes] as [string[], string[] | undefined];
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
		if (token.error || token.charType === CharLevelState.mBt || token.charType === CharLevelState.rBt) {
			// string template middle/closing parts always follow the '}' of a variable part
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
		} else if (tokenType === TokenLevelState.nodeType) {
			errDoubleSeparators = ['{}', '[]', '()', '*:'];
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
				} else if (prevToken.tokenType === TokenLevelState.nodeType) {
					if (token.value === '()') {
						isXPathError = prevToken.value.charAt(0) === '.';
					} else {
						isXPathError = true;
					}
				} else if (prevToken.tokenType === TokenLevelState.operator) {
					if (prevToken.charType === CharLevelState.rB || prevToken.charType === CharLevelState.rPr || prevToken.charType === CharLevelState.rBr) {
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

	private static validateNumber(text: string) {
		if (text.startsWith('0x')) {
			return /^0x[0-9a-fA-F]+(_+[0-9a-fA-F]+)*$/.test(text);
		} else if (text.startsWith('0b')) {
			return /^0b[01]+(_+[01]+)*$/.test(text);
		} else if (text.includes('_') && /(^|[^0-9_])_|_($|[^0-9_])/.test(text)) {
			// XPath 4.0 '_' digit separators are only allowed between digits
			return false;
		}
		const number = Number(text.replace(/_/g, ''));
		return !isNaN(number) && isFinite(number);
	}

	// XPath 4.0 hexadecimal and binary integer literals, and '_' digit separators
	private static isXPath40Number(text: string) {
		return text.startsWith('0x') || text.startsWith('0b') || text.includes('_');
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
		const useXPath40 = XsltTokenDiagnostics.isXPath40(docType);
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
			if (tokenValue.startsWith('~')) {
				// reported as a type node test, e.g. ~record(a, b)
				isValid = true;
			} else if (tokenValue === 'concat') {
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
						if (tokenValue.endsWith(':concat')) {
							isValid = arity > 0;
						} else {
							isValid = FunctionData.xpath40.indexOf(fNameParts[1]) > -1;
						}
						if (isValid) {
							isParseHTMLFnWarning = tokenValue.endsWith(':parse-html');
						}
						break;
					case XSLTnamespaces.Array:
						isValid = FunctionData.array40.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Map:
						isValid = FunctionData.map40.indexOf(fNameParts[1]) > -1;
						break;
					case XSLTnamespaces.Math:
						isValid = FunctionData.math40.indexOf(fNameParts[1]) > -1;
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
						if (tokenValue.endsWith(':concat')) {
							isValid = arity > 0;
						} else {
							isValid = FunctionData.xpath.indexOf(fNameParts[1]) > -1;
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
		if (!isValid && (fErrorType === ErrorType.XPathFunction || fErrorType === ErrorType.XPathFunctionNamespace) && tokenValue.startsWith('xdm:debug')) {
			fErrorType = ErrorType.XPathFunctionXdmDebug;
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
					msg = `XPath: Invalid axis name: '${tokenValue}'`;
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
				case ErrorType.XPathTypeEmptyArity:
					msg = `XPath Type: Expected type specifier within '${tokenValue}'`;
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
				case ErrorType.OperatorNotSupported:
					msg = `XPath: The '${tokenValue}' operator is not supported by Saxon 13 - for a conditional use if (...) then ... else ...`;
					break;
				case ErrorType.NodeTestRequiresXPath40:
					msg = `XPath: The '${tokenValue}(...)' node test requires XPath 4.0`;
					break;
				case ErrorType.TypeNodeTestNotSupported:
					msg = `XPath: Type node tests, e.g. ~record(...) or ~xs:string, are not supported by Saxon 13: '${tokenValue}'`;
					break;
				case ErrorType.RecordStepNeedsJtree:
					msg = `XPath: A value with the record type ${tokenValue} must be converted with jtree() before '/', e.g. jtree($value)/field (Saxon 13 reports XPTY0019)`;
					break;
				case ErrorType.RecordStepUnknown: {
					const [field, recordName] = tokenValue.split(RecordTypes.valueSeparator);
					msg = `XPath: Child step '${field}' - this is not a field of the record type: ${recordName}`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				}
				case ErrorType.ItemTypeDuplicate:
					msg = `XSLT: Duplicate xsl:item-type name '${tokenValue}' - not allowed for declarations with the same import precedence (XTSE4030). Saxon 13 uses the last declaration`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				case ErrorType.ItemTypeReservedNamespace:
					msg = `XSLT: The xsl:item-type name '${tokenValue}' is in a reserved namespace`;
					break;
				case ErrorType.ItemTypeCircular:
					msg = `XSLT: The item type '${tokenValue}' refers to itself, directly or through other named item types (XTSE4035)`;
					break;
				case ErrorType.AccumulatorNotApplicable:
					msg = `XSLT: The accumulator '${tokenValue}' is not listed in any use-accumulators attribute, e.g. on xsl:mode, so it only applies to documents loaded with functions such as doc()`;
					severity = vscode.DiagnosticSeverity.Warning;
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
				case ErrorType.ItemTypeRequiresXPath40:
					msg = `XPath: The '${tokenValue}(...)' item type requires XPath 4.0`;
					break;
				case ErrorType.ChoiceTypeRequiresXPath40:
					msg = `XPath: Choice item types, e.g. (xs:date | xs:time), require XPath 4.0`;
					break;
				case ErrorType.ObsoleteItemType:
					msg = tokenValue === 'union' ? `XPath: 'union(...)' is not supported - use a choice item type instead, e.g. (xs:date | xs:time)` :
						tokenValue === 'type' ? `XPath: 'type(...)' is not supported - use the named item type directly, e.g. my:type instead of type(my:type)` :
						`XPath: '${tokenValue}(...)' is not supported - use 'record(...)' instead`;
					break;
				case ErrorType.InlineFunctionFnRequiresXPath40:
					msg = `XPath: The 'fn' keyword for inline functions requires XPath 4.0 - use 'function' instead`;
					break;
				case ErrorType.FocusFunctionRequiresXPath40:
					msg = `XPath: Focus functions, e.g. ${tokenValue} { . + 1 }, require XPath 4.0`;
					break;
				case ErrorType.KeywordArgumentRequiresXPath40:
					msg = `XPath: Keyword arguments, e.g. ${tokenValue} := value, require XPath 4.0`;
					break;
				case ErrorType.KeywordArgumentUnknown: {
					const [keyword, fnName] = tokenValue.split('#');
					msg = `XPath: The function '${fnName}' has no parameter named '${keyword}'`;
					break;
				}
				case ErrorType.KeywordArgumentDuplicate:
					msg = `XPath: Duplicate keyword argument: '${tokenValue}'`;
					break;
				case ErrorType.PositionalArgumentAfterKeyword:
					msg = `XPath: A positional argument cannot follow a keyword argument`;
					break;
				case ErrorType.NamespaceDeclRequiresXPath40:
					msg = `XPath: Namespace declarations in an XPath expression require XPath 4.0`;
					break;
				case ErrorType.NamespaceDeclOrder:
					msg = `XPath: 'declare default element namespace' must come before any 'declare namespace'`;
					break;
				case ErrorType.NamespaceDeclSemicolon:
					msg = `XPath: Expected ';' after the namespace declaration's URI: ${tokenValue}`;
					break;
				case ErrorType.OptionalParamRequiresXSLT40:
					msg = `XSLT: Optional function parameters, with required="no", require XSLT 4.0: '${tokenValue}'`;
					break;
				case ErrorType.RequiredParamAfterOptional:
					msg = `XSLT: A required function parameter cannot follow an optional parameter: '${tokenValue}'`;
					break;
				case ErrorType.RecordFieldMissing: {
					const [field, recordName] = tokenValue.split(RecordTypes.valueSeparator);
					msg = `XPath: Record field '${field}' is missing - it's required by the record type: ${recordName}`;
					break;
				}
				case ErrorType.RecordFieldUnknown: {
					const [field, recordName] = tokenValue.split(RecordTypes.valueSeparator);
					msg = `XPath: '${field}' is not a field of the record type: ${recordName}`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				}
				case ErrorType.RecordFieldValueType: {
					const [field, fieldType] = tokenValue.split(RecordTypes.valueSeparator);
					msg = `XPath: The value for record field '${field}' must be of type: ${fieldType}`;
					break;
				}
				case ErrorType.RecordLookupUnknown: {
					const [field, recordName] = tokenValue.split(RecordTypes.valueSeparator);
					msg = `XPath: Lookup of '${field}' - this is not a field of the record type: ${recordName}`;
					severity = vscode.DiagnosticSeverity.Warning;
					break;
				}
				case ErrorType.UndeclaredItemType:
					msg = `XPath: The item type '${tokenValue}' is not declared - expected an xsl:item-type declaration with this name`;
					break;
				case ErrorType.ExtensibleRecordType:
					msg = `XPath: Extensible record types, e.g. record(*), are not supported by Saxon 13 - use map(*) instead`;
					break;
				case ErrorType.XPathLessThanInAttribute:
					msg = `XML: A '<' character is not allowed in an attribute value - use '&lt;' instead: '${tokenValue}'`;
					break;
				case ErrorType.XPathLessThanTagStart:
					msg = `XPath: Expected '}' to end the text value template before '<' - use '&lt;' for the less-than operator`;
					break;
				case ErrorType.EnclosedModeName:
					msg = `XSLT: An xsl:mode with enclosed xsl:template elements must have a name attribute`;
					break;
				case ErrorType.EnclosedTemplateAttribute:
					msg = `XSLT: A template rule enclosed within xsl:mode must not have a '${tokenValue}' attribute`;
					break;
				case ErrorType.EnclosedTemplateMatch:
					msg = `XSLT: A template rule enclosed within xsl:mode must have a match attribute`;
					break;
				case ErrorType.QNameLiteralRequiresXPath40:
					msg = `XPath: The QName literal '${tokenValue}' requires XPath 4.0`;
					break;
				case ErrorType.TypedBindingRequiresXPath40:
					msg = `XPath: A type declaration with 'as' for a variable binding requires XPath 4.0`;
					break;
				case ErrorType.ForKeyValueRequiresXPath40:
					msg = `XPath: 'for ${tokenValue}' map bindings require XPath 4.0`;
					break;
				case ErrorType.NumberRequiresXPath40:
					msg = `XPath: Hexadecimal and binary numeric literals, and '_' digit separators, require XPath 4.0: '${tokenValue}'`;
					break;
				case ErrorType.AxisRequiresXPath40:
					msg = `XPath: The axis '${tokenValue}' requires XPath 4.0`;
					break;
				case ErrorType.MapConstructorRequiresXPath40:
					msg = `XPath: A map constructor without the 'map' keyword requires XPath 4.0`;
					break;
				case ErrorType.BracedIfRequiresXPath40:
					msg = `XPath: An 'if' expression without 'then' and 'else' requires XPath 4.0`;
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
				case ErrorType.XPathTypeFullArity:
					let parts2 = tokenValue.split('#');
					const arityMsg = parts2[2];
					const arityNum = parts2[1];
					const typeName = parts2[0];
					msg = `XPath Type: Expected number of itemType arguments for '${typeName}()' is ${arityMsg} but found: ${arityNum}`;
					break;
				case ErrorType.XPathFunctionParseHtml:
					errCode = DiagnosticCode.parseHtmlRef;
					severity = vscode.DiagnosticSeverity.Warning;
					msg = `XPath: The 'parse-html' function requires the 'htmlParserJar' setting when invoked from VS Code`;
					break;
				case ErrorType.XPathFunctionXdmDebug:
					errCode = DiagnosticCode.xdmDebugRef;
					severity = vscode.DiagnosticSeverity.Warning;
					msg = `XPath: 'xdm:debug/debug-color' function not defined - use QuickFix`;
					break;
				case ErrorType.XPathTypeName:
					msg = `XPath: Invalid type: '${tokenValue}'`;
					break;
				case ErrorType.XPathNumber:
					msg = `XPath: Invalid numeric literal: '${tokenValue}'`;
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
					msg = `XPath: Unexpected token '${tokenValue}' - expected syntax: \n'function($v) {expression} or\n'function($v as <TYPE>) as <TYPE> {expression}'`;
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
