/**
 * Test suite for the problems reported for the documents open in editors: not only the active document, but also one
 * shown beside it or open in a tab that isn't shown - e.g. a stylesheet changed by an AI agent while another file is
 * active, so the agent sees the problems of its change. A document that's only loaded, e.g. an XML context file read
 * for completions, gets no problems.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stylesheet = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template name="t">${body}</xsl:template>
</xsl:stylesheet>`;
const undeclared = 'XPath: The variable/parameter $undeclared cannot be resolved';
const problems = (doc: vscode.TextDocument) => vscode.languages.getDiagnostics(doc.uri).map((d) => d.message);

// an edit from outside the editor, as by an agent: a reference to an undeclared variable
async function addUndeclared(doc: vscode.TextDocument) {
	const edit = new vscode.WorkspaceEdit();
	const at = doc.getText().indexOf('<x/>');
	edit.replace(doc.uri, new vscode.Range(doc.positionAt(at), doc.positionAt(at + 4)), '<xsl:sequence select="$undeclared"/>');
	await vscode.workspace.applyEdit(edit);
}

suite('Problems in open editors', () => {
	const opened: vscode.TextDocument[] = [];
	// the test's editors are closed without a prompt to save them, so they don't affect later tests
	suiteTeardown(async () => {
		for (const doc of opened) {
			await vscode.window.showTextDocument(doc);
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}
	});

	test('problems are reported for the active document, one beside it, and one in a tab not shown - not one only loaded', async function () {
		this.timeout(20000);
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		const active = await vscode.workspace.openTextDocument({ content: stylesheet('<x/>'), language: 'xslt' });
		const beside = await vscode.workspace.openTextDocument({ content: stylesheet('<x/>'), language: 'xslt' });
		const hidden = await vscode.workspace.openTextDocument({ content: stylesheet('<x/>'), language: 'xslt' });
		// a file, as for an XML context file - an untitled document's name may be that of an earlier one still in a tab
		const loadedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-problems-')), 'loaded.xsl');
		fs.writeFileSync(loadedPath, stylesheet('<xsl:sequence select="$undeclared"/>'));
		const loaded = await vscode.workspace.openTextDocument(vscode.Uri.file(loadedPath));
		opened.push(active, beside, hidden);
		await vscode.window.showTextDocument(hidden, { viewColumn: vscode.ViewColumn.Two, preview: false });
		await vscode.window.showTextDocument(beside, { viewColumn: vscode.ViewColumn.Two, preview: false });
		await vscode.window.showTextDocument(active, { viewColumn: vscode.ViewColumn.One, preview: false });
		await sleep(1000);
		for (const doc of [active, beside, hidden]) {
			await addUndeclared(doc);
		}
		await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', loaded.uri);
		// problems are reported after a pause in typing
		await sleep(1500);
		assert.deepEqual(problems(active), [undeclared], 'active');
		assert.deepEqual(problems(beside), [undeclared], 'beside');
		assert.deepEqual(problems(hidden), [undeclared], 'in a tab not shown');
		assert.deepEqual(problems(loaded), [], 'only loaded');
	});
});
