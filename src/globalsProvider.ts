// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import * as vscode from 'vscode'
import {XSLTLightConfiguration} from './languageConfigurations';
import { GlobalInstructionData } from "./xslLexer";

export interface GlobalImportData {
	data: GlobalInstructionData[];
	error: boolean
}

export class GlobalsProvider {

	public static async provideGlobals(href: string): Promise<GlobalImportData> {
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

	public static async fileExists(file: string): Promise<boolean> {
		let exists = false;
		try {
			await vscode.workspace.openTextDocument(file);
			exists = true;
		} catch (e) {
			// do nothing
		}
		return exists;
	}
}



