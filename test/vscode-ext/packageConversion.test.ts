/**
 * Test suite for the analysis of converting a library - a module that stylesheets import or include - to an XSLT
 * package (see PackageConversion): what has to change for the stylesheets to work as before, as Saxon 13 behaves.
 */
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { ImportIndex } from '../../src/importIndex';
import { ConversionAnalysis, ConversionItem, PackageConversion } from '../../src/packageConversion';
import { PackageAnalysisView } from '../../src/packageAnalysisView';
import { PackageEdits } from '../../src/packageEdits';
import { TestConfiguration } from '../../src/mcp/assistantRuns';
import * as vscode from 'vscode';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSLTConfiguration } from '../../src/languageConfigurations';

const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:c="urn:common" xmlns:u="urn:util" version="3.0"';

suite('XSLT packages: analysing a library as a package', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-conversion-')));
	const file = (name: string, content: string) => {
		const fsPath = path.join(dir, name);
		fs.mkdirSync(path.dirname(fsPath), { recursive: true });
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	const common = file('lib/common.xsl', `<xsl:stylesheet ${ns}>
  <xsl:import href="util.xsl"/>
  <xsl:strip-space elements="*"/>
  <xsl:output method="xml" indent="yes"/>
  <xsl:key name="c:by-id" match="*" use="@id"/>
  <xsl:variable name="c:root" select="/*"/>
  <xsl:variable name="c:version" select="'1.0'"/>
  <xsl:function name="c:pad"><xsl:param name="s"/><xsl:sequence select="$s || ' '"/></xsl:function>
  <xsl:function name="c:fmt"><xsl:param name="s"/><xsl:sequence select="c:hook($s)"/></xsl:function>
  <xsl:function name="c:unused"><xsl:sequence select="1"/></xsl:function>
  <xsl:template match="item" mode="c:list"><li><xsl:value-of select="c:fmt(.)"/></li></xsl:template>
  <xsl:template match="para"><p/></xsl:template>
</xsl:stylesheet>`);
	const util = file('lib/util.xsl', `<xsl:stylesheet ${ns}>
  <xsl:function name="u:twice"><xsl:param name="s"/><xsl:sequence select="$s, $s"/></xsl:function>
</xsl:stylesheet>`);
	const main = file('main.xsl', `<xsl:stylesheet ${ns}>
  <xsl:import href="lib/common.xsl"/>
  <xsl:function name="c:fmt"><xsl:param name="s"/><xsl:sequence select="upper-case($s)"/></xsl:function>
  <xsl:function name="c:hook"><xsl:param name="s"/><xsl:sequence select="$s"/></xsl:function>
  <xsl:template match="item" mode="c:list"><xsl:apply-imports/></xsl:template>
  <xsl:template match="/">
    <xsl:apply-templates select="//item" mode="c:list"/>
    <xsl:apply-templates/>
    <xsl:sequence select="c:pad('x'), u:twice('y'), key('c:by-id', 'a'), $c:version"/>
  </xsl:template>
</xsl:stylesheet>`);

	let analysis: ConversionAnalysis;
	suiteSetup(async () => {
		await ImportIndex.instance.buildFrom([common, util, main]);
		const result = await PackageConversion.analyse(common);
		assert.notTypeOf(result, 'string', String(result));
		analysis = result as ConversionAnalysis;
	});
	suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

	const subjects = (section: string) => analysis.items.filter((i) => i.section === section).map((i) => `${i.severity}: ${i.subject}`);

	test('the library\'s modules, and the stylesheets that use it - with a name for the package', () => {
		assert.sameMembers(analysis.libraryModules, [common, util]);
		assert.deepEqual(analysis.topLevels, [main]);
		assert.strictEqual(analysis.packageName, 'urn:common');
	});

	test('the components the stylesheets use are made public - not those they don\'t', () => {
		assert.sameMembers(subjects('visibility'), ['change: function c:pad#1', 'change: variable $c:version', 'change: function u:twice#1']);
	});

	test('a declaration with the name of the library\'s is an override - and one the library calls, but only the stylesheet declares, is abstract', () => {
		assert.deepEqual(subjects('override'), ['change: function c:fmt#1']);
		assert.deepEqual(subjects('abstract'), ['change: function c:hook#1']);
	});

	test('modes: a named mode is made public, the stylesheet\'s rules in it overrides, the unnamed mode becomes a named mode - xsl:apply-imports needs a decision', () => {
		assert.sameMembers(subjects('modes'), ['change: mode c:list', 'change: 1 template rule in mode c:list', 'change: the unnamed mode', 'decision: xsl:apply-imports']);
	});

	test('keys, xsl:strip-space and xsl:output aren\'t shared by a package - a global variable using the context item fails in one', () => {
		assert.sameMembers(subjects('not-shared'), ['change: key c:by-id', 'change: xsl:strip-space / xsl:preserve-space', 'change: xsl:output']);
		assert.deepEqual(subjects('blockers'), ['blocker: variable $c:root']);
	});

	test('the report: a verdict, then the items by section - each with a link to its declaration, then the stylesheets using it', () => {
		const folder = path.join(dir, 'reports');
		const markdown = PackageAnalysisView.markdown(analysis, (p) => path.relative(dir, p), (p, line) => PackageAnalysisView.href(folder, p, line));
		assert.include(markdown, '❌ **1 item needs reworking before it can be converted**');
		assert.include(markdown, '## To rework first');
		// relative links: the Markdown preview doesn't allow file: links
		assert.include(markdown, '- **function c:pad#1** - made public, as the stylesheets use it - [lib/common.xsl:8](../lib/common.xsl#L8)\n  - [main.xsl](../main.xsl) - line [9](../main.xsl#L9)');
		assert.notInclude(markdown, 'file:');
	});

	test('a module that\'s a package, or that nothing imports, isn\'t analysed', async () => {
		assert.strictEqual(await PackageConversion.analyse(main), 'No stylesheet in the workspace imports or includes the module, so it isn\'t used as a library');
	});

	test('a global variable whose value uses the context item - found by linting it as a function\'s body', async () => {
		const lib = file('context/lib.xsl', `<xsl:stylesheet ${ns}>
  <xsl:variable name="c:a" select="/"/>
  <xsl:variable name="c:b" select="item/@id"/>
  <xsl:variable name="c:c" select="name()"/>
  <xsl:variable name="c:d"><xsl:value-of select="."/></xsl:variable>
  <xsl:variable name="c:e" select="count(//x)"/>
  <xsl:variable name="c:f" select="'a/b'"/>
  <xsl:variable name="c:g" select="$c:f || 'x'"/>
  <xsl:variable name="c:h" select="doc('x.xml')//item"/>
  <xsl:param name="c:i" select="current-date()"/>
</xsl:stylesheet>`);
		const user = file('context/user.xsl', `<xsl:stylesheet ${ns}><xsl:import href="lib.xsl"/></xsl:stylesheet>`);
		await ImportIndex.instance.buildFrom([lib, user]);
		const untitledBefore = vscode.workspace.textDocuments.filter((d) => d.isUntitled).length;
		const result = await PackageConversion.analyse(lib) as ConversionAnalysis;
		assert.sameMembers(result.items.filter((i) => i.section === 'blockers').map((i) => i.subject), ['variable $c:a', 'variable $c:b', 'variable $c:c', 'variable $c:d', 'variable $c:e']);
		// the check doesn't leave an unsaved 'Untitled' document behind
		assert.equal(vscode.workspace.textDocuments.filter((d) => d.isUntitled).length, untitledBefore);
		await ImportIndex.instance.buildFrom([common, util, main]);
	});
});


