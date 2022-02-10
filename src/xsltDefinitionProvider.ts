import * as vscode from 'vscode';
import {XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType, DocumentTypes} from './xslLexer';
import {GlobalsProvider} from './globalsProvider';
import * as path from 'path';
import { DefinitionLocation, XsltTokenDefinitions } from './xsltTokenDefintions';
import { XsltTokenCompletions } from './xsltTokenCompletions';
import { XSLTSchema, SchemaData } from './xsltSchema';
import { SchemaQuery } from './schemaQuery';
import { XsltPackage, XsltSymbolProvider } from './xsltSymbolProvider';
import { BaseToken, ExitCondition, LexPosition, XPathLexer } from './xpLexer';
import { XPathSemanticTokensProvider } from './extension';
import { DocumentChangeHandler } from './documentChangeHandler';
import * as url from 'url';

interface ImportedGlobals {
	href: string;
	data: GlobalInstructionData[];
	error: boolean;
}

interface GlobalsSummary {
	globals: ImportedGlobals[];
	hrefs: string[];
}

export interface ExtractedImportData {
	allTokens: BaseToken[]; 
	globalInstructionData: GlobalInstructionData[]; 
	allImportedGlobals: GlobalInstructionData[]; 
	accumulatedHrefs: string[]; 
}

export class XsltDefinitionProvider implements vscode.DefinitionProvider, vscode.CompletionItemProvider {

	private readonly xslLexer: XslLexer;
	private xpLexer: XPathLexer | null = null;
	private gp = new GlobalsProvider();
	private docType: DocumentTypes;
	private schemaData: SchemaData|undefined;
	private languageConfig: LanguageConfiguration;

	public constructor(xsltConfiguration: LanguageConfiguration) {
		this.languageConfig = xsltConfiguration;
		this.xslLexer = new XslLexer(xsltConfiguration);
		this.xslLexer.provideCharLevelState = true;
		this.docType = xsltConfiguration.docType;
		this.schemaData = xsltConfiguration.schemaData;
	}

	private getXPLexer() {
		if (this.xpLexer === null) {
			this.xpLexer = new XPathLexer();
		}
		return this.xpLexer;
	}

	public async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<DefinitionLocation | undefined> {
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };

		let extractedImportData: ExtractedImportData = await this.getImportedGlobals(document, lexPosition);
		const { allTokens, globalInstructionData, allImportedGlobals, accumulatedHrefs } = extractedImportData;

