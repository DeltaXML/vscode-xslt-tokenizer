import * as vscode from 'vscode';
import {XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType} from './xslLexer';
import {XsltTokenDiagnostics} from './xsltTokenDiagnostics';
import {GlobalsProvider} from './globalsProvider';
import * as path from 'path';
import { promises } from 'dns';


interface ImportedGlobals {
	href: string,
	data: GlobalInstructionData[]
}

interface GlobalsSummary {
	globals: ImportedGlobals[],
	hrefs: string[]
}

export class XsltSymbolProvider implements vscode.DocumentSymbolProvider {

	private readonly xslLexer: XslLexer;
	private readonly collection: vscode.DiagnosticCollection;
	private gp = new GlobalsProvider();

	public constructor(xsltConfiguration: LanguageConfiguration, collection: vscode.DiagnosticCollection) {
		this.xslLexer = new XslLexer(xsltConfiguration);
		this.xslLexer.provideCharLevelState = true;
		this.collection = collection;
	}

	public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[] | undefined> {
		// console.log('provideDocumentSymbols: ' + document.uri);
		const allTokens = this.xslLexer.analyse(document.getText());
		const globalInstructionData = this.xslLexer.globalInstructionData;

		// TODO: import recursively if imports include imports etc.
		let importedG: ImportedGlobals = {data: globalInstructionData, href: document.fileName};
		let importedGlobals1 = [importedG];
		let accumulatedHrefs: string[] = [importedG.href];


		let globalsSummary0: GlobalsSummary = {globals: importedGlobals1, hrefs: accumulatedHrefs}

		let processNestedGlobals = async () => {
			let level = 0;
			while (globalsSummary0.hrefs.length > 0 && level < 20) {
				globalsSummary0 = await this.processImportedGlobals(globalsSummary0.globals, accumulatedHrefs);
				level++;
			}
		};

		await processNestedGlobals();

		return new Promise((resolve, reject) => {
			let symbols: vscode.DocumentSymbol[] = [];
			let flattenedGlobals: GlobalInstructionData[] = [];
			globalsSummary0.globals.forEach((globals) => {
				globals.data.forEach((global) => {
					flattenedGlobals.push(global);
				});
			});
			console.log('---- top-level globals-----');
			console.log(globalInstructionData);
			console.log('---- flattened globals -----');
			console.log(flattenedGlobals);

			let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(document, allTokens, globalInstructionData, symbols);
			if (diagnostics.length > 0) {
				this.collection.set(document.uri, diagnostics);
			} else {
				this.collection.clear();
			};
			resolve(symbols);
		});

	}

	private async processImportedGlobals(importedGlobals1: ImportedGlobals[], level1Hrefs: string[]): Promise<GlobalsSummary> {
		let level2Globals: Promise<ImportedGlobals[]>[] = [];
		let level2Hrefs = this.accumulateImportHrefs(importedGlobals1, level1Hrefs);

		level2Hrefs.forEach((href) => {
			level2Globals.push(this.fetchImportedGlobals([href]));
		});
		let importedGlobals2Array = await Promise.all(level2Globals);
		importedGlobals2Array.forEach((importedGlobals2) => {
			importedGlobals1 = importedGlobals1.concat(importedGlobals2);
		});
		return {globals: importedGlobals1, hrefs: level2Hrefs};
	}

	private accumulateImportHrefs(importedGlobals: ImportedGlobals[], existingHrefs: string[]): string[] {
		let result: string[] = [];
		importedGlobals.forEach((importedG) => {
			importedG.data.forEach((data) => {
				if (data.type === GlobalInstructionType.Import || data.type === GlobalInstructionType.Include) {
					let resolvedName = this.resolvePath(data.name, importedG.href);
					if (existingHrefs.indexOf(resolvedName) < 0) {
						existingHrefs.push(resolvedName);
						result.push(resolvedName);
					}
				}
			});
		});
		return result;
	}

	private resolvePath(href: string, documentPath: string) {

		if (path.isAbsolute(href)) {
			return href;
		} else {
			let basePath = path.dirname(documentPath);
			let joinedPath = path.join(basePath, href);
			return path.normalize(joinedPath);
		}
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
						result.push({href: href, data: globals});
						if (index === lastIndex) {
							resolve(result);
						}
					});
				});
			});
		}
	}
}