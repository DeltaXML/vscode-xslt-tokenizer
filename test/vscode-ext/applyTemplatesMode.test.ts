/**
 * Test suite for the warning on an xsl:apply-templates without a mode in a template rule with a mode: it applies the
 * default mode - rarely what's meant, e.g. when mode="#current" is forgotten in a template rule for a new mode - with
 * quick fixes to add mode="#current" or mode="#default"
 *
 * - no warning when the template rule's modes include the default mode - the unnamed mode, or the mode of an
 *   [xsl:]default-mode - or #all, or #default
 * - none in a template rule within an XSLT 4.0 xsl:mode, where the default is the enclosing mode, as in Saxon 13
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const stylesheet = (body: string, version = '3.0', attributes = '') => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}"${attributes}>
${body}
</xsl:stylesheet>`;

const warning = (modes: string) => `XSLT: xsl:apply-templates without a mode applies the default mode, not the template rule's ${modes} - add mode="#current", or mode="#default" if that's intended`;

async function problems(xslt: string) {
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const config = { ...XSLTConfiguration.configuration, isVersion4: xslLexer.isXSLT40 };
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(config, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.filter((d) => d.message.includes('xsl:apply-templates without a mode')).map((d) => [d.message, document.getText(d.range)]);
}

const cases: [string, string, [string, string][]][] = [
	['no mode, in a template rule with a mode', stylesheet(`<xsl:template match="a" mode="m"><xsl:apply-templates/></xsl:template>`),
		[[warning(`mode 'm'`), 'xsl:apply-templates']]],
	['no mode, within an instruction in the template rule', stylesheet(`<xsl:template match="a" mode="m"><xsl:for-each select="*"><xsl:apply-templates select="b"/></xsl:for-each></xsl:template>`),
		[[warning(`mode 'm'`), 'xsl:apply-templates']]],
	['no mode, in a template rule with two modes', stylesheet(`<xsl:template match="a" mode="m n"><xsl:apply-templates/></xsl:template>`),
		[[warning(`modes 'm', 'n'`), 'xsl:apply-templates']]],
	['mode="#current"', stylesheet(`<xsl:template match="a" mode="m"><xsl:apply-templates mode="#current"/></xsl:template>`), []],
	['mode="#default"', stylesheet(`<xsl:template match="a" mode="m"><xsl:apply-templates mode="#default"/></xsl:template>`), []],
	['a template rule without a mode', stylesheet(`<xsl:template match="a"><xsl:apply-templates/></xsl:template>`), []],
	['a template rule in #all modes', stylesheet(`<xsl:template match="a" mode="#all"><xsl:apply-templates/></xsl:template>`), []],
	['a template rule including #default', stylesheet(`<xsl:template match="a" mode="m #default"><xsl:apply-templates/></xsl:template>`), []],
	['the default mode of the stylesheet', stylesheet(`<xsl:template match="a" mode="m"><xsl:apply-templates/></xsl:template>`, '3.0', ' default-mode="m"'), []],
	['another default mode of the stylesheet', stylesheet(`<xsl:template match="a" mode="m"><xsl:apply-templates/></xsl:template>`, '3.0', ' default-mode="n"'),
		[[warning(`mode 'm'`), 'xsl:apply-templates']]],
	['the default mode of a literal result element', stylesheet(`<xsl:template match="a" mode="m"><out xsl:default-mode="m"><xsl:apply-templates/></out></xsl:template>`), []],
	['XSLT 4.0: a template rule within an xsl:mode', stylesheet(`<xsl:mode name="m"><xsl:template match="a"><xsl:apply-templates/></xsl:template></xsl:mode>`, '4.0'), []],
	['a named template', stylesheet(`<xsl:template name="t"><xsl:apply-templates/></xsl:template>`), []],
];

suite('xsl:apply-templates without a mode in a template rule with a mode', () => {
	cases.forEach(([label, xslt, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(xslt), expected);
		});
	});

	test('quick fixes: add mode="#current" (preferred) or mode="#default"', async function () {
		this.timeout(10000);
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		const content = stylesheet(`<xsl:template match="a" mode="m"><xsl:apply-templates select="b"/></xsl:template>`);
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		// the problems are reported for a document in an editor
		await vscode.window.showTextDocument(document);
		let diagnostic: vscode.Diagnostic | undefined;
		for (let i = 0; i < 50 && !diagnostic; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			diagnostic = vscode.languages.getDiagnostics(document.uri).find((d) => d.message === warning(`mode 'm'`));
		}
		assert.isDefined(diagnostic);
		const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri, diagnostic!.range, vscode.CodeActionKind.QuickFix.value) ?? [];
		const fixes = actions.filter((a) => a.title.startsWith('Add mode='));
		assert.deepEqual(fixes.map((a) => [a.title, !!a.isPreferred]), [['Add mode="#current"', true], ['Add mode="#default"', false]]);
		const edit = new vscode.WorkspaceEdit();
		edit.set(document.uri, fixes[0].edit!.get(document.uri));
		await vscode.workspace.applyEdit(edit);
		assert.include(document.getText(), '<xsl:apply-templates mode="#current" select="b"/>');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});
});
