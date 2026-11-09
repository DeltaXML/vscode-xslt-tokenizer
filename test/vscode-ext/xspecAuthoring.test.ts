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

	test('an XSpec file with no outermost element: x:description after \'<\', for each stylesheet beside it, or above an xspec folder - with its name first', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xspec-root-'));
		fs.mkdirSync(path.join(root, 'xspec'));
		fs.writeFileSync(path.join(root, 'order.xsl'), '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:o="urn:o" version="3.0"><xsl:function name="o:total"><xsl:param name="n"/><xsl:sequence select="$n"/></xsl:function></xsl:stylesheet>');
		fs.writeFileSync(path.join(root, 'shapes.xsl'), '<xsl:package name="urn:shapes" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>');
		const completions = async (file: string, content: string) => {
			fs.writeFileSync(path.join(root, file), content);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, file)));
			return XSpecScenario.rootCompletions(document, document.positionAt(content.length));
		};
		const labels = (items: vscode.CompletionItem[]) => items.map((c) => c.label);
		const body = (item: vscode.CompletionItem) => (item.insertText as vscode.SnippetString).value;
		// for each stylesheet beside it - the one with its name first, preselected - then empty
		const beside = (await completions('order.xspec', '<'))!;
		assert.deepEqual(labels(beside), ['x:description with pending scenarios for order.xsl', 'x:description with pending scenarios for shapes.xsl',
			'x:description for a stylesheet', 'x:description for a Schematron']);
		assert.isTrue(beside[0].preselect);
		assert.isFalse(beside[1].preselect);
		assert.include(body(beside[0]), 'x:description xmlns:x="http://www.jenitennison.com/xslt/xspec"');
		assert.include(body(beside[0]), 'xmlns:xs="http://www.w3.org/2001/XMLSchema"');
		assert.include(body(beside[0]), 'stylesheet="order.xsl"');
		assert.include(body(beside[0]), '</x:description>');
		// a package: run externally
		assert.include(body(beside[1]), 'run-as="external"');
		assert.notInclude(body(beside[0]), 'run-as');
		// empty: a choice of the stylesheets
		assert.include(body(beside[2]), 'stylesheet="${1|order.xsl,shapes.xsl|}"');
		// in an xspec folder: those in the folder above
		const inFolder = (await completions('xspec/order.xspec', '<?xml version="1.0"?>\n<x:d'))!;
		assert.deepEqual(labels(inFolder).slice(0, 2), ['x:description with pending scenarios for ../order.xsl', 'x:description with pending scenarios for ../shapes.xsl']);
		// none with its name: the others, none preselected
		const other = (await completions('other.xspec', '<'))!;
		assert.deepEqual(labels(other).slice(0, 2), ['x:description with pending scenarios for order.xsl', 'x:description with pending scenarios for shapes.xsl']);
		assert.isFalse(other.some((c) => c.preselect));
		// no stylesheet: a placeholder
		fs.mkdirSync(path.join(root, 'empty'));
		const none = (await completions('empty/none.xspec', '<'))!;
		assert.deepEqual(labels(none), ['x:description for a stylesheet', 'x:description for a Schematron']);
		assert.include(body(none[0]), 'stylesheet="${1:stylesheet.xsl}"');
		// not once there's an outermost element
		assert.isUndefined(await completions('started.xspec', '<x:description stylesheet="order.xsl">\n<'));

		// with pending scenarios: x:description, then a scenario for each function and template, as the code action adds
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, 'order.xspec')));
		const editor = await vscode.window.showTextDocument(document);
		const first = beside[0];
		await editor.insertSnippet(first.insertText as vscode.SnippetString, first.range as vscode.Range);
		await vscode.commands.executeCommand(first.command!.command, ...first.command!.arguments!);
		const text = editor.document.getText();
		assert.match(text, /^<x:description xmlns:x="http:\/\/www\.jenitennison\.com\/xslt\/xspec"/);
		assert.include(text, 'stylesheet="order.xsl"');
		assert.include(text, 'xmlns:o="urn:o"');
		assert.include(text, '<x:call function="o:total">');
		assert.include(text, 'pending="to do"');
		assert.match(text, /<\/x:description>\s*$/);
	});

	test('x:variable and scenario x:param: with a name and a type, for a value in select or as content', async () => {
		const uri = stylesheet(`snippets${count++}.xsl`);
		const xspecPath = path.join(dir, `snippets${count++}.xspec`);
		const content = `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="${path.basename(uri.fsPath)}">
  <x:scenario label="area">
    IN_SCENARIO
    <x:call function="f:area">IN_CALL</x:call>
  </x:scenario>
</x:description>`;
		const text = content.replace('IN_SCENARIO', '<').replace('IN_CALL', '<');
		fs.writeFileSync(xspecPath, text);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(xspecPath));
		await vscode.window.showTextDocument(document);
		const completions = async (marker: string) => {
			const offset = content.replace(marker === 'IN_SCENARIO' ? 'IN_CALL' : 'IN_SCENARIO', '<').indexOf(marker) + 1;
			const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
			return new Map(list.items.map((item) => [typeof item.label === 'string' ? item.label : item.label.label, item.insertText instanceof vscode.SnippetString ? item.insertText.value : String(item.insertText)]));
		};
		const inScenario = await completions('IN_SCENARIO');
		assert.strictEqual(inScenario.get('x:variable (select)'), 'x:variable name="${1:name}" as="${2:item()*}" select="$3"/>$0');
		assert.strictEqual(inScenario.get('x:variable'), 'x:variable name="${1:name}" as="${2:item()*}">\n\t$0\n</x:variable>');
		assert.strictEqual(inScenario.get('x:param (select)'), 'x:param name="${1:name}" as="${2:item()*}" select="$3"/>$0');
		// an x:param of x:call passes a value: not a declaration
		const inCall = await completions('IN_CALL');
		assert.isFalse(inCall.has('x:param (select)'));
		assert.notInclude(inCall.get('x:param') ?? '', 'item()*');
	});

	test('variable completion where XPath is expected: the variables in scope as XSpec scopes them, with their types', async () => {
		const uri = stylesheet(`scoped${count++}.xsl`);
		const sharedName = `shared${count++}.xspec`;
		fs.writeFileSync(path.join(dir, sharedName), `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" stylesheet="${path.basename(uri.fsPath)}">
  <x:variable name="imported-global" select="2"/>
  <x:scenario label="common" shared="yes"><x:variable name="from-shared" as="xs:integer" select="3"/></x:scenario>
</x:description>`);
		const xspecPath = path.join(dir, `scoped${count++}.xspec`);
		const content = `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="${path.basename(uri.fsPath)}">
  <x:import href="${sharedName}"/>
  <x:variable name="own-global" select="1"/>
  <x:scenario label="outer">
    <x:variable name="outer-var" as="element(item)"><item/></x:variable>
    <x:scenario label="area">
      <x:like label="common"/>
      <x:variable name="local" as="xs:double" select="1"/>
      <x:variable name="this-one" select="$|"/>
      <x:call function="f:area"><x:param select="1"/><x:param select="'a'"/></x:call>
      <x:variable name="later" select="1"/>
    </x:scenario>
  </x:scenario>
  <x:scenario label="other"><x:variable name="not-visible" select="1"/></x:scenario>
</x:description>`;
		const offset = content.indexOf('|');
		fs.writeFileSync(xspecPath, content.replace('|', ''));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(xspecPath));
		await vscode.window.showTextDocument(document);
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
		const variables = new Map(list.items.filter((item) => item.kind === vscode.CompletionItemKind.Variable)
			.map((item) => [typeof item.label === 'string' ? item.label : item.label.label, item.detail]));
		for (const name of ['$own-global', '$imported-global', '$outer-var', '$from-shared', '$local']) {
			assert.isTrue(variables.has(name), `${name} in ${[...variables.keys()].join(' ')}`);
		}
		for (const name of ['$this-one', '$later', '$not-visible']) {
			assert.isFalse(variables.has(name), name);
		}
		assert.strictEqual(variables.get('$local'), 'xs:double');
		assert.strictEqual(variables.get('$outer-var'), 'element(item)');
		assert.strictEqual(variables.get('$from-shared'), 'xs:integer');
	});

	test('variable completion in a shared scenario: those in scope at every x:like using it', async () => {
		const uri = stylesheet(`template${count++}.xsl`);
		const xspecPath = path.join(dir, `template${count++}.xspec`);
		const content = `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="${path.basename(uri.fsPath)}">
  <x:scenario label="sized" shared="yes">
    <x:call function="f:area"><x:param select="$|"/><x:param select="'a'"/></x:call>
  </x:scenario>
  <x:scenario label="small"><x:variable name="width" select="1"/><x:variable name="only-small" select="1"/><x:like label="sized"/></x:scenario>
  <x:scenario label="large"><x:variable name="width" select="1000"/><x:like label="sized"/></x:scenario>
</x:description>`;
		const offset = content.indexOf('|');
		fs.writeFileSync(xspecPath, content.replace('|', ''));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(xspecPath));
		await vscode.window.showTextDocument(document);
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
		const variables = list.items.filter((item) => item.kind === vscode.CompletionItemKind.Variable).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
		assert.include(variables, '$width');
		assert.notInclude(variables, '$only-small');
	});
});
