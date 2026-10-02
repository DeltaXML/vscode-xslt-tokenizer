/**
 * Test suite for the actions of the notification when a task writes a result file: 'Open', and for an HTML result,
 * 'Open in Browser' - VS Code's integrated browser - if its command, which isn't documented, is available
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { SaxonTaskProvider } from '../../src/saxonTaskProvider';

const withBrowser = ['vscode.open', SaxonTaskProvider.integratedBrowserOpenFile];
const withoutBrowser = ['vscode.open'];

suite('Result file actions', () => {
	['result.html', 'page.HTM', 'doc.xhtml'].forEach((file) => {
		test(`Open and Open in Browser, for ${file}`, () => {
			assert.deepEqual(SaxonTaskProvider.resultActions(`/out/${file}`, withBrowser), ['Open', 'Open in Browser']);
		});
	});

	test('only Open, for a result that is not HTML', () => {
		assert.deepEqual(SaxonTaskProvider.resultActions('/out/result.xml', withBrowser), ['Open']);
	});

	test('only Open, when VS Code has no integrated browser command', () => {
		assert.deepEqual(SaxonTaskProvider.resultActions('/out/result.html', withoutBrowser), ['Open']);
	});

	test('the integrated browser command in this VS Code', async () => {
		const available = (await vscode.commands.getCommands(true)).includes(SaxonTaskProvider.integratedBrowserOpenFile);
		console.log(`BROWSER ${vscode.version}: ${SaxonTaskProvider.integratedBrowserOpenFile} ${available ? 'available' : 'not available'}`);
	});
});