suite('XSLT packages: converting a library to a package', () => {
	// main.xsl imports the library, lib/common.xsl (which imports lib/util.xsl), then helpers.xsl, which declares the
	// callback h:hook - the converted stylesheet gives the same result on Saxon-PE 13.1: [x] yy 1 1.0 2
	const sources: { [file: string]: string } = {
		'lib/common.xsl': "<xsl:stylesheet version=\"3.0\" xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\"\n    xmlns:xs=\"http://www.w3.org/2001/XMLSchema\" xmlns:c=\"urn:common\" xmlns:u=\"urn:util\"\n    exclude-result-prefixes=\"#all\">\n    <xsl:import href=\"util.xsl\"/>\n    <xsl:strip-space elements=\"*\"/>\n    <xsl:output method=\"text\"/>\n    <xsl:key name=\"c:by-id\" match=\"item\" use=\"@id\"/>\n    <xsl:variable name=\"c:version\" select=\"'1.0'\"/>\n    <xsl:function name=\"c:pad\" as=\"xs:string\">\n        <xsl:param name=\"s\" as=\"xs:string\"/>\n        <xsl:sequence select=\"'[' || $s || ']'\"/>\n    </xsl:function>\n    <xsl:function name=\"c:fmt\" as=\"xs:string\">\n        <xsl:param name=\"s\" as=\"xs:string\"/>\n        <xsl:sequence select=\"c:hook($s) || '!'\"/>\n    </xsl:function>\n    <xsl:function name=\"c:unused\"><xsl:sequence select=\"1\"/></xsl:function>\n    <xsl:template match=\"item\" mode=\"c:list\">\n        <xsl:value-of select=\"'lib:' || c:fmt(string(.)) || ' '\"/>\n    </xsl:template>\n</xsl:stylesheet>\n",
		'lib/util.xsl': "<xsl:stylesheet version=\"3.0\" xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\" xmlns:u=\"urn:util\">\n    <xsl:function name=\"u:twice\"><xsl:param name=\"s\"/><xsl:sequence select=\"$s || $s\"/></xsl:function>\n</xsl:stylesheet>\n",
		'helpers.xsl': "<xsl:stylesheet version=\"3.0\" xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\"\n    xmlns:xs=\"http://www.w3.org/2001/XMLSchema\" xmlns:h=\"urn:common\">\n    <xsl:function name=\"h:hook\" as=\"xs:string\">\n        <xsl:param name=\"s\" as=\"xs:string\"/>\n        <xsl:sequence select=\"lower-case($s)\"/>\n    </xsl:function>\n</xsl:stylesheet>\n",
		'main.xsl': "<xsl:stylesheet version=\"3.0\" xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\"\n    xmlns:xs=\"http://www.w3.org/2001/XMLSchema\" xmlns:c=\"urn:common\" xmlns:u=\"urn:util\"\n    exclude-result-prefixes=\"#all\">\n    <xsl:import href=\"lib/common.xsl\"/>\n    <xsl:import href=\"helpers.xsl\"/>\n\n    <xsl:function name=\"c:fmt\" as=\"xs:string\">\n        <xsl:param name=\"s\" as=\"xs:string\"/>\n        <xsl:sequence select=\"upper-case(c:hook($s))\"/>\n    </xsl:function>\n\n    <xsl:template match=\"item\" mode=\"c:list\">\n        <xsl:text>(</xsl:text>\n        <xsl:apply-imports/>\n        <xsl:text>)</xsl:text>\n    </xsl:template>\n\n    <xsl:template match=\"/\">\n        <xsl:value-of select=\"c:pad('x'), u:twice('y'), count(key('c:by-id', 'b')), $c:version, count(//text())\"/>\n        <xsl:text>&#10;</xsl:text>\n        <xsl:apply-templates select=\"//item\" mode=\"c:list\"/>\n    </xsl:template>\n</xsl:stylesheet>\n"
	};
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-convert-')));
	const write = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	const converted = new Map<string, string>();
	suiteSetup(async () => {
		Object.entries(sources).forEach(([file, text]) => write(file, text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map((f) => path.join(dir, f)));
		const analysis = await PackageConversion.analyse(path.join(dir, 'lib/common.xsl')) as ConversionAnalysis;
		const edits = PackageConversion.convert(analysis, 'urn:common', '1.0');
		assert.notTypeOf(edits, 'string', String(edits));
		for (const [file, fileEdits] of edits as Map<string, { start: number, end: number, text: string }[]>) {
			let text = fs.readFileSync(file, 'utf8');
			[...fileEdits].sort((a, b) => b.start - a.start).forEach((e) => text = text.substring(0, e.start) + e.text + text.substring(e.end));
			converted.set(path.relative(dir, file).split(path.sep).join('/'), text);
		}
	});
	suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('the library becomes a package: its components the stylesheet uses or overrides are public, with a public mode and an abstract callback', () => {
		const library = converted.get('lib/common.xsl')!;
		assert.match(library, /^<xsl:package version="3\.0"[\s\S]*? name="urn:common" package-version="1\.0" declared-modes="no">/);
		assert.match(library, /<\/xsl:package>\s*$/);
		['<xsl:variable name="c:version" select="\'1.0\'" visibility="public"/>', '<xsl:function name="c:pad" as="xs:string" visibility="public">',
			'<xsl:function name="c:fmt" as="xs:string" visibility="public">', '<xsl:function name="c:unused">', '<xsl:mode name="c:list" visibility="public"/>',
			'<xsl:function name="c:hook" as="xs:string" visibility="abstract">\n        <xsl:param name="s" as="xs:string"/>\n    </xsl:function>'].forEach((part) => assert.include(library, part));
		assert.include(converted.get('lib/util.xsl'), '<xsl:function name="u:twice" visibility="public">');
	});

	test('the stylesheet uses the package - after its imports - with its overrides, callback and template rule moved into xsl:override', () => {
		const main = converted.get('main.xsl')!;
		assert.include(main, `    <xsl:import href="helpers.xsl"/>
    <xsl:use-package name="urn:common" package-version="1.0">
        <xsl:override>
            <xsl:function name="c:fmt" as="xs:string">`);
		// named with main.xsl's prefix for its namespace - h:hook in helpers.xsl
		assert.include(main, '<xsl:function name="c:hook" as="xs:string">');
		assert.include(main, '<xsl:next-match/>');
		assert.notInclude(main, 'apply-imports');
		assert.notInclude(main, '\n\n\n');
		assert.notInclude(converted.get('helpers.xsl'), 'h:hook');
	});

	test('the declarations a package doesn\'t share are copied into the stylesheet', () => {
		const main = converted.get('main.xsl')!;
		['<xsl:key name="c:by-id" match="item" use="@id"/>', '<xsl:strip-space elements="*"/>', '<xsl:output method="text"/>'].forEach((part) => assert.include(main, part));
	});

	test('the converted modules have no problems', async () => {
		converted.forEach((text, file) => write(file, text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map((f) => path.join(dir, f)));
		const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean | string): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
		for (const file of Object.keys(sources)) {
			const document = await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(path.join(dir, file)), 'xslt');
			const errors = (await moduleDiagnostics.call(XsltSymbolProvider, document, false)).filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
			assert.deepEqual(errors.map((d) => `${file}:${d.range.start.line + 1} ${d.message}`), []);
		}
	});

	test('a library with a blocker, or the unnamed mode shared, isn\'t converted', () => {
		const blocked = { plan: { preventing: [{ subject: 'variable $c:root' }] } } as unknown as ConversionAnalysis;
		assert.strictEqual(PackageConversion.convert(blocked, 'urn:x', '1.0'), '1 item needs reworking first: variable $c:root');
	});
});

