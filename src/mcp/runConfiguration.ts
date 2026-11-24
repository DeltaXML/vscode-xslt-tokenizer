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
import * as childProcess from 'child_process';
import * as jsc from 'jsonc-parser';
import { SaxonTaskProvider, XSLTTask } from '../saxonTaskProvider';
import { CatalogSetting } from '../catalogSetting';
import { XsltPackages } from '../xsltPackages';
import { ImportIndex } from '../importIndex';
import { PackageScope } from '../packageScope';
import { McpRoot } from './mcpRoot';
import { XSpecRunner } from '../xspecRunner';
import { DocumentChangeHandler } from '../documentChangeHandler';
import { unquotedPath } from '../settingPaths';
import { TaskConfiguration } from './taskConfiguration';

// The run_configuration tool: how the user runs stylesheets - so that an assistant running one itself, e.g. in a
// terminal, uses the same Saxon, options and input. The workspace's: the Saxon jar - with its edition, version and
// licence, as Saxon reports them when it runs (see saxonReport) - the catalog, the XSpec installation and the packages. For a
// stylesheet, also its Quick Run task - the one in tasks.json, else the one Quick Run would create - with its XML
// context file and parameters, and the command line, made as the task's is (SaxonTaskProvider.commandLine)
export class RunConfiguration {

	// the workspace's settings - and, for a stylesheet given, what Quick Run would run
	// tasks: with the XSLT tasks in tasks.json - the stylesheet's, or all - their problems, and the properties a task has
	public static async describe(stylesheet: string | undefined, withTasks = false): Promise<string> {
		// the packages in the workspace are those the index finds: wait for it, as the other tools do - else none are known
		// until something else has built it, and the command for a stylesheet that uses one has no -lib
		if (ImportIndex.isEnabled()) {
			await ImportIndex.instance.whenBuilt();
		}
		const lines: string[] = [];
		const folder = McpRoot.current();
		const shown = (file: string) => folder && file.startsWith(folder + path.sep) ? path.relative(folder, file) : file;
		lines.push(`Workspace: ${folder ?? '(no folder open)'}`);
		const otherFolders = McpRoot.folders().slice(1);
		if (otherFolders.length > 0) {
			lines.push(`Other workspace folders (relative paths start in the first): ${otherFolders.join(', ')}`);
		}
		// Saxon
		const saxonJar = XSpecRunner.saxonJar();
		if (!saxonJar) {
			lines.push('Saxon jar: not set - the XSLT.tasks.saxonJar setting is empty, so stylesheets and XSpec tests can\'t be run with SaxonJ');
		} else if (!fs.existsSync(saxonJar)) {
			lines.push(`Saxon jar: ${saxonJar} (NOT FOUND)`);
		} else {
			// as Saxon reports itself - its edition, version and licence - else from the jar's name
			const report = await RunConfiguration.saxonReport(saxonJar);
			if (report.product) {
				lines.push(`Saxon jar: ${saxonJar} - ${report.product}`);
				lines.push(`Saxon licence: ${report.licence ?? (/-HE\b/.test(report.product) ? 'none needed (Saxon-HE)' : 'not reported')}`);
			} else {
				const edition = RunConfiguration.saxonEdition(saxonJar);
				const version = RunConfiguration.saxonVersion(saxonJar);
				lines.push(`Saxon jar: ${saxonJar}${edition ? ` - Saxon-${edition}${version ? ' ' + version : ''}, from its name` : ''}`);
				lines.push(`Saxon licence: unknown - Saxon couldn't be run to report it: ${report.error}`);
			}
		}
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const htmlParser = unquotedPath(tasks.get<string>('htmlParserJar'))?.trim();
		if (htmlParser) {
			lines.push(`HTML parser jar (on the classpath for XSLT 4.0's parse-html()): ${htmlParser}`);
		}
		lines.push(`Quick Run processor: ${SaxonTaskProvider.quickRunProcessorNames[tasks.get<'xslt' | 'xslt-js' | 'xslt-c'>('quickRunProcessor', 'xslt')] ?? 'SaxonJ'}`);
		lines.push('Java: \'java\', as found on the PATH - the command VS Code\'s tasks run');
		const catalog = CatalogSetting.catalogPath();
		lines.push(`XML catalog: ${catalog ? `${catalog} - passed to Saxon with -catalog` : 'none (the XSLT.resources.catalog setting is empty)'}`);
		const xspecHome = XSpecRunner.home();
		lines.push(`XSpec: ${xspecHome ?? 'not found'}${xspecHome && XSpecRunner.extensionUri && xspecHome.startsWith(XSpecRunner.extensionUri.fsPath) ? ' (bundled with the extension)' : ''}`);
		const packages = XsltPackages.all();
		lines.push(packages.length === 0 ? 'XSLT packages: none known' :
			`XSLT packages (passed with -lib to stylesheets that use them):\n${packages.map((p) => `  ${p.name}${p.version ? ' ' + p.version : ''} -> ${shown(p.path)}`).join('\n')}`);
		if (stylesheet !== undefined) {
			lines.push('', ...await RunConfiguration.forStylesheet(stylesheet, folder));
		}
		if (withTasks) {
			const xsltFsPath = stylesheet === undefined ? undefined : path.isAbsolute(stylesheet) || !folder ? path.resolve(stylesheet) : path.resolve(folder, stylesheet);
			lines.push('', ...TaskConfiguration.describe(vscode.extensions.getExtension('deltaxml.xslt-xpath')?.packageJSON, folder, xsltFsPath));
		}
		return lines.join('\n');
	}

