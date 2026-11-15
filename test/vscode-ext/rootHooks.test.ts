/**
 * Hooks for the whole test run - outside any suite, so on Mocha's root suite: before the first test, and after the last -
 * and before and after each test.
 *
 * Starting a debug session saves the unsaved editors first (debug.saveBeforeStart): an untitled document a test left
 * open would get a Save As dialog, which waits for an answer - so, for the run, none are saved.
 *
 * An untitled document a test opened in an editor - e.g. openTextDocument({ content }) then showTextDocument - is unsaved:
 * left open, closing all editors later, in another suite, would ask to save it, a modal dialog that stops the run. After
 * each test, those it opened are reverted and closed - not those that were open before it, e.g. one a suite shares
 * between its tests, opened in suiteSetup.
 *
 * For new tests: use files in a temp folder, not untitled documents, and close only the suite's own editors - see
 * "Writing VS Code host tests: documents and editors" in __tests__/README.md.
 */
import * as vscode from 'vscode';

let saveBeforeStart: string | undefined;
// the untitled documents open when the current test started
let untitledBefore = new Set<string>();

suiteSetup(async () => {
	const config = vscode.workspace.getConfiguration('debug');
	saveBeforeStart = config.inspect<string>('saveBeforeStart')?.globalValue;
	await config.update('saveBeforeStart', 'none', vscode.ConfigurationTarget.Global);
});

suiteTeardown(async () => {
	await vscode.workspace.getConfiguration('debug').update('saveBeforeStart', saveBeforeStart, vscode.ConfigurationTarget.Global);
});

setup(() => {
	untitledBefore = new Set(vscode.workspace.textDocuments.filter((d) => d.uri.scheme === 'untitled').map((d) => d.uri.toString()));
});

teardown(async () => {
	const opened = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) => tab.input instanceof vscode.TabInputText &&
		tab.input.uri.scheme === 'untitled' && !untitledBefore.has(tab.input.uri.toString()));
	for (const tab of opened) {
		const uri = (tab.input as vscode.TabInputText).uri;
		const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
		if (document?.isDirty) {
			await vscode.window.showTextDocument(document, { viewColumn: tab.group.viewColumn, preserveFocus: false });
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		} else {
			await vscode.window.tabGroups.close(tab);
		}
	}
});
