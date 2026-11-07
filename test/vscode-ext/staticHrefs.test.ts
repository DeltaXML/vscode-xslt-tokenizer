/**
 * Test suite for xsl:import and xsl:include with a _href shadow attribute: the href is worked out where its expressions
 * are static parameters or variables of the module with string literal values, e.g. _href="{$dir}/lib.xsl" with
 * <xsl:param name="dir" static="yes" select="'lib'"/>, and the module is checked with what it imports - otherwise, a
 * template, function or other declaration that isn't found may be in the module it imports: a warning, not an error.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { StaticHrefs } from '../../src/staticHrefs';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';

const stylesheet = (body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0" xmlns:f="urn:f">\n${body}\n</xsl:stylesheet>`;
const hrefs = (body: string) => StaticHrefs.resolve(stylesheet(body)).map((href) => href.href);

suite('xsl:import and xsl:include with _href', () => {
	test('the href, with the values of static parameters and variables that are string literals', () => {
		assert.deepEqual(hrefs(`<xsl:param name="dir" static="yes" select="'lib'"/><xsl:import _href="{$dir}/lib.xsl"/>`), ['lib/lib.xsl']);
		assert.deepEqual(hrefs(`<xsl:variable name="v" static="true" select="&quot;v2&quot;"/><xsl:param name="d" select="'x'" static=" yes "/>
<xsl:include _href="{ $d }/{$v}/a.xsl"/><xsl:import _href="b{{1}}.xsl"/>`), ['x/v2/a.xsl', 'b{1}.xsl']);
		assert.deepEqual(hrefs(`<xsl:param name="q" static="yes" select="'it''s'"/><xsl:import _href="{$q}.xsl"/>`), ["it's.xsl"]);
		assert.deepEqual(hrefs(`<xsl:param name="dir" static="yes" select="'lib'"/>
<xsl:import _href="{$dir}/lib.xsl"/>`).length, 1);
	});

	test('not resolved: a parameter that isn\'t static or isn\'t a string literal, or another expression', () => {
		const unresolved = [
			`<xsl:param name="dir" select="'lib'"/><xsl:import _href="{$dir}/lib.xsl"/>`,
			`<xsl:param name="dir" static="yes" select="concat('l', 'ib')"/><xsl:import _href="{$dir}/lib.xsl"/>`,
			`<xsl:param name="dir" static="yes" required="yes"/><xsl:import _href="{$dir}/lib.xsl"/>`,
			`<xsl:param name="dir" static="yes" select="'lib'"/><xsl:import _href="{upper-case($dir)}/lib.xsl"/>`,
			`<xsl:import _href="{$undeclared}/lib.xsl"/>`
		];
		unresolved.forEach((body) => {
			assert.deepEqual(hrefs(body), [], body);
			assert.isTrue(StaticHrefs.hasUnresolved(stylesheet(body)), body);
		});
		assert.isFalse(StaticHrefs.hasUnresolved(stylesheet(`<xsl:import href="lib.xsl"/>`)));
	});

	suite('checked with the module it imports', () => {
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'static-hrefs-'));
		const calls = `<xsl:template name="main"><xsl:call-template name="lib-template"/><xsl:value-of select="f:lib-function(), $lib-variable"/></xsl:template>`;
		const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean | string): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
		let fileCount = 0;
		const diagnostics = async (body: string) => {
			const file = path.join(folder, `main${++fileCount}.xsl`);
			fs.writeFileSync(file, stylesheet(body));
			const document = await vscode.workspace.openTextDocument(file);
			const xslt = document.languageId === 'xslt' ? document : await vscode.languages.setTextDocumentLanguage(document, 'xslt');
			return (await moduleDiagnostics.call(XsltSymbolProvider, xslt, false)).filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint);
		};
		suiteSetup(() => {
			fs.mkdirSync(path.join(folder, 'lib'));
			fs.writeFileSync(path.join(folder, 'lib', 'lib.xsl'), stylesheet(`<xsl:variable name="lib-variable" select="1"/><xsl:template name="lib-template"/>
<xsl:function name="f:lib-function"><xsl:sequence select="1"/></xsl:function>`));
		});

		test('resolved: what it declares is found', async () => {
			assert.deepEqual((await diagnostics(`<xsl:param name="dir" static="yes" select="'lib'"/><xsl:import _href="{$dir}/lib.xsl"/>${calls}`)).map((d) => d.message), []);
		});

		test('not resolved: a name that isn\'t found is a warning - it may be in the module it imports', async () => {
			const found = await diagnostics(`<xsl:param name="dir" select="'lib'"/><xsl:import _href="{$dir}/lib.xsl"/>${calls}<xsl:template name="t"><xsl:value-of select="fn:nothing()"/></xsl:template>`);
			const warnings = found.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).map((d) => d.message);
			assert.isTrue(warnings.some((m) => /lib-template' not found - it may be declared in a module imported or included with _href/.test(m)), warnings.join(' | '));
			assert.isTrue(warnings.some((m) => /f:lib-function' with 0 arguments not found - it may be/.test(m)), warnings.join(' | '));
			// still an error: a built-in function that doesn't exist
			assert.isTrue(found.some((d) => d.severity === vscode.DiagnosticSeverity.Error && /fn:nothing/.test(d.message)));
		});
	});
});
