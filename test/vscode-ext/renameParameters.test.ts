/**
 * Test suite for renaming a parameter of a function or template: as well as the declaration and its references, the
 * @param for it in the declaration's documentation note (xsl:note format="xdoc-md") is renamed, and for a function
 * parameter, keyword arguments for it in calls of the function, e.g. greeting := 'Hi' - but not keyword arguments with
 * the same name in calls of other functions, or variables with the same name.
 * For a function or template in a library module, its calls, keyword arguments and xsl:with-param names are also
 * renamed in the stylesheets that import it, found from the index of the workspace's modules - but a rename is refused when
 * another module declares a function (with an arity in common) or template with the same name, which may override it.
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
		const calls = `  <xsl:template name="main"><xsl:sequence select="ex:greeting('Ann', greeting := 'Hi'), ex:farewell('a')"/><xsl:call-template name="t"><xsl:with-param name="who" select="'Bob'"/></xsl:call-template></xsl:template>`;
		const farewell = (params: number) => `  <xsl:function name="ex:farewell">${'<xsl:param name="p"/><xsl:param name="q"/>'.substring(0, params * 22)}<xsl:sequence select="1"/></xsl:function>`;
		const files: { [name: string]: string } = {
			'lib.xsl': stylesheet(`${greeting}\n${farewell(1)}\n  <xsl:template name="t"><xsl:param name="who"/><xsl:sequence select="$who"/></xsl:template>`),
			'main1.xsl': stylesheet(`  <xsl:import href="lib.xsl"/>\n${calls}`),
			// overrides ex:greeting - and declares ex:farewell with another arity, which doesn't override it, and calls both
			'main2.xsl': stylesheet(`  <xsl:import href="lib.xsl"/>\n${greeting}\n${farewell(2)}\n${calls}\n  <xsl:variable name="v" select="ex:farewell('a', 'b')"/>`),
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

		// the rename at the text in the library, plus the delta, is refused - with the reason
		async function refusedInLibrary(text: string, delta: number) {
			const lib = await open('lib.xsl');
			const position = lib.positionAt(lib.getText().indexOf(text) + delta);
			try {
				await new XSLTReferenceProvider().prepareRename(lib, position, new vscode.CancellationTokenSource().token);
			} catch (reason) {
				return String(reason);
			}
			assert.fail('the rename is not refused');
		}

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

		test('a function parameter: refused, as the function may be overridden', async () => {
			const reason = await refusedInLibrary(`name="greeting" required`, 7);
			assert.equal(reason, 'XSLT: ex:greeting is also declared in main2.xsl, where it may override this function, or be overridden by it - so renaming a parameter of the function ex:greeting could change which function is called');
		});

		test('the function itself: refused, as it may be overridden', async () => {
			assert.include(await refusedInLibrary(`name="ex:greeting"`, 9), 'so renaming the function ex:greeting could change which function is called');
		});

		test('refused too when the overriding stylesheet is the one inferred for the library', async () => {
			ImportIndex.instance.chooseForModule(file('lib.xsl'), file('main2.xsl'));
			try {
				assert.include(await refusedInLibrary(`name="greeting" required`, 7), 'also declared in main2.xsl');
			} finally {
				ImportIndex.instance.clearChoice(file('lib.xsl'));
			}
		});

		test('find all references for an overridden function parameter: not in the overriding stylesheet', async () => {
			const lib = await open('lib.xsl');
			const position = lib.positionAt(lib.getText().indexOf(`name="greeting" required`) + 7);
			const locations = await new XSLTReferenceProvider().provideReferences(lib, position, { includeDeclaration: true }, new vscode.CancellationTokenSource().token) ?? [];
			assert.isTrue(locations.some((l) => l.uri.fsPath === file('main1.xsl')));
			assert.isFalse(locations.some((l) => l.uri.fsPath === file('main2.xsl')));
		});

		test('a template parameter: its xsl:with-param names in each stylesheet', async () => {
			const texts = await renameInLibrary(`name="who"/>`, 7, 'person');
			assert.include(texts.get('lib.xsl'), '<xsl:param name="person"/><xsl:sequence select="$person"/>');
			assert.include(texts.get('main1.xsl'), `<xsl:with-param name="person" select="'Bob'"/>`);
			assert.include(texts.get('main2.xsl'), `<xsl:with-param name="person" select="'Bob'"/>`);
		});

		test('a template: its calls in each stylesheet', async () => {
			const texts = await renameInLibrary(`name="t"`, 6, 'show');
			assert.include(texts.get('lib.xsl'), '<xsl:template name="show">');
			assert.include(texts.get('main1.xsl'), '<xsl:call-template name="show">');
			assert.include(texts.get('main2.xsl'), '<xsl:call-template name="show">');
		});

		test('a function with another arity in a stylesheet: its calls with its arity in each stylesheet', async () => {
			const texts = await renameInLibrary(`name="ex:farewell"`, 9, 'ex:bye');
			assert.include(texts.get('lib.xsl'), '<xsl:function name="ex:bye">');
			assert.include(texts.get('main1.xsl'), `ex:bye('a')`);
			assert.include(texts.get('main2.xsl'), `ex:bye('a')`);
			// the other function, with 2 parameters, and its call
			assert.include(texts.get('main2.xsl'), '<xsl:function name="ex:farewell"><xsl:param name="p"/><xsl:param name="q"/>');
			assert.include(texts.get('main2.xsl'), `ex:farewell('a', 'b')`);
		});
	});
});
