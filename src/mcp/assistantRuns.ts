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
import { SaxonTaskProvider } from '../saxonTaskProvider';

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
	public static outputFolder(kind: 'xspec' | 'schematron' | 'profile' | 'trace', file: string): string {
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
		const summary = AssistantRuns.summaryCommand(saxonJar, files.result, 'xspec-summary.xsl');
		lines.push('', 'Then read the result. The run exits with 0 whether or not tests failed - don\'t use the exit code. This prints the numbers passed, failed and pending, and each failure with what was expected and what the test gave:',
			`  ${summary}`);
		// all of it as one command - a step that fails, e.g. the tests not compiling, stops it with Saxon's error
		lines.push('', 'Or all of it - the steps, then the summary - as one command:', `In one line: ${[...steps.map((step) => step.command), summary].join(' && ')}`);
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

// The profile_configuration tool: how a stylesheet is profiled - its Quick Run, with Saxon's timing profile (-TP) written as XML
// to the temporary files, and the command that summarises that profile as text, ranked by net time. The extension's Profile
// Stylesheet command runs the same task the same way (its profile-xml.xsl as -TPxsl, -repeat:N from the XSLT.tasks.profileRuns
// setting); the summary gives the numbers of its Profile view. Saxon PE or EE only
export class ProfileConfiguration {
	// with the setting at its default of 1 a profile is mostly the Java VM's warm-up, so an assistant gets at least this many runs
	private static readonly minimumRuns = 5;

	public static async describe(stylesheet: string, top?: number, source?: string): Promise<ConfigurationResult> {
		if (ImportIndex.isEnabled()) {
			await ImportIndex.instance.whenBuilt();
		}
		const folder = McpRoot.current();
		const xsltPath = AssistantRuns.resolve(stylesheet);
		const saxonJar = XSpecRunner.saxonJar(vscode.Uri.file(xsltPath));
		if (!saxonJar) {
			return AssistantRuns.error('Profiling: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.');
		}
		if (!fs.existsSync(saxonJar)) {
			return AssistantRuns.error(`Profiling: the Saxon jar '${saxonJar}' doesn't exist - check the "XSLT.tasks.saxonJar" setting.`);
		}
		if (SaxonTaskProvider.isSaxonHE(saxonJar)) {
			return AssistantRuns.error(`Profiling uses Saxon's timing profile, a feature of Saxon PE and EE - the user's Saxon jar is Saxon-HE (${saxonJar}). It can't be profiled with it.`);
		}
		const folderForFiles = AssistantRuns.outputFolder('profile', xsltPath);
		// Saxon creates the folder of the result file but not that of the profile
		fs.mkdirSync(folderForFiles, { recursive: true });
		const profile = path.join(folderForFiles, 'profile.xml');
		const result = path.join(folderForFiles, 'result.out');
		const setting = Math.floor(vscode.workspace.getConfiguration('XSLT.tasks', vscode.Uri.file(xsltPath)).get<number>('profileRuns', 1)) || 1;
		const runs = Math.max(ProfileConfiguration.minimumRuns, Math.min(100, setting));
		const extension = XSpecRunner.extensionUri?.fsPath ?? '';
		const quickRun = await RunConfiguration.quickRun(xsltPath, folder, {
			TPfilename: profile, TPxslFilename: path.join(extension, 'xslt-resources', 'profile', 'profile-xml.xsl'),
			profileRepeat: runs, resultPath: result,
			...(source ? { xmlSource: AssistantRuns.resolve(source) } : {})
		});
		if (!quickRun.command) {
			return AssistantRuns.error(quickRun.lines.join('\n'));
		}
		const { classPath, mainClass, args, missing } = quickRun.command;
		const lines: string[] = [];
		lines.push(`Profile of ${AssistantRuns.shown(quickRun.xsltFsPath)}`);
		lines.push(await AssistantRuns.saxon(saxonJar));
		// the Quick Run's own description - without its command, which is given below with the profile options
		lines.push(...quickRun.lines.slice(1).filter((line) => !/^ {2}(Classpath|Command|The result file is chosen):/.test(line) && !/^ {2}The result file is chosen/.test(line)));
		lines.push('', `This command runs the stylesheet as Quick Run does, with Saxon's timing profile, ${runs} times${runs > setting ? ` (the XSLT.tasks.profileRuns setting is ${setting}: a profile of one run is mostly the Java VM's start-up)` : ' (the XSLT.tasks.profileRuns setting)'}. ` +
			`It runs nothing here: run it yourself, with the user's permission, from any folder. It writes the profile and the stylesheet's result to ${folderForFiles}, in the temporary files, not in the project:`);
		lines.push(`  ${AssistantRuns.command(['-cp', classPath.join(path.delimiter), mainClass, ...args])}`);
		if (missing.length > 0) {
			lines.push(`  Add a value for ${missing.join(', ')} to the command as name=value - Quick Run asks for ${missing.length === 1 ? 'it' : 'them'}`);
		}
		const base = path.dirname(quickRun.xsltFsPath).replace(/\\/g, '/') + '/';
		const summary = AssistantRuns.command(['-cp', saxonJar, 'net.sf.saxon.Transform', '-it:main',
			'-xsl:' + path.join(extension, 'xslt-resources', 'assistant', 'profile-summary.xsl'), 'profile=' + profile, 'base=' + base, `top=${top ?? 15}`]);
		lines.push('', 'Then read the profile as text. The first run, the Java VM\'s warm-up, is left out and the times are the average of the others. Each line is a template, function or global variable, ranked by net time - the time in it, not in what it calls (gross includes those) - with its share of the net times, its calls, and where it is declared (the line is where its start tag ends). Add top=0 for all of them:',
			`  ${summary}`);
		lines.push(`The full profile is the XML file ${profile}.`);
		lines.push('', 'Saxon times templates, functions and globals, not lines inside them, and tracing switches off some optimisations: the times are relative, not those of an untraced run. ' +
			'The profile uses the saved files, not changes in an editor that aren\'t saved. To compare a change, profile again and read the summary again.');
		return { text: lines.join('\n'), isError: false };
	}
}

// The trace_configuration tool: how a stylesheet is run with logpoints, and no VS Code - its Quick Run, by the debugger's
// TraceRun (in the extension's debugger jar), which prints each logpoint's message as the Debug Console would: by default
// the local variables, in the debugger's notation. Nothing pauses. For an assistant to see values inside templates and
// functions - which evaluate_xpath, with no stylesheet around it, can't
export class TraceConfiguration {
	public static async describe(stylesheet: string, source?: string): Promise<ConfigurationResult> {
		if (ImportIndex.isEnabled()) {
			await ImportIndex.instance.whenBuilt();
		}
		const folder = McpRoot.current();
		const xsltPath = AssistantRuns.resolve(stylesheet);
		const saxonJar = XSpecRunner.saxonJar(vscode.Uri.file(xsltPath));
		if (!saxonJar) {
			return AssistantRuns.error('Tracing: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.');
		}
		if (!fs.existsSync(saxonJar)) {
			return AssistantRuns.error(`Tracing: the Saxon jar '${saxonJar}' doesn't exist - check the "XSLT.tasks.saxonJar" setting.`);
		}
		const extension = XSpecRunner.extensionUri?.fsPath ?? '';
		const adapterJar = path.join(extension, 'xslt-resources', 'xslt-debugger', 'xslt-debugger.jar');
		const result = path.join(AssistantRuns.outputFolder('trace', xsltPath), 'result.out');
		const quickRun = await RunConfiguration.quickRun(xsltPath, folder, { resultPath: result, ...(source ? { xmlSource: AssistantRuns.resolve(source) } : {}) });
		if (!quickRun.command) {
			return AssistantRuns.error(quickRun.lines.join('\n'));
		}
		const { classPath, args, missing } = quickRun.command;
		const shownXslt = AssistantRuns.shown(quickRun.xsltFsPath);
		const lines: string[] = [];
		lines.push(`Trace of ${shownXslt}`);
		lines.push(await AssistantRuns.saxon(saxonJar));
		lines.push(...quickRun.lines.slice(1).filter((line) => !/^ {2}(Classpath|Command):/.test(line) && !/^ {2}The result file is chosen/.test(line)));
		const java = ['-cp', [adapterJar, ...classPath].join(path.delimiter), 'com.deltaxml.xslt.debug.TraceRun'];
		lines.push('', 'This command runs the stylesheet as Quick Run does, with logpoints: at each one, as the stylesheet runs, it prints the ' +
			'message with where it is - nothing pauses. It runs nothing here: put your logpoints in place of LOGPOINTS and run it yourself, with ' +
			`the user's permission, from any folder. The result goes to ${path.dirname(result)}, in the temporary files, not the project:`);
		lines.push(`  ${AssistantRuns.command(java)} LOGPOINTS -- ${args.map((arg) => AssistantRuns.quote(arg)).join(' ')}`);
		if (missing.length > 0) {
			lines.push(`  Add a value for ${missing.join(', ')} after -- as name=value - Quick Run asks for ${missing.length === 1 ? 'it' : 'them'}`);
		}
		lines.push('', 'LOGPOINTS, any number of (or none, with --rules):',
			'  --log FILE:LINE            the local variables there - parameters and variables in scope - as {$*} gives them',
			'  --log \'FILE:LINE=MESSAGE\'  the message: text with {expression} parts, e.g. \'order {@id}: {$total}\' - XPath evaluated there, with the context item',
			'  --when \'FILE:LINE=CONDITION\' only when the XPath condition is true there, e.g. \'$total gt 100\'',
			'  --max-hits N               the messages shown for each logpoint - 20 by default; the rest are counted',
			'  --rules                    at the end, for each input file: the rules that processed its elements, and the elements only built-in',
			'                             rules did - no template matched them - as input_rules gives them from the user\'s run. On its own, with no',
			'                             logpoints, when there\'s no run of the user\'s to ask for: output missing, or stray text in it',
			`FILE is a stylesheet module - absolute, or relative to the folder the command runs in - e.g. ${quickRun.xsltFsPath}. LINE is an instruction's line: ` +
			'a logpoint on a line with no instruction moves to the one that starts there, or is reported as not set. find_declaration and list_declarations give the lines of templates and functions.');
		lines.push('', 'Each message is printed as FILE:LINE #N: then the values, in the debugger\'s notation (strings in single quotes, nodes with their paths), ' +
			'with xsl:message output and Saxon\'s errors where they happen. At the end: each logpoint\'s number of hits, or that it was never reached - ' +
			'a template that never ran, or a condition never true - and whether the run failed.');
		lines.push('', 'A traced run is slower than a normal one (no optimisation, and every instruction is traced). Use --when and --max-hits for a ' +
			'template that runs many times. It uses the saved files, not changes in an editor that aren\'t saved.');
		return { text: lines.join('\n'), isError: false };
	}
}