suite('XSLT packages: converting a library that shares the unnamed mode', () => {
	// custom.xsl customizes lib.xsl's template rules in the unnamed mode - converted, the unnamed mode becomes the package's
	// mode l:default, and Saxon-PE 13.1 gives the same result for both
	const sources: { [file: string]: string } = {
		'lib.xsl': `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:l="urn:lib">
  <xsl:mode on-no-match="shallow-skip"/>
  <xsl:template match="/"><out><xsl:apply-templates/></out></xsl:template>
  <xsl:template match="para"><p><xsl:apply-templates/></p></xsl:template>
  <xsl:template match="b"><strong><xsl:apply-templates/></strong></xsl:template>
</xsl:stylesheet>`,
		'custom.xsl': `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:import href="lib.xsl"/>
  <xsl:include href="helper.xsl"/>
  <xsl:template match="b"><em><xsl:apply-imports/></em></xsl:template>
  <xsl:template match="note"><n><xsl:apply-templates/></n></xsl:template>
</xsl:stylesheet>`,
		'helper.xsl': `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template name="all"><xsl:apply-templates select="//para"/></xsl:template>
</xsl:stylesheet>`
	};
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-unnamed-')));
	const write = (file: string, text: string) => fs.writeFileSync(path.join(dir, file), text);
	let analysis: ConversionAnalysis;
	const converted = new Map<string, string>();
	suiteSetup(async () => {
		Object.entries(sources).forEach(([file, text]) => write(file, text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map((f) => path.join(dir, f)));
		analysis = await PackageConversion.analyse(path.join(dir, 'lib.xsl')) as ConversionAnalysis;
		const edits = PackageConversion.convert(analysis, 'urn:lib', '1.0', 'l:default');
		assert.notTypeOf(edits, 'string', String(edits));
		for (const [file, fileEdits] of edits as Map<string, { start: number, end: number, text: string }[]>) {
			let text = fs.readFileSync(file, 'utf8');
			[...fileEdits].sort((a, b) => b.start - a.start).forEach((e) => text = text.substring(0, e.start) + e.text + text.substring(e.end));
			converted.set(path.basename(file), text);
		}
	});
	suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('the unnamed mode becomes a named mode - a name is proposed, and needed', () => {
		assert.isTrue(analysis.plan.renameUnnamed);
		assert.strictEqual(analysis.unnamedModeName, 'l:default');
		assert.strictEqual(PackageConversion.convert(analysis, 'urn:lib', '1.0'), 'the library shares the unnamed mode with the stylesheets: a name is needed for the package\'s mode it becomes');
		assert.isUndefined(PackageConversion.modeNameProblem(analysis, 'l:default'));
		assert.isUndefined(PackageConversion.modeNameProblem(analysis, 'Q{urn:x}m'));
		assert.strictEqual(PackageConversion.modeNameProblem(analysis, 'x:default'), 'The library doesn\'t declare the prefix \'x\'');
		assert.strictEqual(PackageConversion.modeNameProblem(analysis, 'two words'), 'A mode name, e.g. lib:default');
	});

	test('the library: its default mode, and its unnamed xsl:mode, are the named mode, which is public', () => {
		const lib = converted.get('lib.xsl')!;
		assert.include(lib, 'name="urn:lib" package-version="1.0" declared-modes="no" default-mode="l:default">');
		assert.include(lib, '<xsl:mode on-no-match="shallow-skip" name="l:default" visibility="public"/>');
		assert.include(lib, '<xsl:template match="para"><p><xsl:apply-templates/></p></xsl:template>');
	});

	test('the stylesheet: its rules move into xsl:override in the mode, its xsl:apply-templates use it, and a rule starts the transformation in it', () => {
		const custom = converted.get('custom.xsl')!;
		// custom.xsl has no prefix for the namespace: an EQName
		assert.include(custom, '<xsl:template match="b" mode="Q{urn:lib}default"><em><xsl:next-match/></em></xsl:template>');
		assert.include(custom, '<xsl:template match="note" mode="Q{urn:lib}default"><n><xsl:apply-templates mode="Q{urn:lib}default"/></n></xsl:template>');
		assert.include(custom, '<xsl:template match=".">\n    <xsl:apply-templates select="." mode="Q{urn:lib}default"/>\n  </xsl:template>');
		assert.include(converted.get('helper.xsl'), '<xsl:apply-templates select="//para" mode="Q{urn:lib}default"/>');
	});

	test('the converted modules have no problems', async () => {
		converted.forEach((text, file) => write(file, text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map((f) => path.join(dir, f)));
		const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean | string): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
		for (const file of Object.keys(sources)) {
			const document = await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(path.join(dir, file)), 'xslt');
			// helper.xsl as the extension lints it: with custom.xsl, which includes it
			const parent = file === 'helper.xsl' ? path.join(dir, 'custom.xsl') : false;
			const errors = (await moduleDiagnostics.call(XsltSymbolProvider, document, parent)).filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
			assert.deepEqual(errors.map((d) => `${file}:${d.range.start.line + 1} ${d.message}`), []);
		}
	});

	test('what has to be reworked first: the stylesheet\'s xsl:mode for the unnamed mode, a rule that\'s also a named template, and a name found nowhere', async () => {
		write('lib.xsl', sources['lib.xsl'].replace('</xsl:stylesheet>', '<xsl:template name="t"><xsl:call-template name="missing"/></xsl:template>\n</xsl:stylesheet>'));
		write('custom.xsl', sources['custom.xsl'].replace('<xsl:include href="helper.xsl"/>', '<xsl:include href="helper.xsl"/><xsl:import href="plugin:x:y.xsl"/><xsl:mode on-no-match="deep-copy"/>')
			.replace('<xsl:template match="note">', '<xsl:template match="note" name="note">').replace('<xsl:template match="b">', '<xsl:template match="b" name="bold">'));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map((f) => path.join(dir, f)));
		const blocked = await PackageConversion.analyse(path.join(dir, 'lib.xsl')) as ConversionAnalysis;
		const blockers = blocked.items.filter((i) => i.severity === 'blocker');
		// the rule named bold uses xsl:apply-imports, so it can't be split - note can be
		assert.sameMembers(blockers.map((i) => i.subject), ['xsl:mode for the unnamed mode', 'a template rule that\'s also a named template', 'template missing']);
		assert.deepEqual(blocked.items.filter((i) => i.subject === 'a template rule that\'s also a named template').map((i) => i.severity).sort(), ['blocker', 'change']);
		assert.include(blockers.find((i) => i.subject === 'template missing')!.text, 'these imports or includes aren\'t found, so what they declare isn\'t known: plugin:x:y.xsl');
	});
});

