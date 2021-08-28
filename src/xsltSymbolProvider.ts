import * as vscode from 'vscode';
import { XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType, DocumentTypes } from './xslLexer';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { GlobalsProvider } from './globalsProvider';
import * as path from 'path';
import { exit } from 'process';
import { DocumentChangeHandler } from './documentChangeHandler';
import * as url from 'url';
import { BaseToken, CharLevelState, TokenLevelState } from './xpLexer';
import { ElementData, XPathData } from './xsltTokenCompletions'

interface ImportedGlobals {
	href: string,
	data: GlobalInstructionData[],
	error: boolean
}

interface GlobalsSummary {
	globals: ImportedGlobals[],
	hrefs: string[]
}

export interface XsltPackage {
	name: string,
	path: string,
	version?: string
}

export enum SelectionType {
	Current,
	Next,
	Previous,
	Parent,
	FirstChild
}

enum AxisType {
	Child,
	Descendant,
	Parent,
	Ancestor
}


type possDocumentSymbol = vscode.DocumentSymbol | null;


type Entry = [string, number];

export class XsltSymbolProvider implements vscode.DocumentSymbolProvider {

	private readonly xslLexer: XslLexer;
	private readonly collection: vscode.DiagnosticCollection | null;
	private readonly languageConfig: LanguageConfiguration;
	private docType: DocumentTypes;
	public static documentSymbols = new Map<vscode.Uri, vscode.DocumentSymbol[]>();
	private importHrefs: Map<string, string[]> = new Map();
	public static importSymbolHrefs: Map<string, string[]> = new Map();


	public constructor(xsltConfiguration: LanguageConfiguration, collection: vscode.DiagnosticCollection | null) {
		this.xslLexer = new XslLexer(xsltConfiguration);
		this.xslLexer.provideCharLevelState = true;
		this.collection = collection;
		this.languageConfig = xsltConfiguration;
		this.docType = xsltConfiguration.docType;
	}

