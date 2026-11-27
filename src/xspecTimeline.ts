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

// the history of the Test Explorer's XSpec runs, in the Timeline view: one item for each run, however many XSpec files
// it ran, in the workspace timeline - and in an XSpec file's timeline, for the runs that included it, with its counts -
// and in the timeline of the stylesheet or Schematron an XSpec file tests, with that XSpec file's counts
// - the Timeline API is final in VS Code 1.145: declared here, and used only when there, so 1.138 is still enough

// the part of the Timeline API used (see vscode.d.ts in 1.145)
interface TimelineItem {
	timestamp: number;
	label?: string;
	id?: string;
	iconPath?: vscode.ThemeIcon;
	description?: string;
	tooltip?: string | vscode.MarkdownString;
	contextValue?: string;
}
interface TimelineOptions { readonly cursor?: string; readonly limit?: number }
interface Timeline { readonly items: readonly TimelineItem[]; readonly cursor?: string }
interface TimelineApi {
	registerTimelineProvider(id: string, label: string, scheme: string | readonly string[], provider: {
		readonly onDidChangeTimeline?: vscode.Event<vscode.Uri | vscode.Uri[] | undefined>;
		provideTimeline(uri: vscode.Uri, options: TimelineOptions, token: vscode.CancellationToken): vscode.ProviderResult<Timeline>;
	}): vscode.Disposable;
	registerWorkspaceTimelineProvider(id: string, label: string, provider: {
		readonly onDidChangeWorkspaceTimeline?: vscode.Event<void>;
		provideWorkspaceTimeline(options: TimelineOptions, token: vscode.CancellationToken): vscode.ProviderResult<Timeline>;
	}): vscode.Disposable;
}
type TimelineItemClass = new (label: string, timestamp: number) => TimelineItem;

// the outcome of an XSpec file in a run
export interface XSpecRunFile {
	file: string;
	passed: number;
	failed: number;
	pending: number;
	stopped?: string;
	// the label paths of the expectations that failed - the first maxFailedLabels
	failedLabels?: string[];
	// the milliseconds the tests took to run - not starting Java, compiling or reporting - with XSpec's measure-time
	// (Saxon-PE/EE, and not when debugging)
	testTime?: number;
	// the stylesheet or Schematron the XSpec file tested - its path, when the run was recorded
	tested?: string;
}

// a run, as kept in the workspace state
export interface XSpecRunRecord {
	start: number;
	end: number;
	kind: 'Run' | 'Debug' | 'Coverage';
	cancelled: boolean;
	files: XSpecRunFile[];
}

export class XSpecTimeline {
	private static readonly id = 'xspec-runs';
	private static readonly label = 'XSpec Runs';
	private static readonly stateKey = 'xspec.runHistory';
	private static readonly maxRuns = 100;
	public static readonly maxFailedLabels = 10;
	private static instance: XSpecTimeline | undefined;
	private readonly changed = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	private readonly workspaceChanged = new vscode.EventEmitter<void>();

	private constructor(private readonly state: vscode.Memento, private readonly itemClass: TimelineItemClass) { }

	// registers the providers when the Timeline API is there
	public static register(context: vscode.ExtensionContext) {
		const api = vscode.workspace as unknown as Partial<TimelineApi>;
		const itemClass = (vscode as unknown as { TimelineItem?: TimelineItemClass }).TimelineItem;
		if (typeof api.registerTimelineProvider !== 'function' || typeof api.registerWorkspaceTimelineProvider !== 'function' || !itemClass) {
			return;
		}
		const timeline = new XSpecTimeline(context.workspaceState, itemClass);
		const providers: vscode.Disposable[] = [];
		try {
			// before VS Code 1.145 the API is proposed: the functions are there but throw, as the proposal isn't enabled
			providers.push(api.registerWorkspaceTimelineProvider(XSpecTimeline.id, XSpecTimeline.label, {
				onDidChangeWorkspaceTimeline: timeline.workspaceChanged.event,
				provideWorkspaceTimeline: (options) => timeline.page(timeline.runs().map((run) => timeline.runItem(run)), options)
			}));
			providers.push(api.registerTimelineProvider(XSpecTimeline.id, XSpecTimeline.label, 'file', {
				onDidChangeTimeline: timeline.changed.event,
				// an empty timeline, not undefined, for a file with no runs: in VS Code 1.145, when the last provider to
				// answer returns undefined, the Timeline view can keep showing 'Loading...'
				provideTimeline: (uri, options) => timeline.page(timeline.items(uri), options)
			}));
		} catch {
			providers.forEach((p) => p.dispose());
			timeline.changed.dispose();
			timeline.workspaceChanged.dispose();
			return;
		}
		XSpecTimeline.instance = timeline;
		context.subscriptions.push(timeline.changed, timeline.workspaceChanged, ...providers);
	}

