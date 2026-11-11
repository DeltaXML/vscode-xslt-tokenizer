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
import { XsltProfile } from './xsltProfile';
import { ProfileRun, XsltProfileView } from './xsltProfileView';

// the profiles of a stylesheet, in its Timeline view - clicking one shows it in the Profile view again. Each profile is
// kept as a JSON file in the workspace's storage folder, with a small index of them in the workspace state: the last
// maxPerStylesheet for each stylesheet. The Timeline API is final in VS Code 1.145: declared here (as in XSpecTimeline),
// and used only when there, so 1.138 is still enough - without it, profiles aren't kept

// the part of the Timeline API used (see vscode.d.ts in 1.145)
interface TimelineItem {
	timestamp: number;
	label?: string;
	id?: string;
	iconPath?: vscode.ThemeIcon;
	description?: string;
	tooltip?: string | vscode.MarkdownString;
	command?: vscode.Command;
	contextValue?: string;
}
interface TimelineOptions { readonly cursor?: string; readonly limit?: number }
interface Timeline { readonly items: readonly TimelineItem[]; readonly cursor?: string }
interface TimelineApi {
	registerTimelineProvider(id: string, label: string, scheme: string | readonly string[], provider: {
		readonly onDidChangeTimeline?: vscode.Event<vscode.Uri | vscode.Uri[] | undefined>;
		provideTimeline(uri: vscode.Uri, options: TimelineOptions, token: vscode.CancellationToken): vscode.ProviderResult<Timeline>;
	}): vscode.Disposable;
}
type TimelineItemClass = new (label: string, timestamp: number) => TimelineItem;

// a kept profile, as the index has it - its file has the whole ProfileRun
interface ProfileRecord {
	// the time it was profiled, which names its file too
	id: number;
	// the stylesheet's fsPath
	stylesheet: string;
	processor: string;
	sourceSummary: string;
	runs: number;
	requestedRuns: number;
	total: number;
	netTotal: number;
	// the rows with the most net time: label and net, for the tooltip
	top: { label: string; net: number }[];
}

export class XsltProfileTimeline {
	private static readonly id = 'xslt-profiles';
	private static readonly label = 'XSLT Profiles';
	private static readonly stateKey = 'xslt.profileHistory';
	private static readonly maxPerStylesheet = 20;
	private static readonly maxAll = 200;
	private static readonly openCommand = 'xslt-xpath.openProfile';
	private static instance: XsltProfileTimeline | undefined;
	private readonly changed = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();

	private constructor(private readonly state: vscode.Memento, private readonly folder: vscode.Uri, private readonly itemClass: TimelineItemClass) { }

	// registers the provider when the Timeline API is there, and there's a workspace to keep profiles for
	public static register(context: vscode.ExtensionContext) {
		const api = vscode.workspace as unknown as Partial<TimelineApi>;
		const itemClass = (vscode as unknown as { TimelineItem?: TimelineItemClass }).TimelineItem;
		if (typeof api.registerTimelineProvider !== 'function' || !itemClass || !context.storageUri) {
			return;
		}
		const timeline = new XsltProfileTimeline(context.workspaceState, vscode.Uri.joinPath(context.storageUri, 'profiles'), itemClass);
		XsltProfileTimeline.instance = timeline;
		context.subscriptions.push(timeline.changed,
			vscode.commands.registerCommand(XsltProfileTimeline.openCommand, (id: number) => timeline.open(id)),
			api.registerTimelineProvider(XsltProfileTimeline.id, XsltProfileTimeline.label, 'file', {
				onDidChangeTimeline: timeline.changed.event,
				provideTimeline: (uri, options) => {
					// an empty timeline, not undefined: in VS Code 1.145, when the last provider to answer returns
					// undefined, the Timeline view can keep showing 'Loading...'
					if (!/\.xslt?$/i.test(uri.fsPath)) {
						return { items: [] };
					}
					const items = timeline.records().filter((r) => r.stylesheet === uri.fsPath).map((r) => timeline.item(r));
					return timeline.page(items, options);
				}
			}));
	}

