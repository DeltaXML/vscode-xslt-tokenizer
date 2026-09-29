/**
 * Test suite for renaming a parameter of a function or template: as well as the declaration and its references, the
 * @param for it in the declaration's documentation note (xsl:note format="xdoc-md") is renamed, and for a function
 * parameter, keyword arguments for it in calls of the function, e.g. greeting := 'Hi' - but not keyword arguments with
 * the same name in calls of other functions, or variables with the same name.
 * For a function or template in a library module, the keyword arguments and xsl:with-param names are also renamed in the
 * stylesheets that import it, found from the index of the workspace's modules - but not in a stylesheet tree that declares
 * a function or template with the same name, which may override it.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';
import { ImportIndex } from '../../src/importIndex';

const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:ex="ex" version="4.0">
  <xsl:function name="ex:greeting">
    <xsl:note format="xdoc-md">
      Greets someone.

      @param $name the name
      @param $greeting the greeting
    </xsl:note>
    <xsl:param name="name"/>
    <xsl:param name="greeting" required="no" select="'Hello'"/>
    <xsl:sequence select="$greeting || ', ' || $name"/>
  </xsl:function>
  <xsl:function name="ex:other">
    <xsl:param name="greeting"/>
    <xsl:sequence select="$greeting"/>
  </xsl:function>
  <xsl:template name="t">
    <xsl:note format="xdoc-md">
      @param $who the person
    </xsl:note>
    <xsl:param name="who"/>
    <xsl:variable name="greeting" select="'x'"/>
    <xsl:sequence select="ex:greeting('Ann', greeting := 'Hi'), ex:other(greeting := $greeting), 'Bob' => ex:greeting(greeting := $who)"/>
  </xsl:template>
  <xsl:template match="/">
    <xsl:call-template name="t"><xsl:with-param name="who" select="'Bob'"/></xsl:call-template>
  </xsl:template>
</xsl:stylesheet>`;

// the text of each line after renaming the symbol at the position of the text, plus the offset
async function rename(text: string, delta: number, newName = 'salutation') {
	const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
	const position = document.positionAt(content.indexOf(text) + delta);
	const provider = new XSLTReferenceProvider();
	const token = new vscode.CancellationTokenSource().token;
	await provider.prepareRename(document, position, token);
	const edit = await provider.provideRenameEdits(document, position, newName, token);
	assert.isTrue(await vscode.workspace.applyEdit(edit!));
	return document.getText().split('\n').map((line) => line.trim());
}

suite('Renaming parameters', () => {
	const functionParamRenamed = (lines: string[]) => {
		assert.include(lines, '@param $salutation the greeting');
		assert.include(lines, `<xsl:param name="salutation" required="no" select="'Hello'"/>`);
		assert.include(lines, `<xsl:sequence select="$salutation || ', ' || $name"/>`);
		// keyword arguments of ex:greeting - but not of ex:other, and not the variable $greeting
		assert.include(lines, `<xsl:sequence select="ex:greeting('Ann', salutation := 'Hi'), ex:other(greeting := $greeting), 'Bob' => ex:greeting(salutation := $who)"/>`);
		assert.include(lines, '<xsl:param name="greeting"/>');
		assert.include(lines, `<xsl:variable name="greeting" select="'x'"/>`);
	};

	test('a function parameter, from its declaration', async () => {
		functionParamRenamed(await rename(`name="greeting" required`, 7));
	});

	test('a function parameter, from a reference', async () => {
		functionParamRenamed(await rename(`$greeting ||`, 2));
	});

	test('a template parameter, with its @param and xsl:with-param', async () => {
		const lines = await rename(`name="who"/>`, 7, 'person');
		assert.include(lines, '@param $person the person');
		assert.include(lines, '<xsl:param name="person"/>');
		assert.include(lines, `<xsl:call-template name="t"><xsl:with-param name="person" select="'Bob'"/></xsl:call-template>`);
		assert.include(lines, `<xsl:sequence select="ex:greeting('Ann', greeting := 'Hi'), ex:other(greeting := $greeting), 'Bob' => ex:greeting(greeting := $person)"/>`);
	});

	test('find all references includes the @param and keyword arguments', async () => {
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		const position = document.positionAt(content.indexOf(`name="greeting" required`) + 7);
		const references = await new XSLTReferenceProvider().provideReferences(document, position, { includeDeclaration: true }, new vscode.CancellationTokenSource().token);
		const lines = (references ?? []).map((r) => r.range.start.line + 1).sort((a, b) => a - b);
		// the @param, the declaration, the reference, and two keyword arguments on one line
		assert.deepEqual(lines, [7, 10, 11, 23, 23]);
	});
	suite('in the stylesheets that import a library', () => {
		const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rename-params-')));
		const file = (name: string) => path.join(dir, name);
		const stylesheet = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:ex="ex" version="4.0">\n${body}\n</xsl:stylesheet>`;
		const greeting = `  <xsl:function name="ex:greeting">\n    <xsl:param name="name"/>\n    <xsl:param name="greeting" required="no" select="'Hello'"/>\n    <xsl:sequence select="$greeting || $name"/>\n  </xsl:function>`;
		const calls = `  <xsl:template name="main"><xsl:sequence select="ex:greeting('Ann', greeting := 'Hi')"/><xsl:call-template name="t"><xsl:with-param name="who" select="'Bob'"/></xsl:call-template></xsl:template>`;
		const files: { [name: string]: string } = {
			'lib.xsl': stylesheet(`${greeting}\n  <xsl:template name="t"><xsl:param name="who"/><xsl:sequence select="$who"/></xsl:template>`),
			'main1.xsl': stylesheet(`  <xsl:import href="lib.xsl"/>\n${calls}`),
			// overrides ex:greeting - but not the template
			'main2.xsl': stylesheet(`  <xsl:import href="lib.xsl"/>\n${greeting}\n${calls}`),
		};
		const open = (name: string) => vscode.workspace.openTextDocument(vscode.Uri.file(file(name)));

		setup(async () => {
			for (const [name, text] of Object.entries(files)) {
				const document = await open(name);
				if (document.getText() !== text) {
					// reset from the previous test
					const edit = new vscode.WorkspaceEdit();
					edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
					await vscode.workspace.applyEdit(edit);
				}
				fs.writeFileSync(file(name), text);
				await document.save();
			}
			await ImportIndex.instance.buildFrom(Object.keys(files).map(file));
		});

		suiteSetup(() => Object.entries(files).forEach(([name, text]) => fs.writeFileSync(file(name), text)));

		suiteTeardown(async () => {
			for (const name of Object.keys(files)) {
				await (await open(name)).save();
				ImportIndex.instance.setReferences(file(name), []);
			}
			ImportIndex.instance.clearChoice(file('lib.xsl'));
			fs.rmSync(dir, { recursive: true, force: true });
		});

		// the texts of the modules after renaming at the text in the library, plus the delta
		async function renameInLibrary(text: string, delta: number, newName: string) {
			const lib = await open('lib.xsl');
			const position = lib.positionAt(lib.getText().indexOf(text) + delta);
			const provider = new XSLTReferenceProvider();
			const token = new vscode.CancellationTokenSource().token;
			await provider.prepareRename(lib, position, token);
			const edit = await provider.provideRenameEdits(lib, position, newName, token);
			assert.isTrue(await vscode.workspace.applyEdit(edit!));
			const texts = new Map<string, string>();
			for (const name of Object.keys(files)) {
				texts.set(name, (await open(name)).getText());
			}
			return texts;
		}

		test('a function parameter: its keyword arguments, except where the function is overridden', async () => {
			const texts = await renameInLibrary(`name="greeting" required`, 7, 'salutation');
			assert.include(texts.get('lib.xsl'), '<xsl:param name="salutation" required="no"');
			assert.include(texts.get('main1.xsl'), `ex:greeting('Ann', salutation := 'Hi')`);
			assert.include(texts.get('main2.xsl'), `ex:greeting('Ann', greeting := 'Hi')`);
			assert.include(texts.get('main2.xsl'), '<xsl:param name="greeting" required="no"');
		});

		test('a template parameter: its xsl:with-param names in each stylesheet', async () => {
			const texts = await renameInLibrary(`name="who"/>`, 7, 'person');
			assert.include(texts.get('lib.xsl'), '<xsl:param name="person"/><xsl:sequence select="$person"/>');
			assert.include(texts.get('main1.xsl'), `<xsl:with-param name="person" select="'Bob'"/>`);
			assert.include(texts.get('main2.xsl'), `<xsl:with-param name="person" select="'Bob'"/>`);
		});

		test('the top-level stylesheet inferred for the library overrides the function', async () => {
			ImportIndex.instance.chooseForModule(file('lib.xsl'), file('main2.xsl'));
			try {
				const params = await renameInLibrary(`name="greeting" required`, 7, 'salutation');
				assert.include(params.get('main2.xsl'), `ex:greeting('Ann', greeting := 'Hi')`);
				assert.include(params.get('main1.xsl'), `ex:greeting('Ann', salutation := 'Hi')`);
			} finally {
				ImportIndex.instance.clearChoice(file('lib.xsl'));
			}
		});

		test('the function itself, with the overriding stylesheet inferred: its calls there are not renamed', async () => {
			ImportIndex.instance.chooseForModule(file('lib.xsl'), file('main2.xsl'));
			try {
				const texts = await renameInLibrary(`name="ex:greeting"`, 9, 'ex:hello');
				assert.include(texts.get('lib.xsl'), '<xsl:function name="ex:hello">');
				assert.include(texts.get('main2.xsl'), `ex:greeting('Ann', greeting := 'Hi')`);
				assert.include(texts.get('main2.xsl'), '<xsl:function name="ex:greeting">');
			} finally {
				ImportIndex.instance.clearChoice(file('lib.xsl'));
			}
		});
	});
});
