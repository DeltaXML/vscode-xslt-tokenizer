import * as vscode from 'vscode';
import { XSLTnamespaces, FunctionData } from './functionData';
import { XSLTConfiguration } from './languageConfigurations';
import { SchemaQuery } from './schemaQuery';
import { LexPosition, BaseToken, CharLevelState, Data, ErrorType, TokenLevelState, XPathLexer } from './xpLexer';
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, LanguageConfiguration, XMLCharState, XslLexer, XSLTokenLevelState } from './xslLexer';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { XsltTokenDefinitions } from './xsltTokenDefintions';
import { AttributeType, TagType, XSLTToken, XsltTokenDiagnostics, ElementData, XPathData, VariableData, ValidationType, CurlyBraceType} from './xsltTokenDiagnostics';
import * as url from 'url';

export class XSLTReferenceProvider implements vscode.ReferenceProvider {

	private xslLexer: XslLexer;
	public constructor() {
		this.xslLexer = new XslLexer(XSLTConfiguration.configuration);
		this.xslLexer.provideCharLevelState = true;
	}

	async provideReferences(document: vscode.TextDocument, position: vscode.Position, context: vscode.ReferenceContext, token: vscode.CancellationToken): Promise<vscode.Location[] | null | undefined> {
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		const langConfig = XSLTConfiguration.configuration;
		// TODO: first check if position is on a definition already
		const dProvider = new XsltDefinitionProvider(langConfig);
		const definition = await dProvider.seekDefinition(document, position, token);
		let locations: vscode.Location[] = [];
		if (definition) {
			const { instruction, extractedImportData: eid } = definition;
			if (instruction && eid) {
				// find all references to this instruction
				let refTokens = XSLTReferenceProvider.calculateReferences(instruction, langConfig, langConfig.docType, document, eid.allTokens, eid.globalInstructionData, eid.allImportedGlobals);
				const refLocations = refTokens.map(token => XsltTokenDefinitions.createLocationFromToken(token, document));
				locations = refLocations;
        locations.push(definition);
				for (let index = 0; index < eid.accumulatedHrefs.length; index++) {
					const currentHref = eid.accumulatedHrefs[index];
					if (currentHref === document.fileName) {
						continue;
					}
					try {
						const pathForUri = url.pathToFileURL(currentHref).toString();
						const docUri = vscode.Uri.parse(pathForUri);
						let hrefDoc = await vscode.workspace.openTextDocument(docUri);
						const hrefAllTokens = this.xslLexer.analyse(hrefDoc.getText());
						let refDocTokens = XSLTReferenceProvider.calculateReferences(instruction, langConfig, langConfig.docType, hrefDoc, hrefAllTokens, eid.globalInstructionData, eid.allImportedGlobals);
						const refLocations = refDocTokens.map(token => XsltTokenDefinitions.createLocationFromToken(token, hrefDoc));
						locations = locations.concat(refLocations);
					} catch (error) {
						console.error(error);
					}
				}
			}
		} 
		return new Promise(resolve => {
			resolve(locations);
		});
	}

