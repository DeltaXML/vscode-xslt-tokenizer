/**
 * Test suite for the XML context file of each stylesheet
 *
 * Each top-level stylesheet has its own XML context file - used for XPath completion and as the source for Quick
 * Run - so picking one for a stylesheet doesn't change it for the others. A stylesheet with none picked for it uses
 * the source of its Quick Run task in tasks.json, and else the context file last picked.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';
import { FileSelection } from '../../src/fileSelection';
import { SaxonTaskProvider } from '../../src/saxonTaskProvider';

suite('Context file: the source of a stylesheet\'s Quick Run task', () => {
	const workspaceFolder = path.resolve('/work/project');
	const fsPath = (...segments: string[]) => path.join(workspaceFolder, ...segments);
	const task = (type: string, xmlSource: string | undefined, xsltFile = '${workspaceFolder}/report.xsl') => ({ type, label: 'report', xsltFile, xmlSource });

	test('the last task for the stylesheet, of the selected type', () => {
		const tasks = [task('xslt', '${workspaceFolder}/a.xml'), task('xslt', 'b.xml'), task('xslt-js', '${workspaceFolder}/c.xml'), task('xslt', '${workspaceFolder}/d.xml', '${workspaceFolder}/other.xsl')];
		assert.strictEqual(SaxonTaskProvider.quickRunTaskSourceIn(tasks, 'xslt', fsPath('report.xsl'), workspaceFolder), fsPath('b.xml'));
		assert.strictEqual(SaxonTaskProvider.quickRunTaskSourceIn(tasks, 'xslt-js', fsPath('report.xsl'), workspaceFolder), fsPath('c.xml'));
	});

	test('with no task of the selected type, one of another type', () => {
		const tasks = [task('xslt-c', '${workspaceFolder}/a.xml')];
		assert.strictEqual(SaxonTaskProvider.quickRunTaskSourceIn(tasks, 'xslt', fsPath('report.xsl'), workspaceFolder), fsPath('a.xml'));
	});

	test('null for a task with no source, undefined with no task', () => {
		assert.isNull(SaxonTaskProvider.quickRunTaskSourceIn([task('xslt', '')], 'xslt', fsPath('report.xsl'), workspaceFolder));
		assert.isNull(SaxonTaskProvider.quickRunTaskSourceIn([task('xslt', undefined)], 'xslt', fsPath('report.xsl'), workspaceFolder));
		assert.isUndefined(SaxonTaskProvider.quickRunTaskSourceIn([task('shell', 'a.xml')], 'xslt', fsPath('report.xsl'), workspaceFolder));
	});

	test('ignores tasks whose source is a variable, e.g. the active file', () => {
		const tasks = [task('xslt', '${workspaceFolder}/a.xml'), task('xslt', '${file}'), task('xslt', '${command:xslt-xpath.pickXmlSourceFile}')];
		assert.strictEqual(SaxonTaskProvider.quickRunTaskSourceIn(tasks, 'xslt', fsPath('report.xsl'), workspaceFolder), fsPath('a.xml'));
	});
});

suite('Context file: one for each stylesheet', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stylesheet-context-'));
	const file = (name: string, content = '') => {
		const fsPath = path.join(dir, name);
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	const stylesheet = '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>';
	const reportXsl = file('report.xsl', stylesheet);
	const invoiceXsl = file('invoice.xsl', stylesheet);
	const booksXml = file('books.xml', '<books/>');
	const ordersXml = file('orders.xml', '<orders/>');

	// workspace state in memory, so the tests don't change the extension's
	const state = new Map<string, unknown>();
	const testContext = {
		workspaceState: {
			get: (key: string) => state.get(key),
			update: async (key: string, value: unknown) => { state.set(key, value); },
		},
	} as unknown as vscode.ExtensionContext;
	let extensionFileSelection: FileSelection;
	let extensionTaskContextFile: typeof DocumentChangeHandler.taskContextFile;
	let taskSources: { [stylesheet: string]: string | null };

	suiteSetup(() => {
		extensionFileSelection = FileSelection.instance;
		extensionTaskContextFile = DocumentChangeHandler.taskContextFile;
		new FileSelection(testContext);
		DocumentChangeHandler.taskContextFile = async (stylesheetFsPath) => taskSources[stylesheetFsPath];
	});
	setup(() => {
		state.clear();
		taskSources = {};
		DocumentChangeHandler.setLastPicked(null, false);
	});
	suiteTeardown(() => {
		FileSelection.instance = extensionFileSelection;
		DocumentChangeHandler.taskContextFile = extensionTaskContextFile;
		DocumentChangeHandler.setLastPicked(null, false);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const contextFor = async (fsPath: string) => {
		const { uri, isNone } = await DocumentChangeHandler.contextFor(await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath)));
		return isNone ? 'None' : uri?.fsPath;
	};

	test('each stylesheet keeps the one picked for it', async () => {
		FileSelection.instance.setStylesheetContextFile(reportXsl, booksXml);
		FileSelection.instance.setStylesheetContextFile(invoiceXsl, ordersXml);
		assert.strictEqual(await contextFor(reportXsl), booksXml);
		assert.strictEqual(await contextFor(invoiceXsl), ordersXml);
	});

	test('\'None\' picked for a stylesheet', async () => {
		FileSelection.instance.setStylesheetContextFile(reportXsl, FileSelection.NO_FILE_PICKED);
		DocumentChangeHandler.setLastPicked(vscode.Uri.file(booksXml), false);
		assert.strictEqual(await contextFor(reportXsl), 'None');
	});

	test('with none picked for it, its Quick Run task\'s source, before the last one picked', async () => {
		DocumentChangeHandler.setLastPicked(vscode.Uri.file(booksXml), false);
		taskSources[invoiceXsl] = ordersXml;
		assert.strictEqual(await contextFor(invoiceXsl), ordersXml);
		taskSources[invoiceXsl] = null;
		assert.strictEqual(await contextFor(invoiceXsl), 'None');
		// the one picked for it comes first
		FileSelection.instance.setStylesheetContextFile(invoiceXsl, booksXml);
		assert.strictEqual(await contextFor(invoiceXsl), booksXml);
	});

	test('with none picked for it and no task, the last one picked', async () => {
		DocumentChangeHandler.setLastPicked(vscode.Uri.file(ordersXml), false);
		assert.strictEqual(await contextFor(reportXsl), ordersXml);
		DocumentChangeHandler.setLastPicked(null, true);
		assert.strictEqual(await contextFor(reportXsl), 'None');
	});

	test('a stylesheet that isn\'t a file, or another kind of file, uses the last one picked', async () => {
		FileSelection.instance.setStylesheetContextFile(reportXsl, booksXml);
		DocumentChangeHandler.setLastPicked(vscode.Uri.file(ordersXml), false);
		const untitled = await vscode.workspace.openTextDocument({ content: stylesheet, language: 'xslt' });
		assert.strictEqual((await DocumentChangeHandler.contextFor(untitled)).uri?.fsPath, ordersXml);
		assert.strictEqual((await DocumentChangeHandler.contextFor(undefined)).uri?.fsPath, ordersXml);
	});
});
