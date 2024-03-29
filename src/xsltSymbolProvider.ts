import * as vscode from 'vscode';
import { XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType, DocumentTypes } from './xslLexer';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { GlobalsProvider } from './globalsProvider';
import * as path from 'path';
import { exit } from 'process';
import { DocumentChangeHandler } from './documentChangeHandler';
import * as url from 'url';
import { BaseToken, CharLevelState, ExitCondition, LexPosition, TokenLevelState, XPathLexer } from './xpLexer';
import { ElementData, VariableData, XPathData, XsltTokenCompletions } from './xsltTokenCompletions';
import { anyDocumentSymbol, XSLTCodeActions } from './xsltCodeActions';

interface ImportedGlobals {
	href: string;
	data: GlobalInstructionData[];
	error: boolean;
}

interface Cleaned {
	cleanedTokens: TokenWithUnion[];
	hasParentAxis: boolean;
}

interface GlobalsSummary {
	globals: ImportedGlobals[];
	hrefs: string[];
}

export interface XsltPackage {
	name: string;
	path: string;
	version?: string;
}

export enum SelectionType {
	Current,
	Next,
	Previous,
	Parent,
	FirstChild
}

enum AxisType {
	Attribute,
	Self,
	Child,
	Descendant,
	DescendantOrSelf,
	Parent,
	ParentKeep,
	Ancestor,
	AncestorOrSelf,
	FollowingSibling,
	PrecedingSibling,
	Union
}

interface SymbolWithParent extends vscode.DocumentSymbol {
	parent?: vscode.DocumentSymbol;
	isAttr?: boolean;
}

interface TokenWithUnion extends BaseToken {
	union?: boolean;
}

export type possDocumentSymbol = vscode.DocumentSymbol | null;
type Entry = [string, number];
enum UseSource {
	none = "none",
	latest = "latest"
}

export class XsltSymbolProvider implements vscode.DocumentSymbolProvider {

	public static instanceForXSLT: XsltSymbolProvider|null = null;
	private readonly xslLexer: XslLexer;
	public readonly collection: vscode.DiagnosticCollection | null;
	private internalDiagnostics: vscode.Diagnostic[];
	private readonly languageConfig: LanguageConfiguration;
	private docType: DocumentTypes;
	public static documentSymbols = new Map<vscode.Uri, vscode.DocumentSymbol[]>();
	private importHrefs: Map<string, string[]> = new Map();
	public static importSymbolHrefs: Map<string, string[]> = new Map();
	private static readonly useSourceFile: UseSource = <UseSource>vscode.workspace.getConfiguration('XSLT.resources').get('useSourceFile');
	private internalImportedGlobals: GlobalInstructionData[] = [];

	public constructor(xsltConfiguration: LanguageConfiguration, collection: vscode.DiagnosticCollection | null) {
		this.xslLexer = new XslLexer(xsltConfiguration);
		this.xslLexer.provideCharLevelState = true;
		this.collection = collection;
		this.languageConfig = xsltConfiguration;
		this.docType = xsltConfiguration.docType;
		this.internalDiagnostics = [];
		if (xsltConfiguration.docType === DocumentTypes.XSLT) {
			XsltSymbolProvider.instanceForXSLT = this;
		}
	}

	public static getSymbolsForActiveDocument(): vscode.DocumentSymbol[] {
		if (vscode.window.activeTextEditor) {
			const result = XsltSymbolProvider.documentSymbols.get(vscode.window.activeTextEditor.document.uri);
			return !!result ? result : [];
		} else {
			return [];
		}
	}

	public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[] | undefined> {
		const result = this.getDocumentSymbols(document, false);
		return result;
	}

	private static findMatchingParent(map: Map<string, string[]>, path: string) {
		let matchingKey: string | undefined;
		// use last entry
		for (const entry of map.entries()) {
			if (entry[1].find((x) => x === path)) {
				matchingKey = entry[0];
			}
		}
		return matchingKey;
	}

