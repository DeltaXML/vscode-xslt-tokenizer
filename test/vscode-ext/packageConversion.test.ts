/**
 * Test suite for the analysis of converting a library - a module that stylesheets import or include - to an XSLT
 * package (see PackageConversion): what has to change for the stylesheets to work as before, as Saxon 13 behaves.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { ImportIndex } from '../../src/importIndex';
import { ConversionAnalysis, PackageConversion } from '../../src/packageConversion';
import { PackageAnalysisView } from '../../src/packageAnalysisView';
import * as vscode from 'vscode';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';

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
		const result = await PackageConversion.analyse(lib) as ConversionAnalysis;
		assert.sameMembers(result.items.filter((i) => i.section === 'blockers').map((i) => i.subject), ['variable $c:a', 'variable $c:b', 'variable $c:c', 'variable $c:d', 'variable $c:e']);
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
