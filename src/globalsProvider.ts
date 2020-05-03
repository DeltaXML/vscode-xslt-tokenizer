// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {XSLTLightConfiguration} from './languageConfigurations';
import { GlobalInstructionData } from "./xslLexer";

export class GlobalsProvider {

	absolutePathRegex = new RegExp(/^[A-Za-z]:|^\\|^\//);
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

	public resolveHref(href: string) {
		let rootPath = vscode.workspace.rootPath? vscode.workspace.rootPath: '/';
		return this.resolvePath(href, rootPath);
	}

	exists(file: string): Promise<boolean> {
		return new Promise<boolean>((resolve, _reject) => {
			fs.exists(file, (value) => {
				resolve(value);
			});
		});
	}

	resolvePath(href: string, rootPath: string) {
		if (this.absolutePathRegex.test(href)) {
			return href;
		} else {
			return path.join(rootPath, href);
		}
	}
}