	// keeps a profile - nothing when the API isn't there. Older ones beyond the limits are removed, with their files
	public static async record(run: ProfileRun) {
		const timeline = XsltProfileTimeline.instance;
		if (!timeline) {
			return;
		}
		const id = run.time.getTime();
		const record: ProfileRecord = {
			id, stylesheet: run.stylesheet.fsPath, processor: run.processor, sourceSummary: run.sourceSummary,
			runs: run.runs, requestedRuns: run.requestedRuns, total: run.total, netTotal: run.netTotal,
			top: run.rows.slice().sort((a, b) => b.net - a.net).slice(0, 3).map((r) => ({ label: `${r.kind} ${r.label}`, net: r.net }))
		};
		try {
			await vscode.workspace.fs.createDirectory(timeline.folder);
			await vscode.workspace.fs.writeFile(timeline.file(id), Buffer.from(JSON.stringify({ ...run, stylesheet: run.stylesheet.toString(), time: id }), 'utf8'));
		} catch (e) {
			console.warn('Profile Stylesheet: could not keep the profile for the Timeline view', e);
			return;
		}
		const { kept, removed } = XsltProfile.prune([record, ...timeline.records()], XsltProfileTimeline.maxPerStylesheet, XsltProfileTimeline.maxAll);
		await timeline.state.update(XsltProfileTimeline.stateKey, kept);
		for (const old of removed) {
			await vscode.workspace.fs.delete(timeline.file(old.id)).then(undefined, () => undefined);
		}
		timeline.changed.fire([run.stylesheet, ...removed.map((r) => vscode.Uri.file(r.stylesheet))]);
	}

	// for testing: the profiles kept, newest first - undefined when the Timeline API isn't there
	public static get history(): { id: number; stylesheet: string }[] | undefined {
		return XsltProfileTimeline.instance?.records();
	}

	// removes the stylesheet's profiles - or with no stylesheet, all of them - and their files; the number removed
	public static async clear(stylesheet?: vscode.Uri): Promise<number> {
		return XsltProfileTimeline.remove((r) => !stylesheet || r.stylesheet === stylesheet.fsPath);
	}

	// removes one profile, by its timeline item's id
	public static async deleteEntry(id: string): Promise<number> {
		return XsltProfileTimeline.remove((r) => String(r.id) === id);
	}

	private static async remove(removing: (record: ProfileRecord) => boolean): Promise<number> {
		const timeline = XsltProfileTimeline.instance;
		if (!timeline) {
			return 0;
		}
		const records = timeline.records();
		const removed = records.filter(removing);
		if (removed.length === 0) {
			return 0;
		}
		await timeline.state.update(XsltProfileTimeline.stateKey, records.filter((r) => !removing(r)));
		for (const old of removed) {
			await vscode.workspace.fs.delete(timeline.file(old.id)).then(undefined, () => undefined);
		}
		timeline.changed.fire([...new Set(removed.map((r) => r.stylesheet))].map((s) => vscode.Uri.file(s)));
		return removed.length;
	}

	// newest first
	private records(): ProfileRecord[] {
		return this.state.get<ProfileRecord[]>(XsltProfileTimeline.stateKey, []);
	}

	private file(id: number) {
		return vscode.Uri.joinPath(this.folder, `${id}.json`);
	}

	// a kept profile, in the Profile view again
	private async open(id: number) {
		let run: ProfileRun;
		try {
			const saved = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(this.file(id))).toString('utf8'));
			run = { ...saved, stylesheet: vscode.Uri.parse(saved.stylesheet), time: new Date(saved.time) };
		} catch {
			vscode.window.showErrorMessage('Profile: this profile is no longer kept.');
			return;
		}
		XsltProfileView.show(run);
	}

	// the items after the cursor - an index - up to the limit
	private page(items: TimelineItem[], options: TimelineOptions): Timeline {
		const from = options.cursor ? Number(options.cursor) : 0;
		const to = options.limit !== undefined ? from + options.limit : items.length;
		return { items: items.slice(from, to), cursor: to < items.length ? String(to) : undefined };
	}

	private static ms(n: number) {
		return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
	}

	// e.g. 'Profile: 9.26 ms' - 'orders.xml (2.1 KB) · average of runs 2–5 · SaxonJ'
	private item(record: ProfileRecord): TimelineItem {
		const ms = XsltProfileTimeline.ms;
		const item = new this.itemClass(`Profile: ${ms(record.netTotal)} ms`, record.id);
		item.id = String(record.id);
		item.contextValue = 'xsltProfile';
		item.iconPath = new vscode.ThemeIcon('pulse');
		const runs = XsltProfile.runsText(record.runs, record.requestedRuns);
		item.description = [record.sourceSummary, runs, record.processor].join(' · ');
		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**Profile** - ${new Date(record.id).toLocaleString()} - `).appendText(`${record.processor}, ${record.sourceSummary}, ${runs}`).appendMarkdown('\n\n');
		tooltip.appendText(`${ms(record.netTotal)} ms in templates, functions and globals of ${ms(record.total)} ms in all`).appendMarkdown('\n\n');
		for (const top of record.top) {
			tooltip.appendMarkdown('- ').appendText(`${top.label}: ${ms(top.net)} ms net`).appendMarkdown('\n');
		}
		item.tooltip = tooltip;
		item.command = { title: 'Show Profile', command: XsltProfileTimeline.openCommand, arguments: [record.id] };
		return item;
	}
}
