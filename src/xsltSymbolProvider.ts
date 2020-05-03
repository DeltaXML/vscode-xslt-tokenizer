import * as vscode from 'vscode';
import {XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType} from './xslLexer';
import {XsltTokenDiagnostics} from './xsltTokenDiagnostics';
import {GlobalsProvider} from './globalsProvider';

interface ImportedGlobals {
	href: string,
	data: GlobalInstructionData[]
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
		let importHrefs: string[] = [];

		this.accumulateImportHrefs(globalInstructionData, importHrefs);

		// TODO: import recursively if imports include imports etc.
		let importedGlobals = await this.fetchImportedGlobals(importHrefs);

		return new Promise((resolve, reject) => {
			let symbols: vscode.DocumentSymbol[] = [];
			console.log(importedGlobals);
			let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(document, allTokens, globalInstructionData, symbols);
			if (diagnostics.length > 0) {
				this.collection.set(document.uri, diagnostics);
			} else {
				this.collection.clear();
			};
			resolve(symbols);
		});

	}


	private accumulateImportHrefs(globalInstructionData: GlobalInstructionData[], importHrefs: string[]) {
		globalInstructionData.forEach((data) => {
			if (data.type === GlobalInstructionType.Import || data.type === GlobalInstructionType.Include) {
				importHrefs.push(this.gp.resolveHref(data.name));
			}
		});
	}

	private async fetchImportedGlobals(hrefs: string[]): Promise<ImportedGlobals[]> {
		let result: ImportedGlobals[] = [];
		let accumulatedImports: string[] = [];
		let lastIndex = hrefs.length - 1;
		if (lastIndex < 0) {
			return result;
		} else {
			return new Promise((resolve, reject) => {
				hrefs.forEach((href, index) => {
					this.gp.provideGlobals(href).then((globals) => {
						result.push({href: href, data: globals});
						accumulatedImports.push(href);
						if (index === lastIndex) {
							resolve(result);
						}
					});
				});
			});
		}
	}
}