	// Saxon's own report, by jar: kept until the jar changes - for a while, as a licence may be renewed or expire
	private static readonly reports = new Map<string, { modified: number, at: number, report: { product?: string, licence?: string, error?: string } }>();
	private static readonly reportLifetime = 10 * 60 * 1000;
	// for testing: how Saxon is run - its standard output and error, or why it couldn't be
	public static runSaxon = (jar: string, xsltFile: string) => new Promise<{ output: string, error?: string }>((resolve) => {
		childProcess.execFile('java', ['-cp', jar, 'net.sf.saxon.Transform', '-t', '-it', `-xsl:${xsltFile}`], { timeout: 20000, windowsHide: true }, (error, stdout, stderr) => {
			// Saxon's messages are on the error stream - the result, an XML declaration with no newline, on the output stream
			resolve({ output: `${stderr}\n${stdout}`, error: error ? ((error as NodeJS.ErrnoException).code === 'ENOENT' ? '\'java\' wasn\'t found on the PATH' : error.message.split('\n')[0]) : undefined });
		});
	});

	// what Saxon reports, with -t, when it runs a stylesheet that does nothing: its edition and version - e.g. 'SaxonJ-PE
	// 13.1 from Saxonica' - and for PE or EE its licence, as it finds it: 'Using license serial number ...', or why it
	// runs without its licensed features, e.g. 'No license file found - running with licensable features disabled'
	public static async saxonReport(jar: string): Promise<{ product?: string, licence?: string, error?: string }> {
		const modified = fs.statSync(jar).mtimeMs;
		const cached = RunConfiguration.reports.get(jar);
		if (cached && cached.modified === modified && Date.now() - cached.at < RunConfiguration.reportLifetime) {
			return cached.report;
		}
		const xsltFile = path.join(os.tmpdir(), 'xslt-xpath-saxon-report.xsl');
		fs.writeFileSync(xsltFile, '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:template name="xsl:initial-template"/></xsl:stylesheet>');
		const { output, error } = await RunConfiguration.runSaxon(jar, xsltFile);
		const lines = output.split(/\r?\n/).map((line) => line.trim());
		const product = lines.map((line) => /Saxon\S*-(?:HE|PE|EE)\s+\d\S*/.exec(line)?.[0]).find((match) => match);
		const licence = lines.find((line) => /licen[cs]e/i.test(line));
		const report = product ? { product, licence } : { error: error ?? (lines.find((line) => line) || 'no output') };
		RunConfiguration.reports.set(jar, { modified, at: Date.now(), report });
		return report;
	}

