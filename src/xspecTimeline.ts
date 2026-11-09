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

// the history of the Test Explorer's XSpec runs, in the Timeline view: one item for each run, however many XSpec files
// it ran, in the workspace timeline - and in an XSpec file's timeline, for the runs that included it, with its counts
// - the Timeline API is final in VS Code 1.145: declared here, and used only when there, so 1.138 is still enough

// the part of the Timeline API used (see vscode.d.ts in 1.145)
interface TimelineItem {
	timestamp: number;
	label?: string;
	id?: string;
	iconPath?: vscode.ThemeIcon;
	description?: string;
	tooltip?: string | vscode.MarkdownString;
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
		XSpecTimeline.instance = timeline;
		context.subscriptions.push(timeline.changed, timeline.workspaceChanged,
			api.registerWorkspaceTimelineProvider(XSpecTimeline.id, XSpecTimeline.label, {
				onDidChangeWorkspaceTimeline: timeline.workspaceChanged.event,
				provideWorkspaceTimeline: (options) => timeline.page(timeline.runs().map((run) => timeline.runItem(run)), options)
			}),
			api.registerTimelineProvider(XSpecTimeline.id, XSpecTimeline.label, 'file', {
				onDidChangeTimeline: timeline.changed.event,
				provideTimeline: (uri, options) => {
					if (!uri.fsPath.endsWith('.xspec')) {
						return undefined;
					}
					const items = timeline.runs().flatMap((run) => {
						const file = run.files.find((f) => f.file === uri.fsPath);
						return file ? [timeline.fileItem(run, file)] : [];
					});
					return timeline.page(items, options);
				}
			}));
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
			timeline.changed.fire(run.files.map((f) => vscode.Uri.file(f.file)));
		});
	}

	// for testing: the runs recorded, newest first - undefined when the Timeline API isn't there
	public static get history(): XSpecRunRecord[] | undefined {
		return XSpecTimeline.instance?.runs();
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

	private fileItem(run: XSpecRunRecord, file: XSpecRunFile): TimelineItem {
		const item = new this.itemClass(`XSpec ${run.kind.toLowerCase()}: ` + (file.stopped !== undefined ? 'stopped' : XSpecTimeline.counts(file)), run.start);
		item.id = String(run.start);
		item.iconPath = XSpecTimeline.icon(file.failed > 0, file.stopped !== undefined);
		const testTime = XSpecTimeline.testTimeText(file);
		item.description = [...(testTime ? [testTime] : []), ...(run.files.length > 1 ? [`in a run of ${run.files.length} files`] : [])].join(' · ');
		const failed = XSpecTimeline.failedLines(file);
		item.tooltip = `XSpec ${run.kind} - ${new Date(run.start).toLocaleString()}${file.stopped !== undefined ? `\nstopped - ${XSpecTimeline.short(file.stopped)}` : ''}` +
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
