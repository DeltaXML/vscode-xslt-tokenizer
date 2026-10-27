/**
 * Test suite for the symbol provider's state when it checks more than one stylesheet: each check uses its own
 * stylesheet's declarations, XSLT version and imported declarations
 *
 * - two stylesheets checked at the same time, e.g. after an AI agent changes both: neither check is affected by the
 *   other, which starts while the first one is processing its imports
 * - the check used by Extract Function, of the active stylesheet with the new function: with that stylesheet's imported
 *   declarations, not those of the stylesheet checked last, e.g. one in another tab
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';

const xsl = (version: string, body: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
${body}
</xsl:stylesheet>`;

suite('Symbol provider state for each stylesheet', () => {
	let folder: string;
	const file = async (name: string, content: string) => {
		fs.writeFileSync(path.join(folder, name), content);
		return vscode.workspace.openTextDocument(vscode.Uri.file(path.join(folder, name)));
	};
	const problemsOf = (diagnostics: readonly vscode.Diagnostic[]) => diagnostics.map((d) => d.message);

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-lint-state-'));
	});

	test('two stylesheets checked at the same time: each with its own global declarations and XSLT version', async () => {
		const a = await file('a.xsl', xsl('4.0', `<xsl:variable name="g" select="1"/>
<xsl:template name="t"><xsl:switch select="$g"><xsl:when test="1"/></xsl:switch></xsl:template>`));
		const b = await file('b.xsl', xsl('3.0', `<xsl:template name="u"/>`));
		await vscode.window.showTextDocument(a, { preview: false });
		const provider = XsltSymbolProvider.instanceForXSLT!;
		// b's check starts while a's waits for its imports to be processed
		const checkA = provider.getDocumentSymbols(a, false);
		const checkB = provider.getDocumentSymbols(b, false);
		await Promise.all([checkA, checkB]);
		assert.deepEqual(problemsOf(vscode.languages.getDiagnostics(a.uri)), []);
	});

	test('the check for Extract Function uses the stylesheet\'s own imported declarations', async () => {
		await file('a-lib.xsl', xsl('3.0', `<xsl:variable name="from-a-lib" select="1"/>`));
		await file('b-lib.xsl', xsl('3.0', `<xsl:variable name="from-b-lib" select="2"/>`));
		const a = await file('a2.xsl', xsl('3.0', `<xsl:import href="a-lib.xsl"/>
<xsl:template name="t"><xsl:sequence select="$from-a-lib"/></xsl:template>`));
		const b = await file('b2.xsl', xsl('3.0', `<xsl:import href="b-lib.xsl"/>
<xsl:template name="u"><xsl:sequence select="$from-b-lib"/></xsl:template>`));
		const provider = XsltSymbolProvider.instanceForXSLT!;
		await provider.getDocumentSymbols(a, false);
		// another stylesheet checked last, e.g. in another tab
		await provider.getDocumentSymbols(b, false);
		assert.deepEqual(problemsOf(provider.calculateVirtualDiagnostics(a)), []);
	});

	suiteTeardown(async () => {
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		fs.rmSync(folder, { recursive: true, force: true });
	});
});