	// Saxon's edition and version, from the jar's name - e.g. saxon-pe-13.1.jar, saxon9ee.jar, Saxon-HE-12.9.jar
	public static saxonEdition(jar: string): 'HE' | 'PE' | 'EE' | undefined {
		return /saxon[-_.]?(?:\d+)?(he|pe|ee)/i.exec(path.basename(jar))?.[1].toUpperCase() as 'HE' | 'PE' | 'EE' | undefined;
	}

	public static saxonVersion(jar: string): string | undefined {
		return /(?:he|pe|ee)[-_]?(\d+(?:[.-]\d+)*)/i.exec(path.basename(jar).replace(/\.jar$/i, ''))?.[1].replace(/-/g, '.');
	}

	// for an xsl:package run as the principal stylesheet: it has no entry points of its own beyond its public named templates and
	// modes, so say what could be started from - as its visibility works out, with xsl:expose and the packages it uses
	public static packageNotes(file: string, text: string): string[] {
		const declaration = ImportIndex.packageDeclaration(text);
		if (!declaration) {
			return [];
		}
		const { templates, modes } = PackageScope.entryPoints(file, declaration.name, declaration.version);
		const found = [...(templates.length ? [`public named templates ${templates.join(', ')} (-it:name)`] : []), ...(modes.length ? [`public modes ${modes.join(', ')} (-im:name)`] : [])];
		return [`  Note: this is an xsl:package - Saxon can run one as the principal stylesheet, but only through what it makes public${found.length ? `: ${found.join('; ')}` : ' - this one makes no named template or mode public'}. A package is normally used by another stylesheet through xsl:use-package`];
	}

	// the stylesheet's Quick Run: its task, its XML context file, its parameters, and the command line
	private static async forStylesheet(stylesheet: string, folder: string | undefined): Promise<string[]> {
		return (await RunConfiguration.quickRun(stylesheet, folder)).lines;
	}

