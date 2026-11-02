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
		}
		return item;
	}

	private removeFile(uri: vscode.Uri) {
		this.controller.items.delete(uri.toString());
		this.itemsByFile.delete(uri.fsPath);
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
		for (const [file, items] of byFile) {
			if (token.isCancellationRequested) {
				break;
			}
			const fileItem = this.fileItem(vscode.Uri.file(file));
			await this.updateFile(fileItem.uri!);
			// one scenario: the scenario of an expectation; otherwise the whole file
			const scenario = items?.length === 1 ? this.scenarioOf(items[0]) : undefined;
			await this.runFile(run, fileItem, scenario, token, debug, coverage);
		}
		run.end();
	}

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

	private async runFile(run: vscode.TestRun, fileItem: vscode.TestItem, scenario: vscode.TestItem | undefined, token: vscode.CancellationToken, debug: boolean, coverage = false) {
		const xspecPath = fileItem.uri!.fsPath;
		// only the expectations are tests, as XSpec counts them: a scenario's state comes from those in it, so isn't
		// counted too - unless the run's of one without any
		const tests = this.items(scenario ?? fileItem).filter((item) => this.kinds.get(item) === 'expect');
		const items = tests.length > 0 ? tests : [scenario ?? fileItem];
		items.forEach((item) => run.started(item));
		const errored = (message: string) => {
			items.forEach((item) => run.errored(item, new vscode.TestMessage(message)));
			run.appendOutput(message.replace(/\n/g, '\r\n') + '\r\n');
		};
		const problem = XSpecRunner.problem(fileItem.uri);
		if (problem) {
			errored(problem);
			vscode.window.showErrorMessage(problem);
			return;
		}
		const channel = XSpecRunner.output();
		channel.appendLine(`XSpec: ${scenario ? `scenario '${scenario.label}' in ` : ''}${xspecPath}`);
		const files = XSpecRunner.files(xspecPath);
		const prepared = await XSpecRunner.prepare(xspecPath, files, token);
		if (!prepared.ok) {
			errored(`XSpec: the Schematron couldn't be prepared for testing - see the XSpec output.\n${prepared.output.trim()}`);
			channel.show(true);
			return;
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
		if (!compiled.ok) {
			errored(`XSpec: the tests couldn't be compiled - see the XSpec output.\n${compiled.output.trim()}`);
			channel.show(true);
			return;
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
		}
		if (!ran.ok || !hasResult) {
			errored(`XSpec: the tests didn't run to the end - see the XSpec output.\n${ran.output.trim()}`);
			channel.show(true);
			return;
		}
		const results = XSpecTests.parseResults(fs.readFileSync(files.result, 'utf8'));
		const report = await XSpecRunner.report(xspecPath, files, token);
		XSpecTests.useDiffs(results, files.diffs);
		// for one scenario: only its outcomes - the others are pending, as XSpec's force-focus makes them, but keep theirs
		this.applyResults(run, fileItem, results, focusedId ? scenario : undefined);
		run.appendOutput(`XSpec: ${results.filter((r) => r.kind === 'expect' && r.status === 'passed').length} passed, ${results.filter((r) => r.kind === 'expect' && r.status === 'failed').length} failed, ${results.filter((r) => r.kind === 'expect' && r.status === 'pending').length} pending\r\n` +
			(report.ok ? `Report: ${files.html}\r\n` : ''));
	}

	// the coverage of the modules the tests ran: the stylesheet tested and those it uses - not the test runner, or
	// XSpec's own modules. Each instruction's start tag, in a function or template, is a statement - not run, if it has
	// no hits - and each function and template a declaration
	private addCoverage(run: vscode.TestRun, xspecPath: string, files: XSpecFiles, hits: CoverageFiles) {
		const xspecHome = XSpecRunner.home(vscode.Uri.file(xspecPath));
		const isOwn = (file: string) => XSpecSourceMap.samePath(file, files.compiled) || (!!xspecHome && path.normalize(file).startsWith(path.normalize(xspecHome))) ||
			path.dirname(file) === path.dirname(files.compiled);
		for (const [file, { hits: lines, executable }] of Object.entries(hits)) {
			if (isOwn(file) || !fs.existsSync(file) || !/\.xslt?$/i.test(file)) {
				continue;
			}
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

	// the test runner for the whole file, when the scenario's on its own couldn't be compiled or run
	private wholeFileInstead(run: vscode.TestRun, scenario: vscode.TestItem, xspecPath: string, files: XSpecFiles, source: string, token: vscode.CancellationToken) {
		const note = `XSpec: the scenario '${scenario.label}' couldn't be run on its own, with XSpec's force-focus - all the file's tests are run instead`;
		XSpecRunner.output().appendLine(note);
		run.appendOutput(note + '\r\n');
		return XSpecRunner.compile(xspecPath, files, token, undefined, source);
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
