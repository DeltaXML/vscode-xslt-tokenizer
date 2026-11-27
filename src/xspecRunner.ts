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
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { unquotedPath } from './settingPaths';
import { CatalogSetting } from './catalogSetting';
import { XsltPackages } from './xsltPackages';
import { SaxonTaskProvider } from './saxonTaskProvider';
import { SyntaxExtensions } from './syntaxExtensions';
import { SchXslt2Checks } from './schXslt2Checks';
import { XslLexer } from './xslLexer';
import { SchExpandText } from './schExpandText';
import { HrefPaths } from './hrefPaths';
import { XSpecTaskSettings, XSpecTaskSettingsFinder } from './xspecTaskSettings';
import { SaxonLib } from './saxonLib';

// XSpec's steps for an XSpec file that tests a stylesheet, as XSpec's own command line (bin/xspec.sh) runs them, each a
// Saxon transform: compile the tests to a stylesheet, the test runner - run it, for the result XML - and format the
// result as an HTML report. The files are where XSpec puts them, in an xspec folder beside the XSpec file, and each
// command and Saxon's output are shown in the XSpec output channel, so each step can be seen
export interface XSpecFiles {
	// for a Schematron's XSpec: the Schematron compiled to XSLT, and the XSpec for testing it
	schematronXsl: string;
	schematronXspec: string;
	compiled: string;
	result: string;
	html: string;
	// for VS Code's diff of each failed expectation: its expected and actual values, as XSpec compares them
	diffs: string;
}

export interface XSpecStepOutcome {
	ok: boolean;
	output: string;
}

export class XSpecRunner {
	public static readonly mainTemplate = '{http://www.jenitennison.com/xslt/xspec}main';
	public static extensionUri: vscode.Uri | undefined;

	// a string as an XPath string literal, for a stylesheet parameter passed to Saxon as ?name='value' - typed, as Saxon 13
	// fails for transform()'s stylesheet-params with one passed as text (see xslt-resources/schematron/validate.xsl)
	public static xpathString(value: string): string {
		return `'${value.replace(/'/g, "''")}'`;
	}
	private static channel: vscode.OutputChannel | undefined;

	public static output(): vscode.OutputChannel {
		XSpecRunner.channel = XSpecRunner.channel ?? vscode.window.createOutputChannel('XSpec');
		return XSpecRunner.channel;
	}

	// the XSpec installation: the XSLT.xspec.home setting, or the one bundled
	public static home(uri?: vscode.Uri): string | undefined {
		const setting = unquotedPath(vscode.workspace.getConfiguration('XSLT.xspec', uri).get<string>('home'))?.trim();
		if (setting) {
			const folder = vscode.workspace.getWorkspaceFolder(uri ?? vscode.Uri.file(setting))?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			return path.isAbsolute(setting) || !folder ? setting : path.join(folder, setting);
		}
		return XSpecRunner.extensionUri ? path.join(XSpecRunner.extensionUri.fsPath, 'xslt-resources', 'xspec') : undefined;
	}

	// the Saxon jar: the XSLT.tasks.saxonJar setting
	public static saxonJar(uri?: vscode.Uri): string | undefined {
		const setting = unquotedPath(vscode.workspace.getConfiguration('XSLT.tasks', uri).get<string>('saxonJar'))?.trim();
		if (!setting) {
			return undefined;
		}
		const folder = (uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined)?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
		const substituted = setting.replace(/\$\{workspaceFolder\}/g, folder);
		return path.isAbsolute(substituted) || !folder ? substituted : path.join(folder, substituted);
	}

	// the reason the tests can't be run, if any
	public static problem(uri?: vscode.Uri): string | undefined {
		const saxonJar = XSpecRunner.saxonJar(uri);
		if (!saxonJar) {
			return 'XSpec: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.';
		}
		if (!fs.existsSync(saxonJar)) {
			return `XSpec: the Saxon jar '${saxonJar}' doesn't exist - check the "XSLT.tasks.saxonJar" setting.`;
		}
		const home = XSpecRunner.home(uri);
		if (!home || !fs.existsSync(path.join(home, 'src', 'compiler', 'compile-xslt-tests.xsl'))) {
			return `XSpec: '${home}' isn't an XSpec installation - check the "XSLT.xspec.home" setting.`;
		}
		return undefined;
	}