		return new Promise((resolve, reject) => {
			let location: DefinitionLocation|undefined = undefined;

			let isXSLT = this.docType === DocumentTypes.XSLT;
			location= XsltTokenDefinitions.findDefinition(isXSLT, document, allTokens, globalInstructionData, allImportedGlobals, position);
			if (location) {
				location.extractedImportData = extractedImportData;
			}

			resolve(location);
		});
	}

	public async seekDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<DefinitionLocation | undefined> {
		// extends provideDefinition so, if position within an instruction, it returns the instruction
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };

		let extractedImportData: ExtractedImportData = await this.getImportedGlobals(document, lexPosition);
		const { allTokens, globalInstructionData, allImportedGlobals, accumulatedHrefs } = extractedImportData;
		let matchingGlobal = globalInstructionData.find(global => { 
			return global.token.line === position.line && 
			position.character >= global.token.startCharacter && 
			position.character <= global.token.startCharacter + global.token.length;
		});

		if (!matchingGlobal) {
			matchingGlobal = XsltDefinitionProvider.functionInstructionFromDocPosition(document, position);
		}

		return new Promise((resolve, reject) => {
			let location: DefinitionLocation|undefined = undefined;

			if (matchingGlobal) {
				location = XsltTokenDefinitions.createLocationFromInstrcution(matchingGlobal, document);
			} else {
				let isXSLT = this.docType === DocumentTypes.XSLT;
				location= XsltTokenDefinitions.findDefinition(isXSLT, document, allTokens, globalInstructionData, allImportedGlobals, position);
			}

			if (location) {
				location.extractedImportData = extractedImportData;
			}
			resolve(location);
		});
	}

	private static nameCharRgx = new RegExp(/[A-Z]|[a-z]|_|-|:/);

	public static functionInstructionFromDocPosition(document: vscode.TextDocument, position: vscode.Position) {
		let fnName: string | undefined;
		let fnInstruction: GlobalInstructionData | undefined;
		const line = document.lineAt(position.line).text;
		let startIndex = 0;
		for (startIndex = position.character; startIndex > 0; startIndex--) {
			const c = line.charAt(startIndex);
			if (!XsltDefinitionProvider.nameCharRgx.test(c)) {
				break;
			}				
		}
		let endIndex = 0;
		let isFunction = false;
		for (endIndex = position.character + 1; endIndex < line.length; endIndex++) {
			const c = line.charAt(endIndex);
			if (!XsltDefinitionProvider.nameCharRgx.test(c)) {
				if (c === '(') {
					isFunction = true;
				}
				break;
			}				
		}
		if (isFunction) {
			fnName = line.substring(startIndex + 1, endIndex);
			const token: BaseToken = { line: position.line, startCharacter: startIndex + 1, length: endIndex - (startIndex + 1), tokenType: 0, value: fnName};
			fnInstruction = { token: token, idNumber: -1, name: fnName, type: GlobalInstructionType.Function, href: url.fileURLToPath(document.uri.toString())};
		}
		return fnInstruction;
	}

	public async getImportedGlobals(document: vscode.TextDocument, lexPosition: LexPosition) {
		let allTokens: BaseToken[] = [];
		let globalInstructionData: GlobalInstructionData[] = [];
		if (this.docType === DocumentTypes.XPath) {
			allTokens = this.getXPLexer().analyse(document.getText(), ExitCondition.None, lexPosition);
			globalInstructionData = XPathSemanticTokensProvider.getGlobalInstructionData();
		} else {
			allTokens = this.xslLexer.analyse(document.getText());
			globalInstructionData = this.xslLexer.globalInstructionData;
		}

		const xsltPackages: XsltPackage[] = <XsltPackage[]>vscode.workspace.getConfiguration('XSLT.resources').get('xsltPackages');

		// Import/include XSLT - ensuring no duplicates
		const localImportedHrefs = XsltSymbolProvider.importSymbolHrefs;
		let { importedGlobals1, accumulatedHrefs }: { importedGlobals1: ImportedGlobals[]; accumulatedHrefs: string[] } =
		 await XsltSymbolProvider.processTopLevelImports(false, this.xslLexer, localImportedHrefs, document, globalInstructionData, xsltPackages);
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

		let allImportedGlobals: GlobalInstructionData[] = [];

		globalsSummary0.globals.forEach((globals) => {
			if (globals.error) {
				// ignore 
			} else {
				globals.data.forEach((global) => {
					global['href'] = globals.href;
					allImportedGlobals.push(global);
				});
			}
		});
		return { allTokens, globalInstructionData, allImportedGlobals, accumulatedHrefs };
	}

	public async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionItem[] | undefined> {
		const keepNameTests = true;
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		let symbolsForXPath: vscode.DocumentSymbol[] = [];

		let allTokens: BaseToken[] = [];
		let globalInstructionData: GlobalInstructionData[] = [];
		let uri: vscode.Uri|undefined;
		if (this.docType === DocumentTypes.XPath) {
			allTokens = this.getXPLexer().analyse(document.getText(), ExitCondition.None, lexPosition);
			globalInstructionData = XPathSemanticTokensProvider.getGlobalInstructionData();
			uri = DocumentChangeHandler.lastActiveXMLEditor?.document.uri;

		} else {
			if (this.docType === DocumentTypes.XSLT) {
				uri = DocumentChangeHandler.lastActiveXMLNonXSLEditor?.document.uri;
			} else {
				uri = DocumentChangeHandler.lastActiveXMLEditor?.document.uri;
			}
			allTokens = this.xslLexer.analyse(document.getText(), keepNameTests);
			globalInstructionData = this.xslLexer.globalInstructionData;
		}

		if (uri) {
			const lastSymbols = XsltSymbolProvider.documentSymbols.get(uri);
			if (lastSymbols) {
				symbolsForXPath = lastSymbols;
			}
		}
		
		const xsltPackages: XsltPackage[] = <XsltPackage[]>vscode.workspace.getConfiguration('XSLT.resources').get('xsltPackages');

		// Import/include XSLT - ensuring no duplicates
		const localImportedHrefs = XsltSymbolProvider.importSymbolHrefs;
		let { importedGlobals1, accumulatedHrefs }:
			{ importedGlobals1: ImportedGlobals[]; accumulatedHrefs: string[] }
			= await XsltSymbolProvider.processTopLevelImports(false, this.xslLexer, localImportedHrefs, document, globalInstructionData, xsltPackages);


		let globalsSummary0: GlobalsSummary = {globals: importedGlobals1, hrefs: accumulatedHrefs};
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
			let allImportedGlobals: GlobalInstructionData[] = [];

			globalsSummary0.globals.forEach((globals) => {
				if (globals.error) {
					// ignore 
				} else {
					globals.data.forEach((global) => {
						global['href'] = globals.href;
						allImportedGlobals.push(global);
					});
				}		
			});
			let attNames = this.xslLexer.attributeNameTests? this.xslLexer.attributeNameTests: [];
			let nodeNames = this.xslLexer.elementNameTests? this.xslLexer.elementNameTests: [];
			let xslVariable = ['xsl:variable', 'xsl:param'];
			
			let completions: vscode.CompletionItem[]|undefined;
			completions= XsltTokenCompletions.getCompletions(this.languageConfig, symbolsForXPath, xslVariable, attNames, nodeNames, document, allTokens, globalInstructionData, allImportedGlobals, position);
			resolve(completions);
		});

	}
}