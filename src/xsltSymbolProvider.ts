import * as vscode from 'vscode';
import { XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType, DocumentTypes } from './xslLexer';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { GlobalsProvider } from './globalsProvider';
import * as path from 'path';
import { exit } from 'process';
import { DocumentChangeHandler } from './documentChangeHandler';
import * as url from 'url';
import { BaseToken } from './xpLexer';

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
	Parent
}


type possDocumentSymbol = vscode.DocumentSymbol | null;


type Entry = [string, number];

export class XsltSymbolProvider implements vscode.DocumentSymbolProvider {

	private readonly xslLexer: XslLexer;
	private readonly collection: vscode.DiagnosticCollection | null;
	private readonly languageConfig: LanguageConfiguration;
	private docType: DocumentTypes;
	public static documentSymbols: vscode.DocumentSymbol[] = [];
	private importHrefs: Map<string, string[]> = new Map();
	public static importSymbolHrefs: Map<string, string[]> = new Map();


	public constructor(xsltConfiguration: LanguageConfiguration, collection: vscode.DiagnosticCollection | null) {
		this.xslLexer = new XslLexer(xsltConfiguration);
		this.xslLexer.provideCharLevelState = true;
		this.collection = collection;
		this.languageConfig = xsltConfiguration;
		this.docType = xsltConfiguration.docType;
	}

	public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[] | undefined> {
		const result = this.getDocumentSymbols(document, true);
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
		XsltSymbolProvider.documentSymbols = [];
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
			XsltSymbolProvider.documentSymbols = symbols;
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
			const rootSymbol = XsltSymbolProvider.documentSymbols[0];
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
			const rootSymbol = XsltSymbolProvider.documentSymbols[0];
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
		} else {
			return symbol;
		}
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
