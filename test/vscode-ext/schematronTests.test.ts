/**
 * Test suite for XSpec tests generated from a Schematron schema's XML context file: for a rule, an assertion or each
 * rule - the data a node the rule fires for, with its ancestors, and the expectations the schema's results for it, so
 * the tests pass when they're made. With no data, or no context file, a pending scenario.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { SchematronTests } from '../../src/schematronTests';
import { SchematronContext } from '../../src/schematronContext';
import { SchIncludes } from '../../src/schIncludes';
import { XSpecTestController } from '../../src/xspecTestController';

const iso = 'xmlns="http://purl.oclc.org/dsdl/schematron"';
const schemaText = `<schema ${iso} queryBinding="xslt3">
  <pattern id="books">
    <rule context="book">
      <assert test="@isbn" id="isbn">The book has no ISBN</assert>
      <assert test="title">A book needs a title</assert>
      <report test="number(@price) gt 100" id="pricey">The book costs <value-of select="@price"/></report>
    </rule>
    <rule context="magazine"><assert test="@issue" id="issue">A magazine needs an issue</assert></rule>
  </pattern>
  <pattern id="unique">
    <rule context="book"><assert test="count(//book[@isbn = current()/@isbn]) = 1" id="unique-isbn">The ISBN is not unique</assert></rule>
  </pattern>
</schema>`;
const dataText = `<library>
  <shelf>
    <book isbn="1"><title>A</title></book>
    <book isbn="1"/>
    <book isbn="2" price="200"><title>C</title></book>
  </shelf>
</library>`;

suite('Schematron: XSpec tests from the XML context file', () => {
	const saxonJar = process.env.XSPEC_SAXON_JAR;
	let folder = '';
	const file = (name: string) => path.join(folder, name);
	setup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sch-tests-')));
		fs.writeFileSync(file('books.sch'), schemaText);
		fs.writeFileSync(file('library.xml'), dataText);
		SchIncludes.instance.buildFrom([file('books.sch')]);
	});
	teardown(async () => {
		await SchematronContext.setContextFile(file('books.sch'), undefined);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		fs.rmSync(folder, { recursive: true, force: true });
	});
	const withSaxon = async (run: () => Promise<void>) => {
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const saved = tasks.inspect<string>('saxonJar')?.globalValue;
		await tasks.update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		try {
			await run();
		} finally {
			await tasks.update('saxonJar', saved, vscode.ConfigurationTarget.Global);
		}
	};
	const offsetOf = (text: string) => schemaText.indexOf(text);
	// the XSpec file's text, once the scenarios are added
	const generated = async (offset?: number) => {
		const editor = await SchematronTests.create(vscode.Uri.file(file('books.sch')), offset);
		await editor!.document.save();
		return editor!.document.getText();
	};

	test('the code actions: on the schema, a rule, and an assertion or report', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('books.sch')));
		const titles = (text: string) => SchematronTests.codeActions(document, new vscode.Range(document.positionAt(offsetOf(text) + 2), document.positionAt(offsetOf(text) + 2))).map((a) => a.title);
		assert.deepEqual(titles('<schema'), ['Create XSpec tests: a scenario for each rule, from the XML context file']);
		assert.deepEqual(titles('<rule context="book">'), ['Create XSpec scenario for the rule book, from the XML context file']);
		assert.deepEqual(titles('<assert test="@isbn"'), ['Create XSpec scenarios for the assertion isbn: where it fails and passes']);
		assert.deepEqual(titles('<report'), ['Create XSpec scenarios for the report pricey: where it is reported and isn\'t']);
		assert.deepEqual(titles('<pattern id="books"'), []);
	});

	test('no XML context file: a pending scenario for each rule, to be completed', async () => {
		const text = await generated();
		assert.include(text, 'schematron="books.sch"');
		assert.include(text, '<x:scenario label="rule book in books" pending="the schema has no XML context file">');
		assert.include(text, '<x:scenario label="rule magazine in books" pending="the schema has no XML context file">');
		assert.include(text, '<x:expect-not-assert id="isbn" label="The book has no ISBN"/>');
		assert.include(text, '<!-- assert A book needs a title -->');
	});

	test('each rule: the data a node it fires for, with its ancestors, and the schema\'s results for it - and a rule with none, pending - needs a Saxon jar, in XSPEC_SAXON_JAR', async function () {
		if (!saxonJar) {
			this.skip();
		}
		await SchematronContext.setContextFile(file('books.sch'), file('library.xml'));
		await withSaxon(async () => {
			const text = await generated();
			assert.include(text, `<x:scenario label="rule book in books: library.xml /library/shelf/book">
      <!-- generated from library.xml /library/shelf/book, with its ancestors: the expectations are the schema's results for it -->
      <x:context>
         <library>
           <shelf>
             <book isbn="1"><title>A</title></book>
           </shelf>
         </library>
      </x:context>
      <x:expect-not-assert id="isbn" label="The book has no ISBN"/>
      <!-- not reported: assert A book needs a title - with no id, an expectation can't tell it from another -->
      <x:expect-not-report id="pricey" label="The book costs …"/>
   </x:scenario>`);
			assert.include(text, '<x:scenario label="rule magazine in books" pending="no node in library.xml fires it">');
			// again: only the rules with no scenario yet
			const again = await generated();
			assert.strictEqual(again.split('label="rule book in books').length, 2);
		});
	});

	test('an assertion: where it fails, with more of the document where its node alone doesn\'t - and where it passes - and with no id, by its message - needs a Saxon jar, in XSPEC_SAXON_JAR', async function () {
		if (!saxonJar) {
			this.skip();
		}
		await SchematronContext.setContextFile(file('books.sch'), file('library.xml'));
		await withSaxon(async () => {
			const unique = await generated(offsetOf('<assert test="count(//book'));
			// the first book's ISBN isn't unique only with the second book: its siblings are needed - and the expectation is for it
			assert.include(unique, '<x:scenario label="unique-isbn fails: library.xml /library/shelf/book">');
			assert.include(unique, 'with its siblings and ancestors');
			assert.include(unique, '<x:expect-assert id="unique-isbn" location="/library[1]/shelf[1]/book[1]" label="The ISBN is not unique"/>');
			assert.include(unique, '<x:scenario label="unique-isbn passes: library.xml /library/shelf/book[3]">');
			const title = await generated(offsetOf('<assert test="title"'));
			assert.include(title, '<x:scenario label="assert fails: library.xml /library/shelf/book[2]">');
			assert.include(title, '<x:expect-assert label="A book needs a title">A book needs a title</x:expect-assert>');
		});
	});

	test('the generated tests pass, run with XSpec - needs a Saxon jar, in XSPEC_SAXON_JAR', async function () {
		if (!saxonJar) {
			this.skip();
		}
		await SchematronContext.setContextFile(file('books.sch'), file('library.xml'));
		await withSaxon(async () => {
			await generated();
			await generated(offsetOf('<assert test="count(//book'));
			await generated(offsetOf('<report'));
			const xspec = XSpecTestController.instance!;
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('books.xspec')));
			const fileItem = xspec.testController.items.get(document.uri.toString())!;
			const outcomes = new Map<string, string>();
			const record = (status: string) => (item: vscode.TestItem) => outcomes.set(item.label, status);
			xspec.createRun = () => ({
				name: 'test', token: new vscode.CancellationTokenSource().token, isPersisted: false,
				enqueued: record('enqueued'), started: record('started'), skipped: record('skipped'), passed: record('passed'),
				failed: record('failed'), errored: record('errored'), appendOutput: () => undefined, addCoverage: () => undefined, end: () => undefined,
				onDidDispose: new vscode.EventEmitter<void>().event
			} as unknown as vscode.TestRun);
			try {
				await xspec.runProfile.runHandler(new vscode.TestRunRequest([fileItem]), new vscode.CancellationTokenSource().token);
			} finally {
				xspec.createRun = undefined;
			}
			const expectations = [...outcomes].filter(([label]) => !label.startsWith('rule ') && !/ (fails|passes|is reported|isn't reported): /.test(label));
			assert.isAbove(expectations.length, 5, JSON.stringify([...outcomes]));
			assert.deepEqual(expectations.filter(([, outcome]) => outcome !== 'passed' && outcome !== 'skipped'), [], JSON.stringify([...outcomes]));
		});
	});
});