	public async getDocumentSymbols(document: vscode.TextDocument, onlyActiveDocument: boolean): Promise<vscode.DocumentSymbol[] | undefined> {
		if (onlyActiveDocument && vscode.window.activeTextEditor) {
			if (document.fileName !== vscode.window.activeTextEditor.document.fileName) {
				return [];
			}
		}
		const allTokens = this.xslLexer.analyse(document.getText());
		this.languageConfig['isVersion4'] = this.xslLexer.isXSLT40;
		const globalInstructionData = this.xslLexer.globalInstructionData;
		const xsltPackages: XsltPackage[] = <XsltPackage[]>vscode.workspace.getConfiguration('XSLT.resources').get('xsltPackages');

		// Import/include XSLT - ensuring no duplicates
		const localImportedHrefs = XsltSymbolProvider.importSymbolHrefs;
		let { importedGlobals1, accumulatedHrefs }:
			{ importedGlobals1: ImportedGlobals[]; accumulatedHrefs: string[] }
			= await XsltSymbolProvider.processTopLevelImports(true, this.xslLexer, localImportedHrefs, document, globalInstructionData, xsltPackages);

		let topLevelHrefs = XsltSymbolProvider.accumulateImportHrefs(xsltPackages, importedGlobals1, []);


		let globalsSummary0: GlobalsSummary = { globals: importedGlobals1, hrefs: accumulatedHrefs };
		const maxImportLevel = 20;

		let processNestedGlobals = async () => {
			let level = 0;
			while (globalsSummary0.hrefs.length > 0 && level < maxImportLevel) {
				globalsSummary0 = await XsltSymbolProvider.processImportedGlobals(xsltPackages, globalsSummary0.globals, accumulatedHrefs, level === 0);
				level++;
			}
		};

		await processNestedGlobals();

		return new Promise((resolve, reject) => {
			let symbols: vscode.DocumentSymbol[] = [];
			let allImportedGlobals: GlobalInstructionData[] = [];
			let importErrors: GlobalInstructionData[] = [];
			const rootPath = vscode.workspace.rootPath;

			globalsSummary0.globals.forEach((globals) => {
				if (globals.error) {
					if (topLevelHrefs.indexOf(globals.href) > -1) {
						let errorData = globalInstructionData.find((dataObject) => {
							let result = false;
							if (dataObject.type === GlobalInstructionType.Import || dataObject.type === GlobalInstructionType.Include) {
								let resolvedName = XsltSymbolProvider.resolvePath(dataObject.name, document.fileName);
								result = resolvedName === globals.href;
							} else if (dataObject.type === GlobalInstructionType.UsePackage) {
								// TODO:
								const basePath = path.dirname(document.fileName);
								let packageLookup = xsltPackages.find((pkg) => {
									return pkg.name === dataObject.name;
								});
								if (packageLookup && rootPath) {
									let resolvedName = XsltSymbolProvider.resolvePathInSettings(packageLookup.path, rootPath);
									result = resolvedName === globals.href;
								} else {
									result = false;
								}

							}
							return result;
						});
						if (errorData) {
							importErrors.push(errorData);
						}
					}
				} else {
					globals.data.forEach((global) => {
						global['href'] = globals.href;
						allImportedGlobals.push(global);
					});
				}
			});
			this.internalImportedGlobals = allImportedGlobals;
			let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(this.languageConfig, this.docType, document, allTokens, globalInstructionData, allImportedGlobals, symbols);
			if (vscode.window.activeTextEditor && document.fileName !== vscode.window.activeTextEditor.document.fileName) {

			} else {
				// TODO: don't exclude DocumentTypes.SCH once diagnostics implemented fully
				if (this.collection && this.docType !== DocumentTypes.SCH) {
					let importDiagnostics: vscode.Diagnostic[] = [];
					importErrors.forEach((importError) => {
						importDiagnostics.push(XsltTokenDiagnostics.createImportDiagnostic(importError));
					});
					let allDiagnostics = importDiagnostics.concat(diagnostics);
					if (allDiagnostics.length > 0) {
						this.collection.set(document.uri, allDiagnostics);
					} else {
						this.collection.clear();
					};
				}
				this.internalDiagnostics = diagnostics;
			}
			XsltSymbolProvider.documentSymbols.set(document.uri, symbols);
			resolve(symbols);
		});

	}

	public calculateVirtualDiagnostics(document: vscode.TextDocument) {
		const allTokens = this.xslLexer.analyse(document.getText());
		const symbols = XsltSymbolProvider.documentSymbols.get(document.uri)!;
		const globalInstructionData = this.xslLexer.globalInstructionData;

		let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(this.languageConfig, this.docType, document, allTokens, globalInstructionData, this.internalImportedGlobals, symbols);
		return diagnostics;
	}
	
	public get diagnosticsArray() : vscode.Diagnostic[] {
		return this.internalDiagnostics;
	}	

	public static async processTopLevelImports(update: boolean, xslLexer: XslLexer, localImportedHrefs: Map<string, string[]>, document: vscode.TextDocument, globalInstructionData: GlobalInstructionData[], xsltPackages: XsltPackage[]) {
		const matchingParent = this.findMatchingParent(localImportedHrefs, document.fileName);
		let importedGlobals1: ImportedGlobals[] = [];
		let accumulatedHrefs: string[];
		if (matchingParent) {
			// TODO: get globalInstructionData for this point!
			const token: BaseToken = {
				line: 1,
				startCharacter: 0,
				length: matchingParent?.length,
				value: matchingParent,
				tokenType: 0
			};
			const importInstruction: GlobalInstructionData = {
				type: GlobalInstructionType.Import,
				name: matchingParent,
				token: token,
				idNumber: 0
			};

			globalInstructionData.push(importInstruction);
		}

		const importedG = { data: globalInstructionData, href: document.fileName, error: false };
		accumulatedHrefs = [importedG.href];
		importedGlobals1 = [importedG];
		const inheritHrefs = this.getImportHrefs(xsltPackages, importedGlobals1);
		if (update) {
			if (matchingParent) {
				const newInheritHres = localImportedHrefs.get(matchingParent)?.concat(inheritHrefs);
				if (newInheritHres) {
					localImportedHrefs.set(matchingParent, newInheritHres);
				}
			} else {
				localImportedHrefs.set(document.fileName, inheritHrefs);
			}
		}

		return { importedGlobals1, accumulatedHrefs };
	}

	public static selectTextWithSymbol(symbol: vscode.DocumentSymbol | undefined) {
		if (DocumentChangeHandler.lastActiveXMLEditor && symbol) {
			const range = symbol.range;
			if (vscode.window.activeTextEditor) {
				vscode.window.activeTextEditor.revealRange(range);
			}
			DocumentChangeHandler.lastActiveXMLEditor.selection = new vscode.Selection(range.start, range.end);
		}
	}

	public static symbolForXMLElement(selectionType: SelectionType, position: vscode.Position, expandText?: string[]) {
		if (vscode.window.activeTextEditor) {
			const rootSymbol = XsltSymbolProvider.getSymbolsForActiveDocument()[0];
			const path: string[] = [];
			const selection = new vscode.Selection(position, position);
			const result = this.getChildSymbolForSelection(selection, rootSymbol, path, selectionType, null, null, null, expandText);
            return result;
		}
	}

	public static selectXMLElement(selectionType: SelectionType) {
		const selection = vscode.window.activeTextEditor?.selection;
		if (selection) {
			const result = XsltSymbolProvider.symbolForXMLElement(selectionType, selection.start);
			if (result !== null) {
				XsltSymbolProvider.selectTextWithSymbol(result);
			}
		}
	}