	// records a run - nothing when the API isn't there, or no file ran
	public static record(run: XSpecRunRecord) {
		const timeline = XSpecTimeline.instance;
		if (!timeline || run.files.length === 0) {
			return;
		}
		const runs = [run, ...timeline.runs()].slice(0, XSpecTimeline.maxRuns);
		timeline.state.update(XSpecTimeline.stateKey, runs).then(() => {
			timeline.workspaceChanged.fire();
			timeline.changed.fire(XSpecTimeline.uris(run.files));
		});
	}

	// for testing: the runs recorded, newest first - undefined when the Timeline API isn't there
	public static get history(): XSpecRunRecord[] | undefined {
		return XSpecTimeline.instance?.runs();
	}

	// removes the XSpec file's outcomes from the runs - for a stylesheet or Schematron, those of the XSpec files that
	// tested it - or with no file, all the runs. A run that had only those outcomes is removed; one with others is kept
	// for them. The number of outcomes, or runs, removed
	public static async clear(file?: vscode.Uri): Promise<number> {
		const fsPath = file?.fsPath;
		return XSpecTimeline.remove(() => true, fsPath === undefined ? undefined : (f) => f.file === fsPath || f.tested === fsPath);
	}

	// removes one entry: in the workspace timeline, a run - and in an XSpec file's, the file's outcome in the run - and
	// in a tested file's, the outcome of the XSpec file in the entry's id ('start|xspec path'), from every timeline
	public static async deleteEntry(id: string, file?: vscode.Uri): Promise<number> {
		const separator = id.indexOf('|');
		const start = separator < 0 ? id : id.substring(0, separator);
		const xspec = separator < 0 ? file?.fsPath : id.substring(separator + 1);
		return XSpecTimeline.remove((run) => String(run.start) === start, xspec === undefined ? undefined : (f) => f.file === xspec);
	}

	// removes the runs chosen - or with an outcome test, the outcomes in them that pass it
	private static async remove(removing: (run: XSpecRunRecord) => boolean, outcome?: (f: XSpecRunFile) => boolean): Promise<number> {
		const timeline = XSpecTimeline.instance;
		if (!timeline) {
			return 0;
		}
		let count = 0;
		const changedFiles: XSpecRunFile[] = [];
		const runs = timeline.runs().flatMap((run) => {
			if (!removing(run)) {
				return [run];
			}
			const files = run.files.filter((f) => outcome !== undefined && !outcome(f));
			if (files.length === run.files.length) {
				return [run];
			}
			count++;
			changedFiles.push(...run.files.filter((f) => !files.includes(f)));
			return files.length > 0 ? [{ ...run, files }] : [];
		});
		if (count === 0) {
			return 0;
		}
		await timeline.state.update(XSpecTimeline.stateKey, runs);
		timeline.workspaceChanged.fire();
		timeline.changed.fire(XSpecTimeline.uris(changedFiles));
		return count;
	}

	// the files whose timelines show the outcomes: the XSpec files, and those they tested
	private static uris(files: XSpecRunFile[]): vscode.Uri[] {
		const paths = new Set(files.flatMap((f) => [f.file, ...(f.tested ? [f.tested] : [])]));
		return [...paths].map((p) => vscode.Uri.file(p));
	}

	// for testing: a file's timeline items - undefined when the Timeline API isn't there
	public static itemsFor(uri: vscode.Uri): TimelineItem[] | undefined {
		return XSpecTimeline.instance?.items(uri);
	}

	// a file's items, newest first
	private items(uri: vscode.Uri): TimelineItem[] {
		return uri.fsPath.endsWith('.xspec') ?
			// an XSpec file's: its outcome in each run
			this.runs().flatMap((run) => {
				const file = run.files.find((f) => f.file === uri.fsPath);
				return file ? [this.fileItem(run, file)] : [];
			}) :
			// a stylesheet's or Schematron's: the outcome of each XSpec file that tested it, in each run
			this.runs().flatMap((run) => run.files.filter((f) => f.tested === uri.fsPath).map((f) => this.fileItem(run, f, true)));
	}

	// newest first
	private runs(): XSpecRunRecord[] {
		return this.state.get<XSpecRunRecord[]>(XSpecTimeline.stateKey, []);
	}

	// the items after the cursor - an index - up to the limit
	private page(items: TimelineItem[], options: TimelineOptions): Timeline {
		const from = options.cursor ? Number(options.cursor) : 0;
		const to = options.limit !== undefined ? from + options.limit : items.length;
		return { items: items.slice(from, to), cursor: to < items.length ? String(to) : undefined };
	}

	private static counts(c: { passed: number, failed: number, pending: number }) {
		return [`${c.passed} passed`, ...(c.failed > 0 ? [`${c.failed} failed`] : []), ...(c.pending > 0 ? [`${c.pending} pending`] : [])].join(', ');
	}

