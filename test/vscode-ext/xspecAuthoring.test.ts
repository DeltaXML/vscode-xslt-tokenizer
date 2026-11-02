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
import { XsltPackages } from '../../src/xsltPackages';
import { XSLTCodeActions } from '../../src/xsltCodeActions';

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

	test('a test file for a whole stylesheet: a pending scenario for each function and template, then for those added later', async () => {
		const uri = stylesheet(`whole${count++}.xsl`);
		const editor = await XSpecScenario.createFile(uri);
		let text = editor!.document.getText();
		assert.strictEqual(editor!.document.uri.fsPath, uri.fsPath.replace(/\.xsl$/, '.xspec'));
		assert.strictEqual((text.match(/<x:scenario /g) ?? []).length, 3);
		assert.strictEqual((text.match(/pending="to do"/g) ?? []).length, 3);
		assert.include(text, '<x:call function="f:area">');
		assert.include(text, '<x:call template="f:heading">');
		assert.include(text, '<x:context mode="f:summary">');
		await editor!.document.save();
		assert.deepEqual((await moduleDiagnostics.call(XsltSymbolProvider, editor!.document, false, XSpecConfiguration.configuration)).map((d) => d.message), []);
		// a function added to the stylesheet: only its scenario is added
		const stylesheetDocument = await vscode.workspace.openTextDocument(uri);
		const added = new vscode.WorkspaceEdit();
		added.insert(uri, stylesheetDocument.positionAt(stylesheetText.lastIndexOf('</xsl:stylesheet>')), '<xsl:function name="f:extra"><xsl:sequence select="1"/></xsl:function>\n');
		await vscode.workspace.applyEdit(added);
		await stylesheetDocument.save();
		await XSpecScenario.createFile(uri);
		text = editor!.document.getText();
		assert.strictEqual((text.match(/<x:scenario /g) ?? []).length, 4);
		assert.include(text, '<x:call function="f:extra"/>');
	});

	test('a test file for a package: its public functions and templates, run as XSpec runs it externally', async () => {
		const packagePath = path.join(dir, `shapes${count++}.xsl`);
		fs.writeFileSync(packagePath, `<xsl:package name="urn:shapes" package-version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="urn:s" version="3.0">
  <xsl:function name="s:area" visibility="public"><xsl:param name="w"/><xsl:sequence select="$w * $w"/></xsl:function>
  <xsl:function name="s:hidden"><xsl:sequence select="1"/></xsl:function>
  <xsl:template name="s:box" visibility="public"/>
</xsl:package>`);
		XsltPackages.additional = [{ name: 'urn:shapes', version: '1.0', path: packagePath }];
		try {
			const editor = await XSpecScenario.createFile(vscode.Uri.file(packagePath), undefined, 'external');
			const text = editor!.document.getText();
			assert.include(text, 'run-as="external"');
			assert.include(text, `stylesheet="${path.basename(packagePath)}"`);
			assert.notInclude(text, 'x:helper');
			assert.include(text, '<x:call function="s:area">');
			assert.include(text, '<x:call template="s:box"/>');
			assert.notInclude(text, 's:hidden');
			await editor!.document.save();
			assert.deepEqual((await moduleDiagnostics.call(XsltSymbolProvider, editor!.document, false, XSpecConfiguration.configuration)).map((d) => d.message), []);
		} finally {
			XsltPackages.additional = [];
		}
	});

	test('a test file for a package, using it with x:helper: a stylesheet that does nothing, and the package\'s public functions and templates', async () => {
		const packagePath = path.join(dir, `parts${count++}.xsl`);
		fs.writeFileSync(packagePath, `<xsl:package name="urn:parts" package-version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="urn:s" version="3.0">
  <xsl:function name="s:area" visibility="public"><xsl:param name="w"/><xsl:sequence select="$w * $w"/></xsl:function>
  <xsl:function name="s:hidden"><xsl:sequence select="1"/></xsl:function>
</xsl:package>`);
		XsltPackages.additional = [{ name: 'urn:parts', version: '2.0', path: packagePath }];
		try {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(packagePath));
			// a code action for each way XSpec tests a package
			const actions = new XSLTCodeActions().provideCodeActions(document, new vscode.Range(0, 5, 0, 5), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
			assert.deepEqual(actions.map((a) => a.title).filter((t) => t.startsWith('Create XSpec test file')).map((t) => /\((.*)\)$/.exec(t)?.[1]), ['run-as="external"', 'x:helper package-name']);

			const editor = await XSpecScenario.createFile(vscode.Uri.file(packagePath), undefined, 'helper');
			const text = editor!.document.getText();
			const harness = `${path.basename(packagePath, '.xsl')}-xspec-harness.xsl`;
			assert.include(text, `stylesheet="${harness}"`);
			assert.include(text, '<x:helper package-name="urn:parts" package-version="2.0"/>');
			assert.notInclude(text, 'run-as');
			assert.include(text, '<x:call function="s:area">');
			assert.notInclude(text, 's:hidden');
			assert.include(fs.readFileSync(path.join(dir, harness), 'utf8'), '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>');
			await editor!.document.save();
			assert.deepEqual((await moduleDiagnostics.call(XsltSymbolProvider, editor!.document, false, XSpecConfiguration.configuration)).map((d) => d.message), []);
			// a function that isn't public, as for a stylesheet using the package
			const privateCall = vscode.Uri.file(path.join(dir, `private${count++}.xspec`));
			fs.writeFileSync(privateCall.fsPath, text.replace('function="s:area"', 'function="s:hidden"'));
			const privateMessages = (await moduleDiagnostics.call(XsltSymbolProvider, await vscode.workspace.openTextDocument(privateCall), false, XSpecConfiguration.configuration)).map((d) => d.message);
			assert.isTrue(privateMessages.some((m) => m.includes('s:hidden')), JSON.stringify(privateMessages));
		} finally {
			XsltPackages.additional = [];
		}
	});

	test('checks for a package tested externally, and for XPath in an external test', async () => {
		const packagePath = path.join(dir, `checked${count++}.xsl`);
		fs.writeFileSync(packagePath, `<xsl:package name="urn:checked" package-version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:s="urn:s" version="3.0">
  <xsl:function name="s:area" visibility="public"><xsl:param name="w"/><xsl:sequence select="$w * $w"/></xsl:function>
  <xsl:function name="s:hidden"><xsl:sequence select="1"/></xsl:function>
</xsl:package>`);
		XsltPackages.additional = [{ name: 'urn:checked', version: '1.0', path: packagePath }];
		const lint = async (runAs: string, body: string) => {
			const xspecPath = path.join(dir, `checked${count++}.xspec`);
			fs.writeFileSync(xspecPath, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:s="urn:s"${runAs} stylesheet="${path.basename(packagePath)}">\n${body}\n</x:description>`);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(xspecPath));
			return (await moduleDiagnostics.call(XsltSymbolProvider, document, false, XSpecConfiguration.configuration)).map((d) => d.message);
		};
		try {
			// only public components can be called
			assert.deepEqual(await lint(' run-as="external"', '<x:scenario label="s"><x:call function="s:area"><x:param select="1"/></x:call><x:expect label="e" select="1"/></x:scenario>'), []);
			assert.deepEqual(await lint(' run-as="external"', '<x:scenario label="s"><x:call function="s:hidden"/><x:expect label="e" select="1"/></x:scenario>'),
				['XSpec: the function \'s:hidden\' isn\'t public in the package urn:checked - only its public functions and templates can be called']);
			// a package can't be imported into the test runner
			const imported = await lint('', '<x:scenario label="s"><x:call function="s:area"><x:param select="1"/></x:call><x:expect label="e" select="1"/></x:scenario>');
			assert.include(imported, 'XSpec: \'' + path.basename(packagePath) + '\' is the package urn:checked - XSpec can only test a package with run-as="external" on x:description');
			// the stylesheet tested isn't imported, so its functions can't be called in XPath
			const inXPath = await lint(' run-as="external"', '<x:scenario label="s"><x:call function="s:area"><x:param select="1"/></x:call><x:expect label="e" test="$x:result = s:area(1)"/></x:scenario>');
			assert.deepEqual(inXPath, ['XSpec: with run-as="external", the function \'s:area\' of the stylesheet tested can\'t be called in an XPath expression - only with x:call, as the stylesheet isn\'t imported into the test runner']);
		} finally {
			XsltPackages.additional = [];
		}
	});

	test('in an XSpec file: completion and a code action for the functions and templates with no scenario yet', async () => {
		const uri = stylesheet(`untested${count++}.xsl`);
		const xspecPath = path.join(dir, `untested${count++}.xspec`);
		const content = `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="${path.basename(uri.fsPath)}">
  <x:scenario label="area"><x:call function="f:area"><x:param select="1"/><x:param select="'a'"/></x:call><x:expect label="e" select="1"/></x:scenario>
  |
</x:description>`;
		const offset = content.indexOf('|');
		fs.writeFileSync(xspecPath, content.replace('|', '<'));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(xspecPath));
		await vscode.window.showTextDocument(document);
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset + 1));
		const scenarios = list.items.filter((item) => (typeof item.label === 'string' ? item.label : item.label.label).includes(' for '));
		assert.deepEqual(scenarios.map((item) => item.label), ['x:scenario for f:heading', 'x:scenario for template rule list/item[@id]']);
		// xs, for the template's parameter type, is added to x:description
		assert.include(scenarios[0].additionalTextEdits?.map((edit) => edit.newText).join(''), 'xmlns:xs="http://www.w3.org/2001/XMLSchema"');
		// the code action in x:description's start tag
		const position = document.positionAt(content.indexOf('stylesheet'));
		const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri, new vscode.Range(position, position));
		const action = actions.find((a) => a.title.startsWith('Add pending scenarios'));
		assert.strictEqual(action?.title, 'Add pending scenarios for 2 functions and templates with no scenario yet');
		// not where a scenario can't be, e.g. in an x:call
		const inCall = content.indexOf('<x:param select="1"/>') + 1;
		const callList = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(inCall));
		assert.isFalse(callList.items.some((item) => (typeof item.label === 'string' ? item.label : item.label.label).includes(' for ')));
		await vscode.commands.executeCommand(action!.command!.command, ...action!.command!.arguments!);
		const text = document.getText();
		assert.strictEqual((text.match(/pending="to do"/g) ?? []).length, 2);
		assert.include(text, '<x:call template="f:heading">');
	});
});
