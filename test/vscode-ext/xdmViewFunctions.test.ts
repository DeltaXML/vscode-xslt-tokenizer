/**
 * Test suite for the functions of the xdm-view library bundled with the extension (xslt-resources/xdm-view):
 * xdm:debug, xdm:debug-color and xdm:trace. Called without the library's module included, each is reported with
 * its own warning, whose quick fixes include the module - or copy the library into the workspace and include it
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { DiagnosticCode, XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XSLTCodeActions } from '../../src/xsltCodeActions';

async function lint(select: string) {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n  <xsl:template match="/"><xsl:sequence select="${select}"/></xsl:template>\n</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], []);
	return { document, diagnostics };
}

suite('xdm-view library functions: xdm:debug and xdm:trace', () => {
	test('without the module: a warning of their own, naming the function', async () => {
		const { diagnostics } = await lint('xdm:trace(1, \'label\'), xdm:trace(2), xdm:debug(\'title\', map{})');
		assert.deepEqual(diagnostics.map((d) => [d.code, d.severity, d.message]), [
			[DiagnosticCode.xdmDebugRef, vscode.DiagnosticSeverity.Warning, 'XPath: \'xdm:trace\' function not defined - use QuickFix to include the xdm-view module'],
			[DiagnosticCode.xdmDebugRef, vscode.DiagnosticSeverity.Warning, 'XPath: \'xdm:trace\' function not defined - use QuickFix to include the xdm-view module'],
			[DiagnosticCode.xdmDebugRef, vscode.DiagnosticSeverity.Warning, 'XPath: \'xdm:debug\' function not defined - use QuickFix to include the xdm-view module']
		]);
	});

	test('the quick fixes: include the module, or copy the library into the workspace', async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		const { document, diagnostics } = await lint('xdm:trace(1, \'label\')');
		const actions = await new XSLTCodeActions().provideCodeActions(document, diagnostics[0].range, { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		assert.deepEqual(actions.map((a) => a.title), ['include XSLT module for xdm:debug and xdm:trace', 'copy xdm-view library into workspace']);
	});
});
