/**
 * Test suite for an XSLT module whose instructions have a prefix other than xsl, e.g. xslt:template in some W3C tests:
 * the prefix is that of the outermost element - xslt:stylesheet, xslt:transform or xslt:package - and must be bound to
 * the XSLT namespace. Each sample stylesheet, with its xsl prefix replaced by xslt, has the same problems
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { ImportIndex } from '../../src/importIndex';

const toXslt = (text: string) => text.replace(/\bxmlns:xsl=/g, 'xmlns:xslt=').replace(/(?<![\w.:-])xsl:/g, 'xslt:');

async function problems(text: string) {
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(text);
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const config = { ...XSLTConfiguration.configuration, isVersion4: lexer.isXSLT40 };
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(config, DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], []);
	// a problem's message and line - as for the xsl prefix
	return diagnostics.map((d) => `${d.range.start.line}: ${d.message.replace(/(?<![\w.:-])xslt:/g, 'xsl:')}`);
}

suite('An XSLT prefix other than xsl', function () {
	this.timeout(60000);
	const sampleDir = path.join(__dirname, '..', '..', '..', 'sample');
	const samples = fs.readdirSync(sampleDir).filter((f) => f.endsWith('.xsl'))
		.map((f) => ({ name: f, text: fs.readFileSync(path.join(sampleDir, f), 'utf8') }))
		.filter((s) => /<xsl:(stylesheet|transform|package)[\s>]/.test(s.text) && /xmlns:xsl=/.test(s.text));

	test('the samples', () => {
		assert.isAbove(samples.length, 50);
	});

	samples.forEach((sample) => {
		test(`the same problems: ${sample.name}`, async () => {
			assert.deepEqual(await problems(toXslt(sample.text)), await problems(sample.text));
		});
	});

	test('completion and Go to Definition: a variable declared with xslt:variable', async () => {
		const content = '<xslt:stylesheet xmlns:xslt="http://www.w3.org/1999/XSL/Transform" version="3.0">\n<xslt:variable name="total" select="1"/>\n<xslt:template match="/"><xslt:value-of select="$total + $"/></xslt:template>\n</xslt:stylesheet>';
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		await vscode.window.showTextDocument(document);
		const line = content.split('\n')[2];
		const completions = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(2, line.lastIndexOf('$') + 1), '$');
		assert.include(completions.items.map((i) => typeof i.label === 'string' ? i.label : i.label.label), '$total');
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', document.uri, new vscode.Position(2, line.indexOf('$total') + 2));
		assert.deepEqual(definitions.map((d) => d.range.start.line), [1]);
		// not left open, unsaved: VS Code would ask to save it when the tests end
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('an imported module with the xslt prefix: its declarations are found', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-prefix-import-'));
		fs.writeFileSync(path.join(dir, 'lib.xsl'), '<xslt:stylesheet xmlns:xslt="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">\n' +
			'<xslt:function name="f:double"><xslt:param name="n"/><xslt:sequence select="$n * 2"/></xslt:function>\n<xslt:variable name="limit" select="10"/>\n</xslt:stylesheet>');
		fs.writeFileSync(path.join(dir, 'main.xsl'), '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">\n<xsl:import href="lib.xsl"/>\n' +
			'<xsl:template match="/"><r d="{f:double($limit)}" m="{f:missing(1)}"/></xsl:template>\n</xsl:stylesheet>');
		const uri = vscode.Uri.file(path.join(dir, 'main.xsl'));
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
		const problems = () => vscode.languages.getDiagnostics(uri).filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => d.message);
		for (let i = 0; i < 50 && !problems().some((m) => m.includes('f:missing')); i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.lengthOf(problems(), 1, problems().join('\n'));
		assert.include(problems()[0], 'f:missing');
	});

	test('instruction completions: with the module\'s prefix, in the label and the text inserted', async () => {
		const marked = '<xslt:stylesheet xmlns:xslt="http://www.w3.org/1999/XSL/Transform" version="4.0">\n<xslt:template name="t"><|</xslt:template>\n</xslt:stylesheet>';
		const offset = marked.indexOf('|');
		const document = await vscode.workspace.openTextDocument({ content: marked.replace('|', ''), language: 'xslt' });
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token,
			{ triggerKind: vscode.CompletionTriggerKind.TriggerCharacter, triggerCharacter: '<' });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		const inserted = new Map(items.map((item) => [typeof item.label === 'string' ? item.label : item.label.label,
			item.insertText instanceof vscode.SnippetString ? item.insertText.value : item.insertText ?? '']));
		assert.equal(inserted.get('xslt:switch'), 'xslt:switch select="${1:$expr}">\n\t<xslt:when test="\'$2\'">\n\t\t$3\n\t</xslt:when>\n</xslt:switch>');
		assert.isFalse([...inserted.keys()].some((label) => label.startsWith('xsl:')), 'no labels with the prefix xsl');
	});

	test('formatting: the content of xslt:text is kept as it is', async () => {
		const content = '<xslt:stylesheet xmlns:xslt="http://www.w3.org/1999/XSL/Transform" version="3.0">\n<xslt:template match="/">\n<xslt:text>  a\n   b  </xslt:text>\n</xslt:template>\n</xslt:stylesheet>';
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, { tabSize: 2, insertSpaces: true });
		const edit = new vscode.WorkspaceEdit();
		edit.set(document.uri, edits ?? []);
		await vscode.workspace.applyEdit(edit);
		assert.include(document.getText(), '<xslt:text>  a\n   b  </xslt:text>');
		assert.include(document.getText(), '\n  <xslt:template match="/">');
	});

	test('the import index: xslt:import and xslt:include', () => {
		const references = ImportIndex.moduleReferences('<xslt:stylesheet xmlns:xslt="http://www.w3.org/1999/XSL/Transform" version="3.0">\n<xslt:import href="a.xsl"/>\n<xslt:include href="b.xsl"/>\n</xslt:stylesheet>', path.join(os.tmpdir(), 'main.xsl'));
		assert.deepEqual(references.map((r) => path.basename(r.path)), ['a.xsl', 'b.xsl']);
	});

	test('the XSLT instructions are lexed as XSLT, with XPath in their attributes', () => {
		const lexer = new XslLexer(XSLTConfiguration.configuration);
		const tokens = lexer.analyse('<xslt:stylesheet xmlns:xslt="http://www.w3.org/1999/XSL/Transform" version="3.0">\n<xslt:template match="/"><xslt:value-of select="1 + 2"/></xslt:template>\n</xslt:stylesheet>');
		assert.strictEqual(lexer.nativePrefix, 'xslt');
		assert.isTrue(tokens.some((t) => t.value === '+'), 'the XPath is lexed');
	});

	test('reported: the outermost element\'s prefix not bound to the XSLT namespace', async () => {
		const reported = await problems('<xslt:stylesheet xmlns:xslt="urn:not-xslt" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n</xslt:stylesheet>');
		assert.deepEqual(reported, ['0: Expected on the root element: xmlns:xslt=\'http://www.w3.org/1999/XSL/Transform\' prefix/namespace-uri binding']);
	});

	test('an xsl:element within a module with the xslt prefix is a literal result element', async () => {
		const reported = await problems('<xslt:stylesheet xmlns:xslt="http://www.w3.org/1999/XSL/Transform" version="3.0">\n<xslt:template match="/"><xsl:foo/></xslt:template>\n</xslt:stylesheet>');
		assert.lengthOf(reported, 1);
		assert.include(reported[0], 'xsl:foo');
	});
});
