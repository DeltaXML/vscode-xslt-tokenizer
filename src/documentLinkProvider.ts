// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import { GlobalInstructionData, GlobalInstructionType } from "./xslLexer";
import * as vscode from "vscode";
import { LanguageConfiguration} from "./xslLexer"
import * as path from 'path';

export class DocumentLinkProvider implements vscode.DocumentLinkProvider {

	private lexer: XslLexerLight;

	constructor(languageConfig: LanguageConfiguration) {
		this.lexer = new XslLexerLight(languageConfig);
	}

	provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentLink[] {
		let data: GlobalInstructionData[] = this.lexer.analyseLight(document.getText());
		let result: vscode.DocumentLink[] = [];
		data.forEach((instruction) => {
			if (instruction.type === GlobalInstructionType.Import || instruction.type === GlobalInstructionType.Include) {
				const basePath = path.dirname(document.fileName);
				const resolvedPath = path.resolve(basePath, instruction.name);
				const uri = vscode.Uri.parse(resolvedPath);
				const startPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter);
				const endPos = new vscode.Position(instruction.token.line, instruction.token.startCharacter + (instruction.token.length + 2));
				const link = new vscode.DocumentLink(new vscode.Range(startPos, endPos), uri);
				result.push(link);
			}
		});
		return result;
	}

}



