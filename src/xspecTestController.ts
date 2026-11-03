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
import * as path from 'path';
import { XSpecTests, XSpecTestNode, XSpecResult, XSpecTestKind } from './xspecTests';
import { XSpecRunner, XSpecFiles } from './xspecRunner';
import { parseXml, localName, descendants } from './xspecXml';
import { XSpecSourceMap } from './xspecSourceMap';

// XSpec's tests in the Test Explorer: an item for each XSpec file, with its scenarios and expectations - run, or
// debugged with the XSLT debugger, by XSpecRunner's steps. One scenario is run with XSpec's force-focus, and the outcomes
// in XSpec's result XML are matched with the items by their labels (see XSpecTests)
// the outcome of running an XSpec file's tests: those of its expectations - or why they couldn't be run
interface XSpecFileOutcome {
	file: string;
	passed: number;
	failed: number;
	pending: number;
	// why it stopped - Saxon's error, or XSpec's - and for an I/O error, the file
	stopped?: string;
	stoppedDetail?: string;
}

// the debugger's coverage of each module, by path: the hits of each line, and the lines that can be run
// - each as the first and last lines of an instruction's start tag, up to a multi-line expression in it
type CoverageFiles = { [path: string]: { hits: { [line: string]: number }, executable: [number, number][] } };

export class XSpecTestController {
	public static readonly id = 'xspec';
	// the one the extension creates - and for testing, a replacement for the test runs it creates, e.g. to record them
	public static instance: XSpecTestController | undefined;
	public createRun: ((request: vscode.TestRunRequest) => vscode.TestRun) | undefined;
	public readonly runProfile: vscode.TestRunProfile;
	public readonly debugProfile: vscode.TestRunProfile;
	public readonly coverageProfile: vscode.TestRunProfile;
	// the coverage of each file in the last coverage run, by URI, for its details
	private readonly coverageDetails = new Map<string, vscode.FileCoverageDetail[]>();
	// the hits so far of each module in a coverage run, by path
	private readonly runCoverage = new WeakMap<vscode.TestRun, CoverageFiles>();
	private readonly controller: vscode.TestController;
	// the items of each XSpec file, by their key (see XSpecTests.key) - with an occurrence number for repeated labels
	private readonly itemsByFile = new Map<string, Map<string, vscode.TestItem>>();
	private readonly kinds = new WeakMap<vscode.TestItem, XSpecTestKind>();

