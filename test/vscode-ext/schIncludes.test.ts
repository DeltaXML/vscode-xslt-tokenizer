/**
 * Test suite for Schematron's files in the Imports view - 'Schematron Includes': for a Schematron file, the schema that
 * includes it, found from an index of the workspace's .sch files, with the files the schema brings in. And the SchXslt2
 * checks of a file sch:include brings in, whose root is e.g. a pattern.
 *
 * The test host has no workspace folder, so the index is built from the files written to a temporary folder.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { SchIncludes } from '../../src/schIncludes';
import { ImportTreeProvider, ImportNode } from '../../src/importTreeProvider';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { SchConfiguration } from '../../src/languageConfigurations';
import { LanguageConfiguration } from '../../src/xslLexer';
import { SchXslt2Checks } from '../../src/schXslt2Checks';

const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sch-includes-')));
const iso = 'xmlns="http://purl.oclc.org/dsdl/schematron"';
const xsl = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform"';
const files: { [name: string]: string } = {
	'main.sch': `<schema ${iso} ${xsl} queryBinding="xslt3">
  <xsl:include href="lib/functions.xsl"/>
  <include href="patterns/orders.sch"/>
  <pattern id="p"><rule context="a"><extends href="rules/abstract.sch"/></rule></pattern>
</schema>`,
	'patterns/orders.sch': `<pattern ${iso} id="orders"><rule context="order"><assert test="@id">x</assert></rule></pattern>`,
	'rules/abstract.sch': `<rule ${iso} abstract="true" id="r"><assert test="@b">y</assert></rule>`,
	'lib/functions.xsl': `<xsl:stylesheet ${xsl} version="3.0"><xsl:import href="more.xsl"/></xsl:stylesheet>`,
	'lib/more.xsl': `<xsl:stylesheet ${xsl} version="3.0"/>`,
	// a pattern file two schemas include: one in its folder, one in another - the other first in the index
	'multi/far/far.sch': `<schema ${iso}><include href="../shared/common.sch"/></schema>`,
	'multi/shared/near.sch': `<schema ${iso}><include href="common.sch"/></schema>`,
	'multi/shared/common.sch': `<pattern ${iso} id="common"><rule context="a"><assert test="b">x</assert></rule></pattern>`,
	'cycle-a.sch': `<schema ${iso}><include href="cycle-b.sch"/></schema>`,
	// a schema whose included files use its sch:ns prefixes, variables and the functions of its XSLT module
	'ctx/main.sch': `<schema ${iso} ${xsl} queryBinding="xslt3">
  <ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <ns prefix="o" uri="urn:o"/>
  <xsl:include href="lib/f.xsl"/>
  <xsl:function name="o:inline"><xsl:sequence select="1"/></xsl:function>
  <let name="max" value="10"/>
  <phase id="ph"><let name="phaseVar" value="1"/><active pattern="p"/></phase>
  <include href="patterns/p.sch"/>
  <pattern id="q"><let name="patternVar" value="2"/><include href="patterns/rule.sch"/></pattern>
  <pattern id="r"><let name="unused" value="3"/><rule context="z"><assert test="o:f(1)">z</assert></rule></pattern>
  <include href="patterns/own.sch"/>
</schema>`,
	// an included file with its own $max, which hides the schema's
	'ctx/patterns/own.sch': `<pattern ${iso} id="own"><rule context="c"><let name="max" value="99"/><assert test="$max">o</assert></rule></pattern>`,
	'ctx/lib/f.xsl': `<xsl:stylesheet ${xsl} version="3.0" xmlns:o="urn:o"><xsl:function name="o:f"><xsl:param name="n"/><xsl:sequence select="$n"/></xsl:function></xsl:stylesheet>`,
	'ctx/patterns/p.sch': `<pattern ${iso} id="p">
  <rule context="item"><assert test="xs:integer(@n) le $max and o:f(.) and $phaseVar and o:inline()">x</assert></rule>
</pattern>`,
	'ctx/patterns/rule.sch': `<rule ${iso} context="b">
  <assert test="$patternVar and $max and $undeclared and u:nope(.)">y</assert>
</rule>`,
	'cycle-b.sch': `<pattern ${iso}><include href="cycle-a.sch"/></pattern>`
};
const file = (name: string) => path.join(folder, name);

suite('Schematron includes', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		Object.entries(files).forEach(([name, content]) => {
			fs.mkdirSync(path.dirname(file(name)), { recursive: true });
			fs.writeFileSync(file(name), content);
		});
		SchIncludes.instance.buildFrom(Object.keys(files).filter((name) => name.endsWith('.sch')).map(file));
	});
	suiteTeardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	test('the files a schema refers to: sch:include, sch:extends href, and xsl:include and xsl:import at the top level', () => {
		const references = SchIncludes.referencesIn(files['main.sch'], file('main.sch'));
		assert.deepEqual(references.map((r) => [r.kind, path.relative(folder, r.path)]), [
			['xsl:include', path.join('lib', 'functions.xsl')],
			['sch:include', path.join('patterns', 'orders.sch')],
			['sch:extends', path.join('rules', 'abstract.sch')]
		]);
		// not an xsl:include within an XSLT element, which SchXslt2 doesn't copy
		assert.deepEqual(SchIncludes.referencesIn(`<schema ${iso} ${xsl}><xsl:function name="f"><xsl:include href="x.xsl"/></xsl:function></schema>`, file('x.sch')), []);
	});

	test('the schemas that include a file - and the chain from the schema, with no endless cycle', () => {
		assert.deepEqual(SchIncludes.instance.includersOf(file('patterns/orders.sch')), [file('main.sch')]);
		assert.deepEqual(SchIncludes.instance.chain(file('rules/abstract.sch')), [file('main.sch'), file('rules/abstract.sch')]);
		assert.deepEqual(SchIncludes.instance.chain(file('main.sch')), [file('main.sch')]);
		assert.deepEqual(SchIncludes.instance.chain(file('cycle-b.sch')), [file('cycle-a.sch'), file('cycle-b.sch')]);
	});

	test('a file more than one schema includes: the nearest, unless one is chosen - for its tree, or the file alone - shown in the view', async () => {
		const includes = SchIncludes.instance;
		const common = file('multi/shared/common.sch');
		try {
			assert.deepEqual(includes.chain(common), [file('multi/shared/near.sch'), common]);
			assert.isFalse(includes.isChosen(common));
			assert.deepEqual(includes.topLevelCandidates(common).sort(), [file('multi/far/far.sch'), file('multi/shared/near.sch')]);
			// chosen for its tree
			includes.chooseSchema(file('multi/far/far.sch'), common);
			assert.deepEqual(includes.chain(common), [file('multi/far/far.sch'), common]);
			assert.isTrue(includes.isChosen(common));
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(common));
			const provider = new ImportTreeProvider(() => document);
			const [root] = provider.getChildren();
			const item = provider.getTreeItem(root);
			assert.deepEqual([item.label, item.description], ['far.sch', 'chosen - includes it']);
			assert.include(item.tooltip as string, 'common.sch is also included by: ');
			assert.include(item.tooltip as string, 'near.sch');
			// for the file alone, then the nearest again
			includes.chooseForFile(common, file('multi/shared/near.sch'));
			assert.deepEqual(includes.chain(common), [file('multi/shared/near.sch'), common]);
			assert.isTrue(includes.isChosen(common));
			includes.clearChoice(common);
			assert.deepEqual(includes.chain(common), [file('multi/shared/near.sch'), common]);
			assert.isFalse(includes.isChosen(common));
			// saved and restored
			includes.chooseSchema(file('multi/far/far.sch'), common);
			const saved = includes.choices;
			includes.resetChoices();
			assert.deepEqual(includes.chain(common)[0], file('multi/shared/near.sch'));
			includes.setChoices(saved);
			assert.deepEqual(includes.chain(common)[0], file('multi/far/far.sch'));
		} finally {
			includes.resetChoices();
		}
	});

	test('the view, for an included file: the schema that includes it, with the path to the file expanded - and the XSLT modules\' own imports', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('patterns/orders.sch')));
		assert.strictEqual(document.languageId, 'sch');
		const provider = new ImportTreeProvider(() => document);
		const describe = (node: ImportNode) => {
			const item = provider.getTreeItem(node);
			return [item.label, item.description, vscode.TreeItemCollapsibleState[item.collapsibleState!], (item.iconPath as vscode.ThemeIcon).id, item.contextValue];
		};
		const [root] = provider.getChildren();
		assert.deepEqual(describe(root), ['main.sch', 'includes it', 'Expanded', 'root-folder', 'schema']);
		assert.include(provider.getTreeItem(root).tooltip as string, 'Schematron schema');
		const children = provider.getChildren(root);
		assert.deepEqual(children.map(describe), [
			['functions.xsl', 'lib', 'Collapsed', 'file-symlink-file', 'schemaModule'],
			['orders.sch', 'patterns · current', 'None', 'arrow-right', 'schemaModule'],
			['abstract.sch', 'rules', 'None', 'file-symlink-file', 'schemaModule']
		]);
		assert.deepEqual(children.map((c) => (provider.getTreeItem(c).tooltip as string).split('\n')[1]), ['xsl:include', 'sch:include', 'sch:extends']);
		// an XSLT module's own imports
		assert.deepEqual(provider.getChildren(children[0]).map((c) => provider.getTreeItem(c).label), ['more.xsl']);
	});

	test('the view, for a schema nothing includes: the schema itself', async () => {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file('main.sch')));
		const provider = new ImportTreeProvider(() => document);
		const [root] = provider.getChildren();
		const item = provider.getTreeItem(root);
		assert.deepEqual([item.label, item.description, (item.iconPath as vscode.ThemeIcon).id], ['main.sch', 'current', 'arrow-right']);
	});

	test('a file sch:include brings in is checked with what\'s in scope where it\'s included: sch:ns prefixes, variables, and the schema\'s XSLT functions', async () => {
		const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
		const problems = async (name: string) => (await moduleDiagnostics.call(XsltSymbolProvider, await vscode.workspace.openTextDocument(vscode.Uri.file(file(name))), true, SchConfiguration.configuration))
			.map((d) => `${vscode.DiagnosticSeverity[d.severity]}: ${d.message}`);
		// the schema's global variable, a phase's, its sch:ns prefixes, and the function of its xsl:include
		assert.deepEqual(await problems('ctx/patterns/p.sch'), []);
		// included within a pattern: the pattern's variable too - but not what nothing declares
		assert.deepEqual(await problems('ctx/patterns/rule.sch'), [
			'Error: XPath: The variable/parameter $undeclared cannot be resolved',
			'Error: XPath: The prefix \'u\' isn\'t declared with sch:ns - SchXslt2 declares only the sch:ns prefixes in its validation stylesheet, not those declared with xmlns'
		]);
		// the schema's variables used only in the files it includes aren't unused - $unused is
		assert.deepEqual(await problems('ctx/main.sch'), ['Hint: variable is unused']);
	});

	test('variables across files: Go to Definition, Find All References, Rename and hover - from an included file to the schema, and back', async () => {
		const open = async (name: string) => vscode.workspace.openTextDocument(vscode.Uri.file(file(name)));
		const at = (document: vscode.TextDocument, text: string, after = '') => document.positionAt(document.getText().indexOf(text, document.getText().indexOf(after)) + 2);
		const where = (locations: vscode.Location[] | undefined) => (locations ?? []).map((l) => `${path.relative(folder, l.uri.fsPath)}:${l.range.start.line}:${l.range.start.character}`).sort();
		const p = await open('ctx/patterns/p.sch');
		const main = await open('ctx/main.sch');
		const maxDeclaration = `${path.join('ctx', 'main.sch')}:${main.positionAt(main.getText().indexOf('name="max"') + 6).line}:${main.positionAt(main.getText().indexOf('name="max"') + 6).character}`;
		// from the included file: the schema's declaration
		assert.deepEqual(where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', p.uri, at(p, '$max'))), [maxDeclaration]);
		// its references: in the files the schema includes - not in own.sch, whose $max is its own
		const references = where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', p.uri, at(p, '$max')));
		assert.deepEqual(references.map((r) => r.split(':')[0]).sort(), [path.join('ctx', 'main.sch'), path.join('ctx', 'patterns', 'p.sch'), path.join('ctx', 'patterns', 'rule.sch')]);
		// the same from the schema's declaration
		assert.deepEqual(where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', main.uri, main.positionAt(main.getText().indexOf('name="max"') + 7))), references);
		// rename: in each file
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', p.uri, at(p, '$max'), 'limit');
		assert.deepEqual(edit.entries().map(([uri, edits]) => `${path.relative(folder, uri.fsPath)}:${edits.length}`).sort(),
			[`${path.join('ctx', 'main.sch')}:1`, `${path.join('ctx', 'patterns', 'p.sch')}:1`, `${path.join('ctx', 'patterns', 'rule.sch')}:1`]);
		// included within a pattern: the pattern's variable
		const rule = await open('ctx/patterns/rule.sch');
		const patternVar = where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', rule.uri, at(rule, '$patternVar')));
		assert.deepEqual(patternVar.map((l) => l.split(':')[0]), [path.join('ctx', 'main.sch')]);
		// hover: the declaration, in the schema
		const hover = (await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', p.uri, at(p, '$max')))
			.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n');
		assert.include(hover, 'let $max := 10');
		assert.include(hover, 'which includes this file');
		// own.sch's $max: its own
		const own = await open('ctx/patterns/own.sch');
		assert.deepEqual(where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', own.uri, at(own, '$max'))).map((l) => l.split(':')[0]), [path.join('ctx', 'patterns', 'own.sch')]);
	});

	test('functions across files: Go to Definition, Find All References and Rename for a call of an XSLT function - from a Schematron file, and from the module', async () => {
		const open = async (name: string) => vscode.workspace.openTextDocument(vscode.Uri.file(file(name)));
		const at = (document: vscode.TextDocument, text: string) => document.positionAt(document.getText().indexOf(text) + 2);
		const where = (locations: (vscode.Location | vscode.LocationLink)[] | undefined) => (locations ?? []).map((l) => {
			const uri = 'uri' in l ? l.uri : l.targetUri;
			const range = 'range' in l ? l.range : l.targetSelectionRange ?? l.targetRange;
			return `${path.relative(folder, uri.fsPath)}:${range.start.line}`;
		}).sort();
		const p = await open('ctx/patterns/p.sch');
		const main = await open('ctx/main.sch');
		const module = await open('ctx/lib/f.xsl');
		const fDeclaration = `${path.join('ctx', 'lib', 'f.xsl')}:0`;
		// a function of the XSLT module the schema includes: from the included file, the schema and the module
		const calls = [fDeclaration, `${path.join('ctx', 'main.sch')}:${main.positionAt(main.getText().indexOf('o:f(1)')).line}`, `${path.join('ctx', 'patterns', 'p.sch')}:1`].sort();
		assert.deepEqual(where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', p.uri, at(p, 'o:f('))), [fDeclaration]);
		for (const [document, position] of [[p, at(p, 'o:f(')], [main, at(main, 'o:f(1)')], [module, module.positionAt(module.getText().indexOf('name="o:f"') + 7)]] as const) {
			assert.deepEqual(where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, position)), calls, path.basename(document.fileName));
		}
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', p.uri, at(p, 'o:f('), 'o:g');
		assert.deepEqual(edit.entries().map(([uri, edits]) => `${path.relative(folder, uri.fsPath)}:${edits.map((e) => e.newText).join(',')}`).sort(),
			[`${path.join('ctx', 'lib', 'f.xsl')}:o:g`, `${path.join('ctx', 'main.sch')}:o:g`, `${path.join('ctx', 'patterns', 'p.sch')}:o:g`]);
		// a function the schema declares itself, with xsl:function
		const inline = `${path.join('ctx', 'main.sch')}:${main.positionAt(main.getText().indexOf('o:inline')).line}`;
		assert.deepEqual(where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', p.uri, at(p, 'o:inline'))), [inline]);
		assert.deepEqual(where(await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', p.uri, at(p, 'o:inline'))),
			[inline, `${path.join('ctx', 'patterns', 'p.sch')}:1`].sort());
	});

	test('SchXslt2\'s checks for a file sch:include brings in, e.g. a pattern: an ignored XSLT attribute, and Schematron 1.5', async () => {
		const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
		const problems = async (name: string, content: string) => {
			fs.writeFileSync(file(name), content);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file(name)));
			return { document, diagnostics: await moduleDiagnostics.call(XsltSymbolProvider, document, false, SchConfiguration.configuration) };
		};
		const pattern = await problems('included-pattern.sch', `<pattern ${iso} ${xsl} id="i" xsl:use-when="true()"><rule context="a"><assert test="b">x</assert></rule></pattern>`);
		assert.deepEqual(pattern.diagnostics.map((d) => d.message), ['SchXslt2: the attribute xsl:use-when is ignored on sch:pattern']);
		const old = await problems('included-old.sch', `<s:pattern xmlns:s="http://www.ascc.net/xml/schematron" name="Old"><s:rule context="a"><s:assert test="b">x</s:assert></s:rule></s:pattern>`);
		assert.deepEqual(old.diagnostics.map((d) => d.message), ['SchXslt2: this isn\'t ISO Schematron, whose namespace is http://purl.oclc.org/dsdl/schematron - SchXslt2 doesn\'t validate with it']);
		// with its quick fix, as for a schema
		assert.deepEqual(SchXslt2Checks.codeActions(old.document, old.diagnostics).map((a) => a.title), ['Convert to ISO Schematron']);
	});
});
