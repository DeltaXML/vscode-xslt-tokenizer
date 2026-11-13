// tslint:disable
import { XslLexerLight } from "./xslLexerLight";
import * as vscode from 'vscode';
import {XSLTLightConfiguration, XSpecConfiguration, SchConfiguration} from './languageConfigurations';
import { GlobalInstructionData, GlobalInstructionType, XslLexer } from "./xslLexer";
import * as fs from 'fs';

export interface GlobalImportData {
	data: GlobalInstructionData[];
	error: boolean;
}

export class GlobalsProvider {

	public static async provideGlobals(href: string): Promise<GlobalImportData> {
		let lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
		let data: GlobalInstructionData[] = [];

		if (href.length === 0) {
			return {data: data, error: true}; 
		}

		try {
			// TODO: USE VSCODE API (but it needs a URI not a filepath) e.g. 
			//const t = vscode.workspace.fs.readFile
			const text = fs.readFileSync(href).toString('utf-8');
			if (href.endsWith('.xspec')) {
				// an XSpec file that another imports: its global variables and parameters, and the stylesheets and XSpec
				// files it uses
				const xspecLexer = new XslLexer(XSpecConfiguration.configuration);
				xspecLexer.analyse(text);
				data = xspecLexer.globalInstructionData.filter((global) => [GlobalInstructionType.Variable, GlobalInstructionType.Parameter,
					GlobalInstructionType.Import, GlobalInstructionType.Include].includes(global.type));
			} else if (href.endsWith('.sch')) {
				// a Schematron schema that includes the file being checked: the XSLT it declares - its functions, keys and
				// accumulators - and the modules of its xsl:include and xsl:import (see XsltSymbolProvider.processTopLevelImports)
				const schLexer = new XslLexer(SchConfiguration.configuration);
				schLexer.analyse(text);
				data = schLexer.globalInstructionData.filter((global) => [GlobalInstructionType.Function, GlobalInstructionType.Key, GlobalInstructionType.Accumulator,
					GlobalInstructionType.Import, GlobalInstructionType.Include, GlobalInstructionType.UsePackage].includes(global.type));
			} else {
				data = lexer.analyseLight(text);
			}
			return {data: data, error: false};
		} catch (e) {
			return {data: data, error: true};
		}
	}

	public static fileExists(file: string): Promise<boolean> {
		return new Promise<boolean>((resolve, _reject) => {
			fs.exists(file, (exists) => {
				if (exists) {
					fs.stat(file, (err, stats) => {
						resolve(stats.isFile());
					});
				} else {
					resolve(exists);
				}
			});
		});
	}
}