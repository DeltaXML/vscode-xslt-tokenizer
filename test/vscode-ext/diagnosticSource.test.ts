/**
 * Test suite for the source shown with each problem in the Problems view: this extension's linter says it is 'dx.xslt-xpath', so
 * a user - in VS Code or an editor built on it - can tell where a problem comes from; another source, e.g. Saxon's, is kept
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { revertAndCloseEditorsIn } from './testEditors';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

suite('Problems: the source shown for each', function () {
	this.timeout(30000);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagnostic-source-'));

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	suiteTeardown(async () => {
		await revertAndCloseEditorsIn(dir);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const problemsOf = async (file: string, text: string) => {
		fs.writeFileSync(file, text);
		const document = await vscode.workspace.openTextDocument(file);
		await vscode.window.showTextDocument(document);
		let problems: vscode.Diagnostic[] = [];
		for (let waited = 0; waited < 10000 && problems.length === 0; waited += 100) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			problems = vscode.languages.getDiagnostics(document.uri);
		}
		return problems;
	};

	test('the problems of a stylesheet - XSLT, XPath and an import - are from dx.xslt-xpath', async () => {
		const problems = await problemsOf(path.join(dir, 'source.xsl'), `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:import href="missing.xsl"/>
  <xsl:template name="t"><xsl:sequence select="$undeclared"/><xsl:call-template name="nothing"/></xsl:template>
</xsl:stylesheet>`);
		const messages = problems.map((p) => p.message);
		assert.isTrue(messages.some((m) => m.startsWith('XPath:')), messages.join(' | '));
		assert.isTrue(messages.some((m) => m.startsWith('XSLT:') && m.includes('not found')), messages.join(' | '));
		assert.isTrue(problems.length >= 3, messages.join(' | '));
		problems.forEach((p) => assert.strictEqual(p.source, 'dx.xslt-xpath', p.message));
	});

	test('the label is the extension\'s, and another source is kept', () => {
		const own = { message: 'a', source: '' };
		const none = { message: 'b' } as { message: string, source?: string };
		const saxon = { message: 'c', source: 'Saxon' };
		XsltTokenDiagnostics.labelled([own, none, saxon]);
		assert.strictEqual(own.source, XsltTokenDiagnostics.source);
		assert.strictEqual(none.source, 'dx.xslt-xpath');
		assert.strictEqual(saxon.source, 'Saxon');
	});
});
