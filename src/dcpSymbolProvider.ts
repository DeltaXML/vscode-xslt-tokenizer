import * as vscode from 'vscode';
import { XslLexer, LanguageConfiguration, DocumentTypes } from './xslLexer';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';



export class DCPSymbolProvider implements vscode.DocumentSymbolProvider {

	private readonly xslLexer: XslLexer;
	private readonly collection: vscode.DiagnosticCollection;
	private static varNames = ['stringParameter', 'booleanParameter'];
	private docType: DocumentTypes


	public constructor(xsltConfiguration: LanguageConfiguration, collection: vscode.DiagnosticCollection) {
		this.xslLexer = new XslLexer(xsltConfiguration);
		this.xslLexer.provideCharLevelState = true;
		this.collection = collection;
		this.docType = xsltConfiguration.docType;
	}

	public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[] | undefined> {
		const allTokens = this.xslLexer.analyse(document.getText());


		return new Promise((resolve, reject) => {
			let symbols: vscode.DocumentSymbol[] = [];

			let importDiagnostics: vscode.Diagnostic[] = [];
			let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(DCPSymbolProvider.varNames, this.docType, document, allTokens, [], [], symbols);
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