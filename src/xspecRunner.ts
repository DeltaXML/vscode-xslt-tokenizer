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
			compiled: path.join(folder, `${name}-compiled.xsl`), result: path.join(folder, `${name}-result.xml`), html: path.join(folder, `${name}-result.html`)
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

	// the test runner, compiled from the XSpec file - or the one prepare gives - with force-focus, only the scenario with
	// that ID runs
	public static compile(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken, forceFocus?: string, source = xspecPath): Promise<XSpecStepOutcome> {
		fs.mkdirSync(path.dirname(files.compiled), { recursive: true });
		const uri = vscode.Uri.file(xspecPath);
		const args = ['-s:' + source, '-xsl:' + path.join(XSpecRunner.home(uri)!, 'src', 'compiler', 'compile-xslt-tests.xsl'), '-o:' + files.compiled];
		return XSpecRunner.saxon('Compiling the tests', uri, forceFocus ? args.concat('force-focus=' + forceFocus) : args, token);
	}

	// whether the test runner compiles, without running it
	public static check(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken): Promise<XSpecStepOutcome> {
		return XSpecRunner.saxon('Checking the test runner', vscode.Uri.file(xspecPath), ['-xsl:' + files.compiled, '-nogo'], token);
	}

	public static run(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken): Promise<XSpecStepOutcome> {
		// the packages the runner uses - for an x:helper's package-name, and those the stylesheet under test uses - and
		// with run-as="external", which doesn't import the stylesheet, those it uses
		const stylesheet = XSpecRunner.stylesheetOf(xspecPath);
		const libraryPaths = [...new Set(XsltPackages.libraryPaths(files.compiled).concat(stylesheet && fs.existsSync(stylesheet) ? XsltPackages.libraryPaths(stylesheet) : []))];
		const lib = libraryPaths.length > 0 ? ['-lib:' + libraryPaths.join(path.delimiter)] : [];
		return XSpecRunner.saxon('Running the tests', vscode.Uri.file(xspecPath), [...lib, '-xsl:' + files.compiled, '-it:' + XSpecRunner.mainTemplate, '-o:' + files.result], token);
	}

	public static report(xspecPath: string, files: XSpecFiles, token?: vscode.CancellationToken): Promise<XSpecStepOutcome> {
		const uri = vscode.Uri.file(xspecPath);
		return XSpecRunner.saxon('Formatting the report', uri, ['-s:' + files.result, '-xsl:' + path.join(XSpecRunner.home(uri)!, 'src', 'reporter', 'format-xspec-report.xsl'), '-o:' + files.html], token);
	}

	private static saxon(step: string, uri: vscode.Uri, saxonArgs: string[], token?: vscode.CancellationToken): Promise<XSpecStepOutcome> {
		const catalog = CatalogSetting.taskOption({});
		const args = ['-cp', XSpecRunner.saxonJar(uri)!, 'net.sf.saxon.Transform', ...(catalog ? [catalog] : []), ...saxonArgs];
		const channel = XSpecRunner.output();
		channel.appendLine(`${step}:`);
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
