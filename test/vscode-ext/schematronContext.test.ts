/**
 * Test suite for a Schematron schema's XML context file: the XML file the schema is developed for - chosen, or inferred
 * from the file last validated with it, or one whose xml-model names it - for XPath auto-completion and Quick Run, shown
 * in the status bar. A file sch:include brings in has the context file of the schema that includes it.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { SchematronContext } from '../../src/schematronContext';
import { SchematronValidation } from '../../src/schematronValidation';
import { SchIncludes } from '../../src/schIncludes';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';

const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sch-context-')));
const file = (name: string) => path.join(folder, name);
const iso = 'xmlns="http://purl.oclc.org/dsdl/schematron"';
const files: { [name: string]: string } = {
	'main.sch': `<schema ${iso} queryBinding="xslt3">\n  <include href="pattern.sch"/>\n</schema>`,
	'pattern.sch': `<pattern ${iso} id="p">\n  <rule context="book"><assert test="@isbn" id="isbn">The book has no ISBN</assert></rule>\n</pattern>`,
	'associated.xml': '<?xml-model href="main.sch" schematypens="http://purl.oclc.org/dsdl/schematron"?>\n<library><book isbn="1"/></library>',
	'catalog.xml': '<catalog><book/><shelf/></catalog>',
	'browsed.xml': '<other/>'
};

suite('Schematron context file', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		Object.entries(files).forEach(([name, content]) => fs.writeFileSync(file(name), content));
		SchIncludes.instance.buildFrom([file('main.sch'), file('pattern.sch')]);
	});
	teardown(async () => {
		await SchematronContext.setContextFile(file('main.sch'), undefined);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
	suiteTeardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	test('chosen, else inferred - an open file whose xml-model names the schema - and a file sch:include brings in has its schema\'s', async () => {
		await vscode.workspace.openTextDocument(vscode.Uri.file(file('associated.xml')));
		assert.strictEqual(SchematronContext.schemaOf(vscode.Uri.file(file('pattern.sch'))), file('main.sch'));
		assert.strictEqual(SchematronContext.schemaOf(vscode.Uri.file(file('main.sch'))), file('main.sch'));
		assert.deepEqual(SchematronContext.contextFor(file('main.sch')), { file: file('associated.xml'), chosen: false });
		await SchematronContext.setContextFile(file('main.sch'), file('catalog.xml'));
		assert.deepEqual(SchematronContext.contextFor(file('main.sch')), { file: file('catalog.xml'), chosen: true });
	});

	test('auto-completion of element names: from the context file - also in a file the schema includes', async () => {
		await SchematronContext.setContextFile(file('main.sch'), file('catalog.xml'));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('pattern.sch')));
		const position = document.positionAt(document.getText().indexOf('book"'));
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, position);
		const names = list.items.map((i) => typeof i.label === 'string' ? i.label : i.label.label);
		assert.includeMembers(names, ['catalog', 'book', 'shelf'], names.join(', '));
		assert.notInclude(names, 'library');
	});

	test('choosing it: the files whose xml-model names the schema first, then recent XML files, then Browse...', async () => {
		await vscode.workspace.openTextDocument(vscode.Uri.file(file('associated.xml')));
		const choose = SchematronContext.choose;
		const browse = SchematronContext.browse;
		let offered: (vscode.QuickPickItem & { file?: string })[] = [];
		try {
			SchematronContext.choose = async (items) => (offered = items, items.find((i) => i.file === file('associated.xml')));
			assert.strictEqual(await SchematronContext.pick(file('main.sch')), file('associated.xml'));
			assert.strictEqual(offered[0].label, 'xml-model');
			assert.strictEqual(offered[1].file, file('associated.xml'));
			assert.include(offered[1].detail, 'current - inferred');
			assert.strictEqual(offered[offered.length - 1].label, '$(folder-opened) Browse...');
			assert.deepEqual(SchematronContext.contextFor(file('main.sch')), { file: file('associated.xml'), chosen: true });
			// browsing for one
			SchematronContext.choose = async (items) => items[items.length - 1];
			SchematronContext.browse = async () => file('browsed.xml');
			assert.strictEqual(await SchematronContext.pick(file('main.sch')), file('browsed.xml'));
			assert.deepEqual(SchematronContext.contextFor(file('main.sch')), { file: file('browsed.xml'), chosen: true });
			// cancelled: unchanged
			SchematronContext.choose = async () => undefined;
			assert.isUndefined(await SchematronContext.pick(file('main.sch')));
			assert.strictEqual(SchematronContext.contextFor(file('main.sch'))?.file, file('browsed.xml'));
		} finally {
			SchematronContext.choose = choose;
			SchematronContext.browse = browse;
		}
	});

	test('the status bar: the context file, for the schema and a file it includes - and a click chooses another', async () => {
		await SchematronContext.setContextFile(file('main.sch'), file('catalog.xml'));
		const item = DocumentChangeHandler.contextStatusBarItem;
		const shown = async (name: string) => {
			await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file(name))));
			for (let i = 0; i < 20 && !item.text.includes('catalog.xml'); i++) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			return { text: item.text, tooltip: (item.tooltip as vscode.MarkdownString).value, command: item.command };
		};
		const main = await shown('main.sch');
		assert.strictEqual(main.text, '$(file-code) catalog.xml');
		assert.include(main.tooltip, 'XML context file for main.sch');
		assert.include(main.tooltip, 'chosen');
		assert.strictEqual(main.command, SchematronContext.pickCommand);
		assert.include((await shown('pattern.sch')).tooltip, 'main.sch, which includes this file');
	});

	test('Quick Run: validates the context file with the schema - and validating another file doesn\'t change it - needs a Saxon jar, in XSPEC_SAXON_JAR', async function () {
		const saxonJar = process.env.XSPEC_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const saved = tasks.inspect<string>('saxonJar')?.globalValue;
		await tasks.update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		try {
			await SchematronContext.setContextFile(file('main.sch'), file('catalog.xml'));
			await SchematronContext.quickRun(vscode.Uri.file(file('pattern.sch')));
			const problems = vscode.languages.getDiagnostics(vscode.Uri.file(file('catalog.xml'))).filter((d) => d.source?.startsWith('Schematron'));
			assert.deepEqual(problems.map((d) => d.message), ['The book has no ISBN']);
			// associated.xml, validated with the schema from its own editor: the chosen context file stays
			await SchematronValidation.validate(vscode.Uri.file(file('associated.xml')), file('main.sch'), false);
			assert.deepEqual(SchematronContext.contextFor(file('main.sch')), { file: file('catalog.xml'), chosen: true });
		} finally {
			await tasks.update('saxonJar', saved, vscode.ConfigurationTarget.Global);
		}
	});
});
