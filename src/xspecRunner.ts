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
import { HrefPaths } from './hrefPaths';
import { XSpecTaskSettings, XSpecTaskSettingsFinder } from './xspecTaskSettings';

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

	public static files(xspecPath: string, suffix = ''): XSpecFiles {
		const folder = path.join(path.dirname(xspecPath), 'xspec');
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

	// the XSpec file to compile: the file itself - or for a Schematron's, as XSpec's command line does (preprocess_schematron
	// in bin/xspec.sh), the Schematron is compiled to XSLT with SchXslt2, and the XSpec converted to test it
	public static async prepare(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken): Promise<XSpecStepOutcome & { source: string }> {
		const schematron = XSpecRunner.schematron(xspecPath);
		if (!schematron) {
			return { ok: true, output: '', source: xspecPath };
		}
		const schematronText = fs.existsSync(schematron) ? fs.readFileSync(schematron, 'utf8') : undefined;
		if (schematronText === undefined) {
			return { ok: false, output: `XSpec: the Schematron '${schematron}' doesn't exist`, source: xspecPath };
		}
		if (/<(?:[\w.-]+:)?schema\b[^>]*?\squeryBinding\s*=\s*["']\s*xquery/i.test(schematronText)) {
			return { ok: false, output: 'XSpec: a Schematron with an XQuery query binding isn\'t supported - only XSLT', source: xspecPath };
		}
		fs.mkdirSync(path.dirname(files.compiled), { recursive: true });
		const uri = vscode.Uri.file(xspecPath);
		const home = XSpecRunner.home(uri)!;
		const toXslt = await XSpecRunner.saxon('Compiling the Schematron to XSLT', uri, ['-s:' + xspecPath, '-xsl:' + path.join(home, 'src', 'schematron', 'schut-to-xslt.xsl'), '-o:' + files.schematronXsl], token);
		if (!toXslt.ok) {
			return { ...toXslt, source: xspecPath };
		}
		const toXSpec = await XSpecRunner.saxon('Converting the XSpec for the Schematron\'s XSLT', uri,
			['-s:' + xspecPath, '-xsl:' + path.join(home, 'src', 'schematron', 'schut-to-xspec.xsl'), '+stylesheet-doc=' + files.schematronXsl, '-o:' + files.schematronXspec], token);
		return { ...toXSpec, source: files.schematronXspec };
	}

	// whether a test run can time its scenarios, with XSpec's measure-time: it uses saxon:timestamp(), a Saxon extension
	// function, which Saxon-HE doesn't have
	public static canMeasureTime(uri: vscode.Uri): boolean {
		return !SaxonTaskProvider.isSaxonHE(XSpecRunner.saxonJar(uri));
	}

	// the test runner, compiled from the XSpec file - or the one prepare gives - with force-focus, only the scenario with
	// that ID runs. With measureTime, it times each scenario (see canMeasureTime), for the Test Explorer's durations
	public static compile(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken, forceFocus?: string, source = xspecPath, measureTime = false): Promise<XSpecStepOutcome> {
		fs.mkdirSync(path.dirname(files.compiled), { recursive: true });
		const uri = vscode.Uri.file(xspecPath);
		const compiler = path.join(XSpecRunner.home(uri)!, 'src', 'compiler', 'compile-xslt-tests.xsl');
		// with the XSLT.xspec.legacyCompatibility setting: by the extension's stylesheet, which imports XSpec's compiler and
		// changes the test runner to run tests written for XSpec before 1.0 as that did - each change is reported
		const legacy = vscode.workspace.getConfiguration('XSLT.xspec', uri).get<boolean>('legacyCompatibility', false) && XSpecRunner.extensionUri;
		const args = legacy ?
			['-s:' + source, '-xsl:' + path.join(XSpecRunner.extensionUri!.fsPath, 'xslt-resources', 'xspec-compat', 'xspec-compat.xsl'), '-o:' + files.compiled, 'compiler=' + vscode.Uri.file(compiler).toString()] :
			['-s:' + source, '-xsl:' + compiler, '-o:' + files.compiled];
		const options = [...(forceFocus ? ['force-focus=' + forceFocus] : []), ...(measureTime ? ['?measure-time=true()'] : [])];
		return XSpecRunner.saxon('Compiling the tests', uri, args.concat(options), token);
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
		const read = (file: string) => {
			try {
				const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.fileName === file);
				return open ? open.getText() : fs.readFileSync(file, 'utf8');
			} catch {
				return undefined;
			}
		};
		const xspecText = read(xspecPath) ?? '';
		if (/<(?:[\w.-]+:)?description\b[^>]*\sxslt-version\s*=\s*["']4/.test(xspecText) || /\sas\s*=\s*(["'])[^"']*(?<![\w.:-])(record|enum)\s*\(/.test(xspecText)) {
			return true;
		}
		// from the stylesheet and the helpers: their hrefs, resolved against the XSpec file
		const starts = [...xspecText.matchAll(/<(?:[\w.-]+:)?(?:description|helper)\b[^>]*?\sstylesheet\s*=\s*(["'])(.*?)\1/g)]
			.map((m) => m[2].startsWith('file:') ? vscode.Uri.parse(m[2]).fsPath : path.resolve(path.dirname(xspecPath), m[2]));
		// and the packages of its x:helper elements
		const helperPackages = [...xspecText.matchAll(/<(?:[\w.-]+:)?helper\b[^>]*?\spackage-name\s*=\s*(["'])(.*?)\1[^>]*>/g)].map((m) => {
			const version = /\spackage-version\s*=\s*(["'])(.*?)\1/.exec(m[0])?.[2];
			const found = XsltPackages.find(XsltPackages.all(), m[2], version);
			return found ? HrefPaths.settingsPath(found.path, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(xspecPath)) : undefined;
		}).filter((p): p is string => !!p);
		return SyntaxExtensions.needed(starts.concat(helperPackages));
	}

	// with the Saxon settings of the stylesheet's task, if it has one (see XSpecTaskSettings)
	public static run(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken, taskSettings?: XSpecTaskSettings): Promise<XSpecStepOutcome> {
		// the packages the runner uses - for an x:helper's package-name, and those the stylesheet under test uses - and
		// with run-as="external", which doesn't import the stylesheet, those it uses. Not with a Saxon configuration file,
		// which may declare the packages itself, as for a task (see SaxonTaskProvider.libOption)
		const stylesheet = XSpecRunner.stylesheetOf(xspecPath);
		const libraryPaths = taskSettings?.configFilename ? [] :
			[...new Set(XsltPackages.libraryPaths(files.compiled).concat(stylesheet && fs.existsSync(stylesheet) ? XsltPackages.libraryPaths(stylesheet) : []))];
		const lib = libraryPaths.length > 0 ? ['-lib:' + libraryPaths.join(path.delimiter)] : [];
		const uri = vscode.Uri.file(xspecPath);
		return XSpecRunner.saxon('Running the tests', uri, [...XSpecRunner.syntaxExtensions(uri), ...lib, '-xsl:' + files.compiled, '-it:' + XSpecRunner.mainTemplate, '-o:' + files.result], token, taskSettings);
	}

	// XSpec's HTML report - and, by the extension's stylesheet that imports XSpec's reporter, the expected and actual
	// values of the failed expectations, as XSpec compares them, for VS Code's diffs
	public static report(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken): Promise<XSpecStepOutcome> {
		const uri = vscode.Uri.file(xspecPath);
		const reporter = path.join(XSpecRunner.home(uri)!, 'src', 'reporter', 'format-xspec-report.xsl');
		const withDiffs = XSpecRunner.extensionUri ? path.join(XSpecRunner.extensionUri.fsPath, 'xslt-resources', 'xspec-diff', 'xspec-diff.xsl') : undefined;
		if (fs.existsSync(files.diffs)) {
			fs.rmSync(files.diffs);
		}
		// with the syntax extensions, as maps are reported in XPath 4.0's syntax with them, e.g. {"a": 1}, and evaluated
		// for the diffs
		return XSpecRunner.saxon('Formatting the report', uri, withDiffs ?
			[...XSpecRunner.syntaxExtensions(uri), '-s:' + files.result, '-xsl:' + withDiffs, '-o:' + files.html, 'reporter=' + vscode.Uri.file(reporter).toString(), 'diffs-uri=' + vscode.Uri.file(files.diffs).toString()] :
			['-s:' + files.result, '-xsl:' + reporter, '-o:' + files.html], token);
	}

	private static saxon(step: string, uri: vscode.Uri, saxonArgs: string[], token?: vscode.CancellationToken, taskSettings?: XSpecTaskSettings): Promise<XSpecStepOutcome> {
		const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(uri.fsPath);
		const task = taskSettings ? XSpecTaskSettingsFinder.commandLine(taskSettings, folder) : { classPath: [], args: [] };
		// the task's catalog, if it has one - as for the task, instead of the XSLT.resources.catalog setting
		const catalog = CatalogSetting.taskOption(taskSettings ?? {});
		const classPath = [XSpecRunner.saxonJar(uri)!, ...task.classPath].join(path.delimiter);
		const args = ['-cp', classPath, 'net.sf.saxon.Transform', ...(catalog ? [catalog] : []), ...task.args, ...saxonArgs];
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
