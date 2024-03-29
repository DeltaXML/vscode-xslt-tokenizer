// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import { GlobalInstructionData, GlobalInstructionType } from "./xslLexer";
import * as vscode from "vscode";
import { LanguageConfiguration } from "./xslLexer";
import * as path from 'path';
import { XsltPackage, XsltSymbolProvider } from './xsltSymbolProvider';
import * as url from 'url';


export class DocumentLinkProvider implements vscode.DocumentLinkProvider {

	private lexer: XslLexerLight;

	constructor(languageConfig: LanguageConfiguration) {
		this.lexer = new XslLexerLight(languageConfig);
	}

	provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentLink[] {
		let data: GlobalInstructionData[] = this.lexer.analyseLight(document.getText());
		let result: vscode.DocumentLink[] = [];
		const xsltPackages: XsltPackage[] = <XsltPackage[]>vscode.workspace.getConfiguration('XSLT.resources').get('xsltPackages');
		const rootPath = vscode.workspace.rootPath;


		data.forEach((instruction) => {
			if (instruction.type === GlobalInstructionType.Import || instruction.type === GlobalInstructionType.Include) {
				const resolvedPath = XsltSymbolProvider.resolvePath(instruction.name, document.fileName);
				const pathForUri = resolvedPath.startsWith('file:/') ? resolvedPath : url.pathToFileURL(resolvedPath).toString();
				const uri = vscode.Uri.parse(pathForUri);
				const startPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter);
				const endPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter + (instruction.token.length + 2));
				const link = new vscode.DocumentLink(new vscode.Range(startPos, endPos), uri);
				result.push(link);
			} else if (instruction.type === GlobalInstructionType.UsePackage) {
				let packageLookup = xsltPackages.find((pkg) => {
					return pkg.name === instruction.name;
				});
				if (packageLookup && rootPath) {
					let resolvedName = XsltSymbolProvider.resolvePathInSettings(packageLookup.path, rootPath);
					const pathForUri = resolvedName.startsWith('file:/') ? resolvedName : url.pathToFileURL(resolvedName).toString();

					const uri = vscode.Uri.parse(pathForUri);
					const startPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter);
					const endPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter + (instruction.token.length + 2));
					const link = new vscode.DocumentLink(new vscode.Range(startPos, endPos), uri);
					result.push(link);
				}
			}
		});
		return result;
	}

}