	public static getXPathFromSelection(expandText?: string[]) {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const selection = editor.selection;
			const rootSymbol = XsltSymbolProvider.getSymbolsForActiveDocument()[0];
			const newPath = ['/' + rootSymbol.name.split(' ')[0]];
			const result = this.getChildSymbolForSelection(selection, rootSymbol, newPath, SelectionType.Current, null, null, null, expandText);
			const fullPath = newPath.join('');
			return fullPath;
		}
	}

	public static findVariableTypeAtSymbol(targetSymbol: anyDocumentSymbol, variableNames: string[], types: Map<string, string>, mergeNames: string[]) {
		const rootSymbol = XsltSymbolProvider.getSymbolsForActiveDocument()[0];
		if (targetSymbol) XsltSymbolProvider.findChildVariableTypeAtSymbol(targetSymbol, rootSymbol, variableNames, types, mergeNames);
	}


	private static findChildVariableTypeAtSymbol(targetSymbol: vscode.DocumentSymbol, parentSymbol: vscode.DocumentSymbol, variableNames: string[], types: Map<string, string>, mergeNames: string[]) {
		for (const childSymbol of parentSymbol.children) {			
			if (childSymbol.range.contains(targetSymbol.range)) {
				XsltSymbolProvider.findChildVariableTypeAtSymbol(targetSymbol, childSymbol, variableNames, types, mergeNames);
				break;
			} else {
				// preceding sibling:
				if (childSymbol.kind === vscode.SymbolKind.Module) {
					const attrs = childSymbol.children[0];
					if (attrs && attrs.kind === vscode.SymbolKind.Array && attrs.name === 'attributes') {
						const nameAttr = attrs.children.find((attr) => attr.name === 'name');
						if (nameAttr) {
							const fixedName = nameAttr.detail.substring(1, nameAttr.detail.length - 1);
							if (variableNames.includes(fixedName)) {
								const typeAttr = attrs.children.find((attr) => attr.name === 'as');
								if (typeAttr) {
									types.set(fixedName, typeAttr.detail.substring(1, typeAttr.detail.length - 1));
								}
							}
						}
					}
				} else if (childSymbol.kind === vscode.SymbolKind.Object) {
					const symbolName = childSymbol.name;
					if (symbolName.startsWith('xsl:merge-source')) {
						const doc = vscode.window.activeTextEditor!.document;
					const attrs = childSymbol.children[0];
						if (attrs && attrs.kind === vscode.SymbolKind.Array && attrs.name === 'attributes') {
							const nameAttr = attrs.children.find((attr) => attr.name === 'name');
							if (nameAttr) {
								const attrValueFull = XSLTCodeActions.getAttrValueFromSymbol(doc, nameAttr);
								mergeNames.push(attrValueFull);
							}
						}
					} else if (symbolName === 'xsl:merge') {
						mergeNames.length = 0;
					}
				}
			}

		}
	}

	private static getChildSymbolForSelection(selection: vscode.Selection, symbol: vscode.DocumentSymbol, path: string[], selectionType: SelectionType, parentSymbol: possDocumentSymbol, precedingSymbol: possDocumentSymbol, nextSymbol: possDocumentSymbol, expandText?: string[]): possDocumentSymbol {
		const selectionPos = new vscode.Position(selection.start.line, selection.start.character + 1);
		const result = symbol.children.find((sym) => sym.range.contains(selectionPos));

		if (result) {
			const resultName = result.name.split(' ')[0];
			let nextSibling = null;
			let precedingSibling = null;
			let firstChild = null;
			let precedingSymbolNames = 1;
			let breakNext = false;
			for (const sibling of symbol.children) {
				if (breakNext) {
					nextSibling = sibling;
					break;
				} if (sibling === result) {
					if (selectionType === SelectionType.Next) {
						breakNext = true;
					} else {
						break;
					}
				} else {
					precedingSibling = sibling;
					const siblingName = sibling.name.split(' ')[0];
					if (siblingName === resultName) {
						precedingSymbolNames++;
					}
				}
			}
			const isAttributesSymbol = symbol.kind === vscode.SymbolKind.Array && symbol.name === 'attributes';
			if (!isAttributesSymbol && expandText) {
				const attributes = symbol.children.find((attr) => attr.kind === vscode.SymbolKind.Array);
				if (attributes) {
					const expandTextAttr = attributes.children.find((attr) => attr.name === 'expand-text' || attr.name === 'xsl:expand-text');
					if (expandTextAttr && expandTextAttr.detail) {
						expandText.push(expandTextAttr.detail);
					}
				}
			}
			if (isAttributesSymbol) {
				path.push('/@' + resultName);
			} else if (!(result.kind === vscode.SymbolKind.Array && result.name === 'attributes')) {
				path.push('/' + resultName + `[${precedingSymbolNames}]`);
			}
			if (isAttributesSymbol && selectionType === SelectionType.Parent) {
				return parentSymbol;
			} else {
				return this.getChildSymbolForSelection(selection, result, path, selectionType, symbol, precedingSibling, nextSibling, expandText);
			}
		} else if (selectionType === SelectionType.Parent) {
			return parentSymbol;
		} else if (selectionType === SelectionType.Previous) {
			return precedingSymbol;
		} else if (selectionType === SelectionType.Next) {
			return nextSymbol;
		} else if (selectionType === SelectionType.FirstChild) {
			const firstChild = symbol.children.length > 0 ? symbol.children[0] : null;
			if (firstChild) {
				if (firstChild.kind === vscode.SymbolKind.Array && firstChild.name === 'attributes') {
					return symbol.children.length > 1 ? symbol.children[1] : null;
				} else {
					return firstChild;
				}
			} else {
				return null;
			}
		} else {
			return symbol;
		}
	}

	public static getCompletionNodeNames(
		allTokens: BaseToken[],
		globalInstructionData: GlobalInstructionData[],
		xsltVariables: VariableData[], 
		xpathVariables: VariableData[], 
		index: number,
		xpathStack: XPathData[], 
		symbols: vscode.DocumentSymbol[],
		eNames: string[],
		aNames: string[]
		) 
		{
		if (this.useSourceFile === UseSource.none) {
			return [eNames, aNames];
		}
		const {cleanedTokens, hasParentAxis} = XsltSymbolProvider.filterPathTokens(allTokens, globalInstructionData, xsltVariables, xpathVariables,index, xpathStack);
		// console.log('pathTokens')
		// console.log(cleanedTokens);
		const result = XsltSymbolProvider.getExpectedForXPathLocation(cleanedTokens, symbols, hasParentAxis);
		const [elementNames, attrNames] = result;
		// console.log('elementNames');
		// console.log(elementNames);
		// console.log('attrtNames');
		// console.log(attrNames);
		return result;
	}

	public static filterPathTokens(tokens: BaseToken[], globalInstructionData: GlobalInstructionData[], xsltVariables: VariableData[], xpathVariables: VariableData[], position: number, xpathStack: XPathData[]) {
		let cleanedTokens: TokenWithUnion[] = [];
		const bracketTokens: BaseToken[] = [];
		let saveToken = false;
		let nesting = 0;
		let exitLoop = false;
		let finalSlashToken: BaseToken|undefined;
		let xpathStacksChecked = 0;
		let lastTokenWasSlash = false;
		let lastTokenWasSlash2 = false;
		let hasParentAxis = false;
		let foundVariableToken = false;
		let isNextBracketUnion = false;
		let collectBracketTokens = false;

		// track backwards to get all tokens in path
		for (let i = position; i > -1; i--) {
			const token: TokenWithUnion = tokens[i];
			const isXSLToken = token.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
			let xpathCharType = <CharLevelState>token.charType;
			let xpathTokenType = <TokenLevelState>token.tokenType;
			if (nesting > 0) {
				if (xpathTokenType === TokenLevelState.operator && xpathCharType === CharLevelState.lPr) {
					nesting--;
				}
			} else if (collectBracketTokens) {
				// test to see if: (element1|element2)
				switch (xpathTokenType) {
					case TokenLevelState.operator:
						switch (xpathCharType) {
							case CharLevelState.lB:
								// TODO: handle case of: /countries/(sibling|sibling2)
								cleanedTokens = cleanedTokens.concat(...bracketTokens);
								// saveToken = true;
								// temp fix to terminate when finding (...)/country
								bracketTokens.length = 0;
								isNextBracketUnion = false;
								collectBracketTokens = false;
								break;
							case CharLevelState.sep:
								exitLoop = (token.value !== '|' && token.value !== ',');
								isNextBracketUnion = !exitLoop;
								break;
							case CharLevelState.rPr:
								nesting++;
								break;
							default:
								exitLoop = true;
						}
						break;
					case TokenLevelState.nodeNameTest:
						if (isNextBracketUnion) {
							token.union = true;
						}
						bracketTokens.push(token);
						break;
					default:
						exitLoop = true;
						break;
				}
			} else {
				switch (xpathTokenType) {
					case TokenLevelState.operator:
						switch (xpathCharType) {
							case CharLevelState.rPr:
								nesting++;
								break;
							case CharLevelState.rB:
								collectBracketTokens = true;
								break;
							case CharLevelState.dSep:
								exitLoop = (token.value !== '//' && token.value !== '::' && token.value !== '()');
								saveToken = token.value === '//';
								break;
							case CharLevelState.sep:
								// keep '/' char if it's the last part of the reversed path meaning we're on an absolute path
								exitLoop = token.value !== '/';
								if (!exitLoop && i === 0) {
									cleanedTokens.push(token);
								} 
								if (!exitLoop) {
									finalSlashToken = token;
									lastTokenWasSlash = true;
								}
								break;
							case CharLevelState.lPr:
							case CharLevelState.lB:
								xpathStacksChecked++;
								break;
							default:
								exitLoop = true;
								break;
						}
						break;
					case TokenLevelState.nodeNameTest:
					case TokenLevelState.attributeNameTest:
						saveToken = true;
						break;
					case TokenLevelState.axisName:
						saveToken = token.value !== 'child';
						if (!hasParentAxis) {
							hasParentAxis = ['parent', 'ancestor', 'ancestor-or-self', 'following-sibling', 'preceding-sibling'].indexOf(token.value) !== -1;
						}
						break;
					case TokenLevelState.nodeType:
						saveToken = ['*', '..','node','element','item'].indexOf(token.value) !== -1;
						if (!hasParentAxis) {
							hasParentAxis = token.value === '..';
						}
						// TODO: for '..' case, we can just pop cleanedTokens and not save?
						exitLoop = !(saveToken || token.value === '.');
						break;
					case TokenLevelState.variable:
						// e.g. $dev/body
						foundVariableToken = true;
						let xpv = xpathVariables.find(v => v.token.value === token.value);
						if (!xpv) {
							const tv = token.value.substring(1);
							xpv = xsltVariables.find(v => v.name === tv);
						}
						if (!xpv) {
							const tv = token.value.substring(1);
							const gd = globalInstructionData.find(d => d.type === GlobalInstructionType.Variable && d.name === tv);
							if (gd?.idNumber) {
								xpv = { index: gd.idNumber, token: gd.token, name: gd.name };
							}
						}
						if (xpv) {
							const lastTokenIndex = XsltSymbolProvider.fetchXPathVariableTokens(tokens, xpv);
							// recursive call:
							if (position === lastTokenIndex) {
								foundVariableToken = false;
								cleanedTokens.push(token);
								exitLoop = true;
							} else {
								const result: Cleaned = XsltSymbolProvider.filterPathTokens(tokens, globalInstructionData, xsltVariables, xpathVariables, lastTokenIndex, xpathStack );
								// console.log('xpv', xpv);
								// console.log('lastTokenIndex', lastTokenIndex, tokens[lastTokenIndex]);
								// console.log('filteredVarTokens', result.cleanedTokens);
								if (!hasParentAxis) {
									hasParentAxis = result.hasParentAxis;
								}
								cleanedTokens = cleanedTokens.concat(result.cleanedTokens);
							}
						} else {
							// add the $dev token
							const varFromExtXPath = XsltTokenCompletions.extXPathVariables.get(token.value.substring(1));
							if (varFromExtXPath) {
								const xpLexer = new XPathLexer();
								const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
								const extTokens = xpLexer.analyse(varFromExtXPath, ExitCondition.None, lexPosition);
								const result: Cleaned = XsltSymbolProvider.filterPathTokens(extTokens, globalInstructionData, xsltVariables, xpathVariables, extTokens.length - 1, [] );
								if (!hasParentAxis) {
									hasParentAxis = result.hasParentAxis;
								}
								cleanedTokens = cleanedTokens.concat(result.cleanedTokens);
							} else {
								cleanedTokens.push(token);
								exitLoop = true;
							}
						}
					default:
						exitLoop = true;
						break;
				}
			}
			if (foundVariableToken) {
				// $var gives context so don't check if we're in a predicate
				break;
			} else if (exitLoop) {
				// check to see if we're still within a predicate: el1[el2 and el3]
				exitLoop = false;
				let predicateStart = -1;

				const xpathStackEnd = xpathStack.length - (xpathStacksChecked + 1);
				for (let x = xpathStackEnd; x > -1; x--) {
					xpathStacksChecked++;
					const item = xpathStack[x];
					if ((item.token.charType === CharLevelState.lPr || item.token.charType === CharLevelState.lB) && item.tokenIndex) {
						predicateStart = item.tokenIndex;
						break;
					}
				}
				if (predicateStart === -1) {
					if (lastTokenWasSlash2 && finalSlashToken) {
						cleanedTokens.push(finalSlashToken);
					}
					break;
				} else {
					// warning: changes the loop counter which will be decremented next!!
					i = predicateStart;
				}
			} else if (nesting === 0 && saveToken && bracketTokens.length === 0) {
				cleanedTokens.push(token);
			}
			lastTokenWasSlash2 = lastTokenWasSlash;
			lastTokenWasSlash = false;
			saveToken = false;
		}
		return {cleanedTokens, hasParentAxis};
	}

	static fetchXPathVariableTokens(tokens: BaseToken[], xpv: VariableData) {
		let result = -1;
		let nesting = 0;
		let exitForLoop = false;
		let onXsltTokensAtStart = false;

		const startPosiiton = xpv.index + 2;

		for (let index = startPosiiton; index < tokens.length; index++) {
			const token = tokens[index];

			const isXSLToken = token.tokenType >= XsltTokenCompletions.xsltStartTokenNumber;
			if (isXSLToken) {
				if (index === startPosiiton) {
					onXsltTokensAtStart = true;
				}
				if (onXsltTokensAtStart) {
					result++;
					continue;
				} else {
					break;
				}
			} else {
				onXsltTokensAtStart = false;
			}

			let xpathCharType = <CharLevelState>token.charType;
			let xpathTokenType = <TokenLevelState>token.tokenType;
			switch (xpathTokenType) {
				case TokenLevelState.operator:
					if (xpathCharType === CharLevelState.lPr) {
						nesting++;
					} else if (xpathCharType === CharLevelState.rPr) {
						nesting--;
					} else if (nesting === 0 && xpathCharType === CharLevelState.sep && token.value === ',') {
						exitForLoop = true;
					}				
					break;
				case TokenLevelState.complexExpression:
					if (nesting === 0) {
						exitForLoop = true;
					}
					break;
				default:
					break;
			}
			if (exitForLoop) {
				break;
			} else {
				result++;
			}
		}

		return result + startPosiiton;
	}

	public static getExpectedForXPathLocation(tokens: TokenWithUnion[], symbols: vscode.DocumentSymbol[], hasParentAxis: boolean) {		
		if (symbols.length === 0) {
			return [[], []];
		}	

		if (tokens.length === 0) {
			const token: BaseToken = {
				line: 1,
				startCharacter: 0,
				length: 1,
				value: '//',
				tokenType: TokenLevelState.operator,
				charType: CharLevelState.dSep
			};
			tokens.push(token);
		} else {
			const tv = tokens[tokens.length - 1].value;
			if (!(tv === '/' || tv === '//')) {
				const token: BaseToken = {
					line: 1,
					startCharacter: 0,
					length: 1,
					value: '//',
					tokenType: TokenLevelState.operator,
					charType: CharLevelState.dSep
				};
				tokens.push(token);
			}
		}	
		const lastTokenIndex = tokens.length - 1;	
		// start with root element symbol:
		let currentSymbols: SymbolWithParent[] = [];
		let isDocumentNode = false;
		let nextAxis = AxisType.Child;
		let isPathStart = true;
		let isPathEnd = false;
		let unionElementNames: string[] = [];

		// track backwards to get all tokens in path
		for (let i = lastTokenIndex; i > -1; i--) {
			const token = tokens[i];
			const tv = token.value;
			let xpathCharType = <CharLevelState>token.charType;
			let xpathTokenType = <TokenLevelState>token.tokenType;
			let currentAxis = nextAxis;
			isPathEnd = i === 0;
			nextAxis = AxisType.Child;
			let nextSymbols: SymbolWithParent[] = [];
			let descendantAttrNames: string[] = [];

			switch (xpathTokenType) {
				case TokenLevelState.operator:
					switch (xpathCharType) {
						case CharLevelState.sep:
							if (isPathStart) {
								isDocumentNode = token.value === '/';
								nextSymbols = [symbols[0]];
							}
							break;
						case CharLevelState.dSep:
							if (token.value === '//') {
								// need to just hold and wait for next token
								// 1. //*
								// 2. //element
								nextSymbols = isPathStart? [symbols[0]] : currentSymbols;
								const descendantOrSelf = isPathStart;
								const {outSymbols, attrNameArray} = XsltSymbolProvider.getDescendantSymbols(nextSymbols, descendantOrSelf, hasParentAxis);
								nextSymbols = outSymbols;
								descendantAttrNames = attrNameArray;
								nextAxis = AxisType.Descendant;
							}
					}
					break;
				case TokenLevelState.nodeNameTest:
					if (isDocumentNode) {
						isDocumentNode = false;
						// starting point: assume root element
						if (xpathNameMatchesSymbol(token.value, currentSymbols[0].name)) {
							nextSymbols = currentSymbols;
						}
					} else if (token.union) {
						unionElementNames.push(token.value);
						nextSymbols = currentSymbols;
					} else if (currentAxis !== AxisType.Child && currentAxis !== AxisType.Parent ) {
						nextSymbols = currentSymbols.filter(current => xpathNameMatchesSymbol(token.value, current.name));
					} else {
						unionElementNames.push(token.value);
						for (let i = 0; i < currentSymbols.length; i++) {
							const symbol = currentSymbols[i];
							if (hasParentAxis) {
								symbol.children.forEach((child: SymbolWithParent) => {
									if (child.kind !== vscode.SymbolKind.Array && xpathNamesMatcheSymbol(unionElementNames, child.name)) {
										if (!child.parent) {
											child.parent = symbol;
										}
										nextSymbols.push(child);
									}
								});
							} else {
								const next = symbol.children.filter(child => child.kind !== vscode.SymbolKind.Array && xpathNamesMatcheSymbol(unionElementNames, child.name));
								nextSymbols = nextSymbols.concat(next);
							}
						}
						unionElementNames.length = 0;
					}
					break;
				case TokenLevelState.attributeNameTest:
					const attrTokenValue = token.value.substring(1);
					currentSymbols.forEach(symbol => {
						const attrContainer = symbol.children.length > 0? symbol.children[0] : undefined;
						if (attrContainer && attrContainer.kind === vscode.SymbolKind.Array) {
							const attributes = attrContainer.children;
							attributes.forEach((attr: SymbolWithParent) => {
								if (attr.name === attrTokenValue) {
									attr.isAttr = true;
									if (hasParentAxis) {
										attr.parent = symbol;
									}
									nextSymbols.push(attr);
								}
							});
						} 
					});
					// leave axisType as child
					break;
				case TokenLevelState.axisName:
					switch (token.value) {
						case 'self':
							nextAxis = AxisType.Self;
							nextSymbols = currentSymbols;
							break;
						case 'descendant-or-self':
						case 'descendant':
							nextSymbols = isPathStart ? [symbols[0]] : currentSymbols;
							nextAxis = AxisType.Descendant;
							if (token.value === 'descendant-or-self') {
								nextAxis = AxisType.DescendantOrSelf;
							}
							const { outSymbols, attrNameArray } = XsltSymbolProvider.getDescendantSymbols(nextSymbols, nextAxis === AxisType.DescendantOrSelf, hasParentAxis);
							nextSymbols = outSymbols;
							descendantAttrNames = attrNameArray;
							break;
						case 'attribute':
							currentSymbols.forEach(symbol => {
								const attrContainer = symbol.children.length > 0? symbol.children[0] : undefined;
								if (attrContainer && attrContainer.kind === vscode.SymbolKind.Array) {
									const attributes = attrContainer.children;
									attributes.forEach((attr: SymbolWithParent) => {
										attr.isAttr = true;
										if (hasParentAxis) {
											attr.parent = symbol;
										}
										nextSymbols.push(attr);
									});
								} 
							});
							nextAxis = AxisType.Attribute;
							break;
						case 'parent':
							currentSymbols.forEach(symbol => { if (symbol.parent) nextSymbols.push(symbol.parent); });
							nextAxis = AxisType.ParentKeep;
							break;
					  case 'following-sibling':
							nextAxis = AxisType.FollowingSibling;
						case 'preceding-sibling':
							// include all siblings
							const isFollowing = nextAxis === AxisType.FollowingSibling;
							currentSymbols.forEach(symbol => {
								const sParent = symbol.parent;
								if (sParent) {
									const pos = symbol.range.start;
									sParent.children.forEach((c: SymbolWithParent) => {
										if (c.kind !== vscode.SymbolKind.Array && (
											(isFollowing && c.range.start.isAfter(pos) ||
											(!isFollowing && c.range.start.isBefore(pos))
											)
										)) {
											if (hasParentAxis && !c.parent) {
												c.parent = sParent;
											}
											nextSymbols.push(c);
										}
									});
								} 
							});
							if (!isFollowing) {
								nextAxis = AxisType.PrecedingSibling;
							}
							break;
						case 'ancestor-or-self':
							nextAxis = AxisType.AncestorOrSelf;
						case 'ancestor':
							const includeSelf = nextAxis === AxisType.AncestorOrSelf;
							currentSymbols.forEach(symbol => {
								let s: SymbolWithParent | undefined = symbol;
								if (includeSelf) {
									nextSymbols.push(s);
								}
								while (s) {
									s = s.parent;
									if (s) {
										nextSymbols.push(s);
									}
								}
							});
							if (!includeSelf) {
								nextAxis = AxisType.Ancestor;
							}
							break;
					}
					break;
				case TokenLevelState.nodeType:
					if (isPathStart) {
						// TODO: start with all descendants?
						currentSymbols = [symbols[0]];
					}
					if (['*','node','element','item'].indexOf(token.value) !== -1) {
						if (isDocumentNode) {
							isDocumentNode = false;								
							nextSymbols = currentSymbols;
						} else if (currentAxis !== AxisType.Child && currentAxis !== AxisType.Parent) {
							nextSymbols = currentSymbols;
						} else {
							currentSymbols.forEach(symbol => {
								if (hasParentAxis) {
									symbol.children.forEach((child: SymbolWithParent) => {
										if (child.kind !== vscode.SymbolKind.Array) {
											if (!child.parent) {
												child.parent = symbol;
											}
											nextSymbols.push(child);
										}
									});
								} else {
									const elementChildren = symbol.children.filter(child => child.kind !== vscode.SymbolKind.Array);
									nextSymbols = nextSymbols.concat(elementChildren);
								}
							});
						}
					} else if (token.value === '..') {
						currentSymbols.forEach(symbol => {if (symbol.parent) nextSymbols.push(symbol.parent);});
						nextAxis = AxisType.Parent;
					}
					break;
				case TokenLevelState.variable:
					// can only happen at start of path - assume all descendant-or-self
					const descendantOrSelf = true;
					nextSymbols = [symbols[0]];
					const { outSymbols, attrNameArray } = XsltSymbolProvider.getDescendantSymbols(nextSymbols, descendantOrSelf, hasParentAxis);
					nextSymbols = outSymbols;
					descendantAttrNames = attrNameArray;
					nextAxis = AxisType.DescendantOrSelf;
					isDocumentNode = false;
					break;
				case TokenLevelState.operator:
					break;
			}

			currentSymbols = nextSymbols;
			isPathStart = false;

			if (i === 0) {
				let elementNames = new Set<string>();
				let attrNames = new Set<string>();

				if (isDocumentNode) {
					elementNames.add(currentSymbols[0].name);
				} else if (nextAxis === AxisType.Attribute) {
					currentSymbols.forEach(current => {
						if (current.isAttr) {
							attrNames.add(current.name);
						}});
				} else if (nextAxis !== AxisType.Child && nextAxis !== AxisType.Parent) {
					currentSymbols.forEach(current => {
						if (current.isAttr) {
							attrNames.add(current.name);
						} else {
						elementNames.add(current.name);}
					});
				} else {
					for (let x = 0; x < currentSymbols.length; x++) {
						const curentSymbol = currentSymbols[x];
						curentSymbol.children.forEach(child => {
							if (child.kind === vscode.SymbolKind.Array && child.name === 'attributes') {
								child.children.forEach(child => attrNames.add('@' + child.name));
							} else {
								elementNames.add(child.name);
							}
						});
					}
				}
				const attrNameArray = (nextAxis === AxisType.Descendant || nextAxis === AxisType.DescendantOrSelf)
				? descendantAttrNames : [...attrNames];
				return [[...elementNames], attrNameArray];
			} // end if (i == 0)

		}

		return [[], []];

		function xpathNameMatchesSymbol(xpathName: string, symbolName: string) {
			let matches: boolean;
			if (xpathName.startsWith('*:')) {
				let symName = symbolName;
				const colonPos = symName.indexOf(':');
				symName = (colonPos > -1) ? symName.substring(colonPos + 1) : symName;
				matches = symName === xpathName.substring(2);
			} else {
				matches = symbolName === xpathName;
			}
			return matches;
		}

		function xpathNamesMatcheSymbol(xpathNames: string[], symbolName: string) {
			return !!xpathNames.find(v => xpathNameMatchesSymbol(v, symbolName));
		}
	}


	private static getDescendantSymbols(currentSymbols: vscode.DocumentSymbol[], descendantOrSelf: boolean, hasParentAxis: boolean, nodeName?: string) {
		let newSymbols: vscode.DocumentSymbol[] = [];
		let parentSymbols: vscode.DocumentSymbol[] = [];
		const isNameTest = nodeName !== undefined;
		let outSymbols:vscode.DocumentSymbol[] = descendantOrSelf? [...currentSymbols] : [];
		let attrNames = new Set<string>();

		do {
			// recursive descent to get all descendants
			currentSymbols.forEach(symbol => {
				symbol.children.forEach((child: SymbolWithParent)  => {
					if (child.kind === vscode.SymbolKind.Array) {
						child.children.forEach((attr: SymbolWithParent) => {
							attrNames.add('@' + attr.name);
							attr.isAttr = true;
							if (hasParentAxis){
								attr.parent = symbol;
							}
						});
					} else {
						if (hasParentAxis){
							child.parent = symbol;
						}
						outSymbols.push(child);
					}
				});
			});
			newSymbols = newSymbols.concat(outSymbols);
			currentSymbols = outSymbols;
			outSymbols = [];
		} while (currentSymbols.length > 0);
		if (isNameTest) {
			outSymbols = newSymbols.filter(symbol => symbol.name === nodeName);
		} else {
			outSymbols = newSymbols;
		}
		const attrNameArray = [...attrNames];
		return {outSymbols, attrNameArray};
	}

	public static getSymbolFromXPathLocator(rawText: string, symbols: vscode.DocumentSymbol[]) {
		const text = rawText.startsWith('/') ? rawText.substring(1) : '';
		const pathParts = text.split('/');

		if (symbols.length === 0) {
			return;
		}

		let currentSymbol: vscode.DocumentSymbol | undefined = symbols[0];

		pathParts.forEach((item, i) => {
			const isLastItem = i === pathParts.length - 1;
			if (currentSymbol === undefined) {
				// can't yet handle attribute-test: /element/@attribute
				return;
			} else if (isLastItem && item.startsWith('@') && currentSymbol.children.length > 0) {
				const attrName = item.substring(1);
				const attributesSymbol: vscode.DocumentSymbol | undefined = undefined;
				const firstChild = currentSymbol.children[0];
				if (firstChild.kind === vscode.SymbolKind.Array && firstChild.name === 'attributes') {
					currentSymbol = firstChild.children.find(symbol => symbol.name === attrName);
				} else {
					currentSymbol = undefined;
				}
				return;
			}
			const pos = item.indexOf('[');
			let pathName: string = '';
			// only want one result;
			let pathIndex = 1;
			if (pos === -1) {
				pathName = item;
			} else {
				const predicateString = item.substring(pos + 1, item.length - 1);
				const predicateNum = Number(predicateString);
				pathIndex = -1;
				if (!Number.isNaN(predicateNum)) {
					pathIndex = predicateNum;
				}
				pathName = item.substr(0, pos);
			}

			if (i === 0) {
				const spacePos = currentSymbol.name.indexOf(' ');
				const symbolName = spacePos === -1 ? currentSymbol.name : currentSymbol.name.substring(0, spacePos);
				currentSymbol = symbolName === pathName && pathIndex === 1 ? currentSymbol : undefined;
			} else {
				let nameCount = 0;
				currentSymbol = currentSymbol.children.find((symbol) => {
					const spacePos = symbol.name.indexOf(' ');
					const symbolName = spacePos === -1 ? symbol.name : symbol.name.substring(0, spacePos);
					if (symbolName === pathName) {
						nameCount++;
						return pathIndex === nameCount;
					} else {
						return false;
					}
				});
			}
		});
		return currentSymbol;
	}

	public static async processImportedGlobals(xsltPackages: XsltPackage[], importedGlobals1: ImportedGlobals[], level1Hrefs: string[], topLevel: boolean): Promise<GlobalsSummary> {
		let level2Globals: Promise<ImportedGlobals[]>[] = [];
		let level2Hrefs = XsltSymbolProvider.accumulateImportHrefs(xsltPackages, importedGlobals1, level1Hrefs);
		let newGlobals: ImportedGlobals[] = [];

		level2Hrefs.forEach((href) => {
			level2Globals.push(XsltSymbolProvider.fetchImportedGlobals([href]));
		});
		let importedGlobals2Array = await Promise.all(level2Globals);
		importedGlobals2Array.forEach((importedGlobals2) => {
			if (topLevel) {
				newGlobals = newGlobals.concat(importedGlobals2);
			} else {
				importedGlobals1 = importedGlobals1.concat(importedGlobals2);
			}
		});

		if (topLevel) {
			return { globals: newGlobals, hrefs: level2Hrefs };
		} else {
			return { globals: importedGlobals1, hrefs: level2Hrefs };
		}
	}

	public static accumulateImportHrefs(xsltPackages: XsltPackage[], importedGlobals: ImportedGlobals[], existingHrefs: string[]): string[] {
		let result: string[] = [];
		const rootPath = vscode.workspace.rootPath;
		importedGlobals.forEach((importedG) => {
			importedG.data.forEach((data) => {
				if (data.type === GlobalInstructionType.Import || data.type === GlobalInstructionType.Include) {
					let resolvedName = XsltSymbolProvider.resolvePath(data.name, importedG.href);
					if (existingHrefs.indexOf(resolvedName) < 0) {
						existingHrefs.push(resolvedName);
						result.push(resolvedName);
					}
				} else if (rootPath && data.type === GlobalInstructionType.UsePackage) {
					let packageLookup = xsltPackages.find((pkg) => {
						return pkg.name === data.name;
					});
					if (packageLookup) {
						let resolvedName = XsltSymbolProvider.resolvePathInSettings(packageLookup.path, rootPath);
						if (existingHrefs.indexOf(resolvedName) < 0) {
							existingHrefs.push(resolvedName);
							result.push(resolvedName);
						}
					}
				}
			});
		});
		return result;
	}

	private static getImportHrefs(xsltPackages: XsltPackage[], importedGlobals: ImportedGlobals[]): string[] {
		let result: string[] = [];
		const rootPath = vscode.workspace.rootPath;
		importedGlobals.forEach((importedG) => {
			importedG.data.forEach((data) => {
				if (data.type === GlobalInstructionType.Import || data.type === GlobalInstructionType.Include) {
					let resolvedName = XsltSymbolProvider.resolvePath(data.name, importedG.href);
					result.push(resolvedName);
				} else if (rootPath && data.type === GlobalInstructionType.UsePackage) {
					let packageLookup = xsltPackages.find((pkg) => {
						return pkg.name === data.name;
					});
					if (packageLookup) {
						let resolvedName = XsltSymbolProvider.resolvePathInSettings(packageLookup.path, rootPath);
						result.push(resolvedName);
					}
				}
			});
		});
		return result;
	}

	public static resolvePath(href: string, documentPath: string) {

		if (path.isAbsolute(href)) {
			return href;
		} else if (href.startsWith('file:///')) {
			return href.substring(7);
		} else if (href.startsWith('file:/')) {
			return href.substring(5);
		} else {
			href = href.startsWith('file:') ? href.substring(5) : href;
			let basePath = path.dirname(documentPath);
			let joinedPath = path.join(basePath, href);
			return path.normalize(joinedPath);
		}
	}

	public static resolvePathInSettings(href: string, workspace: string) {

		if (path.isAbsolute(href)) {
			return href;
		} else {
			let joinedPath = path.join(workspace, href);
			return path.normalize(joinedPath);
		}
	}

	public static async fetchImportedGlobals(inputHrefs: string[]): Promise<ImportedGlobals[]> {
		let result: ImportedGlobals[] = [];
		//let inputHrefs: string[] = this.accumulateImportHrefs(globalInstructionData, existingHrefs, docHref);
		let lastIndex = inputHrefs.length - 1;
		if (lastIndex < 0) {
			return result;
		} else {
			return new Promise((resolve, reject) => {
				inputHrefs.forEach((href, index) => {
					GlobalsProvider.provideGlobals(href).then((globals) => {
						result.push({ href: href, data: globals.data, error: globals.error });
						if (index === lastIndex) {
							resolve(result);
						}
					});
				});
			});
		}
	}
}

