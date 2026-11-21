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
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpRoot } from './mcpRoot';
import { RunConfiguration } from './runConfiguration';
import { CatalogSetting } from '../catalogSetting';
import { ImportIndex } from '../importIndex';
import { SchematronContext } from '../schematronContext';
import { SchematronValidation } from '../schematronValidation';
import { SchExpandText } from '../schExpandText';
import { XSpecRunner } from '../xspecRunner';
import { XSpecTaskSettings, XSpecTaskSettingsFinder } from '../xspecTaskSettings';
import { XSpecTestNode, XSpecTests } from '../xspecTests';

export interface ConfigurationResult {
	text: string;
	isError: boolean;
}

// What the test_configuration and validation_configuration tools share. Like run_configuration, they run nothing: they give an
// assistant the commands that run XSpec tests or a Schematron validation as the extension runs them - so that it gets the same
// result as the Test Explorer or Schematron: Validate, with the same Saxon, options and files - and how to read the result.
// The files the commands write are in a folder of their own in the temporary files, one for each XSpec or XML file, not in the
// project
class AssistantRuns {
	public static resolve(file: string): string {
		const folder = McpRoot.current();
		return path.isAbsolute(file) || !folder ? path.resolve(file) : path.resolve(folder, file);
	}

	public static shown(file: string): string {
		const folder = McpRoot.current();
		return folder && file.startsWith(folder + path.sep) ? path.relative(folder, file) : file;
	}

	public static error(text: string): ConfigurationResult {
		return { text, isError: true };
	}

