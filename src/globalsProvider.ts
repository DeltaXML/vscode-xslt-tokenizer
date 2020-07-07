// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import * as fs from 'fs';
import {XSLTLightConfiguration} from './languageConfigurations';
import { GlobalInstructionData } from "./xslLexer";

export interface GlobalImportData {
	data: GlobalInstructionData[];
	error: boolean
}

export class GlobalsProvider {

	// -------------
	public async provideGlobals(href: string): Promise<GlobalImportData> {
		let xsltText = '';
		let lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
		let data: GlobalInstructionData[] = [];
		let error = true;

		if (href.length !== 0 && await this.fileExists(href)) {
			xsltText= fs.readFileSync(href).toString('utf-8');
			data = lexer.analyseLight(xsltText);
			error = false;
		}

		return {data: data, error: error};
	}

	fileExists(file: string): Promise<boolean> {
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



