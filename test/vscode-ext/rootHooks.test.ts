/**
 * Hooks for the whole test run - outside any suite, so on Mocha's root suite: before the first test, and after the last.
 *
 * Starting a debug session saves the unsaved editors first (debug.saveBeforeStart): an untitled document a test left
 * open would get a Save As dialog, which waits for an answer - so, for the run, none are saved.
 */
import * as vscode from 'vscode';

let saveBeforeStart: string | undefined;

suiteSetup(async () => {
	const config = vscode.workspace.getConfiguration('debug');
	saveBeforeStart = config.inspect<string>('saveBeforeStart')?.globalValue;
	await config.update('saveBeforeStart', 'none', vscode.ConfigurationTarget.Global);
});

suiteTeardown(async () => {
	await vscode.workspace.getConfiguration('debug').update('saveBeforeStart', saveBeforeStart, vscode.ConfigurationTarget.Global);
});
