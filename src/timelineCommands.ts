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
import { XsltProfileTimeline } from './xsltProfileTimeline';
import { XSpecTimeline } from './xspecTimeline';

// commands to remove the extension's entries from the Timeline view - its profiles and XSpec runs, never other
// sources' entries (e.g. Git's or Local History's): for the current file, for all files, or one entry from its context
// menu. The entries are only what the extension keeps, so removing them changes nothing else
export class TimelineCommands {
	public static readonly clearFile = 'xslt-xpath.clearTimelineFile';
	public static readonly clearAll = 'xslt-xpath.clearTimelineAll';
	public static readonly deleteEntry = 'xslt-xpath.deleteTimelineEntry';
	// asks before clearing all files' entries - for testing, a replacement that answers without a modal dialog
	public static confirmClearAll = async () => {
		const clear = 'Clear';
		const answer = await vscode.window.showWarningMessage('Clear all profiles and XSpec runs from the Timeline view, for all files?',
			{ modal: true, detail: 'Only the entries this extension added are removed. This cannot be undone.' }, clear);
		return answer === clear;
	};

	public static register(context: vscode.ExtensionContext) {
		context.subscriptions.push(
			// from the Timeline view's title menu, the file it shows may be passed; otherwise it's the active editor's
			vscode.commands.registerCommand(TimelineCommands.clearFile, async (arg?: unknown) => {
				const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
				if (!uri || uri.scheme !== 'file') {
					vscode.window.showInformationMessage('Clear Timeline Entries: open a stylesheet or XSpec file first.');
					return;
				}
				const removed = await XsltProfileTimeline.clear(uri) + await XSpecTimeline.clear(uri);
				vscode.window.setStatusBarMessage(TimelineCommands.message(removed, vscode.workspace.asRelativePath(uri)), 4000);
			}),
			vscode.commands.registerCommand(TimelineCommands.clearAll, async () => {
				if (!await TimelineCommands.confirmClearAll()) {
					return;
				}
				const removed = await XsltProfileTimeline.clear() + await XSpecTimeline.clear();
				vscode.window.setStatusBarMessage(TimelineCommands.message(removed), 4000);
			}),
			// from an entry's context menu: the item, then the file of the timeline (none in the workspace timeline)
			vscode.commands.registerCommand(TimelineCommands.deleteEntry, async (item?: { id?: string, contextValue?: string }, uri?: vscode.Uri) => {
				if (!item?.id) {
					return;
				}
				if (item.contextValue === 'xsltProfile') {
					await XsltProfileTimeline.deleteEntry(item.id);
				} else if (item.contextValue === 'xspecRun') {
					await XSpecTimeline.deleteEntry(item.id);
				} else if (item.contextValue === 'xspecRunFile' && uri instanceof vscode.Uri) {
					await XSpecTimeline.deleteEntry(item.id, uri);
				}
			}));
	}

	private static message(removed: number, file?: string) {
		const what = removed === 1 ? '1 timeline entry' : `${removed} timeline entries`;
		return removed === 0 ? `No profiles or XSpec runs in the timeline${file ? ` for ${file}` : ''}` :
			`Cleared ${what}${file ? ` for ${file}` : ''}`;
	}
}