	// outputFolder: where the files go - by default the xspec folder beside the XSpec file, where the Test Explorer puts them
	public static files(xspecPath: string, suffix = '', outputFolder?: string): XSpecFiles {
		const folder = outputFolder ?? path.join(path.dirname(xspecPath), 'xspec');
		const name = path.basename(xspecPath, path.extname(xspecPath)) + suffix;
		return {
			schematronXsl: path.join(folder, `${name}-sch-preprocessed.xsl`), schematronXspec: path.join(folder, `${name}-sch-preprocessed.xspec`),
			compiled: path.join(folder, `${name}-compiled.xsl`), result: path.join(folder, `${name}-result.xml`), html: path.join(folder, `${name}-result.html`),
			diffs: path.join(folder, `${name}-diffs.json`)
		};
	}

	// the stylesheet an XSpec file tests - its path
	public static stylesheetOf(xspecPath: string): string | undefined {
		const text = fs.readFileSync(xspecPath, 'utf8');
		const href = /<(?:[\w.-]+:)?description\b[^>]*?\sstylesheet\s*=\s*(["'])(.*?)\1/.exec(text)?.[2];
		return href === undefined ? undefined : href.startsWith('file:') ? vscode.Uri.parse(href).fsPath : path.resolve(path.dirname(xspecPath), href);
	}

	// the Schematron an XSpec file tests - its path, or undefined for a stylesheet's XSpec
	public static schematron(xspecPath: string): string | undefined {
		const text = fs.readFileSync(xspecPath, 'utf8');
		const href = /<(?:[\w.-]+:)?description\b[^>]*?\sschematron\s*=\s*(["'])(.*?)\1/.exec(text)?.[2];
		return href === undefined ? undefined : href.startsWith('file:') ? vscode.Uri.parse(href).fsPath : path.resolve(path.dirname(xspecPath), href);
	}

	// the steps that prepare the XSpec file to compile - none for a stylesheet's. For a Schematron's, as XSpec's command line does
	// (preprocess_schematron in bin/xspec.sh), the Schematron is compiled to XSLT with SchXslt2, and the XSpec converted to test it:
	// each step's title and Saxon arguments, and the XSpec file to compile after them - or the problem that stops them
	public static prepareSteps(xspecPath: string, files: XSpecFiles): { problem?: string; steps: { title: string; saxonArgs: string[] }[]; source: string } {
		const schematron = XSpecRunner.schematron(xspecPath);
		if (!schematron) {
			return { steps: [], source: xspecPath };
		}
		const schematronText = fs.existsSync(schematron) ? fs.readFileSync(schematron, 'utf8') : undefined;
		if (schematronText === undefined) {
			return { problem: `XSpec: the Schematron '${schematron}' doesn't exist`, steps: [], source: xspecPath };
		}
		if (/<(?:[\w.-]+:)?schema\b[^>]*?\squeryBinding\s*=\s*["']\s*xquery/i.test(schematronText)) {
			return { problem: 'XSpec: a Schematron with an XQuery query binding isn\'t supported - only XSLT', steps: [], source: xspecPath };
		}
		const uri = vscode.Uri.file(xspecPath);
		const home = XSpecRunner.home(uri)!;
		// text value templates in messages, with xsl:expand-text - the non-standard extension, by the setting
		// XSLT.schematron.allowExpandText: rewritten as sch:value-of, as XSpec's first step - which SchXslt2 doesn't have
		const expandText = SchExpandText.allowed() && XSpecRunner.extensionUri ?
			['?STEP1-PREPROCESSOR-URI=' + XSpecRunner.xpathString(vscode.Uri.joinPath(XSpecRunner.extensionUri, 'xslt-resources', 'schematron', 'expand-text.xsl').toString())] : [];
		return {
			steps: [
				{ title: 'Compiling the Schematron to XSLT', saxonArgs: ['-s:' + xspecPath, '-xsl:' + path.join(home, 'src', 'schematron', 'schut-to-xslt.xsl'), '-o:' + files.schematronXsl, ...expandText] },
				{ title: 'Converting the XSpec for the Schematron\'s XSLT', saxonArgs: ['-s:' + xspecPath, '-xsl:' + path.join(home, 'src', 'schematron', 'schut-to-xspec.xsl'), '+stylesheet-doc=' + files.schematronXsl, '-o:' + files.schematronXspec] }
			],
			source: files.schematronXspec
		};
	}

	// the XSpec file to compile: the file itself - or for a Schematron's, as prepareSteps says
	public static async prepare(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken): Promise<XSpecStepOutcome & { source: string }> {
		const { problem, steps, source } = XSpecRunner.prepareSteps(xspecPath, files);
		if (problem) {
			return { ok: false, output: problem, source: xspecPath };
		}
		if (steps.length > 0) {
			fs.mkdirSync(path.dirname(files.compiled), { recursive: true });
		}
		const uri = vscode.Uri.file(xspecPath);
		let outcome: XSpecStepOutcome = { ok: true, output: '' };
		for (const step of steps) {
			outcome = await XSpecRunner.saxon(step.title, uri, step.saxonArgs, token);
			if (!outcome.ok) {
				return { ...outcome, source: xspecPath };
			}
		}
		return { ...outcome, source };
	}

	// whether a test run can time its scenarios, with XSpec's measure-time: it uses saxon:timestamp(), a Saxon extension
	// function, which Saxon-HE doesn't have
	public static canMeasureTime(uri: vscode.Uri): boolean {
		return !SaxonTaskProvider.isSaxonHE(XSpecRunner.saxonJar(uri));
	}

	// the Saxon arguments to compile the test runner from the XSpec file - or the one prepare gives - with force-focus, only the
	// scenario with that ID runs. With measureTime, it times each scenario (see canMeasureTime), for the Test Explorer's durations
	public static compileArgs(xspecPath: string, files: XSpecFiles, forceFocus?: string, source = xspecPath, measureTime = false): string[] {
		const uri = vscode.Uri.file(xspecPath);
		const compiler = path.join(XSpecRunner.home(uri)!, 'src', 'compiler', 'compile-xslt-tests.xsl');
		// with the XSLT.xspec.legacyCompatibility setting: by the extension's stylesheet, which imports XSpec's compiler and
		// changes the test runner to run tests written for XSpec before 1.0 as that did - each change is reported
		const legacy = vscode.workspace.getConfiguration('XSLT.xspec', uri).get<boolean>('legacyCompatibility', false) && XSpecRunner.extensionUri;
		const args = legacy ?
			['-s:' + source, '-xsl:' + path.join(XSpecRunner.extensionUri!.fsPath, 'xslt-resources', 'xspec-compat', 'xspec-compat.xsl'), '-o:' + files.compiled, 'compiler=' + vscode.Uri.file(compiler).toString()] :
			['-s:' + source, '-xsl:' + compiler, '-o:' + files.compiled];
		const options = [...(forceFocus ? ['force-focus=' + forceFocus] : []), ...(measureTime ? ['?measure-time=true()'] : [])];
		return args.concat(options);
	}

	// the test runner, compiled from the XSpec file - or the one prepare gives (see compileArgs)
	public static compile(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken, forceFocus?: string, source = xspecPath, measureTime = false): Promise<XSpecStepOutcome> {
		fs.mkdirSync(path.dirname(files.compiled), { recursive: true });
		return XSpecRunner.saxon('Compiling the tests', vscode.Uri.file(xspecPath), XSpecRunner.compileArgs(xspecPath, files, forceFocus, source, measureTime), token);
	}

	// whether the test runner compiles, without running it - with the Saxon settings of the stylesheet's task, as it's run
	public static check(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken, taskSettings?: XSpecTaskSettings): Promise<XSpecStepOutcome> {
		const uri = vscode.Uri.file(xspecPath);
		return XSpecRunner.saxon('Checking the test runner', uri, [...XSpecRunner.syntaxExtensions(uri), '-xsl:' + files.compiled, '-nogo'], token, taskSettings);
	}

	// Saxon's syntax extensions - XPath 4.0 syntax, and e.g. record types in an XSLT 3.0 stylesheet - by the
	// XSLT.xspec.allowSyntaxExtensions setting. They're needed to compile the stylesheet tested, which the test runner
	// imports - or, with run-as="external", compiles with fn:transform(), which has the same configuration
	private static syntaxExtensions(uri: vscode.Uri): string[] {
		return XSpecRunner.syntaxExtensionsValue(uri) === 'on' ? ['--allowSyntaxExtensions:on'] : [];
	}

	// 'on' or 'off': as the setting says - or for 'auto', the default, on only for tests that need them, of a stylesheet
	// that's XSLT 4.0, or uses item types or notes - and never with Saxon-HE, which fails every transform with them on.
	// Not otherwise, as with them on, Saxon 13 runs a stylesheet before 4.0 with some of 4.0's rules, e.g. the
	// priority of a union pattern (SXWN9052)
	public static syntaxExtensionsValue(uri: vscode.Uri): 'on' | 'off' {
		const setting = vscode.workspace.getConfiguration('XSLT.xspec', uri).get<string>('allowSyntaxExtensions');
		if (setting === 'on' || setting === 'off') {
			return setting;
		}
		return !SaxonTaskProvider.isSaxonHE(XSpecRunner.saxonJar(uri)) && XSpecRunner.needsSyntaxExtensions(uri.fsPath) ? 'on' : 'off';
	}

	// the XSpec file, with xslt-version="4.0" or item types, or a module it tests - the stylesheet, and those it imports,
	// includes or uses, with its helpers - that's XSLT 4.0, or uses item types or notes
	private static needsSyntaxExtensions(xspecPath: string): boolean {
		const read = (file: string) => XSpecRunner.readText(file);
		const xspecText = read(xspecPath) ?? '';
		if (/<(?:[\w.-]+:)?description\b[^>]*\sxslt-version\s*=\s*["']4/.test(xspecText) || /\sas\s*=\s*(["'])[^"']*(?<![\w.:-])(record|enum)\s*\(/.test(xspecText)) {
			return true;
		}
		const tested = XSpecRunner.testedModules(xspecPath, xspecText);
		return SyntaxExtensions.needed(tested.stylesheets.concat(tested.packages)) || XSpecRunner.schematronNeedsSyntaxExtensions(xspecText, xspecPath, read);
	}

	// the modules an XSpec file tests, from its text: the stylesheet and the helpers' stylesheets - their hrefs, resolved against
	// the XSpec file - and, apart, the packages of its x:helper elements
	public static testedModules(xspecPath: string, xspecText?: string): { stylesheets: string[]; packages: string[] } {
		const text = xspecText ?? XSpecRunner.readText(xspecPath) ?? '';
		const starts = [...text.matchAll(/<(?:[\w.-]+:)?(?:description|helper)\b[^>]*?\sstylesheet\s*=\s*(["'])(.*?)\1/g)]
			.map((m) => m[2].startsWith('file:') ? vscode.Uri.parse(m[2]).fsPath : path.resolve(path.dirname(xspecPath), m[2]));
		const helperPackages = [...text.matchAll(/<(?:[\w.-]+:)?helper\b[^>]*?\spackage-name\s*=\s*(["'])(.*?)\1[^>]*>/g)].map((m) => {
			const version = /\spackage-version\s*=\s*(["'])(.*?)\1/.exec(m[0])?.[2];
			const found = XsltPackages.find(XsltPackages.all(), m[2], version);
			return found ? HrefPaths.settingsPath(found.path, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(xspecPath)) : undefined;
		}).filter((p): p is string => !!p);
		return { stylesheets: starts, packages: helperPackages };
	}

	// a file's text: as it is in an editor, if it's open - else on disk, or undefined if it can't be read
	private static readText(file: string): string | undefined {
		try {
			const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.fileName === file);
			return open ? open.getText() : fs.readFileSync(file, 'utf8');
		} catch {
			return undefined;
		}
	}

	// the Schematron the XSpec file tests, compiled by SchXslt2 to an XSLT 3.0 stylesheet: it needs them for xsl:note in a
	// declaration it copies, e.g. xsl:function (not one with use-when="false()"), for XPath 4.0 (queryBinding="xslt4"),
	// or for a module it includes or imports that needs them
	private static schematronNeedsSyntaxExtensions(xspecText: string, xspecPath: string, read: (file: string) => string | undefined): boolean {
		const href = /<(?:[\w.-]+:)?description\b[^>]*?\sschematron\s*=\s*(["'])(.*?)\1/.exec(xspecText)?.[2];
		const schPath = href ? HrefPaths.toPath(href.trim(), xspecPath) : undefined;
		const schText = schPath ? read(schPath) : undefined;
		return !!schPath && schText !== undefined && XSpecRunner.schemaNeedsSyntaxExtensions(schPath, schText);
	}

	// a Schematron schema, compiled by SchXslt2, needs them - see schematronNeedsSyntaxExtensions - and with 'auto', they're
	// on for its validation only then, and never with Saxon-HE
	public static schematronSyntaxExtensions(uri: vscode.Uri, schPath: string, schText: string): boolean {
		const setting = vscode.workspace.getConfiguration('XSLT.xspec', uri).get<string>('allowSyntaxExtensions');
		return setting === 'on' || (setting !== 'off' && !SaxonTaskProvider.isSaxonHE(XSpecRunner.saxonJar(uri)) && XSpecRunner.schemaNeedsSyntaxExtensions(schPath, schText));
	}

	private static schemaNeedsSyntaxExtensions(schPath: string, schText: string): boolean {
		const queryBinding = /<(?:[\w.-]+:)?schema\b[^>]*?\squeryBinding\s*=\s*(["'])\s*([^"']*?)\s*\1/.exec(schText)?.[2];
		if (queryBinding?.toLowerCase() === 'xslt4' || SchXslt2Checks.notesNeedingExtensions(schText).length > 0) {
			return true;
		}
		const xsltPrefix = XslLexer.schXsltPrefix(schText).replace(/[.-]/g, '\\$&');
		const modules = [...schText.replace(/<!--[\s\S]*?-->/g, '').matchAll(new RegExp(`<${xsltPrefix}:(?:include|import)\\b[^>]*?\\shref\\s*=\\s*(["'])(.*?)\\1`, 'g'))]
			.map((m) => HrefPaths.toPath(m[2].trim(), schPath)).filter((p): p is string => !!p);
		return SyntaxExtensions.needed(modules);
	}

	// the Saxon arguments to run the compiled tests: with the packages they use for -lib (see libraryPaths)
	public static runArgs(xspecPath: string, files: XSpecFiles, libraryPaths: string[]): string[] {
		const uri = vscode.Uri.file(xspecPath);
		const lib = libraryPaths.length > 0 ? ['-lib:' + libraryPaths.join(path.delimiter)] : [];
		return [...XSpecRunner.syntaxExtensions(uri), ...lib, '-xsl:' + files.compiled, '-it:' + XSpecRunner.mainTemplate, '-o:' + files.result];
	}

	// the packages the runner uses - for an x:helper's package-name, and those the stylesheet under test uses - and
	// with run-as="external", which doesn't import the stylesheet, those it uses. Not with a Saxon configuration file,
	// which may declare the packages itself, as for a task (see SaxonTaskProvider.libOption). From the compiled test runner, just
	// compiled - or, with fromCompiled false, as when the commands are only given, not run, so a runner left by an earlier run
	// may be out of date - from the XSpec file's stylesheet and helpers
	public static libraryPaths(xspecPath: string, files: XSpecFiles, taskSettings?: XSpecTaskSettings, fromCompiled = true): string[] {
		if (taskSettings?.configFilename) {
			return [];
		}
		const stylesheet = XSpecRunner.stylesheetOf(xspecPath);
		// before it's compiled: those the stylesheets use, and the helpers' packages and those they use
		const tested = fromCompiled && fs.existsSync(files.compiled) ? undefined : XSpecRunner.testedModules(xspecPath);
		const fromRunner = tested === undefined ? XsltPackages.libraryPaths(files.compiled) :
			tested.stylesheets.flatMap((module) => XsltPackages.libraryPaths(module)).concat(tested.packages.flatMap((pkg) => [pkg, ...XsltPackages.libraryPaths(pkg)]));
		return [...new Set(fromRunner.concat(stylesheet && fs.existsSync(stylesheet) ? XsltPackages.libraryPaths(stylesheet) : []))];
	}

	// with the Saxon settings of the stylesheet's task, if it has one (see XSpecTaskSettings)
	public static run(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken, taskSettings?: XSpecTaskSettings): Promise<XSpecStepOutcome> {
		return XSpecRunner.saxon('Running the tests', vscode.Uri.file(xspecPath), XSpecRunner.runArgs(xspecPath, files, XSpecRunner.libraryPaths(xspecPath, files, taskSettings)), token, taskSettings);
	}

	// the Saxon arguments for XSpec's HTML report - and, by the extension's stylesheet that imports XSpec's reporter, the expected
	// and actual values of the failed expectations, as XSpec compares them, for VS Code's diffs
	public static reportArgs(xspecPath: string, files: XSpecFiles): string[] {
		const uri = vscode.Uri.file(xspecPath);
		const reporter = path.join(XSpecRunner.home(uri)!, 'src', 'reporter', 'format-xspec-report.xsl');
		const withDiffs = XSpecRunner.extensionUri ? path.join(XSpecRunner.extensionUri.fsPath, 'xslt-resources', 'xspec-diff', 'xspec-diff.xsl') : undefined;
		// with the syntax extensions, as maps are reported in XPath 4.0's syntax with them, e.g. {"a": 1}, and evaluated
		// for the diffs
		return withDiffs ?
			[...XSpecRunner.syntaxExtensions(uri), '-s:' + files.result, '-xsl:' + withDiffs, '-o:' + files.html, 'reporter=' + vscode.Uri.file(reporter).toString(), 'diffs-uri=' + vscode.Uri.file(files.diffs).toString()] :
			['-s:' + files.result, '-xsl:' + reporter, '-o:' + files.html];
	}

	public static report(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken): Promise<XSpecStepOutcome> {
		if (fs.existsSync(files.diffs)) {
			fs.rmSync(files.diffs);
		}
		return XSpecRunner.saxon('Formatting the report', vscode.Uri.file(xspecPath), XSpecRunner.reportArgs(xspecPath, files), token);
	}

	// the arguments of the java command that runs a Saxon step: the classpath - the Saxon jar, and the task's entries - the
	// catalog, the task's own options, then the step's. With the Saxon settings of the stylesheet's task, if it has one
	public static javaArgs(uri: vscode.Uri, saxonArgs: string[], taskSettings?: XSpecTaskSettings): string[] {
		const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(uri.fsPath);
		const task = taskSettings ? XSpecTaskSettingsFinder.commandLine(taskSettings, folder) : { classPath: [], args: [] };
		// the task's catalog, if it has one - as for the task, instead of the XSLT.resources.catalog setting
		const catalog = CatalogSetting.taskOption(taskSettings ?? {});
		// and the jars of the Saxon download's lib folder that invisible-xml() needs (see SaxonLib)
		const classPath = SaxonLib.classPath(XSpecRunner.saxonJar(uri)!, task.classPath).join(path.delimiter);
		return ['-cp', classPath, 'net.sf.saxon.Transform', ...(catalog ? [catalog] : []), ...task.args, ...saxonArgs];
	}

	private static saxon(step: string, uri: vscode.Uri, saxonArgs: string[], token?: vscode.CancellationToken, taskSettings?: XSpecTaskSettings): Promise<XSpecStepOutcome> {
		const args = XSpecRunner.javaArgs(uri, saxonArgs, taskSettings);
		const channel = XSpecRunner.output();
		channel.appendLine(`${step}:`);
		if (taskSettings) {
			channel.appendLine(`(with the Saxon settings of the task '${taskSettings.label}')`);
		}
		channel.appendLine('java ' + args.map((arg) => /[\s"]/.test(arg) ? `"${arg}"` : arg).join(' '));
		return new Promise((resolve) => {
			let output = '';
			const child = spawn('java', args, { cwd: path.dirname(uri.fsPath) });
			const append = (data: Buffer) => {
				const text = data.toString();
				output += text;
				channel.append(text);
			};
			child.stdout.on('data', append);
			child.stderr.on('data', append);
			const cancel = token?.onCancellationRequested(() => child.kill());
			child.on('error', (error) => {
				cancel?.dispose();
				channel.appendLine(`XSpec: Java couldn't be run: ${error.message}`);
				resolve({ ok: false, output: output + error.message });
			});
			child.on('close', (code) => {
				cancel?.dispose();
				channel.appendLine(code === 0 ? '' : `(exit code ${code})\n`);
				resolve({ ok: code === 0, output });
			});
		});
	}
}