	public static calculateReferences = (seekInstruction: GlobalInstructionData, languageConfig: LanguageConfiguration, docType: DocumentTypes, document: vscode.TextDocument, allTokens: BaseToken[], globalInstructionData: GlobalInstructionData[], importedInstructionData: GlobalInstructionData[]): BaseToken[] => {
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
		let tagElementChildren: string[] = [];
		let startTagToken: XSLTToken | null = null;
		let preXPathVariable = false;
		let anonymousFunctionParams = false;
		let variableData: VariableData | null = null;
		let xsltVariableDeclarations: BaseToken[] = [];
		let unresolvedXsltVariableReferences: BaseToken[] = [];
		let prevToken: BaseToken | null = null;
		let includeOrImport = false;
		let referenceTokens: BaseToken[] = [];
		let tagIdentifierName: string = '';
		let lastTokenIndex = allTokens.length - 1;
		let tagAttributeNames: string[] = [];
		let tagAttributeSymbols: vscode.DocumentSymbol[] = [];
		let tagXmlnsNames: string[] = [];
		let rootXmlnsBindings: [string, string][] = [];
		let inheritedPrefixes: string[] = [];
		let globalVariableData: VariableData[] = [];		
		let importedGlobalVarNames: string[] = [];
		let importedGlobalVarTokens: BaseToken[] = [];
		let importedGlobalFnNames: string[] = [];
		let incrementFunctionArity = false;
		let onRootStartTag = true;
		let rootXmlnsName: string | null = null;
		let xsltPrefixesToURIs = new Map<string, XSLTnamespaces>();
		let namedTemplates: Map<string, string[]> = new Map();
		let globalModes: string[] = ['#current', '#default'];
		let globalKeys: string[] = [];
		let globalAccumulatorNames: string[] = [];
		let globalAttributeSetNames: string[] = [];
		let tagExcludeResultPrefixes: { token: BaseToken; prefixes: string[] } | null = null;
		let ifThenStack: BaseToken[] = [];
		let currentXSLTIterateParams: string[][] = [];
		let schemaQuery = languageConfig.schemaData ? new SchemaQuery(languageConfig.schemaData) : undefined;
		let xsltSchemaQuery: SchemaQuery | undefined;
		const isSchematron = docType === DocumentTypes.SCH;
		let pendingTemplateParamErrors: BaseToken[] = [];
		if (isSchematron && XSLTConfiguration.configuration.schemaData) {
			xsltSchemaQuery = new SchemaQuery(XSLTConfiguration.configuration.schemaData);
		}

		globalInstructionData.forEach((instruction) => {
			switch (instruction.type) {
				case GlobalInstructionType.Variable:
				case GlobalInstructionType.Parameter:
					globalVariableData.push({ token: instruction.token, name: instruction.name });
					xsltVariableDeclarations.push(instruction.token);
					break;
				case GlobalInstructionType.Function:
					let functionNameWithArity = instruction.name + '#' + instruction.idNumber;
					importedGlobalFnNames.push(functionNameWithArity);
					break;
				case GlobalInstructionType.Template:
					if (namedTemplates.get(instruction.name)) {

					} else {
						let members = instruction.memberNames ? instruction.memberNames : [];
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
					importedGlobalVarNames.push(instruction.name);
					importedGlobalVarTokens.push(instruction.token);
					break;
				case GlobalInstructionType.Function:
					let functionNameWithArity = instruction.name + '#' + instruction.idNumber;
					importedGlobalFnNames.push(functionNameWithArity);
					break;
				case GlobalInstructionType.Template:
					let members = instruction.memberNames ? instruction.memberNames : [];
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
					ifThenStack = [];
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
				}
				xpathStack = [];
				preXPathVariable = false;
				let xmlCharType = <XMLCharState>token.charType;
				let xmlTokenType = <XSLTokenLevelState>(token.tokenType - XsltTokenDiagnostics.xsltStartTokenNumber);

				switch (xmlTokenType) {
					case XSLTokenLevelState.xslElementName:
						// this is xslt or schematron element
						pendingTemplateParamErrors = [];
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
								// start-tag ended, we're now within the new element scope:
								if (docType === DocumentTypes.XSLT && onRootStartTag) {
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
								const attrValType = tagElementName.startsWith('xsl:') ? ValidationType.XSLTAttribute : ValidationType.XMLAttribute;

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
									const stackElementChildren = isSchematron ? tagElementChildren : attrValType === ValidationType.XMLAttribute && elementStack.length > 0 ? elementStack[elementStack.length - 1].expectedChildElements : tagElementChildren;
									//let newVariablesList = inScopeVariablesList;

									const childSymbols: vscode.DocumentSymbol[] = XsltTokenDiagnostics.initChildrenSymbols(tagAttributeSymbols);

									if (variableData !== null) {
										if (elementStack.length > 1) {
											xsltVariableDeclarations.push(variableData.token);
										}
										if (startTagToken) {
											// if a top-level element, use global variables instad of inScopeVariablesList;
											elementStack.push({
												namespacePrefixes: inheritedPrefixesCopy, currentVariable: variableData, variables: newVariablesList,
												symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: childSymbols, expectedChildElements: stackElementChildren
											});
										}
									} else if (startTagToken) {
										elementStack.push({ namespacePrefixes: inheritedPrefixesCopy, variables: newVariablesList, symbolName: tagElementName, symbolID: tagIdentifierName, identifierToken: startTagToken, childSymbols: childSymbols, expectedChildElements: stackElementChildren });
									}
									inScopeVariablesList = [];
									newVariablesList = [];
									tagType = TagType.NonStart;

								} else {
									// self-closed tag: xmlns declarations on this are no longer in scope
									inheritedPrefixes = orginalPrefixes;
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
										inheritedPrefixes = poppedData.namespacePrefixes.slice();
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
								}
								break;
						}
						break;

					case XSLTokenLevelState.attributeName:
					case XSLTokenLevelState.xmlnsName:
						rootXmlnsName = null;
						let attNameText = XsltTokenDiagnostics.getTextForToken(lineNumber, token, document);

						if (xmlTokenType === XSLTokenLevelState.xmlnsName) {
							tagXmlnsNames.push(attNameText);
							if (attNameText.length > 6) {
								let prefix = attNameText.substring(6);
								if (inheritedPrefixes.indexOf(prefix) < 0) {
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
							tagAttributeSymbols.push(XsltTokenDiagnostics.createSymbolForAttribute(token, attNameText));
							tagAttributeNames.push(attNameText);
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
								if (seekInstruction.type === GlobalInstructionType.Mode && variableName === seekInstruction.name) {
									referenceTokens.push(token);
								}
								break;
							case AttributeType.UseAttributeSets:
								if (seekInstruction.type === GlobalInstructionType.AttributeSet && variableName === seekInstruction.name) {
									referenceTokens.push(token);
								}
								break;
							case AttributeType.ExcludeResultPrefixes:
								let excludePrefixes = variableName.split(/\s+/);
								tagExcludeResultPrefixes = { token: token, prefixes: excludePrefixes };
								break;
						}
						if (
							seekInstruction.type === GlobalInstructionType.Template && 
							attType === AttributeType.InstructionName && 
							tagElementName === 'xsl:call-template') {
							if (variableName === seekInstruction.name) {
								referenceTokens.push(token);
							}
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
								if (xp.function?.value === 'key' && seekInstruction.type === GlobalInstructionType.Key) {
									let keyVal = token.value.substring(1, token.value.length - 1);
									if (seekInstruction.name === keyVal) {
										referenceTokens.push(token);
									}
								} else if (xp.function?.value.startsWith('accumulator-') && seekInstruction.type === GlobalInstructionType.Accumulator) {
									let keyVal = token.value.substring(1, token.value.length - 1);
									if (seekInstruction.name === keyVal) {
										referenceTokens.push(token);
									}
								}
							}
						}
						break;
					case TokenLevelState.variable:
						let fullVariableName = token.value.substring(1);
						if ((preXPathVariable && !xpathVariableCurrentlyBeingDefined) || anonymousFunctionParams) {
							let currentVariable = { token: token, name: fullVariableName };
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
							let globalVarName: string | null = null;
							if (tagType === TagType.XSLTvar && elementStack.length === 1) {
								globalVarName = tagIdentifierName;
							}

							if (seekInstruction.type === GlobalInstructionType.Variable || seekInstruction.type === GlobalInstructionType.Parameter) {
								if (fullVariableName === seekInstruction.name) {
									let resolvedDefn = XsltTokenDiagnostics.getXPathVariableDefnToken(globalVarName, document, importedGlobalVarNames, token, xpathVariableCurrentlyBeingDefined, inScopeXPathVariablesList,
										xpathStack, inScopeVariablesList, elementStack);
									const seekToken = seekInstruction.token;
									if (resolvedDefn && resolvedDefn.line === seekToken.line && resolvedDefn.startCharacter === seekToken.startCharacter) {
										referenceTokens.push(token);
									} else if (!resolvedDefn) {
										// only check for globals if it hasn't already been resolved
										if (globalVarName !== fullVariableName) {
											let globalVar = globalVariableData.find(vdata => vdata.name === fullVariableName);
											if (globalVar) {
												const gToken = globalVar.token;
												if (gToken.line === seekToken.line && gToken.startCharacter === seekToken.startCharacter) {
													referenceTokens.push(token);
												}
											} else {
												let globalDefnIndex = importedGlobalVarNames.indexOf(fullVariableName);
												if (globalDefnIndex > -1) {
													const globalToken = importedGlobalVarTokens[globalDefnIndex];
													if (globalToken.line === seekToken.line && globalToken.startCharacter === seekToken.startCharacter) {
														referenceTokens.push(token);
													}
												}
											}

										}
									}
								}
							}
						}
						break;
					case TokenLevelState.complexExpression:
						let valueText = token.value;
						switch (valueText) {
							case 'if':
								ifThenStack.push(token);
								break;
							case 'every':
							case 'for':
							case 'let':
							case 'some':
								preXPathVariable = true;
								xpathVariableCurrentlyBeingDefined = false;
								xpathStack.push({ token: token, variables: inScopeXPathVariablesList.slice(), preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, isRangeVar: true });
								break;
							case 'then':
								if (ifThenStack.length > 0) {
									ifThenStack.pop();
								}
								xpathStack.push({ token: token, variables: inScopeXPathVariablesList.slice(), preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined });
								inScopeXPathVariablesList = [];
								break;
							case 'return':
							case 'satisfies':
							case 'else':
								let tokenValBeforeDelete = xpathStack.length > 0? xpathStack[xpathStack.length - 1].token.value : '';
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
									let peekedStack = xpathStack[xpathStack.length - 1];
									if (peekedStack) {
										if (valueText === 'else') {
											preXPathVariable = peekedStack.preXPathVariable;
										} else {
											// todo: if after a return AND a ',' prePathVariable = true; see $pos := $c.
											preXPathVariable = false;
										}
										xpathVariableCurrentlyBeingDefined = peekedStack.xpathVariableCurrentlyBeingDefined;
										peekedStack.token = token;
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
						let isXPathError = false;
						let tv = token.value;

						// start checks
						let stackItem: XPathData | undefined = xpathStack.length > 0 ? xpathStack[xpathStack.length - 1] : undefined;
						const sv = stackItem?.token.value;
						const tokenIsComma = tv === ',';
						const popStackLaterForComma = sv && tokenIsComma && (sv === 'return' || sv === 'else' || sv === 'satisfies' );
						if (popStackLaterForComma && xpathStack.length > 1) {
							stackItem = xpathStack[xpathStack.length - 2];
						}
						if (stackItem && stackItem.curlyBraceType === CurlyBraceType.Map) {
							if (tokenIsComma) {
								if (stackItem.awaitingMapKey) {
									isXPathError = true;
								} else {
									stackItem.awaitingMapKey = true;
								}
							} else if (tv === '}' && stackItem.awaitingMapKey) {
								isXPathError = true;
							}
						}
						if (prevToken?.tokenType === TokenLevelState.complexExpression) {
							let currCharType = <CharLevelState>token.charType;
							if (currCharType === CharLevelState.rB || currCharType === CharLevelState.rBr || currCharType === CharLevelState.rPr) {
							  // do nothing
							} else if (tokenIsComma) {
                // do nothing								
							}
						} else if (prevToken && tv === ':') {
							if (stackItem && stackItem.curlyBraceType === CurlyBraceType.Map) {
								if (stackItem.awaitingMapKey) {
									stackItem.awaitingMapKey = false;
								}
							}
						}
						// end checks
						let functionToken: BaseToken | null = null;
						switch (xpathCharType) {
							case CharLevelState.lBr:
								let curlyBraceType = CurlyBraceType.None;
								if (prevToken && prevToken.tokenType === TokenLevelState.operator) {
									if (prevToken.value === 'map') {
										curlyBraceType = CurlyBraceType.Map;
									} else if (prevToken.value === 'array') {
										curlyBraceType = CurlyBraceType.Array;
									}
								}
                const stackItem: XPathData = { token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined, curlyBraceType };
								if (curlyBraceType === CurlyBraceType.Map) {
									stackItem.awaitingMapKey = true;
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
								let xpathItem: XPathData = { token: token, variables: inScopeXPathVariablesList, preXPathVariable: preXPathVariable, xpathVariableCurrentlyBeingDefined: xpathVariableCurrentlyBeingDefined };
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
										inScopeXPathVariablesList = poppedData.variables;
										preXPathVariable = poppedData.preXPathVariable;
										xpathVariableCurrentlyBeingDefined = poppedData.xpathVariableCurrentlyBeingDefined;
										if (poppedData.function && poppedData.functionArity !== undefined) {
											if (prevToken?.charType !== CharLevelState.lB) {
												if (poppedData.functionArity !== undefined) {
													poppedData.functionArity++;
												}
											}
											if (seekInstruction.type === GlobalInstructionType.Function) {
												let functionName;
												let arity = poppedData.functionArity;
												const fnToken = poppedData.function;
												if (arity === undefined) {
													let parts = fnToken.value.split('#');
													arity = Number.parseInt(parts[1]);
													functionName = parts[0];
												} else {
													functionName = fnToken.value;
												}
												if (functionName === seekInstruction.name && (arity === seekInstruction.idNumber || seekInstruction.idNumber < 0)) {
													referenceTokens.push(fnToken);
												}
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
										let nonBracketedThen = -1;
										for (let i = xpathStack.length - 1; i > -1; i--) {
											const xpathItem = xpathStack[i].token;
											const val = xpathItem.value;
											if (!(val === 'return' || val === 'else' || val === 'satisfies' || val === 'then' )) {
												break;
											} else if (val === 'then') {
												nonBracketedThen = i;
											}
										}
										const sv = xp.token.value;
										if (sv === 'return' || sv === 'else' || sv === 'satisfies' ) {
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
									if (seekInstruction.type === GlobalInstructionType.Function) {
										const sameArity = fnArity == seekInstruction.idNumber;
										if (prevToken.value === seekInstruction.name && (sameArity || seekInstruction.idNumber < 0)) {
											referenceTokens.push(prevToken);
										}
									}
									incrementFunctionArity = false;
								} else if (isEmptyBracketsToken && prevToken?.tokenType === TokenLevelState.variable) {
									// TODO: check arity of variable of type 'function'
									incrementFunctionArity = false;
								} else if (token.value === '=>') {
									incrementFunctionArity = true;
								}
								break;
						}
						break;
					case TokenLevelState.functionNameTest:
						if (seekInstruction.type === GlobalInstructionType.Function) {
							const parts = token.value.split('#');
							const arity = Number.parseInt(parts[1]);
							const functionName = parts[0];
							if (functionName === seekInstruction.name && (arity === seekInstruction.idNumber || seekInstruction.idNumber < 0)) {
								referenceTokens.push(token);
							}
						}
						break;
				}
			}
			prevToken = token.tokenType === TokenLevelState.comment ? prevToken : token;
			if (index === lastTokenIndex) {
				if (elementStack.length > 0) {
					while (elementStack.length > 0) {
						elementStack.pop();
					}
				}
			}
		});

		return referenceTokens;
	};

}