suite('XSLT packages: converting - a template rule that\'s also a named template', () => {
	// split: the named template stays, and a rule that calls it moves into xsl:override - Saxon-PE 13.1 gives the same
	// result before and after
	const sources: { [file: string]: string } = {
		'lib.xsl': `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:l="urn:lib">
  <xsl:mode on-no-match="shallow-skip"/>
  <xsl:template match="/"><out><xsl:apply-templates/><xsl:apply-templates select="//b" mode="l:list"/></out></xsl:template>
  <xsl:template match="para"><p><xsl:apply-templates><xsl:with-param name="level" select="1"/></xsl:apply-templates></p></xsl:template>
  <xsl:template match="b"><strong><xsl:apply-templates/></strong></xsl:template>
  <xsl:template match="b" mode="l:list">[lib]</xsl:template>
</xsl:stylesheet>`,
		'custom.xsl': `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:l="urn:lib">
  <xsl:import href="lib.xsl"/>
  <xsl:template match="b" name="bold">
    <xsl:param name="level" select="0"/>
    <em level="{$level}"><xsl:apply-templates/></em>
  </xsl:template>
  <xsl:template match="b" mode="l:list" name="listed" priority="2">[custom <xsl:value-of select="name()"/>]</xsl:template>
  <xsl:template name="extra"><xsl:call-template name="bold"/></xsl:template>
</xsl:stylesheet>`
	};
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-split-')));
	suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('the named template stays, and a rule that calls it - passing its parameters - moves into xsl:override', async () => {
		Object.entries(sources).forEach(([file, text]) => fs.writeFileSync(path.join(dir, file), text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map((f) => path.join(dir, f)));
		const analysis = await PackageConversion.analyse(path.join(dir, 'lib.xsl')) as ConversionAnalysis;
		const edits = PackageConversion.convert(analysis, 'urn:lib', '1.0', 'l:default') as Map<string, { start: number, end: number, text: string }[]>;
		assert.notTypeOf(edits, 'string', String(edits));
		const file = path.join(dir, 'custom.xsl');
		const custom = [...edits.get(file)!].sort((a, b) => b.start - a.start).reduce((text, e) => text.substring(0, e.start) + e.text + text.substring(e.end), sources['custom.xsl']);
		assert.include(custom, `      <xsl:template match="b" mode="l:list" priority="2">
        <xsl:call-template name="listed"/>
      </xsl:template>
      <xsl:template match="b" mode="l:default">
        <xsl:param name="level" select="0"/>
        <xsl:call-template name="bold">
          <xsl:with-param name="level" select="$level"/>
        </xsl:call-template>
      </xsl:template>`);
		assert.include(custom, '<xsl:template name="bold">\n    <xsl:param name="level" select="0"/>\n    <em level="{$level}"><xsl:apply-templates mode="l:default"/></em>');
		assert.include(custom, '<xsl:template name="listed">[custom <xsl:value-of select="name()"/>]</xsl:template>');
	});
});

suite('XSLT packages: what the library uses that a shared module declares - the package includes the module', () => {
	// lib.xsl, with its root's start tag over several lines, calls h:hook, which only shared.xsl declares: shared.xsl is
	// imported by both stylesheets that use the library - it's included in the package, not copied into both of them
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:h="urn:lib"';
	const sources: { [file: string]: string } = {
		'lib.xsl': `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"\n                xmlns:h="urn:lib"\n                version="3.0">\n  <xsl:function name="h:wrap"><xsl:param name="s"/><xsl:sequence select="h:hook($s)"/></xsl:function>\n</xsl:stylesheet>`,
		'shared.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:import href="deeper.xsl"/>\n  <xsl:function name="h:hook"><xsl:param name="s"/><xsl:sequence select="h:deep(upper-case($s))"/></xsl:function>\n</xsl:stylesheet>`,
		'deeper.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:function name="h:deep"><xsl:param name="s"/><xsl:sequence select="$s || '!'"/></xsl:function>\n</xsl:stylesheet>`,
		'one.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:import href="lib.xsl"/>\n  <xsl:import href="shared.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="h:wrap('a'), h:hook('z')"/></xsl:template>\n</xsl:stylesheet>`,
		'two.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:import href="lib.xsl"/>\n  <xsl:import href="shared.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="h:wrap('b')"/></xsl:template>\n</xsl:stylesheet>`
	};
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-shared-')));
	const file = (name: string) => path.join(dir, name);
	const apply = (edits: Map<string, { start: number, end: number, text: string }[]>) => {
		const texts = new Map<string, string>();
		for (const name of Object.keys(sources)) {
			let text = fs.readFileSync(file(name), 'utf8');
			[...(edits.get(file(name)) ?? [])].sort((a, b) => b.start - a.start).forEach((e) => text = text.substring(0, e.start) + e.text + text.substring(e.end));
			texts.set(name, text);
		}
		return texts;
	};
	suiteSetup(async () => {
		Object.entries(sources).forEach(([name, text]) => fs.writeFileSync(file(name), text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map(file));
	});
	suiteTeardown(() => {
		Object.keys(sources).forEach((name) => ImportIndex.instance.setReferences(file(name), []));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('the module is included in the package - with what it imports - and there is no abstract component, override or copy', async () => {
		const analysis = await PackageConversion.analyse(file('lib.xsl')) as ConversionAnalysis;
		assert.sameMembers(analysis.absorbed, [file('shared.xsl')]);
		assert.sameMembers(analysis.libraryModules, [file('lib.xsl'), file('shared.xsl'), file('deeper.xsl')]);
		assert.sameMembers(analysis.topLevels, [file('one.xsl'), file('two.xsl')]);
		assert.deepEqual(analysis.items.filter((i) => i.section === 'included').map((i) => i.subject), ['shared.xsl']);
		assert.isEmpty(analysis.items.filter((i) => i.section === 'abstract' || i.section === 'override' || i.severity === 'blocker'));
		assert.isEmpty(analysis.plan.callbacks);
		assert.isEmpty(analysis.plan.overrides);
		// what the stylesheets use of the module is public: what it declares that the stylesheet one.xsl calls
		assert.deepEqual(analysis.items.filter((i) => i.section === 'visibility').map((i) => i.subject).sort(), ['function h:hook#1', 'function h:wrap#1']);
	});

	test('the conversion: the library includes the module, which stays as it is - the stylesheets use the package, and import neither', async () => {
		const analysis = await PackageConversion.analyse(file('lib.xsl')) as ConversionAnalysis;
		const texts = apply(PackageConversion.convert(analysis, 'urn:lib', '1.0') as Map<string, { start: number, end: number, text: string }[]>);
		const lib = texts.get('lib.xsl')!;
		// indented as its content is - not as its root element's last attribute is
		assert.include(lib, '\n  <xsl:include href="shared.xsl"/>\n</xsl:package>');
		assert.include(lib, '<xsl:function name="h:wrap" visibility="public">');
		assert.include(texts.get('shared.xsl')!, '<xsl:function name="h:hook" visibility="public">');
		for (const name of ['one.xsl', 'two.xsl']) {
			const text = texts.get(name)!;
			assert.include(text, '<xsl:use-package name="urn:lib" package-version="1.0"/>', name);
			assert.notInclude(text, 'xsl:import href="shared.xsl"', name);
			assert.notInclude(text, 'xsl:import href="lib.xsl"', name);
			// no copy of the module's code
			assert.notInclude(text, 'h:hook"', name.concat(' has a copy'));
			assert.notInclude(text, 'xsl:override', name);
		}
	});

	test('a module that others use too can\'t be taken out of them', async () => {
		fs.writeFileSync(file('other.xsl'), `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:import href="shared.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="h:hook('x')"/></xsl:template>\n</xsl:stylesheet>`);
		try {
			await ImportIndex.instance.buildFrom([...Object.keys(sources).map(file), file('other.xsl')]);
			const analysis = await PackageConversion.analyse(file('lib.xsl')) as ConversionAnalysis;
			assert.isEmpty(analysis.absorbed);
			const blockers = analysis.items.filter((i) => i.severity === 'blocker');
			assert.deepEqual(blockers.map((i) => i.subject), ['function h:hook#1']);
			assert.include(blockers[0].text, 'stylesheets that don\'t use the library use too');
		} finally {
			ImportIndex.instance.setReferences(file('other.xsl'), []);
			fs.rmSync(file('other.xsl'));
			await ImportIndex.instance.buildFrom(Object.keys(sources).map(file));
		}
	});
});

suite('XSLT packages: what the library calls, that a stylesheet declares - an abstract component', () => {
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:h="urn:lib"';
	const sources: { [file: string]: string } = {
		'lib.xsl': `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"\n                xmlns:h="urn:lib"\n                version="3.0">\n  <xsl:function name="h:wrap"><xsl:param name="s"/><xsl:sequence select="h:hook($s)"/></xsl:function>\n</xsl:stylesheet>`,
		'one.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:import href="lib.xsl"/>\n  <xsl:function name="h:hook"><xsl:param name="s"/><xsl:sequence select="upper-case($s)"/></xsl:function>\n  <xsl:template match="/"><xsl:sequence select="h:wrap('a')"/></xsl:template>\n</xsl:stylesheet>`
	};
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-callback-')));
	const file = (name: string) => path.join(dir, name);
	suiteSetup(async () => {
		Object.entries(sources).forEach(([name, text]) => fs.writeFileSync(file(name), text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map(file));
	});
	suiteTeardown(() => {
		Object.keys(sources).forEach((name) => ImportIndex.instance.setReferences(file(name), []));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('the stylesheet declares what the library calls: abstract in the package, indented as its content is - not as its root\'s last attribute is', async () => {
		const analysis = await PackageConversion.analyse(file('lib.xsl')) as ConversionAnalysis;
		assert.isEmpty(analysis.absorbed);
		assert.deepEqual(analysis.items.filter((i) => i.section === 'abstract').map((i) => `${i.severity}: ${i.subject}`), ['change: function h:hook#1']);
		const edits = PackageConversion.convert(analysis, 'urn:lib', '1.0') as Map<string, { start: number, end: number, text: string }[]>;
		let text = fs.readFileSync(file('lib.xsl'), 'utf8');
		[...edits.get(file('lib.xsl'))!].sort((a, b) => b.start - a.start).forEach((e) => text = text.substring(0, e.start) + e.text + text.substring(e.end));
		assert.include(text, '\n  <xsl:function name="h:hook" visibility="abstract">\n    <xsl:param name="s"/>\n  </xsl:function>\n</xsl:package>');
		assert.notMatch(text, /\n {8,}<xsl:function name="h:hook"/);
	});

	test('the indentation of an element\'s content: its first child\'s - or the first indentation after the start tag', () => {
		const indent = (text: string) => PackageEdits.contentIndent(text, text.indexOf('>') + 1);
		assert.strictEqual(indent('<a\n        b="1">\n  <c/>\n</a>'), '  ');
		assert.strictEqual(indent('<a b="1">\n\t<!-- c -->\n\t<c/>\n</a>'), '\t');
		// children not indented: the first indentation after the start tag
		assert.strictEqual(indent('<a\n        b="1">\n<c>\n    <d/>\n</c>\n</a>'), '    ');
		assert.strictEqual(indent('<a/>'), '\t');
	});
});

suite('XSLT packages: what the library calls that a module declares which imports the library', () => {
	// mid.xsl imports lib.xsl, and declares h:hook, which lib.xsl calls: it's imported by both stylesheets - each gets a copy
	// of it in its xsl:override, which the analysis says, and what to do
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:h="urn:lib"';
	const sources: { [file: string]: string } = {
		'lib.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:function name="h:wrap"><xsl:param name="s"/><xsl:sequence select="h:hook($s)"/></xsl:function>\n</xsl:stylesheet>`,
		'mid.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:import href="lib.xsl"/>\n  <xsl:function name="h:hook"><xsl:param name="s"/><xsl:sequence select="upper-case($s)"/></xsl:function>\n</xsl:stylesheet>`,
		'one.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:import href="mid.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="h:wrap('a')"/></xsl:template>\n</xsl:stylesheet>`,
		'two.xsl': `<xsl:stylesheet ${ns} version="3.0">\n  <xsl:import href="mid.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="h:wrap('b')"/></xsl:template>\n</xsl:stylesheet>`
	};
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-imports-lib-')));
	const file = (name: string) => path.join(dir, name);
	suiteSetup(async () => {
		Object.entries(sources).forEach(([name, text]) => fs.writeFileSync(file(name), text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map(file));
	});
	suiteTeardown(() => {
		Object.keys(sources).forEach((name) => ImportIndex.instance.setReferences(file(name), []));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('a decision: the declaration is copied into each stylesheet - convert the module that imports the library instead', async () => {
		const analysis = await PackageConversion.analyse(file('lib.xsl')) as ConversionAnalysis;
		assert.isEmpty(analysis.absorbed);
		const item = analysis.items.find((i) => i.section === 'abstract')!;
		assert.strictEqual(item.severity, 'decision');
		assert.include(item.text, 'moved out of mid.xsl, which imports the library');
		assert.include(item.text, 'each of the 2 stylesheets');
		assert.include(item.text, 'convert mid.xsl to a package instead');
	});
});

suite('XSLT packages: the errors in the modules a conversion reads are checked first', () => {
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0"';
	const sources: { [file: string]: string } = {
		'lib.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:function name="f:one"><xsl:sequence select="1"/></xsl:function>\n</xsl:stylesheet>`,
		'top.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:import href="lib.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="f:one(), f:missing(2)"/></xsl:template>\n</xsl:stylesheet>`,
		'unrelated.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:template match="/"><xsl:sequence select="f:nothing(1)"/></xsl:template>\n</xsl:stylesheet>`
	};
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-baseline-')));
	const file = (name: string) => path.join(dir, name);
	let analysis: ConversionAnalysis;
	suiteSetup(async () => {
		Object.entries(sources).forEach(([name, text]) => fs.writeFileSync(file(name), text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map(file));
		analysis = await PackageConversion.analyse(file('lib.xsl')) as ConversionAnalysis;
	});
	suiteTeardown(() => {
		Object.keys(sources).forEach((name) => ImportIndex.instance.setReferences(file(name), []));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('the library\'s modules and those of the stylesheets using it are checked - each with errors is a blocker, with a link to the lines', async () => {
		const checked: string[] = [];
		const items = await PackageConversion.baseline(analysis, async (module) => {
			checked.push(path.basename(module));
			return module === file('top.xsl') ? [{ line: 2, message: 'XPath: Function: \'f:missing\' with 1 arguments not found' }, { line: 5, message: 'another' }] : [];
		}) as ConversionItem[];
		assert.sameMembers(checked, ['lib.xsl', 'top.xsl']);
		assert.deepEqual(items.map((i) => `${i.severity}: ${i.subject}`), ['blocker: 2 errors in top.xsl']);
		assert.include(items[0].text, 'f:missing');
		assert.include(items[0].text, '(and 1 more)');
		assert.deepEqual(items[0].places, [{ path: file('top.xsl'), line: 2 }, { path: file('top.xsl'), line: 5 }]);
		// none: nothing to rework
		assert.isEmpty(await PackageConversion.baseline(analysis, async () => []) as ConversionItem[]);
	});

	test('with the linter: an error in a stylesheet that uses the library blocks the conversion - one in an unrelated stylesheet doesn\'t', async () => {
		const provider = new XsltSymbolProvider(XSLTConfiguration.configuration, null);
		const errorsOf = async (module: string) => (await provider.diagnosticsFor(await vscode.workspace.openTextDocument(vscode.Uri.file(module)))).filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
			.map((d) => ({ line: d.range.start.line, message: d.message }));
		const items = await PackageConversion.baseline(analysis, errorsOf) as ConversionItem[];
		assert.deepEqual(items.map((i) => i.subject), ['1 error in top.xsl']);
		assert.include(items[0].text, 'f:missing');
		assert.strictEqual(items[0].places[0].line, 2);
	});

	test('cancelled: no result - and progress is reported', async () => {
		const progress: string[] = [];
		assert.isUndefined(await PackageConversion.baseline(analysis, async () => [], (done, total) => progress.push(`${done}/${total}`), () => progress.length > 0));
		assert.deepEqual(progress, ['0/2']);
	});

	test('many modules with errors: the first are listed, then the number of others', async () => {
		const many = { libraryModules: Array.from({ length: 25 }, (_, i) => `/m/${i}.xsl`), topLevels: [], userModules: [] } as unknown as ConversionAnalysis;
		const items = await PackageConversion.baseline(many, async () => [{ line: 0, message: 'e' }]) as ConversionItem[];
		assert.lengthOf(items, 21);
		assert.strictEqual(items[20].subject, 'errors in 5 more modules');
	});
});

suite('XSLT packages: a module that is a part of a larger library', () => {
	// master.xsl imports lib.xsl and two more modules, and the stylesheets import master.xsl: converting lib.xsl alone leaves the
	// others as imports - the analysis says so, and that master.xsl converts them all
	const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0"';
	const sources: { [file: string]: string } = {
		'lib.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:function name="f:one"><xsl:sequence select="1"/></xsl:function>\n</xsl:stylesheet>`,
		'second.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:function name="f:two"><xsl:sequence select="2"/></xsl:function>\n</xsl:stylesheet>`,
		'third.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:function name="f:three"><xsl:sequence select="3"/></xsl:function>\n</xsl:stylesheet>`,
		'master.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:import href="lib.xsl"/>\n  <xsl:import href="second.xsl"/>\n  <xsl:import href="third.xsl"/>\n</xsl:stylesheet>`,
		'top.xsl': `<xsl:stylesheet ${ns}>\n  <xsl:import href="master.xsl"/>\n  <xsl:template match="/"><xsl:sequence select="f:one(), f:two()"/></xsl:template>\n</xsl:stylesheet>`
	};
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-part-')));
	const file = (name: string) => path.join(dir, name);
	suiteSetup(async () => {
		Object.entries(sources).forEach(([name, text]) => fs.writeFileSync(file(name), text));
		await ImportIndex.instance.buildFrom(Object.keys(sources).map(file));
	});
	suiteTeardown(() => {
		Object.keys(sources).forEach((name) => ImportIndex.instance.setReferences(file(name), []));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('converting one module of the library: a decision, naming the module that imports it - and what to convert instead', async () => {
		const analysis = await PackageConversion.analyse(file('lib.xsl')) as ConversionAnalysis;
		const item = analysis.items.find((i) => i.section === 'library')!;
		assert.strictEqual(item.severity, 'decision');
		assert.strictEqual(item.subject, 'lib.xsl is a part of master.xsl');
		assert.include(item.text, '2 other modules (second.xsl, third.xsl)');
		assert.include(item.text, 'convert master.xsl');
		assert.deepEqual(item.places, [{ path: file('master.xsl'), line: 0 }]);
	});

	test('converting the module that imports them all - or a top-level stylesheet\'s only library: nothing to say', async () => {
		assert.isEmpty((await PackageConversion.analyse(file('master.xsl')) as ConversionAnalysis).items.filter((i) => i.section === 'library'));
	});

	test('the proposed package name: a placeholder, for the module\'s name, when no namespace of the library\'s own is declared', async () => {
		const bare = file('bare.xsl');
		const user = file('bare-user.xsl');
		fs.writeFileSync(bare, `<xsl:stylesheet ${ns}>\n  <xsl:template name="t"><xsl:sequence select="1"/></xsl:template>\n  <xsl:function name="xs:mine" xmlns:xs="http://www.w3.org/2001/XMLSchema"><xsl:sequence select="1"/></xsl:function>\n</xsl:stylesheet>`);
		fs.writeFileSync(user, `<xsl:stylesheet ${ns}>\n  <xsl:import href="bare.xsl"/>\n  <xsl:template match="/"><xsl:call-template name="t"/></xsl:template>\n</xsl:stylesheet>`);
		try {
			await ImportIndex.instance.buildFrom([bare, user]);
			assert.strictEqual((await PackageConversion.analyse(bare) as ConversionAnalysis).packageName, 'http://example.com/packages/bare');
		} finally {
			ImportIndex.instance.setReferences(bare, []);
			ImportIndex.instance.setReferences(user, []);
			fs.rmSync(bare);
			fs.rmSync(user);
			await ImportIndex.instance.buildFrom(Object.keys(sources).map(file));
		}
	});

	test('the namespaces the language and the processors define are not the library\'s own', () => {
		['http://www.w3.org/2001/XMLSchema', 'http://www.w3.org/2005/xpath-functions', 'http://www.w3.org/2005/xpath-functions/map', 'http://www.w3.org/2005/xpath-functions/array',
			'http://www.w3.org/2005/xpath-functions/math', 'http://www.w3.org/1999/XSL/Transform', 'http://saxon.sf.net/', 'http://saxon.sf.net/sql', 'http://exslt.org/common',
			'http://expath.org/ns/file', 'java:java.lang.Math', 'http://www.w3.org/2001/XMLSchema-instance', 'http://www.w3.org/2005/xqt-errors', 'http://www.w3.org/XML/1998/namespace']
			.forEach((uri) => assert.isTrue(PackageConversion.isStandardNamespace(uri), uri));
		['urn:f', 'http://example.com/ns/mine', 'http://www.w3.org/2005/xpath-functions/other'].forEach((uri) => assert.isFalse(PackageConversion.isStandardNamespace(uri), uri));
	});

	test('the proposed package name: the namespace of its functions - with the module\'s name when it is a part of a larger library', async () => {
		// all of them declare functions in the namespace urn:f: the whole library has it, a part of it adds its own name
		assert.strictEqual((await PackageConversion.analyse(file('lib.xsl')) as ConversionAnalysis).packageName, 'urn:f:lib');
		assert.strictEqual((await PackageConversion.analyse(file('master.xsl')) as ConversionAnalysis).packageName, 'urn:f');
	});
});


suite('XSLT packages: the XSpec tests a conversion affects', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-conversion-xspec-')));
	const file = (name: string, content: string) => {
		const fsPath = path.join(dir, name);
		fs.mkdirSync(path.dirname(fsPath), { recursive: true });
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	const xspec = (name: string, stylesheet: string, attributes = '') => file(name,
		`<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:c="urn:common" stylesheet="${stylesheet}"${attributes}>\n  <x:scenario label="s"><x:call function="c:pad"><x:param select="'x'"/></x:call><x:expect label="e" select="'x '"/></x:scenario>\n</x:description>`);
	const library = file('lib/common.xsl', `<xsl:stylesheet ${ns}>
  <xsl:function name="c:pad"><xsl:param name="s"/><xsl:sequence select="$s || ' '"/></xsl:function>
</xsl:stylesheet>`);
	// the top-level stylesheet imports a module, which imports the library
	const module = file('module.xsl', `<xsl:stylesheet ${ns}>
  <xsl:import href="lib/common.xsl"/>
  <xsl:function name="u:label"><xsl:param name="s"/><xsl:sequence select="c:pad($s)"/></xsl:function>
</xsl:stylesheet>`);
	const top = file('top.xsl', `<xsl:stylesheet ${ns}>
  <xsl:import href="module.xsl"/>
  <xsl:template match="/"><xsl:sequence select="u:label('a')"/></xsl:template>
</xsl:stylesheet>`);
	const unrelated = file('unrelated.xsl', `<xsl:stylesheet ${ns}/>`);
	const ofLibrary = xspec('of-library.xspec', 'lib/common.xsl');
	const ofTopLevel = xspec('of-top.xspec', 'top.xsl');
	const ofModule = xspec('of-module.xspec', 'module.xsl');
	const external = xspec('external.xspec', 'lib/common.xsl', ' run-as="external"');
	const ofUnrelated = xspec('of-unrelated.xspec', 'unrelated.xsl');
	const xspecFiles = PackageConversion.xspecFiles;
	let analysis: ConversionAnalysis;

	suiteSetup(async () => {
		PackageConversion.xspecFiles = async () => [ofLibrary, ofTopLevel, ofModule, external, ofUnrelated];
		await ImportIndex.instance.buildFrom([library, module, top, unrelated]);
		const result = await PackageConversion.analyse(library);
		assert.notTypeOf(result, 'string', String(result));
		analysis = result as ConversionAnalysis;
	});
	suiteTeardown(() => {
		PackageConversion.xspecFiles = xspecFiles;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const tests = () => analysis.items.filter((i) => i.section === 'tests');

	test('a test of the library, of a top-level stylesheet and of a module that imports the library: each is reported, with where it names the stylesheet', () => {
		assert.deepEqual(tests().map((i) => `${i.severity}: ${i.subject}`), [
			'decision: 1 XSpec file tests the library',
			'decision: 1 XSpec file tests a stylesheet that will use the package',
			'change: 1 XSpec file tests a module that uses the library'
		]);
		const [library_, topLevel, moduleTest] = tests();
		assert.deepEqual(library_.places.map((p) => p.path), [ofLibrary]);
		assert.deepEqual(topLevel.places.map((p) => p.path), [ofTopLevel]);
		assert.deepEqual(moduleTest.places.map((p) => p.path), [ofModule]);
		// the line of the stylesheet attribute: x:description's start tag, the first line
		assert.strictEqual(library_.places[0].line, 0);
	});

	test('what each needs: run-as="external" or a helper for the library, helpers for the modules, and why a top-level stylesheet can\'t be tested', () => {
		const [library_, topLevel, moduleTest] = tests();
		assert.include(library_.text, 'run-as="external"');
		assert.include(library_.text, `x:helper package-name="${analysis.packageName}"`);
		assert.include(topLevel.text, 'XTSE3008');
		assert.include(topLevel.text, 'x:helper package-name');
		// the conversion makes this change: the report says so
		assert.include(moduleTest.text, 'Convert to Package... changes this XSpec file, adding an x:helper for the package');
	});

	test('not reported: a test with run-as="external", and a test of a stylesheet that has nothing to do with the library', () => {
		const paths = tests().flatMap((i) => i.places.map((p) => p.path));
		assert.notInclude(paths, external);
		assert.notInclude(paths, ofUnrelated);
	});

	test('the report has a section for them', () => {
		const text = PackageAnalysisView.markdown(analysis, (p) => path.relative(dir, p), (p) => p);
		assert.match(text, /XSpec tests/);
		assert.include(text, 'of-module.xspec');
	});
});

// its own package name: the workspace index keeps the packages of the suites before it, and one of them is urn:common
suite('XSLT packages: converting - the XSpec files that get an x:helper for the package', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'package-conversion-helper-')));
	const file = (name: string, content: string) => {
		const fsPath = path.join(dir, name);
		fs.mkdirSync(path.dirname(fsPath), { recursive: true });
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	const scenario = `<x:scenario label="s"><x:call function="u:label"><x:param select="'a'"/></x:call><x:expect label="e" select="'a '"/></x:scenario>`;
	const xmlns = 'xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:u="urn:util"';
	const library = file('lib/common.xsl', `<xsl:stylesheet ${ns}>
  <xsl:function name="c:pad"><xsl:param name="s"/><xsl:sequence select="$s || ' '"/></xsl:function>
</xsl:stylesheet>`);
	const module = file('module.xsl', `<xsl:stylesheet ${ns}>
  <xsl:import href="lib/common.xsl"/>
  <xsl:function name="u:label"><xsl:param name="s"/><xsl:sequence select="c:pad($s)"/></xsl:function>
</xsl:stylesheet>`);
	const top = file('top.xsl', `<xsl:stylesheet ${ns}>
  <xsl:import href="module.xsl"/>
  <xsl:template match="/"><xsl:sequence select="u:label('a')"/></xsl:template>
</xsl:stylesheet>`);
	const plainText = `<x:description ${xmlns} stylesheet="module.xsl">\n  ${scenario}\n</x:description>`;
	const plain = file('plain.xspec', plainText);
	const withImports = file('with-imports.xspec', `<x:description ${xmlns} stylesheet="module.xsl">\n  <x:import href="other.xspec"/>\n  <x:helper package-name="urn:other" package-version="2.0"/>\n  ${scenario}\n</x:description>`);
	const hasHelper = file('has-helper.xspec', `<x:description ${xmlns} stylesheet="module.xsl">\n  <x:helper package-name="urn:helper-test"/>\n  ${scenario}\n</x:description>`);
	const prefixed = file('prefixed.xspec', `<t:description xmlns:t="http://www.jenitennison.com/xslt/xspec" xmlns:u="urn:util" stylesheet="module.xsl">\n\t<t:scenario label="s"><t:call function="u:label"><t:param select="'a'"/></t:call><t:expect label="e" select="'a '"/></t:scenario>\n</t:description>`);
	const ofLibrary = file('of-library.xspec', `<x:description ${xmlns} stylesheet="lib/common.xsl">\n  ${scenario}\n</x:description>`);
	const ofTop = file('of-top.xspec', `<x:description ${xmlns} stylesheet="top.xsl">\n  ${scenario}\n</x:description>`);
	const xspecFiles = PackageConversion.xspecFiles;
	let analysis: ConversionAnalysis;
	let edits: Map<string, { start: number, end: number, text: string }[]>;

	// the file's text with its edits made, from the end
	const edited = (name: string) => {
		let text = fs.readFileSync(name, 'utf8');
		[...(edits.get(name) ?? [])].sort((a, b) => b.start - a.start).forEach((e) => text = text.substring(0, e.start) + e.text + text.substring(e.end));
		return text;
	};

	suiteSetup(async () => {
		PackageConversion.xspecFiles = async () => [plain, withImports, hasHelper, prefixed, ofLibrary, ofTop];
		await ImportIndex.instance.buildFrom([library, module, top]);
		const result = await PackageConversion.analyse(library);
		assert.notTypeOf(result, 'string', String(result));
		analysis = result as ConversionAnalysis;
		const converted = PackageConversion.convert(analysis, 'urn:helper-test', '1.0');
		assert.notTypeOf(converted, 'string', String(converted));
		edits = converted as Map<string, { start: number, end: number, text: string }[]>;
	});
	suiteTeardown(() => {
		PackageConversion.xspecFiles = xspecFiles;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('an XSpec file for a module that used the library: the helper, at the start of x:description', () => {
		assert.strictEqual(edited(plain), plainText.replace('stylesheet="module.xsl">', 'stylesheet="module.xsl">\n  <x:helper package-name="urn:helper-test" package-version="1.0"/>'));
	});

	test('after its x:import and x:helper elements - with the indentation they have', () => {
		const text = edited(withImports);
		const lines = text.split('\n');
		assert.deepEqual(lines.slice(1, 5), ['  <x:import href="other.xspec"/>', '  <x:helper package-name="urn:other" package-version="2.0"/>',
			'  <x:helper package-name="urn:helper-test" package-version="1.0"/>', '  ' + scenario]);
	});

	test('not if it has a helper for the package already', () => {
		assert.isFalse(edits.has(hasHelper));
	});

	test('with the prefix the file uses for XSpec', () => {
		assert.include(edited(prefixed), '<t:helper package-name="urn:helper-test" package-version="1.0"/>');
		assert.notInclude(edited(prefixed), '<x:helper');
		// its own indentation: a tab
		assert.include(edited(prefixed), '>\n\t<t:helper ');
	});

	test('only those: a test of the library or of a top-level stylesheet is for the user to change - the report says how', () => {
		assert.isFalse(edits.has(ofLibrary));
		assert.isFalse(edits.has(ofTop));
		assert.sameMembers(analysis.plan.xspecHelpers, [plain, withImports, hasHelper, prefixed]);
	});

	test('the file is changed as the Refactor Preview shows it - one edit, an insertion', () => {
		assert.deepEqual(edits.get(plain)!.map((e) => e.start === e.end), [true]);
		assert.lengthOf(edits.get(withImports)!, 1);
	});

	// the whole conversion made, then the module's tests run as the Test Explorer runs them: the package is in the workspace, and the
	// test runner gets it from the helper - the module doesn't reach it any more
	test('end to end - with a real Saxon jar, in XSLT_TEST_SAXON_JAR: after the conversion, the module\'s tests run, with the package from the helper', async function () {
		const realJar = process.env.XSLT_TEST_SAXON_JAR;
		if (!realJar || process.platform === 'win32') {
			this.skip();
		}
		// the extension's XSpec is found once it's active
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const savedJar = tasks.inspect<string>('saxonJar')?.globalValue;
		await tasks.update('saxonJar', realJar, vscode.ConfigurationTarget.Global);
		try {
			// before: the tests pass, as the module imports the library
			const run = async (xspecFile: string) => {
				const described = await TestConfiguration.describe(xspecFile);
				assert.isFalse(described.isError, described.text);
				const text = described.text;
				const shell = (command: string) => {
					try {
						return childProcess.execSync(command, { cwd: os.tmpdir(), encoding: 'utf8', shell: '/bin/sh', stdio: 'pipe', env: { ...process.env, SAXON_LICENSE_DIR: process.env.SAXON_LICENSE_DIR ?? '' } });
					} catch (e: any) {
						throw new Error(`Saxon stopped: ${e.stderr ?? e.message}`);
					}
				};
				shell(/In one line: (java [^\n]+)/.exec(text)![1]);
				return shell(new RegExp('prints the numbers passed[^\\n]*\\n\\s+(java [^\\n]+)').exec(text)![1]);
			};
			assert.match(await run(plain), /^XSpec: 1 passed, 0 failed, 0 pending/m);
			// the conversion: every file it changes
			for (const name of edits.keys()) {
				fs.writeFileSync(name, edited(name));
			}
			await ImportIndex.instance.buildFrom([library, module, top]);
			assert.match(fs.readFileSync(library, 'utf8'), /<xsl:package /);
			assert.match(fs.readFileSync(top, 'utf8'), /<xsl:use-package name="urn:helper-test"/);
			// after: the module no longer imports the library - and the tests still pass, with the helper
			assert.notMatch(fs.readFileSync(module, 'utf8'), /xsl:import href="lib\/common\.xsl"/);
			assert.include(fs.readFileSync(plain, 'utf8'), '<x:helper package-name="urn:helper-test" package-version="1.0"/>');
			assert.match(await run(plain), /^XSpec: 1 passed, 0 failed, 0 pending/m);
		} finally {
			await tasks.update('saxonJar', savedJar, vscode.ConfigurationTarget.Global);
		}
	});
});
