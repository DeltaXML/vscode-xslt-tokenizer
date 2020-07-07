import * as vscode from 'vscode';
import { XslLexer, LanguageConfiguration, DocumentTypes, GlobalInstructionType, GlobalInstructionData } from './xslLexer';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';
import { GlobalsProvider} from './globalsProvider';
import * as path from 'path';

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
		let globals = this.xslLexer.globalInstructionData;

		async function returnBadFileLinks(item: GlobalInstructionData): Promise<GlobalInstructionData|undefined> {
			const basePath = path.dirname(document.fileName);
			const resolvedPath = path.resolve(basePath, item.name);
			let fileExists = await GlobalsProvider.fileExists(resolvedPath);
			if (fileExists) {
				return undefined;
			} else {
				return item;
			}
		}

		let fileChecks: Promise<GlobalInstructionData|undefined>[] = [];
		globals.forEach((item) => {
			if (item.type === GlobalInstructionType.Import || item.type === GlobalInstructionType.Include) {
				fileChecks.push(returnBadFileLinks(item));
			}
		})
		let errorFileRefs = await Promise.all(fileChecks);

		return new Promise((resolve, reject) => {
			let symbols: vscode.DocumentSymbol[] = [];			
			let diagnostics = XsltTokenDiagnostics.calculateDiagnostics(DCPSymbolProvider.varNames, this.docType, document, allTokens, [], [], symbols);
			let importDiagnostics: vscode.Diagnostic[] = [];
			errorFileRefs.forEach((fileRef) => {
				if (fileRef) {
					importDiagnostics.push(XsltTokenDiagnostics.createImportDiagnostic(fileRef));
				}
			});
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