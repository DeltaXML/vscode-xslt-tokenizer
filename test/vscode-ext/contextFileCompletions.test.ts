/**
 * Test suite for element name completions from the XML context file, when the context file's symbols have not been
 * cached - e.g. when VS Code restores the last context file at startup, before the user reselects it.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';

suite('Context file: completions without cached symbols', () => {
	const xmlPath = path.join(os.tmpdir(), `context-${Date.now()}.xml`);

	suiteSetup(() => fs.writeFileSync(xmlPath, '<books><book title="t"/></books>'));
	suiteTeardown(() => {
		DocumentChangeHandler.lastActiveXMLNonXSLUri = null;
		fs.rmSync(xmlPath, { force: true });
	});

	test('root element offered after /', async () => {
		const contextUri = vscode.Uri.file(xmlPath);
		XsltSymbolProvider.documentSymbols.delete(contextUri);
		DocumentChangeHandler.lastActiveXMLNonXSLUri = contextUri;
		const text = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
	<xsl:template match="/"><xsl:sequence select="/"/></xsl:template>
</xsl:stylesheet>`;
		const offset = text.indexOf('"/"/>') + 2;
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
		const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
		const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: '/' });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		const labels = items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
		assert.include(labels, 'books');
	});
});
