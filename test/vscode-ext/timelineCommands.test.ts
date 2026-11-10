/**
 * Test suite for clearing the extension's entries from the Timeline view (see TimelineCommands): XSpec runs and
 * profiles, for the current file or all files. The Timeline API is final in VS Code 1.145 - without it, nothing is kept,
 * so there's nothing to test. Profiles are kept only with a workspace (for its storage folder), so are tested only then
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { XSpecTimeline, XSpecRunRecord } from '../../src/xspecTimeline';
import { XsltProfileTimeline } from '../../src/xsltProfileTimeline';
import { ProfileRun } from '../../src/xsltProfileView';
import { TimelineCommands } from '../../src/timelineCommands';

suite('Timeline: clearing profiles and XSpec runs', function () {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-clear-'));
	const fileA = path.join(dir, 'a.xspec');
	const fileB = path.join(dir, 'b.xspec');
	const stylesheetA = path.join(dir, 'a.xsl');
	const stylesheetB = path.join(dir, 'b.xsl');
	fs.writeFileSync(fileA, '<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" stylesheet="a.xsl"/>');
	fs.writeFileSync(fileB, '<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" stylesheet="b.xsl"/>');
	[stylesheetA, stylesheetB].forEach((file) => fs.writeFileSync(file, '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>'));

	suiteSetup(async function () {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		if (XSpecTimeline.history === undefined) {
			// VS Code before 1.145: no Timeline API
			this.skip();
		}
	});

	// the runs of this suite's files - other suites' runs may be kept in the workspace state too
	const runsOf = (file: string) => XSpecTimeline.history!.filter((run) => run.files.some((f) => f.file === file));
	const profilesOf = (file: string) => XsltProfileTimeline.history?.filter((p) => p.stylesheet === file);

	let time = Date.now();
	const record = async () => {
		const outcome = (file: string) => ({ file, passed: 1, failed: 0, pending: 0 });
		const run = (files: string[]): XSpecRunRecord => ({ start: ++time, end: time + 1, kind: 'Run', cancelled: false, files: files.map(outcome) });
		// a run of a.xspec, and one of both files
		XSpecTimeline.record(run([fileA]));
		XSpecTimeline.record(run([fileA, fileB]));
		const profile = (stylesheet: string): ProfileRun => ({
			stylesheet: vscode.Uri.file(stylesheet), title: path.basename(stylesheet), processor: 'SaxonJ', settings: [], sourceSummary: 'no source',
			requestedRuns: 1, runs: 1, time: new Date(++time), total: 1, netTotal: 1, rows: []
		});
		await XsltProfileTimeline.record(profile(stylesheetA));
		await XsltProfileTimeline.record(profile(stylesheetB));
		// XSpecTimeline.record updates the state without waiting
		for (let i = 0; i < 50 && runsOf(fileB).length === 0; i++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.lengthOf(runsOf(fileA), 2);
		assert.lengthOf(runsOf(fileB), 1);
	};

	test('clear for the current file: its profiles, and its outcomes in XSpec runs - a run of only that file is removed, one with other files is kept for them', async () => {
		await record();
		await vscode.window.showTextDocument(vscode.Uri.file(fileA));
		await vscode.commands.executeCommand(TimelineCommands.clearFile);
		assert.lengthOf(runsOf(fileA), 0);
		const [both] = runsOf(fileB);
		assert.deepEqual(both.files.map((f) => f.file), [fileB], 'the run of both files is kept, for b.xspec');
		// a stylesheet's profiles: only those of the active editor's stylesheet
		if (XsltProfileTimeline.history !== undefined) {
			await vscode.window.showTextDocument(vscode.Uri.file(stylesheetA));
			await vscode.commands.executeCommand(TimelineCommands.clearFile);
			assert.lengthOf(profilesOf(stylesheetA)!, 0);
			assert.lengthOf(profilesOf(stylesheetB)!, 1);
		}
		// a file given, as from the Timeline view's title menu
		await vscode.commands.executeCommand(TimelineCommands.clearFile, vscode.Uri.file(fileB));
		assert.lengthOf(runsOf(fileB), 0);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('clear for all files: every profile and XSpec run - only once confirmed', async () => {
		await record();
		const confirm = TimelineCommands.confirmClearAll;
		try {
			TimelineCommands.confirmClearAll = async () => false;
			await vscode.commands.executeCommand(TimelineCommands.clearAll);
			assert.lengthOf(runsOf(fileA), 2, 'not confirmed: nothing cleared');
			TimelineCommands.confirmClearAll = async () => true;
			await vscode.commands.executeCommand(TimelineCommands.clearAll);
			assert.deepEqual(XSpecTimeline.history, []);
			if (XsltProfileTimeline.history !== undefined) {
				assert.deepEqual(XsltProfileTimeline.history, []);
			}
		} finally {
			TimelineCommands.confirmClearAll = confirm;
		}
	});
});
