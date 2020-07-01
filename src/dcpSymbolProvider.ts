import * as vscode from 'vscode';
import {XslLexer, LanguageConfiguration, GlobalInstructionData, GlobalInstructionType} from './xslLexer';
import {XsltTokenDiagnostics} from './xsltTokenDiagnostics';
import {GlobalsProvider} from './globalsProvider';
import * as path from 'path';

interface ImportedGlobals {
	href: string,
	data: GlobalInstructionData[],
	error: boolean
}

interface GlobalsSummary {
	globals: ImportedGlobals[],
	hrefs: string[]
}

export class DCPSymbolProvider implements vscode.DocumentSymbolProvider {

	private readonly xslLexer: XslLexer;
	private readonly collection: vscode.DiagnosticCollection;
	private readonly isXSLT: boolean;

	public constructor(xsltConfiguration: LanguageConfiguration, collection: vscode.DiagnosticCollection) {
		this.isXSLT = xsltConfiguration.nativePrefix === 'xsl';
		this.xslLexer = new XslLexer(xsltConfiguration);
		this.xslLexer.provideCharLevelState = true;
		this.collection = collection;
	}

	public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[] | undefined> {
		const allTokens = this.xslLexer.analyse(document.getText());


		return new Promise((resolve, reject) => {
			let symbols: vscode.DocumentSymbol[] = [];

			let importDiagnostics: vscode.Diagnostic[] = [];
			let varNames = ['stringParameter', 'booleanParameter'];
			let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(varNames, this.isXSLT, document, allTokens, [], [], symbols);
			let allDiagnostics = importDiagnostics.concat(diagnostics);
			if (allDiagnostics.length > 0) {
				this.collection.set(document.uri, allDiagnostics);
			} else {
				this.collection.clear();
			};
			resolve(symbols);
		});

	}

}