	constructor(context: vscode.ExtensionContext) {
		this.controller = vscode.tests.createTestController(XSpecTestController.id, 'XSpec');
		context.subscriptions.push(this.controller);
		this.controller.resolveHandler = async (item) => {
			if (!item) {
				await this.discoverFiles();
			} else if (item.uri) {
				await this.updateFile(item.uri);
			}
		};
		this.runProfile = this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => this.runTests(request, token, false), true);
		this.debugProfile = this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, (request, token) => this.runTests(request, token, true), true);
		this.coverageProfile = this.controller.createRunProfile('Coverage', vscode.TestRunProfileKind.Coverage, (request, token) => this.runTests(request, token, false, true), true);
		this.coverageProfile.loadDetailedCoverage = async (_run, fileCoverage) => this.coverageDetails.get(fileCoverage.uri.toString()) ?? [];
		XSpecTestController.instance = this;

		const watcher = vscode.workspace.createFileSystemWatcher('**/*.xspec');
		context.subscriptions.push(watcher,
			watcher.onDidCreate((uri) => this.fileItem(uri)),
			watcher.onDidChange((uri) => this.updateFile(uri)),
			watcher.onDidDelete((uri) => this.removeFile(uri)),
			vscode.workspace.onDidOpenTextDocument((document) => this.updateDocument(document)),
			vscode.workspace.onDidChangeTextDocument((event) => this.updateDocument(event.document)));
		vscode.workspace.textDocuments.forEach((document) => this.updateDocument(document));
	}

	public get testController() {
		return this.controller;
	}

	private async discoverFiles() {
		const uris = await vscode.workspace.findFiles('**/*.xspec', '**/node_modules/**');
		uris.forEach((uri) => this.fileItem(uri));
	}

	private fileItem(uri: vscode.Uri): vscode.TestItem {
		let item = this.controller.items.get(uri.toString());
		if (!item) {
			item = this.controller.createTestItem(uri.toString(), path.basename(uri.fsPath), uri);
			item.canResolveChildren = true;
			this.controller.items.add(item);
			XSpecTestController.setHasFiles(true);
		}
		return item;
	}

	private removeFile(uri: vscode.Uri) {
		this.controller.items.delete(uri.toString());
		this.itemsByFile.delete(uri.fsPath);
		XSpecTestController.setHasFiles(this.controller.items.size > 0);
	}

	// the context key for the Test Explorer's menu items for XSpec, e.g. XSpec: Delete Generated Files - which is shown
	// for the tests of other languages too
	private static hasFiles: boolean | undefined;
	private static setHasFiles(hasFiles: boolean) {
		if (XSpecTestController.hasFiles !== hasFiles) {
			XSpecTestController.hasFiles = hasFiles;
			vscode.commands.executeCommand('setContext', 'xslt-xpath.hasXSpecFiles', hasFiles);
		}
	}

	private updateDocument(document: vscode.TextDocument) {
		if (document.uri.scheme === 'file' && document.languageId === 'xspec') {
			this.setChildren(this.fileItem(document.uri), document.getText());
		}
	}

	private async updateFile(uri: vscode.Uri) {
		const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
		try {
			this.setChildren(this.fileItem(uri), open ? open.getText() : fs.readFileSync(uri.fsPath, 'utf8'));
		} catch {
			this.removeFile(uri);
		}
	}

	// the items for the scenarios and expectations in the file's text
	private setChildren(fileItem: vscode.TestItem, text: string) {
		const lineStarts = [0];
		for (let i = text.indexOf('\n'); i > -1; i = text.indexOf('\n', i + 1)) {
			lineStarts.push(i + 1);
		}
		const position = (offset: number) => {
			let line = lineStarts.length - 1;
			while (line > 0 && lineStarts[line] > offset) {
				line--;
			}
			return new vscode.Position(line, offset - lineStarts[line]);
		};
		const items = new Map<string, vscode.TestItem>();
		const create = (node: XSpecTestNode): vscode.TestItem => {
			const key = this.uniqueKey(items, XSpecTests.key(fileItem.uri!.fsPath, node.labelPath));
			const item = this.controller.createTestItem(`${fileItem.id}\u001f${key}`, node.label, fileItem.uri);
			item.range = new vscode.Range(position(node.start), position(Math.max(node.start, node.end)));
			item.tags = node.pending ? [new vscode.TestTag('pending')] : [];
			items.set(key, item);
			this.kinds.set(item, node.kind);
			node.children.forEach((child) => item.children.add(create(child)));
			return item;
		};
		fileItem.children.replace(XSpecTests.testTree(text).map(create));
		fileItem.canResolveChildren = false;
		this.itemsByFile.set(fileItem.uri!.fsPath, items);
	}

	// the key, with an occurrence number if it's already used, e.g. for two expectations with the same label
	private uniqueKey(used: Map<string, unknown>, key: string) {
		let unique = key;
		for (let n = 2; used.has(unique); n++) {
			unique = `${key}\u001f#${n}`;
		}
		return unique;
	}

	private async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken, debug: boolean, coverage = false) {
		const run = this.createRun?.(request) ?? this.controller.createTestRun(request);
		// the items to run, by file: undefined for the whole file
		const byFile = new Map<string, vscode.TestItem[] | undefined>();
		const requested: vscode.TestItem[] = [];
		if (request.include) {
			requested.push(...request.include);
		} else {
			await this.discoverFiles();
			this.controller.items.forEach((item) => requested.push(item));
		}
		for (const item of requested) {
			const file = item.uri!.fsPath;
			const isFile = item.id === item.uri!.toString();
			if (isFile) {
				byFile.set(file, undefined);
			} else if (!byFile.has(file) || byFile.get(file)) {
				byFile.set(file, [...(byFile.get(file) ?? []), item]);
			}
		}
		const outcomes: XSpecFileOutcome[] = [];
		this.problemsShown.clear();
		for (const [file, items] of byFile) {
			if (token.isCancellationRequested) {
				break;
			}
			const fileItem = this.fileItem(vscode.Uri.file(file));
			await this.updateFile(fileItem.uri!);
			// one scenario: the scenario of an expectation; otherwise the whole file
			const scenario = items?.length === 1 ? this.scenarioOf(items[0]) : undefined;
			try {
				outcomes.push(await this.runFile(run, fileItem, scenario, token, debug, coverage));
			} catch (error) {
				// not expected: reported, and the other files run
				const message = error instanceof Error ? error.message : String(error);
				run.appendOutput(`XSpec: ${vscode.workspace.asRelativePath(file)}: stopped - ${message}\r\n`);
				outcomes.push({ file, passed: 0, failed: 0, pending: 0, stopped: message });
			}
		}
		if (outcomes.length > 1) {
			run.appendOutput(XSpecTestController.summary(outcomes, token.isCancellationRequested ? byFile.size : undefined).replace(/\n/g, '\r\n'));
		}
		run.end();
	}

	// for a run of more than one file: the expectations passed, failed and pending, in all of them, and the files that
	// stopped, with why - and, for those stopped by XSpec 4 for tests written for XSpec before 1.0, the setting that runs
	// them as that did
	// - of those run, when the run's cancelled, of all the files requested
	public static summary(outcomes: XSpecFileOutcome[], requested?: number): string {
		const total = (key: 'passed' | 'failed' | 'pending') => outcomes.reduce((sum, outcome) => sum + outcome[key], 0);
		const stopped = outcomes.filter((outcome) => outcome.stopped !== undefined);
		const lines = ['', '─'.repeat(60), `XSpec: ${outcomes.length} files${requested !== undefined ? ` of ${requested} - the run was cancelled` : ''} - ${total('passed')} passed, ${total('failed')} failed, ${total('pending')} pending` +
			` - ${outcomes.length - stopped.length} ran to the end${stopped.length > 0 ? `, ${stopped.length} stopped:` : ''}`];
		// the files that stopped, by why: the most first, and each with a detail, e.g. the label of the x:expect
		const byReason = new Map<string, string[]>();
		for (const outcome of stopped) {
			const { reason, detail } = XSpecTestController.stoppedReason(outcome);
			const file = vscode.workspace.asRelativePath(outcome.file) + (detail ? ` - ${detail}` : '');
			byReason.set(reason, [...(byReason.get(reason) ?? []), file]);
		}
		[...byReason].sort((a, b) => b[1].length - a[1].length).forEach(([reason, files]) => {
			lines.push(`  ${reason}${files.length > 1 ? ` - ${files.length} files` : ''}:`, ...files.sort().map((file) => `    ${file}`));
		});
		const legacy = stopped.filter((outcome) => /(Boolean|Non-boolean) @test must( not)? be accompanied/.test(outcome.stopped!));
		if (legacy.length > 0 && !vscode.workspace.getConfiguration('XSLT.xspec').get<boolean>('legacyCompatibility', false)) {
			lines.push(`${legacy.length} of them stopped for tests written for XSpec before 1.0 - the XSLT.xspec.legacyCompatibility setting runs them as that did`);
		}
		return lines.join('\n') + '\n';
	}

	// why a file stopped, short - XSpec's messages for an x:expect, without its label, which is the detail, shortened
	private static stoppedReason(outcome: XSpecFileOutcome): { reason: string, detail?: string } {
		const expect = /^ERROR in x:expect \('(.*)'\): (.*)$/.exec(outcome.stopped ?? '');
		if (!expect) {
			return { reason: outcome.stopped ?? '', detail: outcome.stoppedDetail };
		}
		const label = expect[1].length > 60 ? expect[1].substring(0, 59) + '…' : expect[1];
		const reason = /^Boolean @test must not be accompanied/.test(expect[2]) ? 'x:expect with a boolean @test and @select, @as, @href or content' :
			/^Non-boolean @test must be accompanied/.test(expect[2]) ? 'x:expect with a @test that isn\'t boolean, and no @select, @as, @href or content' : `x:expect: ${expect[2]}`;
		return { reason, detail: `'${label}'` };
	}

	// the problems shown in the run, so each is shown once
	private readonly problemsShown = new Set<string>();

	private scenarioOf(item: vscode.TestItem): vscode.TestItem | undefined {
		return this.kinds.get(item) === 'expect' ? item.parent : item;
	}

	private keyOf(item: vscode.TestItem) {
		return item.id.substring(item.id.indexOf('\u001f') + 1);
	}

	private items(item: vscode.TestItem): vscode.TestItem[] {
		const all: vscode.TestItem[] = [item];
		item.children.forEach((child) => all.push(...this.items(child)));
		return all;
	}

	private async runFile(run: vscode.TestRun, fileItem: vscode.TestItem, scenario: vscode.TestItem | undefined, token: vscode.CancellationToken, debug: boolean, coverage = false): Promise<XSpecFileOutcome> {
		const xspecPath = fileItem.uri!.fsPath;
		const outcome: XSpecFileOutcome = { file: xspecPath, passed: 0, failed: 0, pending: 0 };
		// only the expectations are tests, as XSpec counts them: a scenario's state comes from those in it, so isn't
		// counted too - unless the run's of one without any
		const tests = this.items(scenario ?? fileItem).filter((item) => this.kinds.get(item) === 'expect');
		const items = tests.length > 0 ? tests : [scenario ?? fileItem];
		items.forEach((item) => run.started(item));
		// the file's tests couldn't be run: why, in each test's message - and in the output, the first error in Saxon's
		// output, which the XSpec output channel has all of
		const errored = (message: string) => {
			items.forEach((item) => run.errored(item, new vscode.TestMessage(message)));
			const lines = message.split('\n').map((line) => line.trim()).filter((line) => line !== '');
			// Saxon's error code and message, e.g. 'XTSE0165  I/O error ...', after its 'Error on line ...' - or XSpec's, e.g.
			// 'ERROR in x:expect (...): ...'
			const coded = lines.findIndex((line, index) => index > 0 && /^\w*:?\s*\b(XPST|XPTY|XPDY|XTSE|XTDE|XTTE|XTMM|FO[A-Z]{2}|SXXP|SXXF)\d{4}\b/.test(line) && !/XTMM9000/.test(line));
			outcome.stopped = coded > -1 ? lines[coded] : lines.find((line, index) => index > 0 && /ERROR|Error/.test(line)) ?? lines[0] ?? '';
			// the file of an I/O error, e.g. a module imported that isn't found, which Saxon gives on the next line
			const ioFile = coded > -1 ? /^file:(\S+?)\.?(\s|$)/.exec(lines[coded + 1] ?? '')?.[1] : undefined;
			if (ioFile) {
				outcome.stoppedDetail = path.basename(ioFile);
			}
			run.appendOutput(`XSpec: ${vscode.workspace.asRelativePath(xspecPath)}: stopped - ${outcome.stopped}\r\n`);
			return outcome;
		};
		const problem = XSpecRunner.problem(fileItem.uri);
		if (problem) {
			// once in a run of many files, e.g. that there's no Saxon jar
			if (!this.problemsShown.has(problem)) {
				this.problemsShown.add(problem);
				vscode.window.showErrorMessage(problem);
			}
			return errored(problem);
		}
		const channel = XSpecRunner.output();
		channel.appendLine(`XSpec: ${scenario ? `scenario '${scenario.label}' in ` : ''}${xspecPath}`);
		const files = XSpecRunner.files(xspecPath);
		const prepared = await XSpecRunner.prepare(xspecPath, files, token);
		if (!prepared.ok) {
			channel.show(true);
			return errored(`XSpec: the Schematron couldn't be prepared for testing - see the XSpec output.\n${prepared.output.trim()}`);
		}
		let compiled = await XSpecRunner.compile(xspecPath, files, token, undefined, prepared.source);
		// the scenario run on its own, with XSpec's force-focus
		let focusedId: string | undefined;
		if (compiled.ok && scenario) {
			// the scenario's ID, from the test runner compiled for all of them - then only it is compiled
			const ids = XSpecTests.scenarioIds(fs.readFileSync(files.compiled, 'utf8'));
			const key = this.keyOf(scenario);
			const occurrence = /\u001f#(\d+)$/.exec(key);
			const id = ids.get(occurrence ? key.substring(0, occurrence.index) : key)?.[occurrence ? Number(occurrence[1]) - 1 : 0];
			const focused = id ? await XSpecRunner.compile(xspecPath, files, token, id, prepared.source) : undefined;
			// XSpec can't always make a test runner for one scenario on its own - e.g. the variable of a scenario made
			// pending by the focus, using its $x:context, gives XPST0008 - so the whole file is run instead. When debugging,
			// the runner is checked first, as the debugger would report its errors
			const usable = focused?.ok && (!debug || (await XSpecRunner.check(xspecPath, files, token)).ok);
			if (focused && !usable) {
				compiled = await this.wholeFileInstead(run, scenario, xspecPath, files, prepared.source, token);
			} else if (focused) {
				focusedId = id;
			}
		}
		// the whole file, with a focused scenario - e.g. focus="debug" - that XSpec can't make a test runner for (see
		// above): when debugging, the runner is checked first, and its tests run without the focus if it fails
		const isFocusedFile = !scenario && XSpecTestController.hasFocus(xspecPath);
		if (compiled.ok && isFocusedFile && debug && !(await XSpecRunner.check(xspecPath, files, token)).ok) {
			compiled = await this.withoutFocus(run, xspecPath, files, prepared.source, token);
		}
		if (!compiled.ok) {
			channel.show(true);
			return errored(`XSpec: the tests couldn't be compiled - see the XSpec output.\n${compiled.output.trim()}`);
		}
		const runOnce = async () => {
			const resultTime = fs.existsSync(files.result) ? fs.statSync(files.result).mtimeMs : 0;
			const outcome = debug || coverage ? await this.debugRunner(xspecPath, files, scenario?.label, coverage ? (hits) => this.addCoverage(run, xspecPath, files, hits) : undefined) :
				await XSpecRunner.run(xspecPath, files, token);
			return { ran: outcome, hasResult: fs.existsSync(files.result) && fs.statSync(files.result).mtimeMs > resultTime };
		};
		let { ran, hasResult } = await runOnce();
		// not when debugging: the run may have ended at an error being debugged, or been stopped - and the runner has
		// been checked
		if ((!ran.ok || !hasResult) && focusedId && scenario && !debug && !token.isCancellationRequested) {
			compiled = await this.wholeFileInstead(run, scenario, xspecPath, files, prepared.source, token);
			// all the file's tests run, so all their outcomes are shown
			focusedId = undefined;
			({ ran, hasResult } = compiled.ok ? await runOnce() : { ran: compiled, hasResult: false });
		} else if ((!ran.ok || !hasResult) && isFocusedFile && !debug && !token.isCancellationRequested) {
			compiled = await this.withoutFocus(run, xspecPath, files, prepared.source, token);
			({ ran, hasResult } = compiled.ok ? await runOnce() : { ran: compiled, hasResult: false });
		}
		if (!ran.ok || !hasResult) {
			channel.show(true);
			return errored(`XSpec: the tests didn't run to the end - see the XSpec output.\n${ran.output.trim()}`);
		}
		const results = XSpecTests.parseResults(fs.readFileSync(files.result, 'utf8'));
		const report = await XSpecRunner.report(xspecPath, files, token);
		XSpecTests.useDiffs(results, files.diffs);
		// for one scenario: only its outcomes - the others are pending, as XSpec's force-focus makes them, but keep theirs
		this.applyResults(run, fileItem, results, focusedId ? scenario : undefined);
		// the expectations applied - of the scenario, for one run on its own
		const applied = results.filter((r) => r.kind === 'expect' && (!focusedId || !scenario || r.labelPath.join('\u001f').startsWith(this.keyOf(scenario).split('\u001f').slice(1).join('\u001f'))));
		outcome.passed = applied.filter((r) => r.status === 'passed').length;
		outcome.failed = applied.filter((r) => r.status === 'failed').length;
		outcome.pending = applied.filter((r) => r.status === 'pending').length;
		run.appendOutput(`XSpec: ${vscode.workspace.asRelativePath(xspecPath)}: ${outcome.passed} passed, ${outcome.failed} failed, ${outcome.pending} pending\r\n` +
			(report.ok ? `Report: ${files.html}\r\n` : ''));
		return outcome;
	}

	// the coverage of the modules the tests ran: the stylesheet tested and those it uses - not the test runner, or
	// XSpec's own modules. Each instruction's start tag, in a function or template, is a statement - not run, if it has
	// no hits - and each function and template a declaration
	private addCoverage(run: vscode.TestRun, xspecPath: string, files: XSpecFiles, hits: CoverageFiles) {
		const xspecHome = XSpecRunner.home(vscode.Uri.file(xspecPath));
		const isOwn = (file: string) => XSpecSourceMap.samePath(file, files.compiled) || (!!xspecHome && path.normalize(file).startsWith(path.normalize(xspecHome))) ||
			path.dirname(file) === path.dirname(files.compiled);
		// a module tested by more than one XSpec file in the run: the hits of each are added together, as a file's
		// coverage replaces what was added for it before
		const runHits = this.runCoverage.get(run) ?? {};
		this.runCoverage.set(run, runHits);
		for (const [file, fileHits] of Object.entries(hits)) {
			if (isOwn(file) || !fs.existsSync(file) || !/\.xslt?$/i.test(file)) {
				continue;
			}
			const before = runHits[file]?.hits ?? {};
			const merged = { ...before };
			Object.entries(fileHits.hits).forEach(([line, count]) => merged[line] = (merged[line] ?? 0) + count);
			runHits[file] = { hits: merged, executable: fileHits.executable };
			const { hits: lines, executable } = runHits[file];
			const text = fs.readFileSync(file, 'utf8');
			const lineOf = (offset: number) => text.substring(0, offset).split('\n').length;
			const hitsAt = (line: number) => lines[String(line)] ?? 0;
			// the hits of each statement, by its first line, and its last line
			const statements = new Map<number, { hits: number, last: number }>();
			const declarations: vscode.DeclarationCoverage[] = [];
			for (const declaration of parseXml(text)?.children ?? []) {
				const kind = localName(declaration.name);
				if (kind !== 'template' && kind !== 'function') {
					continue;
				}
				const first = lineOf(declaration.start);
				const name = declaration.attributes.get('name') ?? `match="${declaration.attributes.get('match') ?? ''}"`;
				const range = new vscode.Range(first - 1, 0, lineOf(declaration.end) - 1, 0);
				const body = descendants(declaration).map((element) => lineOf(element.start));
				// a declaration is run when its start, or anything in it, is
				const declarationHits = Math.max(hitsAt(first), ...body.map(hitsAt), 0);
				declarations.push(new vscode.DeclarationCoverage(`${kind === 'function' ? 'function' : 'template'} ${name}`, declarationHits, range));
			}
			// the instructions that can be run, as the debugger finds them - not, e.g., a function's xsl:param, which is
			// shown as not executable - with their hits, if any. All the lines of a multi-line start tag are shown with it,
			// but not the later lines of a multi-line expression: its parts, e.g. an else branch, may not have been run
			executable.forEach(([line, last]) => statements.set(line, { hits: hitsAt(line), last }));
			// lines arrived at that aren't start tags, e.g. those of a multi-line XPath expression
			Object.entries(lines).forEach(([line, count]) => {
				const statement = statements.get(Number(line));
				statements.set(Number(line), { hits: Math.max(statement?.hits ?? 0, count), last: statement?.last ?? Number(line) });
			});
			const details: vscode.FileCoverageDetail[] = [...statements].sort((a, b) => a[0] - b[0])
				.map(([line, { hits, last }]) => new vscode.StatementCoverage(hits, last === line ? new vscode.Position(line - 1, 0) :
					new vscode.Range(line - 1, 0, last - 1, text.split('\n')[last - 1]?.length ?? 0)));
			details.push(...declarations);
			const uri = vscode.Uri.file(file);
			this.coverageDetails.set(uri.toString(), details);
			run.addCoverage(vscode.FileCoverage.fromDetails(uri, details));
		}
	}

	// the test runner for the whole file, when the scenario's on its own couldn't be compiled or run - without the
	// focus of any scenario in the file (see withoutFocus), which may be what XSpec couldn't run
	private wholeFileInstead(run: vscode.TestRun, scenario: vscode.TestItem, xspecPath: string, files: XSpecFiles, source: string, token: vscode.CancellationToken) {
		const note = `XSpec: the scenario '${scenario.label}' couldn't be run on its own, with XSpec's force-focus - all the file's tests are run instead`;
		XSpecRunner.output().appendLine(note);
		run.appendOutput(note + '\r\n');
		return XSpecRunner.compile(xspecPath, files, token, XSpecTestController.noFocus, source);
	}

	// XSpec's force-focus with no scenario's id: the focus attributes of the file's scenarios are removed, so all its tests run
	private static readonly noFocus = '#none';

	// the test runner for the whole file without its scenarios' focus attributes, when it couldn't be compiled or run with them
	private withoutFocus(run: vscode.TestRun, xspecPath: string, files: XSpecFiles, source: string, token: vscode.CancellationToken) {
		const note = 'XSpec: the file\'s focused scenarios couldn\'t be run - e.g. XSpec gives XPST0008 for an outer scenario\'s x:variable that ' +
			'uses $x:context - so all its tests are run instead, without the focus';
		XSpecRunner.output().appendLine(note);
		run.appendOutput(note + '\r\n');
		return XSpecRunner.compile(xspecPath, files, token, XSpecTestController.noFocus, source);
	}

	// true if a scenario in the XSpec file has a focus attribute
	private static hasFocus(xspecPath: string) {
		try {
			return /<([\w.-]+:)?scenario\b[^>]*\sfocus\s*=/.test(fs.readFileSync(xspecPath, 'utf8'));
		} catch {
			return false;
		}
	}

	// the test runner, run by the XSLT debugger - its breakpoints in the stylesheet under test, which the runner
	// imports, are where it stops
	// - for coverage, without debugging: the debugger counts the hits of each line, sent when the run ends
	private debugRunner(xspecPath: string, files: XSpecFiles, label: string | undefined, onCoverage?: (hits: CoverageFiles) => void): Promise<{ ok: boolean, output: string }> {
		return new Promise((resolve) => {
			const coverageEvents = onCoverage ? vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
				if (event.event === 'xsltCoverage' && event.session.name === name) {
					onCoverage(event.body?.files ?? {});
				}
			}) : undefined;
			const name = `XSpec: ${label ?? path.basename(xspecPath)}`;
			let session: vscode.DebugSession | undefined;
			const started = vscode.debug.onDidStartDebugSession((s) => {
				if (s.name === name) {
					session = s;
				}
			});
			const terminated = vscode.debug.onDidTerminateDebugSession((s) => {
				if (s === session) {
					started.dispose();
					terminated.dispose();
					coverageEvents?.dispose();
					resolve({ ok: true, output: '' });
				}
			});
			const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(xspecPath));
			vscode.debug.startDebugging(folder, { type: 'xslt-saxon', request: 'launch', name, xsltFile: files.compiled, initialTemplate: XSpecRunner.mainTemplate, resultPath: files.result, xspecFile: xspecPath,
				// Saxon's syntax extensions, as for a run (see XSpecRunner)
				allowSyntaxExtensions40: XSpecRunner.syntaxExtensionsValue(vscode.Uri.file(xspecPath)),
				...(onCoverage ? { coverage: true } : {}) }, onCoverage ? { noDebug: true } : undefined).then((ok) => {
				if (!ok) {
					started.dispose();
					terminated.dispose();
					resolve({ ok: false, output: 'XSpec: the debugger didn\'t start' });
				}
			});
		});
	}

	// the outcomes, for the items with their labels - and, e.g. for the expectations of a shared scenario used with
	// x:like, or of an imported XSpec file, new items
	private applyResults(run: vscode.TestRun, runFileItem: vscode.TestItem, results: XSpecResult[], within?: vscode.TestItem) {
		const seen = new Map<string, number>();
		for (const result of results) {
			const file = result.file ?? runFileItem.uri!.fsPath;
			const baseKey = XSpecTests.key(file, result.labelPath);
			const n = (seen.get(baseKey) ?? 0) + 1;
			seen.set(baseKey, n);
			const key = n === 1 ? baseKey : `${baseKey}\u001f#${n}`;
			const item = this.itemFor(file, key, result);
			// a scenario's state is that of the expectations in it
			if (!item || (within && !this.isWithin(item, within)) || result.kind === 'scenario') {
				continue;
			}
			if (result.status === 'passed') {
				run.passed(item);
			} else if (result.status === 'pending') {
				run.skipped(item);
			} else {
				const message = result.expected !== undefined && result.actual !== undefined ?
					vscode.TestMessage.diff(`Failed: ${result.labelPath[result.labelPath.length - 1]}`, result.expected, result.actual) :
					new vscode.TestMessage(`Failed: ${result.labelPath[result.labelPath.length - 1]}`);
				if (item.uri && item.range) {
					message.location = new vscode.Location(item.uri, item.range);
				}
				run.failed(item, message);
			}
		}
	}

	// by ID: the tree is made again from the file before a run, so the item run may be an earlier one
	private isWithin(item: vscode.TestItem, ancestor: vscode.TestItem) {
		for (let i: vscode.TestItem | undefined = item; i; i = i.parent) {
			if (i.id === ancestor.id) {
				return true;
			}
		}
		return false;
	}

	private itemFor(file: string, key: string, result: XSpecResult): vscode.TestItem | undefined {
		if (!this.itemsByFile.has(file) && fs.existsSync(file)) {
			const fileItem = this.fileItem(vscode.Uri.file(file));
			this.setChildren(fileItem, fs.readFileSync(file, 'utf8'));
		}
		const items = this.itemsByFile.get(file);
		if (!items) {
			return undefined;
		}
		let item = items.get(key);
		if (!item && result.labelPath.length > 1) {
			// e.g. from a shared scenario: under its scenario, if that's known
			const parent = items.get(XSpecTests.key(file, result.labelPath.slice(0, -1)));
			if (parent) {
				item = this.controller.createTestItem(`${parent.uri!.toString()}\u001f${key}`, result.labelPath[result.labelPath.length - 1], parent.uri);
				parent.children.add(item);
				items.set(key, item);
				this.kinds.set(item, result.kind);
			}
		}
		return item;
	}
}
