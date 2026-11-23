/**
 * Test suite for the hint on a template rule's mode that no xsl:apply-templates in the stylesheet's modules applies - e.g.
 * a mode added to a template rule but not to the xsl:apply-templates meant to reach it, so the built-in rules run instead
 *
 * - none where an xsl:apply-templates names the mode - in this module or another of the stylesheet's (the imported data)
 * - none for a mode a default-mode names: xsl:apply-templates without a mode applies it, and it's the initial mode
 * - none for a mode with a template rule for the document node (match="/"): it's the initial mode a run starts in, as a rule
 * - a package's private mode is checked - only the package can apply it - not a public or final one, by its xsl:mode's
 *   visibility or the package's xsl:expose: the stylesheets that use the package may apply it
 * - none where a _mode shadow attribute sets a mode
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, GlobalInstructionData, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const stylesheet = (body: string, attributes = '', element = 'xsl:stylesheet') => `<${element} xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"${attributes}>
${body}
</${element}>`;

const hint = (mode: string) => `XSLT: no xsl:apply-templates in the stylesheet's modules applies the mode '${mode}' - its template rules run only if it's ` +
	`the initial mode, or a stylesheet that isn't found here applies it. Was a mode added here but not to the xsl:apply-templates meant to reach it?`;

// the data of another of the stylesheet's modules, as the linter has it for those it imports or includes, or that import it
function moduleData(xslt: string): GlobalInstructionData[] {
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.analyse(xslt);
	return lexer.globalInstructionData;
}

async function problems(xslt: string, otherModule?: string) {
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const config = { ...XSLTConfiguration.configuration, isVersion4: xslLexer.isXSLT40 };
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(config, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData,
		otherModule ? moduleData(otherModule) : [], []);
	return diagnostics.filter((d) => d.message.includes('no xsl:apply-templates')).map((d) => [d.message, document.getText(d.range), d.severity]);
}

const hinted = (mode: string): [string, string, vscode.DiagnosticSeverity] => [hint(mode), mode, vscode.DiagnosticSeverity.Hint];

const cases: [string, string, string | undefined, [string, string, vscode.DiagnosticSeverity][]][] = [
	['a mode nothing applies - the trial\'s bug', stylesheet(`<xsl:template match="/"><xsl:apply-templates select="shipping"/></xsl:template>
<xsl:template match="shipping" mode="detail"><s/></xsl:template>`), undefined, [hinted('detail')]],
	['a mode applied in the module', stylesheet(`<xsl:template match="/"><xsl:apply-templates select="shipping" mode="detail"/></xsl:template>
<xsl:template match="shipping" mode="detail"><s/></xsl:template>`), undefined, []],
	['two modes, one applied', stylesheet(`<xsl:template match="/"><xsl:apply-templates mode="b"/></xsl:template>
<xsl:template match="x" mode="a b"><s/></xsl:template>`), undefined, [hinted('a')]],
	['applied only by its own template rules, with #current', stylesheet(`<xsl:template match="x" mode="m"><xsl:apply-templates mode="#current"/></xsl:template>`), undefined, [hinted('m')]],
	['the stylesheet\'s default mode', stylesheet(`<xsl:template match="x" mode="m"><s/></xsl:template>`, ' default-mode="m"'), undefined, []],
	['#all, #default and a template rule with no mode', stylesheet(`<xsl:template match="x" mode="#all"/><xsl:template match="y" mode="#default"/><xsl:template match="z"/>`), undefined, []],
	['applied in another of the stylesheet\'s modules', stylesheet(`<xsl:template match="shipping" mode="detail"><s/></xsl:template>`),
		stylesheet(`<xsl:template match="/"><xsl:apply-templates select="shipping" mode="detail"/></xsl:template>`), []],
	['another module\'s default mode', stylesheet(`<xsl:template match="shipping" mode="detail"><s/></xsl:template>`), stylesheet('', ' default-mode="detail"'), []],
	['another module that applies another mode', stylesheet(`<xsl:template match="shipping" mode="detail"><s/></xsl:template>`),
		stylesheet(`<xsl:template match="/"><xsl:apply-templates mode="other"/></xsl:template>`), [hinted('detail')]],
	['a mode with a prefix, applied with it', stylesheet(`<xsl:template match="/"><xsl:apply-templates mode="m:detail"/></xsl:template>
<xsl:template match="x" mode="m:detail"><s/></xsl:template>`, ' xmlns:m="urn:m"'), undefined, []],
	['a mode with a template rule for the document node: the initial mode', stylesheet(`<xsl:template match="/" mode="report"><xsl:apply-templates mode="#current"/></xsl:template>
<xsl:template match="order" mode="report"><o/></xsl:template>`), undefined, []],
	['the document node as document-node(), in a union', stylesheet(`<xsl:template match="x | document-node()" mode="report"/>`), undefined, []],
	['a template rule for another node: not the initial mode, as a rule', stylesheet(`<xsl:template match="/*" mode="report"/>`), undefined, [hinted('report')]],
	['a package\'s private mode: only the package can apply it', stylesheet(`<xsl:mode name="detail"/><xsl:template match="x" mode="detail"><s/></xsl:template>`, ' name="urn:p" package-version="1"', 'xsl:package'), undefined, [hinted('detail')]],
	['a package\'s public mode: the stylesheets that use it may apply it', stylesheet(`<xsl:mode name="detail" visibility="public"/><xsl:template match="x" mode="detail"><s/></xsl:template>`, ' name="urn:p" package-version="1"', 'xsl:package'), undefined, []],
	['a package\'s final mode', stylesheet(`<xsl:mode name="detail" visibility="final"/><xsl:template match="x" mode="detail"><s/></xsl:template>`, ' name="urn:p" package-version="1"', 'xsl:package'), undefined, []],
	['a stylesheet\'s template rule for a used package\'s mode, in xsl:override', stylesheet(`<xsl:use-package name="urn:p"><xsl:override><xsl:template match="x" mode="detail"><s/></xsl:template></xsl:override></xsl:use-package>`), undefined, []],
	['a _mode shadow attribute: the mode is a static expression\'s', stylesheet(`<xsl:template match="/"><xsl:apply-templates _mode="{$m}"/></xsl:template>
<xsl:template match="x" mode="detail"><s/></xsl:template>`), undefined, []],
];

suite('a template rule\'s mode that no xsl:apply-templates applies', () => {
	cases.forEach(([label, xslt, otherModule, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(xslt, otherModule), expected);
		});
	});

	// the package's xsl:expose is read from its file, as for the stylesheets that use it
	test('a package\'s mode made public by its xsl:expose - not one it leaves private', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-not-applied-'));
		const file = path.join(dir, 'p.xsl');
		const xslt = stylesheet(`<xsl:expose component="mode" names="shown" visibility="public"/>
<xsl:mode name="shown"/><xsl:mode name="kept"/>
<xsl:template match="x" mode="shown"><s/></xsl:template>
<xsl:template match="y" mode="kept"><s/></xsl:template>`, ' name="urn:p" package-version="1"', 'xsl:package');
		fs.writeFileSync(file, xslt);
		try {
			const xslLexer = new XslLexer(XSLTConfiguration.configuration);
			xslLexer.provideCharLevelState = true;
			const allTokens = xslLexer.analyse(xslt);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
			assert.deepEqual(diagnostics.filter((d) => d.message.includes('no xsl:apply-templates')).map((d) => document.getText(d.range)), ['kept']);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
