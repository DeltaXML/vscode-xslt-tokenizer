/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { SchematronContext } from './schematronContext';
import { SchematronValidation } from './schematronValidation';
import { XSpecRunner } from './xspecRunner';

// Schematron: debugging a schema - with a Schematron file in the editor, the editor title's Debug button - on its XML
// context file (see SchematronContext), with the phase chosen for it: the schema is compiled by SchXslt2 to a stylesheet
// (see SchematronValidation.compileForDebug), which the XSLT debugger runs, and its lines are shown as the schema's (see
// SchematronSourceMap). When the session ends, its SVRL report is shown as a validation's
export class SchematronDebug {
	public static readonly command = 'xslt-xpath.debugSchematron';
	public static readonly debugType = 'xslt-saxon';

	public static activate(context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.commands.registerCommand(SchematronDebug.command, (uri?: vscode.Uri) => SchematronDebug.debug(uri)),
			vscode.debug.onDidTerminateDebugSession((session) => SchematronDebug.ended(session)));
	}

	// the debug configuration for the schema and XML file, with its compiled stylesheet - undefined, with why, if it can't
	// be compiled
	public static async configuration(schema: string, xml: string): Promise<vscode.DebugConfiguration | string> {
		const schemaText = fs.readFileSync(schema, 'utf8');
		const phase = SchematronValidation.validPhase(xml, schema, schemaText);
		// the stylesheet and report, in a folder for the schema
		// by its real path - e.g. on macOS, /private/var/folders/…, not /var/folders/… - as the debugger gives it
		const folder = path.join(fs.realpathSync(os.tmpdir()), 'xslt-schematron-debug', crypto.createHash('sha1').update(schema).digest('hex').substring(0, 12));
		fs.mkdirSync(folder, { recursive: true });
		const compiled = path.join(folder, path.basename(schema, path.extname(schema)) + '-debug.xsl');
		const report = path.join(folder, 'report.svrl');
		fs.rmSync(report, { force: true });
		const problem = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Schematron: compiling ${path.basename(schema)} for debugging` },
			() => SchematronValidation.compileForDebug(schema, phase, compiled));
		if (problem) {
			return `Schematron: Debug - ${problem}`;
		}
		// the last validation's results above the rules aren't this run's
		SchematronValidation.clearCoverage(schema);
		const phaseName = SchematronValidation.phaseName(phase, schemaText);
		return {
			type: SchematronDebug.debugType, request: 'launch', name: `Debug ${path.basename(schema)}${phaseName ? ` (phase ${phaseName})` : ''}`,
			xsltFile: compiled, xmlSource: xml, resultPath: report, schematronFile: schema, schematronPhase: phase,
			// a step in the compiled stylesheet stops only at its lines for the schema's steps (see SchematronSourceMap) - one
			// into a function of the schema's XSLT modules stops as usual
			stepSkip: [compiled],
			allowSyntaxExtensions40: XSpecRunner.schematronSyntaxExtensions(vscode.Uri.file(schema), schema, schemaText) ? 'on' : 'off'
		};
	}

	// the command: the schema of the Schematron file - or the one that includes it - debugged on its XML context file
	public static async debug(uri?: vscode.Uri): Promise<boolean> {
		const schema = SchematronContext.schemaOf(uri ?? vscode.window.activeTextEditor?.document.uri);
		if (!schema) {
			vscode.window.showInformationMessage('Schematron: Debug - open a Schematron file first.');
			return false;
		}
		const xml = SchematronContext.contextFor(schema)?.file ?? await SchematronContext.pick(schema);
		if (!xml) {
			return false;
		}
		for (const document of vscode.workspace.textDocuments.filter((d) => d.isDirty && (d.languageId === 'sch' || d.fileName === xml))) {
			await document.save();
		}
		const configuration = await SchematronDebug.configuration(schema, xml);
		if (typeof configuration === 'string') {
			vscode.window.showErrorMessage(configuration);
			return false;
		}
		const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(schema)) ?? vscode.workspace.workspaceFolders?.[0];
		return vscode.debug.startDebugging(folder, configuration);
	}

	// a Schematron session's report: shown as a validation's - its problems, and how the rules were used
	private static async ended(session: vscode.DebugSession) {
		const { schematronFile, xmlSource, resultPath, schematronPhase } = session.configuration;
		if (typeof schematronFile !== 'string' || typeof xmlSource !== 'string' || typeof resultPath !== 'string' || !fs.existsSync(resultPath)) {
			return;
		}
		const report = fs.readFileSync(resultPath, 'utf8');
		if (report.includes('schematron-output')) {
			await SchematronValidation.show(vscode.Uri.file(xmlSource), schematronFile, report, typeof schematronPhase === 'string' ? schematronPhase : '#DEFAULT');
		}
	}
}
