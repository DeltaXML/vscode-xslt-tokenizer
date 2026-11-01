/**
 * Test suite for authoring XSpec tests: a scenario created for a stylesheet's function, named template or template rule
 * (see XSpecScenario) - in the XSpec file testing the stylesheet, or a new one beside it
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { XSpecScenario } from '../../src/xspecScenario';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSpecConfiguration } from '../../src/languageConfigurations';
import { LanguageConfiguration } from '../../src/xslLexer';

const stylesheetText = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:f="urn:f" version="3.0">
  <xsl:function name="f:area" as="xs:double">
    <xsl:param name="width" as="xs:double"/>
    <xsl:param name="label" as="xs:string"/>
    <xsl:sequence select="$width * $width"/>
  </xsl:function>
  <xsl:template name="f:heading">
    <xsl:param name="text" as="xs:string"/>
    <xsl:param name="depth" tunnel="yes"/>
    <h1><xsl:value-of select="$text"/></h1>
  </xsl:template>
  <xsl:template match="list/item[@id]" mode="f:summary">
    <li/>
  </xsl:template>
</xsl:stylesheet>`;

suite('XSpec authoring: a scenario for a function or template', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xspec-authoring-'));
	let count = 0;
	const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
	const stylesheet = (name: string) => {
		const fsPath = path.join(dir, name);
		fs.writeFileSync(fsPath, stylesheetText);
		return vscode.Uri.file(fsPath);
	};
	const at = (text: string) => stylesheetText.indexOf(text) + 2;

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	test('the declaration at the cursor: a top-level function, named template or template rule', () => {
		assert.deepEqual(XSpecScenario.declarationAt(stylesheetText, at('<xsl:function')), { kind: 'function', name: 'f:area', as: 'xs:double', params: [{ name: 'width', as: 'xs:double' }, { name: 'label', as: 'xs:string' }] });
		// a tunnel parameter isn't passed by x:call
		assert.deepEqual(XSpecScenario.declarationAt(stylesheetText, at('<xsl:template name')), { kind: 'template', name: 'f:heading', as: undefined, params: [{ name: 'text', as: 'xs:string' }] });
		assert.deepEqual(XSpecScenario.declarationAt(stylesheetText, at('<xsl:template match')), { kind: 'rule', name: 'list/item[@id]', mode: 'f:summary', params: [] });
		// not within the start tag
		assert.isUndefined(XSpecScenario.declarationAt(stylesheetText, at('<xsl:sequence')));
	});

	test('a new XSpec file beside the stylesheet, with a scenario for the function', async () => {
		const uri = stylesheet(`prices${count++}.xsl`);
		const editor = await XSpecScenario.create(uri, at('<xsl:function'));
		const xspecPath = uri.fsPath.replace(/\.xsl$/, '.xspec');
		assert.strictEqual(editor?.document.uri.fsPath, xspecPath);
		const text = editor!.document.getText();
		assert.include(text, `stylesheet="${path.basename(uri.fsPath)}"`);
		assert.include(text, '<x:call function="f:area">');
		assert.include(text, '<x:param as="xs:double" select="1"/><!-- $width -->');
		assert.include(text, '<x:param as="xs:string" select="\'text\'"/><!-- $label -->');
		assert.include(text, '<x:expect label="the result" select="()"/>');
		// the function's namespace, and xs for the types, declared on x:description
		assert.match(text, /<x:description [^>]*xmlns:f="urn:f" xmlns:xs="http:\/\/www.w3.org\/2001\/XMLSchema">/);
		assert.include(text, '<x:scenario label="f:area">');
		await editor!.document.save();
		const problems = await moduleDiagnostics.call(XsltSymbolProvider, editor!.document, false, XSpecConfiguration.configuration);
		assert.deepEqual(problems.map((d) => d.message), []);
	});

	test('in the XSpec file testing the stylesheet, with its prefix for XSpec: a named template and a template rule', async () => {
		const uri = stylesheet(`report${count++}.xsl`);
		const xspecPath = path.join(dir, `tests-for-${path.basename(uri.fsPath, '.xsl')}.xspec`);
		fs.writeFileSync(xspecPath, `<t:description xmlns:t="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="${path.basename(uri.fsPath)}">
  <t:scenario label="existing"><t:call template="f:heading"><t:param name="text" select="'a'"/></t:call><t:expect label="e"><h1>a</h1></t:expect></t:scenario>
</t:description>`);
		await vscode.workspace.openTextDocument(vscode.Uri.file(xspecPath));
		let editor = await XSpecScenario.create(uri, at('<xsl:template name'));
		assert.strictEqual(editor?.document.uri.fsPath, xspecPath);
		editor = await XSpecScenario.create(uri, at('<xsl:template match'));
		const text = editor!.document.getText();
		// f is declared already on t:description: only xs is added to it
		assert.match(text, /<t:description [^>]*xmlns:f="urn:f" stylesheet="[^"]*" xmlns:xs="http:\/\/www.w3.org\/2001\/XMLSchema">/);
		assert.include(text, '<t:scenario label="f:heading">');
		assert.include(text, '<t:call template="f:heading">');
		assert.include(text, '<t:param name="text" as="xs:string" select="\'text\'"/>');
		assert.notInclude(text, 'name="depth"');
		assert.include(text, '<t:context mode="f:summary">');
		assert.include(text, '<item/>');
		assert.match(text, /<\/t:scenario>\s*<\/t:description>\s*$/);
		await editor!.document.save();
		const problems = await moduleDiagnostics.call(XsltSymbolProvider, editor!.document, false, XSpecConfiguration.configuration);
		assert.deepEqual(problems.map((d) => d.message), []);
	});

	test('the code action, in the start tag of a function', async () => {
		const uri = stylesheet(`actions${count++}.xsl`);
		const document = await vscode.workspace.openTextDocument(uri);
		const position = document.positionAt(at('<xsl:function'));
		const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, new vscode.Range(position, position));
		assert.include(actions.map((a) => a.title), 'Create XSpec scenario for function f:area');
	});

	test('completion in x:call: an x:param for each parameter not passed - by name for a template, in order for a function', async () => {
		const uri = stylesheet(`params${count++}.xsl`);
		const labels = async (body: string, prefix = 'x') => {
			const content = `<${prefix}:description xmlns:${prefix}="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="${path.basename(uri.fsPath)}">\n${body}\n</${prefix}:description>`;
			const offset = content.indexOf('|');
			const xspecPath = path.join(dir, `params${count++}.xspec`);
			fs.writeFileSync(xspecPath, content.replace('|', ''));
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(xspecPath));
			await vscode.window.showTextDocument(document);
			const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
			return list.items.map((item) => typeof item.label === 'string' ? item.label : item.label.label).filter((label) => label.includes(':param '));
		};
		assert.deepEqual(await labels(`<x:scenario label="s"><x:call template="f:heading">\n<|\n</x:call></x:scenario>`), ['x:param text', 'x:param depth']);
		assert.deepEqual(await labels(`<x:scenario label="s"><x:call function="f:area"><x:param select="2"/>\n<|\n</x:call></x:scenario>`), ['x:param label']);
		// with the file's prefix for XSpec
		assert.deepEqual(await labels(`<t:scenario label="s"><t:call template="f:heading"><t:param name="text" select="'a'"/>\n<|\n</t:call></t:scenario>`, 't'), ['t:param depth']);
	});
});