	public static getSymbolsForActiveDocument(): vscode.DocumentSymbol[] {
		if (vscode.window.activeTextEditor) {
			const result = XsltSymbolProvider.documentSymbols.get(vscode.window.activeTextEditor.document.uri);
			return result ? result : [];
		} else {
			return []
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
		const globalInstructionData = this.xslLexer.globalInstructionData;
		const xsltPackages: XsltPackage[] = <XsltPackage[]>vscode.workspace.getConfiguration('XSLT.resources').get('xsltPackages');

		// Import/include XSLT - ensuring no duplicates
		const localImportedHrefs = XsltSymbolProvider.importSymbolHrefs;
		let { importedGlobals1, accumulatedHrefs }:
			{ importedGlobals1: ImportedGlobals[]; accumulatedHrefs: string[]; }
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

			if (vscode.window.activeTextEditor && document.fileName !== vscode.window.activeTextEditor.document.fileName) {

			} else {
				let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(this.languageConfig, this.docType, document, allTokens, globalInstructionData, allImportedGlobals, symbols);
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
				XsltSymbolProvider.documentSymbols.set(document.uri, symbols);
			}

			resolve(symbols);
		});

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
			}
			const importInstruction: GlobalInstructionData = {
				type: GlobalInstructionType.Import,
				name: matchingParent,
				token: token,
				idNumber: 0
			}

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

	public static selectXMLElement(selectionType: SelectionType) {
		const selection = vscode.window.activeTextEditor?.selection;
		if (vscode.window.activeTextEditor && selection) {
			const rootSymbol = XsltSymbolProvider.getSymbolsForActiveDocument()[0];
			const path: string[] = [];
			const result = this.getChildSymbolForSelection(selection, rootSymbol, path, selectionType, null, null, null);
			if (result !== null) {
				XsltSymbolProvider.selectTextWithSymbol(result);
			}
		}
	}

	public static getXPathFromSelection() {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const selection = editor.selection;
			const rootSymbol = XsltSymbolProvider.getSymbolsForActiveDocument()[0];
			const newPath = ['/' + rootSymbol.name.split(' ')[0]];
			const result = this.getChildSymbolForSelection(selection, rootSymbol, newPath, SelectionType.Current, null, null, null);
			const fullPath = newPath.join('');
			return fullPath;
		}
	}


	private static getChildSymbolForSelection(selection: vscode.Selection, symbol: vscode.DocumentSymbol, path: string[], selectionType: SelectionType, parentSymbol: possDocumentSymbol, precedingSymbol: possDocumentSymbol, nextSymbol: possDocumentSymbol): possDocumentSymbol {
		const result = symbol.children.find((sym) => {
			const selectionPos = new vscode.Position(selection.start.line, selection.start.character);
			return sym.range.contains(selectionPos);
		});

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
			if (symbol.kind === vscode.SymbolKind.Array && symbol.name === 'attributes') {
				path.push('/@' + resultName);
			} else if (!(result.kind === vscode.SymbolKind.Array && result.name === 'attributes')) {
				path.push('/' + resultName + `[${precedingSymbolNames}]`);
			}
			return this.getChildSymbolForSelection(selection, result, path, selectionType, symbol, precedingSibling, nextSibling);
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

	public static filterPathTokens(tokens: BaseToken[], position: number, xpathStack: XPathData[]) {
		let cleanedTokens: BaseToken[] = [];
		const bracketTokens: BaseToken[] = [];
		let saveToken = false;
		let nesting = 0;
		let exitLoop = false;
		let finalSlashToken: BaseToken|undefined;
		let xpathStacksChecked = 0;
		let lastTokenWasSlash = false;
		let lastTokenWasSlash2 = false;

		// track backwards to get all tokens in path
		for (let i = position; i > -1; i--) {
			const token = tokens[i];
			let xpathCharType = <CharLevelState>token.charType;
			let xpathTokenType = <TokenLevelState>token.tokenType;
			if (nesting > 0) {
				if (xpathTokenType === TokenLevelState.operator && xpathCharType === CharLevelState.lPr) {
					nesting--;
				}
			} else if (bracketTokens.length > 0) {
				// test to see if: (element1|element2)
				switch (xpathTokenType) {
					case TokenLevelState.operator:
						switch (xpathCharType) {
							case CharLevelState.lB:
								cleanedTokens = cleanedTokens.concat(...bracketTokens);
								saveToken = true;
								bracketTokens.length = 0;
								break;
							case CharLevelState.sep:
								// TODO: handle '*' what token type is this?
								exitLoop = (token.value !== '|' && token.value !== ',');
								break;
							default:
								exitLoop = true;
						}
						break;
					case TokenLevelState.nodeNameTest:
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
								bracketTokens.push(token);
								break;
							case CharLevelState.dSep:
								exitLoop = (token.value !== '//' && token.value !== '::');
								saveToken = token.value === '//';
								break;
							case CharLevelState.sep:
								// keep '/' char if it's the last part of the reversed path meaning we're on an absolute path
								exitLoop = token.value !== '/';
								if (!exitLoop && i === 0) {
									cleanedTokens.push(token);
								} if (!exitLoop) {
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
					case TokenLevelState.axisName:
						saveToken = true;
						break;
					case TokenLevelState.nodeType:
						saveToken = ['*', '..'].indexOf(token.value) !== -1;
						// TODO: for '..' case, we can just pop cleanedTokens and not save?
						exitLoop = !(saveToken || token.value === '.');
						break;
					default:
						exitLoop = true;
						break;
				}
			}
			if (exitLoop) {
				// check to see if we're still within a predicate: el1[el2 and el3]
				exitLoop = false;
				let predicateStart = -1;

				const xpathStackEnd = xpathStack.length - (xpathStacksChecked + 1);
				for (let x = xpathStackEnd; x > -1; x--) {
					xpathStacksChecked++;
					const item = xpathStack[x];
					if (item.token.charType === CharLevelState.lPr && item.tokenIndex) {
						predicateStart = item.tokenIndex;
						break;
					}
				}
				if (predicateStart === -1) {
					if (lastTokenWasSlash2 && finalSlashToken) {
						cleanedTokens.push(finalSlashToken)
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
		return cleanedTokens;
	}

	public static getExpectedForXPathLocation(tokens: BaseToken[], symbols: vscode.DocumentSymbol[]) {		
		if (symbols.length === 0) {
			return [[], []];
		}		
		if (tokens.length === 0) {
			const rootSymbol = symbols[0];
			return [[rootSymbol.name], []];
		}

		const lastTokenIndex = tokens.length - 1;		
		let elementNames = new Set<string>();
		let attrNames = new Set<string>();
		// start with root element symbol:
		let currentSymbols: vscode.DocumentSymbol[] = [];
		let isDocumentNode = false;
		let nextAxis = AxisType.Child;
		let isPathStart = true;

		// track backwards to get all tokens in path
		for (let i = lastTokenIndex; i > -1; i--) {
			const token = tokens[i];
			const tv = token.value;
			let xpathCharType = <CharLevelState>token.charType;
			let xpathTokenType = <TokenLevelState>token.tokenType;
			let currentAxis = nextAxis;
			nextAxis = AxisType.Child;


			let nextSymbols: vscode.DocumentSymbol[] = [];

			switch (xpathTokenType) {
				case TokenLevelState.operator:
					switch (xpathCharType) {
						case CharLevelState.sep:
							if (isPathStart) {
								isDocumentNode = token.value === '/'
							}
							break;
						case CharLevelState.dSep:
							if (token.value === '//') {
								// need to just hold and wait for next token
								// 1. //*
								// 2. //element
								nextAxis = AxisType.Descendant;
								nextSymbols = currentSymbols;								
							}
					}
					break;
				case TokenLevelState.nodeNameTest:
					if (isDocumentNode) {
						isDocumentNode = false;
						// starting point: assume root element
						if (symbols[0].name === token.value) {
							nextSymbols = [symbols[0]];
						}
					} else {
						if (currentAxis === AxisType.Child) {
							for (let i = 0; i < currentSymbols.length; i++) {
								const symbol = currentSymbols[i];
								const next = symbol.children.filter(child => child.name === token.value);
								nextSymbols = nextSymbols.concat(next);
							}
						} else if (currentAxis === AxisType.Descendant) {
							nextSymbols = XsltSymbolProvider.getDescendantSymbols(currentSymbols, token.value);
						}
					}
					break;
				case TokenLevelState.axisName:
					break;
				case TokenLevelState.nodeType:
					if (isPathStart) {
						currentSymbols = [symbols[0]];
					}
					if (token.value === '*') {
						if (currentAxis === AxisType.Child) {
							if (isDocumentNode) {
								isDocumentNode = false;								
								nextSymbols = [symbols[0]];
							} else {
								currentSymbols.forEach(symbol => {
									nextSymbols = nextSymbols.concat(symbol.children);
								});
							}
						} else if (currentAxis === AxisType.Descendant) {
							nextSymbols = XsltSymbolProvider.getDescendantSymbols(currentSymbols);
						}
					}
					break;
				case TokenLevelState.operator:
					break;
			}

			currentSymbols = nextSymbols;
			isPathStart = false;

			if (i === 0) {
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
			} // end if

		}

		return [[...elementNames], [...attrNames]];
	}


	private static getDescendantSymbols(currentSymbols: vscode.DocumentSymbol[], nodeName?: string) {
		let newSymbols: vscode.DocumentSymbol[] = [];
		const descendantOrSelf = false;
		const isNameTest = nodeName !== undefined;
		let nextSymbols:vscode.DocumentSymbol[] = descendantOrSelf? [...currentSymbols] : [];
		do {
			// recursive descent to get all descendants
			currentSymbols.forEach(symbol => {
				nextSymbols = nextSymbols.concat(symbol.children);
			});
			newSymbols = newSymbols.concat(nextSymbols);
			currentSymbols = nextSymbols;
			nextSymbols = [];
		} while (currentSymbols.length > 0);
		if (isNameTest) {
			nextSymbols = newSymbols.filter(symbol => symbol.name === nodeName);
		} else {
			nextSymbols = newSymbols;
		}
		return nextSymbols;
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
			let pathName: string = ''
			// only want one result;
			let pathIndex = 1;
			if (pos === -1) {
				pathName = item;
			} else {
				const predicateString = item.substring(pos + 1, item.length - 1);
				const predicateNum = Number(predicateString);
				pathIndex = -1;
				if (predicateNum !== NaN) {
					pathIndex = predicateNum;
				}
				pathName = item.substr(0, pos)
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
