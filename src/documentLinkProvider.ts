// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import { GlobalInstructionData, GlobalInstructionType } from "./xslLexer";
import * as vscode from "vscode";
import { LanguageConfiguration } from "./xslLexer";
import { XsltPackage } from './xsltSymbolProvider';
import { HrefPaths } from './hrefPaths';


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
				const target = HrefPaths.linkTarget(instruction.name, document.fileName);
				if (target === undefined) {
					return;
				}
				const uri = vscode.Uri.parse(target);
				const startPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter);
				const endPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter + instruction.token.length);
				const link = new vscode.DocumentLink(new vscode.Range(startPos, endPos), uri);
				result.push(link);
			} else if (instruction.type === GlobalInstructionType.UsePackage) {
				let packageLookup = xsltPackages.find((pkg) => {
					return pkg.name === instruction.name;
				});
				if (packageLookup && rootPath) {
					const packagePath = HrefPaths.settingsPath(packageLookup.path, rootPath);
					if (packagePath === undefined) {
						return;
					}
					const uri = vscode.Uri.file(packagePath);
					const startPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter);
					const endPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter + instruction.token.length);
					const link = new vscode.DocumentLink(new vscode.Range(startPos, endPos), uri);
					result.push(link);
				}
			}
		});
		return result;
	}

}



