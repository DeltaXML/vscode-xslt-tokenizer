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
		const result = PackageConversion.analyse(common);
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

	test('modes: a named mode is made public, the stylesheet\'s rules in it overrides - the unnamed mode and xsl:apply-imports need decisions', () => {
		assert.sameMembers(subjects('modes'), ['change: mode c:list', 'change: 1 template rule in mode c:list', 'decision: the unnamed mode', 'decision: xsl:apply-imports']);
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

	test('a module that\'s a package, or that nothing imports, isn\'t analysed', () => {
		assert.strictEqual(PackageConversion.analyse(main), 'No stylesheet in the workspace imports or includes the module, so it isn\'t used as a library');
	});

	test('a global variable\'s value that may use the context item', () => {
		['/', '/*', '//item', 'item', 'item/@id', '@id', '.', 'root()', 'name()', 'count(//x)', '$a + count(/x)'].forEach((select) => assert.isTrue(PackageConversion.mayUseContext(select), select));
		['1', '\'a/b\'', '$x', '$x/item', '$doc//item', 'c:pad(\'x\')', 'map { }', 'true()', '(1, 2)'].forEach((select) => assert.isFalse(PackageConversion.mayUseContext(select), select));
	});
});
