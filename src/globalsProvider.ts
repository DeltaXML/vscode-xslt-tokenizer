// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {XSLTConfiguration} from './languageConfigurations';
import { GlobalInstructionData } from "./xslLexer";

export class GlobalsProvider {
	// -------------
	public async provideGlobals(): Promise<GlobalInstructionData[]> {
		let rootPath = vscode.workspace.rootPath? vscode.workspace.rootPath: '/';
		let includePath = path.join(rootPath, 'new.xsl');
		let xsltText = '';
		let lexer = new XslLexerLight(XSLTConfiguration.configuration);
		let data: GlobalInstructionData[] = [];

		if (await this.exists(includePath)) {
			xsltText= fs.readFileSync(includePath).toString('utf-8');
			data = lexer.analyseLight(xsltText);
		}

		return data;
	}

	exists(file: string): Promise<boolean> {
		return new Promise<boolean>((resolve, _reject) => {
			fs.exists(file, (value) => {
				resolve(value);
			});
		});
	}
}



