/**
 * Test suite for the suggestions the extension opens as a character is typed: not when VS Code's
 * editor.suggestOnTriggerCharacters is off for the document's language, e.g. "[xml]": { ... false }, and as before when
 * it's on (its default) - and never for '<' in an XML file, where only general element snippets would follow it. Ctrl+Space
 * still shows them
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { assert } from 'chai';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';
import { XPathDocumentChangeHandler } from '../../src/xpathDocumentChangeHandler';

suite('Suggestions as a character is typed', () => {
	let folder: string;
	const opened: vscode.Uri[] = [];

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		folder = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-on-typing-'));
	});

	suiteTeardown(async () => {
		for (const tab of vscode.window.tabGroups.all.flatMap((g) => g.tabs)) {
			if (tab.input instanceof vscode.TabInputText && opened.some((u) => u.toString() === (tab.input as vscode.TabInputText).uri.toString())) {
				await vscode.window.tabGroups.close(tab);
			}
		}
		fs.rmSync(folder, { recursive: true, force: true });
	});

	// whether typing `typed` at the end of the file's content triggers suggestions, with the setting for its language
	async function triggers(name: string, content: string, typed: string, languageId: string, setting: boolean | undefined) {
		const file = path.join(folder, name);
		fs.writeFileSync(file, content);
		const uri = vscode.Uri.file(file);
		opened.push(uri);
		const document = await vscode.workspace.openTextDocument(uri);
		assert.strictEqual(document.languageId, languageId);
		const editor = await vscode.window.showTextDocument(document);
		const config = vscode.workspace.getConfiguration('editor', { languageId });
		await config.update('suggestOnTriggerCharacters', setting, vscode.ConfigurationTarget.Global, true);
		const commands = vscode.commands as { executeCommand: typeof vscode.commands.executeCommand };
		const original = commands.executeCommand;
		const run: string[] = [];
		commands.executeCommand = (<T>(command: string, ...rest: unknown[]) => {
			run.push(command);
			return command === 'editor.action.triggerSuggest' ? Promise.resolve(undefined as T) : original<T>(command, ...rest);
		}) as typeof vscode.commands.executeCommand;
		try {
			const end = document.positionAt(document.getText().length);
			await editor.edit((edit) => edit.insert(end, typed));
			const change: vscode.TextDocumentContentChangeEvent = { range: new vscode.Range(end, end), rangeOffset: document.offsetAt(end), rangeLength: 0, text: typed };
			const event = { document, contentChanges: [change], reason: undefined } as vscode.TextDocumentChangeEvent;
			if (languageId === 'xpath') {
				await new XPathDocumentChangeHandler().onDocumentChange(event);
			} else {
				await new DocumentChangeHandler().onDocumentChange(event, true);
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		} finally {
			commands.executeCommand = original;
			await config.update('suggestOnTriggerCharacters', undefined, vscode.ConfigurationTarget.Global, true);
			await vscode.commands.executeCommand('workbench.action.files.revert');
		}
		return run.includes('editor.action.triggerSuggest');
	}

	const xml = '<root>\n\t<element/>\n\t';
	const xsl = '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n\t<xsl:template match="/">\n\t\t';

	test('XML: \'<\' doesn\'t open them - only general element snippets would follow it - by default, or with the setting on', async () => {
		assert.isFalse(await triggers('a.xml', xml, '<', 'xml', undefined));
		assert.isFalse(await triggers('b.xml', xml, '<', 'xml', true));
	});

	test('XML: \'$\' opens them - not with "[xml]": { "editor.suggestOnTriggerCharacters": false }', async () => {
		assert.isTrue(await triggers('c.xml', xml, '$', 'xml', undefined));
		assert.isFalse(await triggers('c2.xml', xml, '$', 'xml', false));
	});

	test('XSLT: \'<\' opens them, by default', async () => {
		assert.isTrue(await triggers('d0.xsl', xsl, '<', 'xslt', undefined));
	});

	test('XSLT: the setting off for XML doesn\'t change XSLT - and XSLT\'s own does', async () => {
		const config = vscode.workspace.getConfiguration('editor', { languageId: 'xml' });
		await config.update('suggestOnTriggerCharacters', false, vscode.ConfigurationTarget.Global, true);
		try {
			assert.isTrue(await triggers('d.xsl', xsl, '<', 'xslt', undefined));
		} finally {
			await config.update('suggestOnTriggerCharacters', undefined, vscode.ConfigurationTarget.Global, true);
		}
		assert.isFalse(await triggers('e.xsl', xsl, '<', 'xslt', false));
	});

	test('XPath: \'$\' opens them - not with the setting off for XPath', async () => {
		assert.isTrue(await triggers('f.xpath', 'count(', '$', 'xpath', undefined));
		assert.isFalse(await triggers('g.xpath', 'count(', '$', 'xpath', false));
	});
});
