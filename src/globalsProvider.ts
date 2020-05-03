// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import * as fs from 'fs';
import {XSLTLightConfiguration} from './languageConfigurations';
import { GlobalInstructionData } from "./xslLexer";

export class GlobalsProvider {

	// -------------
	public async provideGlobals(href: string): Promise<GlobalInstructionData[]> {
		let xsltText = '';
		let lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
		let data: GlobalInstructionData[] = [];

		if (await this.exists(href)) {
			xsltText= fs.readFileSync(href).toString('utf-8');
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



