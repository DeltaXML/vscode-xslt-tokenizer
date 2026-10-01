/**
 * Test suite for the snippets for the root element of a new stylesheet - xsl:stylesheet and xsl:package, for XSLT 3.0
 * and 4.0, for an identity transform or starting from xsl:initial-template: each is offered in an empty document - in
 * the order they're declared, not by name, with the XSLT version right-aligned - and once expanded - with the default
 * for each placeholder - the stylesheet has no problems.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XSLTSnippets } from '../../src/xsltSnippets';

// the snippet's text with each placeholder's default, a mirrored placeholder's too, and without the final cursor
function expand(body: string) {
	const defaults = new Map<string, string>();
	return body.replace(/\$\{(\d+):([^}]*)\}/g, (_, n, value) => (defaults.set(n, value), value))
		.replace(/\$(\d+)/g, (_, n) => defaults.get(n) ?? '');
}

async function problems(text: string, isVersion4: boolean) {
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(text);
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], [])
		.map((d) => d.message);
}

suite('Root element snippets', () => {
	test('offered in an empty document', async () => {
		const document = await vscode.workspace.openTextDocument({ content: '<', language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, new vscode.Position(0, 1), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		// in their order, as VS Code sorts them: by sortText
		const items = (Array.isArray(result) ? result : result?.items ?? []).slice().sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
		// the name, the detail after it, and the version, right-aligned
		const labels = items.map((item) => typeof item.label === 'string' ? item.label : [item.label.label, item.label.detail?.trim(), item.label.description].filter((part) => part).join(' | '));
		assert.isTrue(items.every((item) => item.sortText !== undefined));
		assert.deepEqual(labels, [
			'xsl:stylesheet | XSLT 3.0', 'xsl:stylesheet | initial template | XSLT 3.0', 'xsl:stylesheet | XSLT 4.0',
			'xsl:stylesheet | initial template | XSLT 4.0', 'xsl:package | XSLT 3.0', 'xsl:package | XSLT 4.0'
		]);
	});

	for (const snippet of XSLTSnippets.xsltRootTags) {
		test(`no problems: ${[snippet.name, snippet.labelDetail, snippet.group].filter((part) => part).join(', ')}`, async () => {
			const text = '<' + expand(snippet.body);
			assert.deepEqual(await problems(text, text.includes('version="4.0"')), []);
		});
	}
});
