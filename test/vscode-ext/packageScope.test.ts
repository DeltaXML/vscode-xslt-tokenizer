/**
 * Test suite for XSLT package visibility (see PackageScope): which components of a used package a stylesheet can refer
 * to, and the problems with xsl:accept and xsl:override - each as Saxon-PE 13.1 behaves.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { XsltPackages } from '../../src/xsltPackages';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTConfiguration } from '../../src/languageConfigurations';

const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:p="urn:p" xmlns:q="urn:q" version="3.0"';

suite('XSLT packages: visibility', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-package-scope-'));
	const file = (name: string, content: string) => {
		const fsPath = path.join(dir, name);
		fs.writeFileSync(fsPath, content);
		return fsPath;
	};
	const p = file('p.xsl', `<xsl:package name="urn:p" package-version="1.0" ${ns}>
  <xsl:note format="xdoc-md">Shapes and sizes.</xsl:note>
  <xsl:expose component="function" names="p:exposed#0" visibility="public"/>
  <xsl:expose component="function" names="p:*" visibility="final"/>
  <xsl:mode/>
  <xsl:function name="p:none" visibility="private"><xsl:sequence select="1"/></xsl:function>
  <xsl:function name="p:pub" visibility="public"><xsl:param name="a"/><xsl:sequence select="$a"/></xsl:function>
  <xsl:function name="p:exposed"><xsl:sequence select="1"/></xsl:function>
  <xsl:function name="p:wild"><xsl:sequence select="1"/></xsl:function>
  <xsl:function name="p:abs" visibility="abstract" as="xs:string"/>
  <xsl:variable name="p:v" select="1"/>
  <xsl:variable name="p:vpub" visibility="public" select="1"/>
  <xsl:param name="p:prm" select="1"/>
  <xsl:template name="p:t">t</xsl:template>
  <xsl:template name="p:tpub" visibility="public"><xsl:param name="x"/></xsl:template>
  <xsl:template name="p:tfin" visibility="final"/>
  <xsl:mode name="p:m"/>
  <xsl:mode name="p:mpub" visibility="public"/>
  <xsl:template match="*" mode="p:m p:mpub">matched</xsl:template>
  <xsl:key name="p:k" match="*" use="."/>
</xsl:package>`);
	const q = file('q.xsl', `<xsl:package name="urn:q" ${ns} declared-modes="no">
  <xsl:use-package name="urn:p">
    <xsl:accept component="function" names="p:pub#1" visibility="public"/>
  </xsl:use-package>
  <xsl:expose component="variable" names="p:vpub" visibility="public"/>
  <xsl:function name="q:f" visibility="public"><xsl:sequence select="p:wild()"/></xsl:function>
</xsl:package>`);

	suiteSetup(() => {
		XsltPackages.additional = [{ name: 'urn:p', path: p, version: '1.0' }, { name: 'urn:q', path: q }];
	});
	suiteTeardown(() => {
		XsltPackages.additional = [];
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean | string): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
	const errors = async (useChildren: string, body: string, topLevel = '', usePackage = 'urn:p') => {
		const text = `<xsl:stylesheet ${ns}>\n<xsl:use-package name="${usePackage}">${useChildren}</xsl:use-package>\n${topLevel}\n<xsl:template name="main">${body}</xsl:template>\n</xsl:stylesheet>`;
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
		const diagnostics = await moduleDiagnostics.call(XsltSymbolProvider, document, false);
		return diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).map((d) => d.message);
	};
	const fails = async (body: string, pattern: RegExp, useChildren = '', topLevel = '', usePackage?: string) => {
		const found = await errors(useChildren, body, topLevel, usePackage);
		assert.isTrue(found.some((m) => pattern.test(m)), `expected ${pattern} in ${JSON.stringify(found)}`);
	};
	const passes = async (body: string, useChildren = '', topLevel = '', usePackage?: string) => {
		assert.deepEqual(await errors(useChildren, body, topLevel, usePackage), []);
	};

	test('public and final components are visible - private ones, by default or explicitly, are not', async () => {
		await passes('<xsl:sequence select="p:pub(1), $p:vpub"/><xsl:call-template name="p:tpub"/><xsl:call-template name="p:tfin"/>');
		await fails('<xsl:sequence select="p:none()"/>', /p:none/);
		await fails('<xsl:sequence select="$p:v"/>', /\$p:v cannot be resolved/);
		await fails('<xsl:call-template name="p:t"/>', /'p:t' not found/);
	});

	test('xsl:expose: by name, then by wildcard - a global xsl:param is public', async () => {
		await passes('<xsl:sequence select="p:exposed(), p:wild(), $p:prm"/>');
	});

	test('keys are local to a package', async () => {
		await fails('<xsl:sequence select="key(\'p:k\', \'x\')"/>', /p:k/);
	});

	test('xsl:accept: hidden removes a component, private keeps it for the stylesheet', async () => {
		await fails('<xsl:sequence select="p:pub(1)"/>', /p:pub/, '<xsl:accept component="function" names="p:pub#1" visibility="hidden"/>');
		await passes('<xsl:sequence select="p:pub(1)"/>', '<xsl:accept component="function" names="p:pub#1" visibility="private"/>');
		await fails('<xsl:sequence select="$p:vpub"/>', /\$p:vpub/, '<xsl:accept component="*" names="*" visibility="hidden"/>');
	});

	test('an abstract component can only be used once it\'s overridden', async () => {
		await fails('<xsl:sequence select="p:abs()"/>', /p:abs/);
		await passes('<xsl:sequence select="p:abs()"/>', '<xsl:override><xsl:function name="p:abs" as="xs:string"><xsl:sequence select="\'a\'"/></xsl:function></xsl:override>');
	});

	test('an overriding template\'s parameters - and xsl:original within the override only', async () => {
		const override = '<xsl:override><xsl:template name="p:tpub" visibility="public"><xsl:param name="x"/><xsl:param name="extra"/><xsl:call-template name="xsl:original"/></xsl:template></xsl:override>';
		await passes('<xsl:call-template name="p:tpub"><xsl:with-param name="extra" select="1"/></xsl:call-template>', override);
		await fails('<xsl:call-template name="xsl:original"/>', /xsl:original/);
	});

	test('a package\'s components accepted from the packages it uses are private, unless accepted or exposed as public', async () => {
		await passes('<xsl:sequence select="q:f(), p:pub(1), $p:vpub"/>', '', '', 'urn:q');
		await fails('<xsl:sequence select="p:exposed()"/>', /p:exposed/, '', '', 'urn:q');
	});

	test('problems with xsl:accept', async () => {
		await fails('', /XTSE3020: The function name 'p:pub'/, '<xsl:accept component="function" names="p:pub" visibility="private"/>');
		await fails('', /XTSE3030: No template named 'p:nothing'/, '<xsl:accept component="template" names="p:nothing" visibility="hidden"/>');
		await fails('', /XTSE3040: The function 'p:none#0' is private/, '<xsl:accept component="function" names="p:none#0" visibility="hidden"/>');
		await fails('', /XTSE3040: The template 'p:tfin' is final .* as public/, '<xsl:accept component="template" names="p:tfin" visibility="public"/>');
		await fails('', /XTSE0020: '#unnamed'/, '<xsl:accept component="mode" names="#unnamed" visibility="hidden"/>');
		await fails('', /XTSE3051/, '<xsl:accept component="template" names="p:tpub" visibility="hidden"/><xsl:override><xsl:template name="p:tpub"/></xsl:override>');
		// a wildcard may match private components
		await passes('', '<xsl:accept component="function" names="p:*" visibility="private"/>');
	});

	test('problems with xsl:override, and declarations with a package component\'s name', async () => {
		await fails('', /XTSE3058: There is no template named 'p:nothing'/, '<xsl:override><xsl:template name="p:nothing"/></xsl:override>');
		await fails('', /XTSE3060: The template 'p:tfin' can't be overridden: it's final/, '<xsl:override><xsl:template name="p:tfin"/></xsl:override>');
		await fails('', /XTSE3060: The template 'p:t' can't be overridden: it's private/, '<xsl:override><xsl:template name="p:t"/></xsl:override>');
		await fails('', /XTSE3050: The function 'p:pub'/, '', '<xsl:function name="p:pub"><xsl:param name="a"/><xsl:sequence select="1"/></xsl:function>');
		// a private component's name is free
		await passes('<xsl:sequence select="p:none()"/>', '', '<xsl:function name="p:none"><xsl:sequence select="1"/></xsl:function>');
	});

	test('the hover of an xsl:use-package: the package note and the components it gives', async () => {
		const text = `<xsl:stylesheet ${ns}>\n<xsl:use-package name="urn:p">\n  <xsl:accept component="function" names="p:wild#0" visibility="hidden"/>\n</xsl:use-package>\n</xsl:stylesheet>`;
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
		const provider = new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration);
		const hover = await provider.provideHover(document, document.positionAt(text.indexOf('name="urn:p"') + 8), new vscode.CancellationTokenSource().token);
		const markdown = (hover?.contents as vscode.MarkdownString[]).map((m) => m.value).join('\n');
		assert.include(markdown, 'Shapes and sizes.');
		// p:wild is hidden, and p:abs abstract
		assert.include(markdown, '**Functions** (2): `p:exposed#0`, `p:pub#1`');
		assert.notInclude(markdown, 'p:wild');
		assert.notInclude(markdown, 'p:none');
		assert.include(markdown, '**Modes** (1): `p:mpub`');
	});

	test('the hover of a function from a package says which, and its visibility', async () => {
		const text = `<xsl:stylesheet ${ns}>\n<xsl:use-package name="urn:p"/>\n<xsl:template name="main"><xsl:sequence select="p:pub(1)"/></xsl:template>\n</xsl:stylesheet>`;
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
		const provider = new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration);
		const hover = await provider.provideHover(document, document.positionAt(text.indexOf('p:pub(') + 2), new vscode.CancellationTokenSource().token);
		const markdown = (hover?.contents as vscode.MarkdownString[]).map((m) => m.value).join('\n');
		assert.include(markdown, 'Public function of package `urn:p` 1.0, declared in p.xsl');
	});
});
