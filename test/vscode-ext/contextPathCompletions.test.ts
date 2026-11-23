/**
 * Test suite for node name completions of a relative path: it's from the context set by the xsl:template, xsl:for-each or
 * xsl:iterate it's in - the names of the XML context file, below the nodes they select - else, when that isn't known, from
 * every element of the context file as before
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';

suite('Context file: completions of a relative path from its context', function () {
	this.timeout(60000);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-path-'));
	const xmlPath = path.join(dir, 'context.xml');

	suiteSetup(() => fs.writeFileSync(xmlPath, '<orders><order id="1"><item sku="a"><part/><price/></item></order><customer><label/><address/></customer></orders>'));
	suiteTeardown(() => {
		DocumentChangeHandler.lastActiveXMLNonXSLUri = null;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	// the names offered at the | in the body of a stylesheet
	async function namesAt(body: string) {
		const contextUri = vscode.Uri.file(xmlPath);
		XsltSymbolProvider.documentSymbols.delete(contextUri);
		DocumentChangeHandler.lastActiveXMLNonXSLUri = contextUri;
		const text = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n${body}\n</xsl:stylesheet>`;
		const offset = text.indexOf('|');
		const document = await vscode.workspace.openTextDocument({ content: text.replace('|', ''), language: 'xslt' });
		const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
		const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		return items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
	}

	const template = (match: string, content: string) => `<xsl:template match="${match}">${content}</xsl:template>`;

	test('the children of the nodes a template matches', async () => {
		const names = await namesAt(template('order', '<xsl:sequence select="|"/>'));
		assert.include(names, 'item');
		assert.notInclude(names, 'customer');
		assert.notInclude(names, 'address');
	});

	test('while a name is being typed', async () => {
		const names = await namesAt(template('order', '<xsl:sequence select="it|"/>'));
		assert.include(names, 'item');
		assert.notInclude(names, 'customer');
		const inPath = await namesAt(template('order', '<xsl:sequence select="item/pa|"/>'));
		assert.include(inPath, 'part');
		assert.notInclude(inPath, 'label');
	});

	test('the root element, for a template matching the document node', async () => {
		const names = await namesAt(template('/', '<xsl:sequence select="|"/>'));
		assert.include(names, 'orders');
		assert.notInclude(names, 'item');
	});

	test('after the steps of a relative path', async () => {
		const names = await namesAt(template('order', '<xsl:sequence select="item/|"/>'));
		assert.include(names, 'part');
		assert.notInclude(names, 'label');
	});

	test('a parent step goes above the context', async () => {
		const names = await namesAt(template('item', '<xsl:sequence select="../|"/>'));
		assert.include(names, 'item');
		assert.notInclude(names, 'part');
	});

	test('within an xsl:for-each, relative to the template', async () => {
		const names = await namesAt(template('order', '<xsl:for-each select="item"><xsl:sequence select="|"/></xsl:for-each>'));
		assert.include(names, 'part');
		assert.include(names, 'price');
		assert.notInclude(names, 'item');
	});

	test('within an xsl:iterate', async () => {
		const names = await namesAt(template('order', '<xsl:iterate select="item"><xsl:sequence select="|"/></xsl:iterate>'));
		assert.include(names, 'price');
		assert.notInclude(names, 'customer');
	});

	test('an xsl:for-each with an absolute path sets the context, wherever it is', async () => {
		const names = await namesAt(template('order', '<xsl:for-each select="/orders/customer"><xsl:sequence select="|"/></xsl:for-each>'));
		assert.include(names, 'label');
		assert.include(names, 'address');
		assert.notInclude(names, 'price');
	});

	test('an xsl:for-each in another, each a relative path', async () => {
		const names = await namesAt(template('orders', '<xsl:for-each select="order"><xsl:for-each select="item"><xsl:sequence select="|"/></xsl:for-each></xsl:for-each>'));
		assert.include(names, 'part');
		assert.notInclude(names, 'item');
	});

	test('an xsl:for-each selecting a variable with a path', async () => {
		const names = await namesAt('<xsl:variable name="items" select="/orders/order/item"/>' + template('/', '<xsl:for-each select="$items"><xsl:sequence select="|"/></xsl:for-each>'));
		assert.include(names, 'part');
		assert.notInclude(names, 'customer');
	});

	test('a path of a variable declared with a relative path isn\'t placed in the context at its use', async () => {
		const names = await namesAt(template('order', '<xsl:variable name="v" select="item"/><xsl:for-each select="$v"><xsl:sequence select="$v/|"/></xsl:for-each>'));
		assert.include(names, 'part');
	});

	test('not known: a pattern that is a union', async () => {
		const names = await namesAt(template('order|customer', '<xsl:sequence select="|"/>'));
		assert.include(names, 'item');
		assert.include(names, 'address');
	});

	test('not known: a match with names the context file doesn\'t have', async () => {
		const names = await namesAt(template('nosuch', '<xsl:sequence select="|"/>'));
		assert.include(names, 'item');
		assert.include(names, 'address');
	});

	test('not known: the xsl:sort of an xsl:apply-templates, in the context of the nodes it selects', async () => {
		const names = await namesAt(template('order', '<xsl:apply-templates select="//customer"><xsl:sort select="|"/></xsl:apply-templates>'));
		assert.include(names, 'address');
	});

	test('not known: a function call selects the nodes', async () => {
		const names = await namesAt(template('order', '<xsl:for-each select="root(.)//customer[1]"><xsl:sequence select="|"/></xsl:for-each>'));
		assert.include(names, 'item');
		assert.include(names, 'address');
	});

	test('an absolute path is unchanged', async () => {
		const names = await namesAt(template('order', '<xsl:sequence select="/orders/|"/>'));
		assert.include(names, 'customer');
		assert.include(names, 'order');
	});
});

suite('Problems of an older version of a file, in a source control diff or an AI agent\'s', function () {
	this.timeout(60000);
	// a source control diff's, and Claude Code's diff of an AI agent's change: the original (left) and the proposal (right)
	['gitlens', '_claude_vscode_fs_left', '_claude_vscode_fs_right'].forEach((scheme) => test(`are not reported for a document of a diff's scheme: ${scheme}`, async () => {
		const provider = vscode.workspace.registerTextDocumentContentProvider(scheme, {
			provideTextDocumentContent: () => '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:template match="/"><xsl:value-of select="nosuch(1)"/></xsl:template></xsl:stylesheet>'
		});
		try {
			const uri = vscode.Uri.parse(`${scheme}:/old/invoicing.xsl`);
			const document = await vscode.workspace.openTextDocument(uri);
			await vscode.languages.setTextDocumentLanguage(document, 'xslt');
			await vscode.window.showTextDocument(document);
			await new Promise((resolve) => setTimeout(resolve, 2500));
			assert.equal(vscode.languages.getDiagnostics(uri).length, 0);
		} finally {
			provider.dispose();
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
	}));
});

suite('Problems of the files of a folder removed from the workspace', () => {
	test('are cleared, except for a file that is open in an editor - and not those of other folders', async function () {
		// 66 ms alone, but it waits for VS Code to register the editor - slow when the machine is busy, e.g. swapping
		this.timeout(30000);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'removed-folder-'));
		try {
			const gone = path.join(dir, 'gone');
			const kept = path.join(dir, 'kept');
			fs.mkdirSync(gone);
			fs.mkdirSync(kept);
			const openFile = path.join(gone, 'open.xsl');
			fs.writeFileSync(openFile, '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>');
			const openDocument = await vscode.workspace.openTextDocument(openFile);
			const editor = await vscode.window.showTextDocument(openDocument);
			// the editor is registered a moment after it's shown - and shown again if another test's editors are closed just then
			for (let waited = 0; waited < 5000 && !XsltSymbolProvider.isOpenInEditor(openDocument); waited += 50) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				if (waited % 500 === 450) {
					await vscode.window.showTextDocument(openDocument);
				}
			}
			assert.isTrue(XsltSymbolProvider.isOpenInEditor(openDocument), 'the editor is open');
			const collection = vscode.languages.createDiagnosticCollection('removed-folder-test');
			const problem = [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'a problem')];
			const closedFile = vscode.Uri.file(path.join(gone, 'closed.xsl'));
			const otherFolder = vscode.Uri.file(path.join(kept, 'other.xsl'));
			const sibling = vscode.Uri.file(gone + '-more.xsl');
			[closedFile, vscode.Uri.file(openFile), otherFolder, sibling].forEach((uri) => collection.set(uri, problem));
			XsltSymbolProvider.clearRemovedFolders(collection, [vscode.Uri.file(gone)]);
			assert.isFalse(collection.has(closedFile), 'a file that is not open');
			assert.isTrue(collection.has(vscode.Uri.file(openFile)), 'a file open in an editor');
			assert.isTrue(collection.has(otherFolder), 'a file in another folder');
			assert.isTrue(collection.has(sibling), 'a file in a folder whose name starts the same');
			collection.dispose();
			assert.isOk(editor);
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('a file in no workspace folder - open when its folder was removed - loses its problems when it is closed', () => {
		const collection = vscode.languages.createDiagnosticCollection('closed-test');
		const file = vscode.Uri.file(path.join(os.tmpdir(), 'not-in-a-workspace', 'a.xsl'));
		collection.set(file, [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'a problem')]);
		assert.isUndefined(vscode.workspace.getWorkspaceFolder(file));
		XsltSymbolProvider.clearClosed(collection, file);
		assert.isFalse(collection.has(file));
		collection.dispose();
	});
});
