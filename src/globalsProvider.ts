// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import * as vscode from 'vscode'
import * as fs from 'fs';
import {XSLTLightConfiguration} from './languageConfigurations';
import { GlobalInstructionData } from "./xslLexer";

export interface GlobalImportData {
	data: GlobalInstructionData[];
	error: boolean
}

export class GlobalsProvider {

	public async provideGlobals(href: string): Promise<GlobalImportData> {
		let lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
		let data: GlobalInstructionData[] = [];

		if (href.length === 0) {
			return {data: data, error: true}; 
		}

		try {
			const doc = await vscode.workspace.openTextDocument(href);
			const text = doc.getText();
			data = lexer.analyseLight(text);
			return {data: data, error: false};
		} catch (e) {
			return {data: data, error: true};
		}
	}

	public static fileExists(file: string): Promise<boolean> {
		return new Promise<boolean>((resolve, _reject) => {
			fs.exists(file, (exists) => {
				if (exists) {
					let stats = fs.stat(file, (err, stats) => {
						resolve(stats.isFile());
					});
				} else {
					resolve(exists);
				}
			});
		});
	}
}