	private static icon(failed: boolean, stopped: boolean) {
		return stopped ? new vscode.ThemeIcon('testing-error-icon', new vscode.ThemeColor('testing.iconErrored')) :
			failed ? new vscode.ThemeIcon('testing-failed-icon', new vscode.ThemeColor('testing.iconFailed')) :
				new vscode.ThemeIcon('testing-passed-icon', new vscode.ThemeColor('testing.iconPassed'));
	}

	private static seconds(run: XSpecRunRecord) {
		return `${((run.end - run.start) / 1000).toFixed(1)}s`;
	}

	// e.g. 'tests 36.7 ms', or 'tests 2.41s' - the time the file's tests took to run, if it's known
	public static testTimeText(file: XSpecRunFile): string | undefined {
		const t = file.testTime;
		if (t === undefined) {
			return undefined;
		}
		return 'tests ' + (t >= 1000 ? `${(t / 1000).toFixed(2)}s` : t >= 10 ? `${t.toFixed(1)} ms` : `${t.toFixed(2)} ms`);
	}

	private runItem(run: XSpecRunRecord): TimelineItem {
		const total = (key: 'passed' | 'failed' | 'pending') => run.files.reduce((sum, f) => sum + f[key], 0);
		const totals = { passed: total('passed'), failed: total('failed'), pending: total('pending') };
		const stopped = run.files.filter((f) => f.stopped !== undefined);
		const item = new this.itemClass(`XSpec ${run.kind.toLowerCase()}: ` + XSpecTimeline.counts(totals) + (stopped.length > 0 ? `, ${stopped.length} stopped` : ''), run.start);
		item.id = String(run.start);
		item.contextValue = 'xspecRun';
		item.iconPath = XSpecTimeline.icon(totals.failed > 0, stopped.length > 0 || run.cancelled);
		const files = run.files.length === 1 ? vscode.workspace.asRelativePath(run.files[0].file) : `${run.files.length} files`;
		item.description = [files, XSpecTimeline.seconds(run), ...(run.cancelled ? ['cancelled'] : [])].join(' · ');
		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**XSpec ${run.kind}** - ${new Date(run.start).toLocaleString()} - ${XSpecTimeline.seconds(run)}${run.cancelled ? ' - cancelled' : ''}\n\n`);
		for (const f of run.files) {
			const testTime = XSpecTimeline.testTimeText(f);
			tooltip.appendMarkdown(`- `).appendText(`${vscode.workspace.asRelativePath(f.file)}: ${f.stopped !== undefined ? `stopped - ${XSpecTimeline.short(f.stopped)}` : XSpecTimeline.counts(f)}${testTime ? ` - ${testTime}` : ''}`).appendMarkdown('\n');
			XSpecTimeline.failedLines(f).forEach((line) => tooltip.appendMarkdown('    - ').appendText(line).appendMarkdown('\n'));
		}
		item.tooltip = tooltip;
		return item;
	}

	// the XSpec file's outcome in a run - in the timeline of the file it tested, named, as more than one may test it
	private fileItem(run: XSpecRunRecord, file: XSpecRunFile, inTested = false): TimelineItem {
		const item = new this.itemClass(`XSpec ${run.kind.toLowerCase()}: ` + (file.stopped !== undefined ? 'stopped' : XSpecTimeline.counts(file)), run.start);
		item.id = inTested ? `${run.start}|${file.file}` : String(run.start);
		item.contextValue = 'xspecRunFile';
		item.iconPath = XSpecTimeline.icon(file.failed > 0, file.stopped !== undefined);
		const testTime = XSpecTimeline.testTimeText(file);
		item.description = [...(inTested ? [path.basename(file.file)] : []), ...(testTime ? [testTime] : []), ...(run.files.length > 1 ? [`in a run of ${run.files.length} files`] : [])].join(' · ');
		const failed = XSpecTimeline.failedLines(file);
		item.tooltip = `XSpec ${run.kind}${inTested ? ` of ${vscode.workspace.asRelativePath(file.file)}` : ''} - ${new Date(run.start).toLocaleString()}${file.stopped !== undefined ? `\nstopped - ${XSpecTimeline.short(file.stopped)}` : ''}` +
			(testTime ? `\n${testTime.replace(/^tests/, 'The tests took')} - not starting Java, compiling or reporting` : '') +
			(failed.length > 0 ? `\n\nFailed:\n${failed.map((line) => `  ${line}`).join('\n')}` : '');
		return item;
	}

	// the expectations that failed, as their label paths - and how many more there were
	private static failedLines(file: XSpecRunFile): string[] {
		const labels = file.failedLabels ?? [];
		return [...labels, ...(file.failed > labels.length && labels.length > 0 ? [`and ${file.failed - labels.length} more`] : [])];
	}

	private static short(message: string) {
		const line = message.split('\n')[0];
		return line.length > 120 ? line.substring(0, 119) + '…' : line;
	}
}
