/**
 * For a suite's teardown: its editors - those of files in its folder - closed, with their changes reverted. An unsaved
 * editor left open would get a 'save changes?' dialog when a later suite closes all editors - a modal dialog that stops
 * the test run until it's answered.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';

export async function revertAndCloseEditorsIn(folder: string) {
	// e.g. on macOS, os.tmpdir() is under /var, a symbolic link to /private/var: a file may be open with either path
	const roots = [folder, fs.existsSync(folder) ? fs.realpathSync(folder) : folder];
	const tabs = () => vscode.window.tabGroups.all.flatMap((group) => group.tabs)
		.filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file' && roots.some((root) => (tab.input as vscode.TabInputText).uri.fsPath.startsWith(root)));
	for (const tab of tabs()) {
		const uri = (tab.input as vscode.TabInputText).uri;
		if (vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString() && d.isDirty)) {
			await vscode.window.showTextDocument(uri, { viewColumn: tab.group.viewColumn });
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	}
	await vscode.window.tabGroups.close(tabs());
}
