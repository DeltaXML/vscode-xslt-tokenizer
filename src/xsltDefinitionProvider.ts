import * as vscode from 'vscode';
import {XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType, DocumentTypes} from './xslLexer';
import {GlobalsProvider} from './globalsProvider';
import * as path from 'path';
import { XsltTokenDefinitions } from './xsltTokenDefintions';
import { XsltTokenCompletions } from './xsltTokenCompletions';
import { XSLTSchema, SchemaData } from './xsltSchema';
import { SchemaQuery } from './schemaQuery';
import { XsltPackage, XsltSymbolProvider } from './xsltSymbolProvider';
import { BaseToken, ExitCondition, LexPosition, XPathLexer } from './xpLexer';
import { XPathSemanticTokensProvider } from './extension';
import { DocumentChangeHandler } from './documentChangeHandler';

interface ImportedGlobals {
	href: string,
	data: GlobalInstructionData[],
	error: boolean
}

interface GlobalsSummary {
	globals: ImportedGlobals[],
	hrefs: string[]
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

	public async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Location | undefined> {
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };

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
		let { importedGlobals1, accumulatedHrefs }:
			{ importedGlobals1: ImportedGlobals[]; accumulatedHrefs: string[]; }
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
			let location: vscode.Location|undefined = undefined;
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

			let isXSLT = this.docType === DocumentTypes.XSLT;
			location= XsltTokenDefinitions.findDefinition(isXSLT, document, allTokens, globalInstructionData, allImportedGlobals, position);

			resolve(location);
		});

	}

	public async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): Promise<vscode.CompletionItem[] | undefined> {
		const keepNameTests = true;
		const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
		let symbolsForXPath: vscode.DocumentSymbol[] = [];

		let allTokens: BaseToken[] = [];
		let globalInstructionData: GlobalInstructionData[] = [];
		if (this.docType === DocumentTypes.XPath) {
			allTokens = this.getXPLexer().analyse(document.getText(), ExitCondition.None, lexPosition);
			globalInstructionData = XPathSemanticTokensProvider.getGlobalInstructionData();
			const uri = DocumentChangeHandler.lastActiveXMLEditor?.document.uri;
			if (uri) {
				const lastSymbols = XsltSymbolProvider.documentSymbols.get(uri);
				if (lastSymbols) {
					symbolsForXPath = lastSymbols;
				}
			}
		} else {
			allTokens = this.xslLexer.analyse(document.getText(), keepNameTests);
			globalInstructionData = this.xslLexer.globalInstructionData;
		}
		
		const xsltPackages: XsltPackage[] = <XsltPackage[]>vscode.workspace.getConfiguration('XSLT.resources').get('xsltPackages');

		// Import/include XSLT - ensuring no duplicates
		const localImportedHrefs = XsltSymbolProvider.importSymbolHrefs;
		let { importedGlobals1, accumulatedHrefs }:
			{ importedGlobals1: ImportedGlobals[]; accumulatedHrefs: string[]; }
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