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
import { XSLTCodeActions } from '../../src/xsltCodeActions';

const ns = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:p="urn:p" xmlns:q="urn:q" xmlns:s="urn:s" version="3.0"';

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

	const s = file('s.xsl', `<xsl:package name="urn:s" ${ns} declared-modes="no">
  <xsl:function name="s:f" visibility="public" as="xs:string"><xsl:param name="a" as="xs:integer"/><xsl:sequence select="'f'"/></xsl:function>
  <xsl:template name="s:t" visibility="public" as="xs:string"><xsl:param name="a" as="xs:integer"/><xsl:param name="r" as="xs:string" required="yes"/></xsl:template>
  <xsl:template name="s:tt" visibility="public" as="xs:string"><xsl:param name="a" as="xs:integer"/><xsl:param name="tun" tunnel="yes" as="xs:integer" select="0"/></xsl:template>
  <xsl:variable name="s:v" visibility="public" as="xs:integer" select="1"/>
</xsl:package>`);
	file('modes.xsl', `<xsl:stylesheet ${ns}><xsl:mode name="inc"/><xsl:mode/></xsl:stylesheet>`);

	suiteSetup(() => {
		XsltPackages.additional = [{ name: 'urn:p', path: p, version: '1.0' }, { name: 'urn:q', path: q }, { name: 'urn:s', path: s }];
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

	test('XTSE3070: an overriding declaration must have the same types, and a template the same parameters', async () => {
		const overrides = async (declaration: string) => (await errors(`<xsl:override>${declaration}</xsl:override>`, '', '', 'urn:s')).filter((m) => m.startsWith('XTSE3070'));
		const fn = (as: string, paramAs: string, param = 'b') => `<xsl:function name="s:f"${as}><xsl:param name="${param}"${paramAs}/><xsl:sequence select="'x'"/></xsl:function>`;
		// another parameter name is allowed - and a type with a prefix declared on the declaration isn't compared
		assert.deepEqual(await overrides(fn(' as="xsd:string" xmlns:xsd="http://www.w3.org/2001/XMLSchema"', ' as="xsd:integer"')), []);
		assert.deepEqual(await overrides(fn(' as="xs:string"', ' as="xs:integer "')), []);
		assert.match((await overrides(fn(' as="xs:string"', ' as="xs:decimal"')))[0], /the type of parameter 1, \$b, is 'xs:decimal', not 'xs:integer'/);
		assert.match((await overrides(fn('', ' as="xs:integer"')))[0], /its return type is none, not 'xs:string'/);
		const template = (params: string, as = ' as="xs:string"') => `<xsl:template name="s:t"${as}>${params}</xsl:template>`;
		const a = '<xsl:param name="a" as="xs:integer"/>';
		const r = '<xsl:param name="r" as="xs:string" required="yes"/>';
		assert.deepEqual(await overrides(template(a + r + '<xsl:param name="extra"/>')), []);
		// a tunnel parameter may be left out (override-t-001)
		assert.deepEqual(await overrides('<xsl:template name="s:tt" as="xs:string">' + a + '</xsl:template>'), []);
		assert.match((await overrides(template(r)))[0], /it has no parameter \$a/);
		assert.match((await overrides(template(a + r + '<xsl:param name="x" required="yes"/>')))[0], /its parameter \$x is required/);
		assert.match((await overrides(template(a + '<xsl:param name="r" as="xs:string"/>')))[0], /parameter \$r is optional, not required/);
		assert.match((await overrides(template('<xsl:param name="a" as="xs:integer" tunnel="yes"/>' + r)))[0], /parameter \$a is a tunnel parameter/);
		assert.match((await overrides(template(a + r, '')))[0], /its type is none, not 'xs:string'/);
		assert.match((await overrides('<xsl:variable name="s:v" as="xs:decimal" select="1"/>'))[0], /its type is 'xs:decimal', not 'xs:integer'/);
	});

	let packageCount = 0;
	test('XTSE3085: in a package, each mode used must be declared', async () => {
		const modeErrors = async (content: string, attributes = '') => {
			// a file, for the href of an xsl:include
			const fsPath = file(`k${++packageCount}.xsl`, `<xsl:package name="urn:k" ${ns} ${attributes}>\n${content}\n</xsl:package>`);
			const document = await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(fsPath), 'xslt');
			const diagnostics = await moduleDiagnostics.call(XsltSymbolProvider, document, false);
			return diagnostics.map((d) => d.message).filter((m) => m.startsWith('XTSE3085'));
		};
		assert.match((await modeErrors('<xsl:template match="*"/>'))[0], /The unnamed mode isn't declared/);
		assert.match((await modeErrors('<xsl:template name="t"><xsl:apply-templates mode="m"/></xsl:template>'))[0], /The mode 'm' isn't declared/);
		assert.match((await modeErrors('<xsl:template match="*" mode="#unnamed"/>'))[0], /unnamed/);
		assert.match((await modeErrors('', 'default-mode="m"'))[0], /The mode 'm'/);
		assert.match((await modeErrors('<xsl:template name="t" default-mode="m"><xsl:apply-templates/></xsl:template>'))[0], /The mode 'm'/);
		// a private mode of a used package isn't declared for the package using it
		assert.match((await modeErrors('<xsl:use-package name="urn:p"/><xsl:template name="t"><xsl:apply-templates mode="p:m"/></xsl:template>'))[0], /p:m/);
		assert.deepEqual(await modeErrors('<xsl:mode name="m"/><xsl:mode/><xsl:template match="*" mode="m #default"/><xsl:template name="t"><xsl:apply-templates mode="#current"/></xsl:template>'), []);
		assert.deepEqual(await modeErrors('<xsl:template match="*" mode="#all"/>'), []);
		assert.deepEqual(await modeErrors('<xsl:template match="*" mode="m"/>', 'declared-modes="no"'), []);
		assert.deepEqual(await modeErrors('<xsl:mode name="m"/><xsl:template match="*"/>', 'default-mode="m"'), []);
		assert.deepEqual(await modeErrors('<xsl:use-package name="urn:p"/><xsl:template name="t"><xsl:apply-templates mode="p:mpub"/></xsl:template>'), []);
		// declared in an included module
		assert.deepEqual(await modeErrors('<xsl:include href="modes.xsl"/><xsl:template match="*" mode="inc"/><xsl:template match="*"/>'), []);
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

suite('XSLT packages: overriding abstract components', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-package-overrides-'));
	const pkg = path.join(dir, 'a.xsl');
	fs.writeFileSync(pkg, `<xsl:package name="urn:a" version="3.0" declared-modes="no" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:a="urn:a" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xsl:function name="a:shape" visibility="abstract" as="xs:string"><xsl:param name="n" as="xs:integer"/></xsl:function>
  <xsl:function name="a:describe" visibility="public" as="xs:string"><xsl:sequence select="'shape: ' || a:shape(3)"/></xsl:function>
  <xsl:template name="a:t" visibility="abstract" as="xs:string"><xsl:param name="x" as="xs:string" required="yes"/><xsl:param name="tun" tunnel="yes" select="0"/></xsl:template>
  <xsl:variable name="a:v" visibility="abstract" as="xs:integer"/>
</xsl:package>`);
	suiteSetup(() => XsltPackages.additional = [{ name: 'urn:a', path: pkg }]);
	suiteTeardown(() => {
		XsltPackages.additional = [];
		fs.rmSync(dir, { recursive: true, force: true });
	});

	let count = 0;
	const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean | string): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
	const lint = async (text: string) => {
		const file = path.join(dir, `u${++count}.xsl`);
		fs.writeFileSync(file, text);
		const document = await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(file), 'xslt');
		const diagnostics: vscode.Diagnostic[] = await moduleDiagnostics.call(XsltSymbolProvider, document, false);
		const actions = (diagnostic: vscode.Diagnostic) => new XSLTCodeActions().provideCodeActions(document, diagnostic.range, { diagnostics: [diagnostic], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		// the text with the code action's edit
		const applied = (action: vscode.CodeAction) => {
			const [, edits] = action.edit!.entries()[0];
			const edit = edits[0];
			return text.substring(0, document.offsetAt(edit.range.start)) + edit.newText + text.substring(document.offsetAt(edit.range.end));
		};
		return { diagnostics, actions, applied };
	};
	const stylesheet = (usePackage: string, body = '', version = '3.0', prefix = 'a') =>
		`<xsl:stylesheet version="${version}" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:${prefix}="urn:a" xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  ${usePackage}\n  <xsl:template name="main">${body}</xsl:template>\n</xsl:stylesheet>`;

	test('a warning lists the abstract components that aren\'t overridden, with fixes to override all or each', async () => {
		const { diagnostics, actions } = await lint(stylesheet('<xsl:use-package name="urn:a"/>'));
		const warning = diagnostics.find((d) => d.severity === vscode.DiagnosticSeverity.Warning)!;
		assert.match(warning.message, /abstract components that aren't overridden: a:shape#1, a:t, \$a:v - .*XTDE3052/);
		assert.deepEqual(actions(warning).map((a) => a.title), ["Override the abstract components of package 'urn:a'", 'Override abstract function a:shape#1', 'Override abstract template a:t', 'Override abstract variable $a:v']);
	});

	test('the skeletons: the package\'s signature, a TODO note with @see, and a body that stops - then no problems', async () => {
		const text = stylesheet('<xsl:use-package name="urn:a"/>', '', '3.0', 'z');
		const { diagnostics, actions, applied } = await lint(text);
		const fixed = applied(actions(diagnostics.find((d) => d.severity === vscode.DiagnosticSeverity.Warning)!)[0]);
		// with the stylesheet's prefix for the package's namespace
		assert.include(fixed, `  <xsl:use-package name="urn:a">
    <xsl:override>
      <xsl:function name="z:shape" as="xs:string">
        <xsl:note use-when="false()" format="xdoc-md">
          TODO: implement the abstract function of package urn:a.

          @see z:shape#1
        </xsl:note>
        <xsl:param name="n" as="xs:integer"/>
        <xsl:message terminate="yes">z:shape#1 is not implemented</xsl:message>
      </xsl:function>
      <xsl:template name="z:t" as="xs:string">`);
		assert.include(fixed, '<xsl:param name="x" as="xs:string" required="yes"/>\n        <xsl:param name="tun" tunnel="yes" select="0"/>');
		assert.include(fixed, '    </xsl:override>\n  </xsl:use-package>');
		assert.deepEqual((await lint(fixed)).diagnostics.filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning).map((d) => d.message), []);
	});

	test('in XSLT 4.0, the note isn\'t excluded - and the declarations go in the existing xsl:override', async () => {
		const text = stylesheet('<xsl:use-package name="urn:a">\n    <xsl:override>\n      <xsl:variable name="a:v" as="xs:integer" select="1"/>\n    </xsl:override>\n  </xsl:use-package>', '', '4.0');
		const { diagnostics, actions, applied } = await lint(text);
		const fixed = applied(actions(diagnostics.find((d) => d.severity === vscode.DiagnosticSeverity.Warning)!)[0]);
		assert.include(fixed, '      <xsl:variable name="a:v" as="xs:integer" select="1"/>\n      <xsl:function name="a:shape" as="xs:string">\n        <xsl:note format="xdoc-md">');
		assert.notInclude(fixed, '$a:v is not implemented');
	});

	test('a reference to an abstract component that isn\'t overridden says so, with a fix to override it', async () => {
		const { diagnostics, actions } = await lint(stylesheet('<xsl:use-package name="urn:a"/>', '<xsl:sequence select="a:shape(1)"/>'));
		const error = diagnostics.find((d) => d.message.startsWith('The abstract function'))!;
		assert.strictEqual(error.message, "The abstract function a:shape#1 of package 'urn:a' isn't overridden, so it can't be used here - override it in the xsl:use-package");
		assert.deepEqual(actions(error).map((a) => a.title), ['Override abstract function a:shape#1']);
	});

	test('a package may pass an abstract component on with xsl:accept visibility="abstract"', async () => {
		const { diagnostics } = await lint(`<xsl:package name="urn:k" version="3.0" declared-modes="no" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:a="urn:a">
  <xsl:use-package name="urn:a"><xsl:accept component="*" names="*" visibility="abstract"/></xsl:use-package>
</xsl:package>`);
		assert.isUndefined(diagnostics.find((d) => d.severity === vscode.DiagnosticSeverity.Warning));
	});

	test('in an overriding declaration\'s note, @see of what it overrides goes to the package\'s declaration', async () => {
		const text = stylesheet('<xsl:use-package name="urn:a">\n    <xsl:override>\n      <xsl:function name="a:shape" as="xs:string">\n        <xsl:note use-when="false()" format="xdoc-md">\n          @see a:shape#1\n        </xsl:note>\n        <xsl:param name="n" as="xs:integer"/>\n        <xsl:sequence select="\'s\'"/>\n      </xsl:function>\n    </xsl:override>\n  </xsl:use-package>');
		const file = path.join(dir, 'see.xsl');
		fs.writeFileSync(file, text);
		const document = await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(file), 'xslt');
		const position = document.positionAt(text.indexOf('@see a:shape') + 7);
		const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
		const location = await provider.provideDefinition(document, position, new vscode.CancellationTokenSource().token);
		assert.strictEqual(location?.uri.fsPath, pkg);
		const hover = await new XSLTHoverProvider(provider, XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
		assert.include((hover?.contents as vscode.MarkdownString[]).map((m) => m.value).join('\n'), 'Abstract function of package `urn:a`');
	});
});