	// the description of the stylesheet's Quick Run - and, when it can be run, its command: the task with extra properties
	// (e.g. for profiling) added, the classpath, Saxon's main class and its arguments, and the parameters that Quick Run asks for
	public static async quickRun(stylesheet: string, folder: string | undefined, extra?: Record<string, unknown>): Promise<{
		lines: string[], xsltFsPath: string,
		command?: { task: XSLTTask, classPath: string[], mainClass: string, args: string[], missing: string[] }
	}> {
		const xsltFsPath = path.isAbsolute(stylesheet) || !folder ? path.resolve(stylesheet) : path.resolve(folder, stylesheet);
		if (!/\.xslt?$/i.test(xsltFsPath)) {
			return { lines: [`Not an XSLT stylesheet: ${xsltFsPath}`], xsltFsPath };
		}
		if (!fs.existsSync(xsltFsPath)) {
			return { lines: [`Stylesheet not found: ${xsltFsPath}`], xsltFsPath };
		}
		const lines = [`For ${xsltFsPath}:`];
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(xsltFsPath));
		const context = await DocumentChangeHandler.contextFor(document);
		if (context.stylesheet && context.stylesheet !== xsltFsPath) {
			lines.push(`  It's a module of ${context.stylesheet}, the top-level stylesheet that Quick Run runs - ask for that one`);
		}
		const persisted = RunConfiguration.quickRunTask(xsltFsPath, folder);
		const contextFile = context.uri?.fsPath;
		const task = (persisted ?? SaxonTaskProvider.createQuickRunTaskDefinition('xslt', 'Quick Run', xsltFsPath, context.isNone ? undefined : contextFile ?? '')) as XSLTTask;
		lines.push(persisted ? `  Quick Run task: '${persisted.label}' in .vscode/tasks.json` : '  Quick Run task: none yet in .vscode/tasks.json - this is the one Quick Run would create');
		// a source given for this command (e.g. trace_configuration's source) - not the task's
		const givenSource = typeof extra?.xmlSource === 'string' ? extra.xmlSource : undefined;
		lines.push(`  XML source: ${givenSource ? `${givenSource} - the one given, for this command` : task.xmlSource ? RunConfiguration.resolved(task.xmlSource, folder) : task.initialTemplate !== undefined ? 'none - it starts from its initial template (-it)' : 'none chosen yet - Quick Run asks for one'}`);
		if (givenSource) {
			// the notes below are about the task's source
		} else if (!persisted && context.fromLastPicked && task.xmlSource) {
			lines.push('  Note: that XML file was only the last one picked in the editor, not chosen for this stylesheet - check it suits this stylesheet, or run it on another file');
		} else if (!persisted && context.fromLastPicked && task.initialTemplate === undefined) {
			lines.push('  Note: no XML file is known for this stylesheet - give Saxon one with -s:path');
		}
		lines.push(...RunConfiguration.packageNotes(xsltFsPath, document.getText()));
		const parameters = task.parameters ?? [];
		const unresolved = (value: string) => /\$\{(input|command):/.test(value);
		if (parameters.length > 0) {
			lines.push('  Parameters:', ...parameters.map((p) => `    ${p.name} = ${unresolved(p.value) ? '(asked for when the task runs)' : p.value}`));
		}
		// the command, as the task's - with Saxon's own Transform class, not the extension's terminal-output variant;
		// paths and settings resolved, a result file chosen when it runs left out (the result goes to standard output)
		const forCommand: XSLTTask = { ...task, messageEscaping: 'on', ...extra };
		for (const key of ['xsltFile', 'xmlSource', 'resultPath'] as const) {
			const value = forCommand[key];
			if (typeof value === 'string' && value !== '') {
				if (unresolved(value)) {
					delete forCommand[key];
				} else {
					(forCommand as unknown as Record<string, string>)[key] = RunConfiguration.resolved(value, folder);
				}
			}
		}
		forCommand.parameters = parameters.filter((p) => !unresolved(p.value));
		const { classPath, mainClass, args } = SaxonTaskProvider.commandLine(forCommand, false);
		const resolvedClassPath = classPath.map((entry) => entry === '${config:XSLT.tasks.saxonJar}' ? XSpecRunner.saxonJar() ?? entry : RunConfiguration.resolved(entry, folder));
		lines.push(`  Classpath: ${resolvedClassPath.join(path.delimiter)}`);
		const quote = (arg: string) => /[\s"'$]/.test(arg) ? `"${arg.replace(/(["$\\])/g, '\\$1')}"` : arg;
		lines.push(`  Command: java -cp ${quote(resolvedClassPath.join(path.delimiter))} ${mainClass} ${args.map(quote).join(' ')}`);
		const missing = parameters.filter((p) => unresolved(p.value)).map((p) => p.name);
		if (missing.length > 0) {
			lines.push(`  Add a value for ${missing.join(', ')} to the command as name=value - Quick Run asks for ${missing.length === 1 ? 'it' : 'them'}`);
		}
		if (task.resultPath && unresolved(task.resultPath)) {
			lines.push('  The result file is chosen when Quick Run runs - add -o:path to the command to write one');
		}
		return { lines, xsltFsPath, command: { task, classPath: resolvedClassPath, mainClass, args, missing } };
	}

	// a path from tasks.json or a setting: ${workspaceFolder} replaced, and relative to the workspace folder
	private static resolved(value: string, folder: string | undefined): string {
		const substituted = folder ? value.replace(/\$\{workspaceFolder\}/g, folder) : value;
		return path.isAbsolute(substituted) || !folder ? substituted : path.join(folder, substituted);
	}

	// the stylesheet's SaxonJ Quick Run task in tasks.json - the last one, as Quick Run uses
	private static quickRunTask(xsltFsPath: string, folder: string | undefined): vscode.TaskDefinition | undefined {
		if (!folder) {
			return undefined;
		}
		const tasksFile = path.join(folder, '.vscode', 'tasks.json');
		if (!fs.existsSync(tasksFile)) {
			return undefined;
		}
		const tasks: vscode.TaskDefinition[] = jsc.parse(fs.readFileSync(tasksFile, 'utf8'))?.tasks ?? [];
		return tasks.filter((t) => t.type === 'xslt' && typeof t.xsltFile === 'string' &&
			SaxonTaskProvider.resolveStoredPath(t.xsltFile, folder) === path.normalize(xsltFsPath)).pop();
	}
}
