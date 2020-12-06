import * as vscode from 'vscode';
import {XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType, DocumentTypes} from './xslLexer';
import {GlobalsProvider} from './globalsProvider';
import * as path from 'path';
import { XsltTokenDefinitions } from './xsltTokenDefintions';
import { XsltTokenCompletions } from './xsltTokenCompletions';
import { XSLTSchema, SchemaData } from './xsltSchema';
import { SchemaQuery } from './schemaQuery';
import { XsltPackage, XsltSymbolProvider } from './xsltSymbolProvider';

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

	public async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Location | undefined> {
		const allTokens = this.xslLexer.analyse(document.getText());
		const globalInstructionData = this.xslLexer.globalInstructionData;
		const xsltPackages: XsltPackage[] = <XsltPackage[]>vscode.workspace.getConfiguration('XSLT.resources').get('xsltPackages');

		// Import/include XSLT - ensuring no duplicates
		let importedG: ImportedGlobals = {data: globalInstructionData, href: document.fileName, error: false};
		let importedGlobals1 = [importedG];
		let accumulatedHrefs: string[] = [importedG.href];


		let globalsSummary0: GlobalsSummary = {globals: importedGlobals1, hrefs: accumulatedHrefs};
		const maxImportLevel = 20;

		let processNestedGlobals = async () => {
			let level = 0;
			while (globalsSummary0.hrefs.length > 0 && level < maxImportLevel) {
				globalsSummary0 = await this.processImportedGlobals(xsltPackages, globalsSummary0.globals, accumulatedHrefs, level === 0);
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
		const allTokens = this.xslLexer.analyse(document.getText(), keepNameTests);
		const globalInstructionData = this.xslLexer.globalInstructionData;
		const xsltPackages: XsltPackage[] = <XsltPackage[]>vscode.workspace.getConfiguration('XSLT.resources').get('xsltPackages');

		// Import/include XSLT - ensuring no duplicates
		let importedG: ImportedGlobals = {data: globalInstructionData, href: document.fileName, error: false};
		let importedGlobals1 = [importedG];
		let accumulatedHrefs: string[] = [importedG.href];


		let globalsSummary0: GlobalsSummary = {globals: importedGlobals1, hrefs: accumulatedHrefs};
		const maxImportLevel = 20;

		let processNestedGlobals = async () => {
			let level = 0;
			while (globalsSummary0.hrefs.length > 0 && level < maxImportLevel) {
				globalsSummary0 = await this.processImportedGlobals(xsltPackages, globalsSummary0.globals, accumulatedHrefs, level === 0);
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
			completions= XsltTokenCompletions.getCompletions(this.languageConfig, xslVariable, attNames, nodeNames, document, allTokens, globalInstructionData, allImportedGlobals, position);
			resolve(completions);
		});

	}

	private async processImportedGlobals(xsltPackages: XsltPackage[], importedGlobals1: ImportedGlobals[], level1Hrefs: string[], topLevel: boolean): Promise<GlobalsSummary> {
		let level2Globals: Promise<ImportedGlobals[]>[] = [];
		let level2Hrefs = this.accumulateImportHrefs(xsltPackages, importedGlobals1, level1Hrefs);
		let newGlobals: ImportedGlobals[] = [];

		level2Hrefs.forEach((href) => {
			level2Globals.push(this.fetchImportedGlobals([href]));
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
			return {globals: newGlobals, hrefs: level2Hrefs};
		} else {
			return {globals: importedGlobals1, hrefs: level2Hrefs};
		}
	}

	private accumulateImportHrefs(xsltPackages: XsltPackage[],importedGlobals: ImportedGlobals[], existingHrefs: string[]): string[] {
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

	private async fetchImportedGlobals(inputHrefs: string[]): Promise<ImportedGlobals[]> {
		let result: ImportedGlobals[] = [];
		//let inputHrefs: string[] = this.accumulateImportHrefs(globalInstructionData, existingHrefs, docHref);
		let lastIndex = inputHrefs.length - 1;
		if (lastIndex < 0) {
			return result;
		} else {
			return new Promise((resolve, reject) => {
				inputHrefs.forEach((href, index) => {
					this.gp.provideGlobals(href).then((globals) => {
						result.push({href: href, data: globals.data, error: globals.error});
						if (index === lastIndex) {
							resolve(result);
						}
					});
				});
			});
		}
	}
}