	// an argument as a shell takes it: as it is, unless it has a character a shell uses - then in double quotes, which keep the
	// single quotes of an XPath string literal as they are - or if it has a character a shell uses even in them, in single
	// quotes (Windows has the double quotes only)
	public static quote(arg: string): string {
		if (/^[\w@%+=:,./\\-]+$/.test(arg)) {
			return arg;
		}
		if (process.platform === 'win32') {
			return `"${arg.replace(/"/g, '\\"')}"`;
		}
		return /["$`\\!]/.test(arg) ? `'${arg.replace(/'/g, '\'\\\'\'')}'` : `"${arg}"`;
	}

	public static command(javaArgs: string[]): string {
		return 'java ' + javaArgs.map((arg) => AssistantRuns.quote(arg)).join(' ');
	}

	// the folder for the files the commands write: the same one for the same file, so the temporary files don't collect
	public static outputFolder(kind: 'xspec' | 'schematron', file: string): string {
		const hash = crypto.createHash('sha1').update(file).digest('hex').substring(0, 8);
		return path.join(os.tmpdir(), 'xslt-xpath', kind, `${path.basename(file, path.extname(file))}-${hash}`);
	}

	// Saxon: the jar - with its edition and version, as Saxon reports them
	public static async saxon(saxonJar: string): Promise<string> {
		const report = await RunConfiguration.saxonReport(saxonJar);
		return `Saxon: ${saxonJar}${report.product ? ' - ' + report.product : ''}`;
	}

	// the command that summarises a result as text, with one of the extension's stylesheets
	public static summaryCommand(saxonJar: string, result: string, stylesheet: string): string {
		const extension = XSpecRunner.extensionUri?.fsPath ?? '';
		return AssistantRuns.command(['-cp', saxonJar, 'net.sf.saxon.Transform', '-s:' + result, '-xsl:' + path.join(extension, 'xslt-resources', 'assistant', stylesheet)]);
	}
}

// The test_configuration tool: how XSpec tests are run. XSpec has no single command here: the tests are compiled to a stylesheet,
// the test runner, which is then run - two Saxon steps, with a few more for a Schematron's tests - each with options that the
// extension works out: the syntax extensions, the catalog, the packages and the Saxon settings of the stylesheet's task. They
// are given as the Test Explorer runs them
export class TestConfiguration {
	public static async describe(xspecArgument: string): Promise<ConfigurationResult> {
		const xspecPath = AssistantRuns.resolve(xspecArgument);
		if (!/\.xspec$/i.test(xspecPath)) {
			return AssistantRuns.error(`Not an XSpec file: ${xspecPath}`);
		}
		if (!fs.existsSync(xspecPath)) {
			return AssistantRuns.error(`File not found: ${xspecPath}`);
		}
		const uri = vscode.Uri.file(xspecPath);
		const problem = XSpecRunner.problem(uri);
		if (problem) {
			return AssistantRuns.error(problem);
		}
		// the packages are those the index finds
		if (ImportIndex.isEnabled()) {
			await ImportIndex.instance.whenBuilt();
		}
		const files = XSpecRunner.files(xspecPath, '', AssistantRuns.outputFolder('xspec', xspecPath));
		const prepared = XSpecRunner.prepareSteps(xspecPath, files);
		if (prepared.problem) {
			return AssistantRuns.error(prepared.problem);
		}
		const saxonJar = XSpecRunner.saxonJar(uri)!;
		const stylesheet = XSpecRunner.stylesheetOf(xspecPath);
		const schematron = XSpecRunner.schematron(xspecPath);
		// the settings of the stylesheet's task - the first, when its tasks differ: the Test Explorer asks which
		const candidates = stylesheet ? XSpecTaskSettingsFinder.candidates(stylesheet) : [];
		const taskSettings: XSpecTaskSettings | undefined = candidates[0];
		const differ = candidates.length > 1 && !XSpecTaskSettingsFinder.allTheSame(candidates);
		// not from a test runner an earlier run left: the XSpec file may have changed since
		const libraryPaths = XSpecRunner.libraryPaths(xspecPath, files, taskSettings, false);
		const steps = [
			...prepared.steps.map((step) => ({ title: step.title, command: AssistantRuns.command(XSpecRunner.javaArgs(uri, step.saxonArgs)) })),
			{ title: 'Compile the tests to a test runner, a stylesheet', command: AssistantRuns.command(XSpecRunner.javaArgs(uri, XSpecRunner.compileArgs(xspecPath, files, undefined, prepared.source, false))) },
			{ title: 'Run the tests', command: AssistantRuns.command(XSpecRunner.javaArgs(uri, XSpecRunner.runArgs(xspecPath, files, libraryPaths), taskSettings)) }
		];
		const lines: string[] = [];
		lines.push(`XSpec tests: ${AssistantRuns.shown(xspecPath)}`);
		lines.push(schematron ? `They test the Schematron schema ${AssistantRuns.shown(schematron)}, compiled to XSLT by SchXslt2` :
			stylesheet ? `They test the stylesheet ${AssistantRuns.shown(stylesheet)}` : 'They name no stylesheet or Schematron to test (x:description\'s stylesheet attribute)');
		lines.push(await AssistantRuns.saxon(saxonJar));
		lines.push('', 'Options, as the Test Explorer works them out:');
		const extensions = XSpecRunner.syntaxExtensionsValue(uri);
		lines.push(`  Saxon's syntax extensions (--allowSyntaxExtensions:on): ${extensions} - the XSLT.xspec.allowSyntaxExtensions setting: 'auto' turns them on only for XSLT 4.0, item types or notes, and never with Saxon-HE`);
		const catalog = CatalogSetting.catalogPath();
		lines.push(`  XML catalog: ${catalog ? catalog + ' (-catalog)' : 'none'}`);
		lines.push(`  Packages (-lib): ${libraryPaths.length > 0 ? libraryPaths.map((p) => AssistantRuns.shown(p)).join(', ') : taskSettings?.configFilename ? 'none - the Saxon configuration file of the task declares them' : 'none used'}`);
		lines.push(`  Saxon settings of the stylesheet's task: ${taskSettings ? `'${taskSettings.label}' - ${XSpecTaskSettingsFinder.describe(taskSettings)}` : 'none - it has no task in tasks.json'}`);
		if (differ) {
			lines.push(`  The stylesheet has ${candidates.length} tasks with different Saxon settings (${candidates.map((c) => `'${c.label}'`).join(', ')}): the Test Explorer asks which one; these are those of the first`);
		}
		if (vscode.workspace.getConfiguration('XSLT.xspec', uri).get<boolean>('legacyCompatibility', false)) {
			lines.push('  Legacy compatibility (tests written for XSpec before 1.0): on - the XSLT.xspec.legacyCompatibility setting');
		}
		lines.push('', `These commands run nothing here. Run them in order, from any folder - they write only to ${path.dirname(files.compiled)}, a folder for this XSpec file in the temporary files, not in the project:`);
		steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step.title}:`, `     ${step.command}`));
		lines.push('', `In one line: ${steps.map((step) => step.command).join(' && ')}`);
		lines.push('', 'Then read the result. The run exits with 0 whether or not tests failed - don\'t use the exit code. This prints the numbers passed, failed and pending, and each failure with what was expected and what the test gave:',
			`  ${AssistantRuns.summaryCommand(saxonJar, files.result, 'xspec-summary.xsl')}`);
		lines.push(`The full result is the XML file ${files.result}.`);
		if (XSpecRunner.canMeasureTime(uri)) {
			lines.push('To time each scenario (Saxon-PE and EE), add ?measure-time=true() to the compile step; the times are in the result file.');
		}
		const scenarios = TestConfiguration.scenarioLines(fs.readFileSync(xspecPath, 'utf8'));
		if (scenarios.length > 0) {
			lines.push('', 'Its scenarios:', ...scenarios);
		}
		lines.push('', 'The tests run on the saved files, not on changes in an editor that aren\'t saved. The Test Explorer in VS Code isn\'t updated by these runs.');
		return { text: lines.join('\n'), isError: false };
	}

	// the scenarios, nested, each with the number of its expectations - the first lines
	private static scenarioLines(text: string): string[] {
		const lines: string[] = [];
		const add = (nodes: XSpecTestNode[], depth: number) => {
			for (const node of nodes) {
				if (node.kind !== 'scenario') {
					continue;
				}
				const expectations = node.children.filter((child) => child.kind !== 'scenario').length;
				lines.push(`${'  '.repeat(depth + 1)}${node.label || '(no label)'}${node.pending ? ' - pending' : ''}${expectations > 0 ? ` (${expectations} expectation${expectations === 1 ? '' : 's'})` : ''}`);
				add(node.children, depth + 1);
			}
		};
		add(XSpecTests.testTree(text), 0);
		return lines.length > 60 ? [...lines.slice(0, 60), `  ... ${lines.length - 60} more`] : lines;
	}
}

// The validation_configuration tool: how a Schematron schema validates an XML file - one run of Saxon, with the schema compiled
// by SchXslt2 and run on the file - given as Schematron: Validate runs it: with its phase, the syntax extensions and the catalog,
// and where the SVRL report goes
export class ValidationConfiguration {
	// file: a schema, or an XML file - pairedWith: the other, if it isn't the one the extension knows: for a schema, the XML file to
	// validate - else its XML context file; for an XML file, the schema - else the one its xml-model names, or it was last
	// validated with. phase: a phase's id, else the one chosen for the pair, or the schema's default
	public static async describe(file: string, pairedWith?: string, phase?: string): Promise<ConfigurationResult> {
		const given = AssistantRuns.resolve(file);
		if (!fs.existsSync(given)) {
			return AssistantRuns.error(`File not found: ${given}`);
		}
		const isSchema = /\.(sch|schematron)$/i.test(given);
		let schema: string | undefined;
		let xml: string | undefined;
		let paired: string;
		if (isSchema) {
			schema = given;
			if (pairedWith) {
				xml = AssistantRuns.resolve(pairedWith);
				paired = 'the XML file you gave';
			} else {
				const context = SchematronContext.contextFor(schema);
				xml = context?.file;
				paired = context ? `the schema's XML context file${context.chosen ? ', which was chosen for it' : ''}` : '';
			}
			if (!xml) {
				return AssistantRuns.error(`The schema ${AssistantRuns.shown(schema)} has no XML context file to validate yet - give the XML file to validate as pairedWith`);
			}
		} else {
			xml = given;
			if (pairedWith) {
				schema = AssistantRuns.resolve(pairedWith);
				paired = 'the schema you gave';
			} else {
				schema = SchematronValidation.schemaFor(xml, fs.readFileSync(xml, 'utf8'));
				paired = 'the schema its xml-model processing instruction names, or it was last validated with';
			}
			if (!schema) {
				return AssistantRuns.error(`No schema is known for ${AssistantRuns.shown(xml)}: it has no xml-model processing instruction for one, and wasn't validated with one before - give the schema as pairedWith`);
			}
		}
		for (const [what, found] of [['The schema', schema], ['The XML file', xml]]) {
			if (!fs.existsSync(found)) {
				return AssistantRuns.error(`${what} doesn't exist: ${found}`);
			}
		}
		const uri = vscode.Uri.file(xml);
		const saxonJar = XSpecRunner.saxonJar(uri);
		if (!saxonJar) {
			return AssistantRuns.error('Schematron: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.');
		}
		if (!fs.existsSync(saxonJar)) {
			return AssistantRuns.error(`Schematron: the Saxon jar '${saxonJar}' doesn't exist - check the "XSLT.tasks.saxonJar" setting.`);
		}
		const schemaText = fs.readFileSync(schema, 'utf8');
		if (/<(?:[\w.-]+:)?schema\b[^>]*?\squeryBinding\s*=\s*["']\s*xquery/i.test(schemaText)) {
			return AssistantRuns.error('A Schematron schema with an XQuery query binding isn\'t supported - only XSLT');
		}
		const { phases, defaultPhase } = SchematronValidation.phasesOf(schemaText);
		if (phase && phase !== '#ALL' && phase !== '#DEFAULT' && !phases.some((p) => p.id === phase)) {
			return AssistantRuns.error(`The schema has no phase '${phase}'${phases.length > 0 ? ` - its phases are ${phases.map((p) => p.id).join(', ')}` : ' - it has no phases'}`);
		}
		const used = phase ?? SchematronValidation.validPhase(xml, schema, schemaText);
		if (ImportIndex.isEnabled()) {
			await ImportIndex.instance.whenBuilt();
		}
		const svrl = path.join(AssistantRuns.outputFolder('schematron', xml), 'report.svrl');
		const args = SchematronValidation.validationArgs(uri, schema, schemaText, used, svrl);
		const lines: string[] = [];
		lines.push(`Schematron validation of ${AssistantRuns.shown(xml)} with ${AssistantRuns.shown(schema)}`);
		lines.push(`  Paired: ${paired}`);
		lines.push(await AssistantRuns.saxon(saxonJar));
		lines.push(`  Phase: ${SchematronValidation.phaseName(used, schemaText)}${phases.length > 0 ? ` - the schema's phases are ${phases.map((p) => p.id + (p.id === defaultPhase ? ' (the default)' : '')).join(', ')}; choose one with the phase argument` : ' - the schema has no phases'}`);
		lines.push(`  Saxon's syntax extensions (--allowSyntaxExtensions:on): ${args.includes('--allowSyntaxExtensions:on') ? 'on - the schema needs them' : 'off'}`);
		const catalog = CatalogSetting.catalogPath();
		lines.push(`  XML catalog: ${catalog ? catalog + ' (-catalog)' : 'none'}`);
		if (SchExpandText.allowed()) {
			lines.push('  Text value templates in messages, with xsl:expand-text, are allowed - the XSLT.schematron.allowExpandText setting');
		}
		lines.push('', `This command runs nothing here. Run it from any folder - it writes the SVRL report to ${svrl}, in the temporary files, not in the project:`,
			`  ${AssistantRuns.command(args)}`);
		lines.push('', 'Then read the report. The run exits with 0 whether or not assertions failed - don\'t use the exit code. This prints the numbers of failed assertions and successful reports, then each with its role, location and message:',
			`  ${AssistantRuns.summaryCommand(saxonJar, svrl, 'svrl-summary.xsl')}`);
		lines.push('A location is an XPath for the XML file, with names written Q{}name: give it to the evaluate_xpath tool, with the XML file, for its line and column.');
		lines.push('', 'The validation uses the saved files, not changes in an editor that aren\'t saved.');
		return { text: lines.join('\n'), isError: false };
	}
}
