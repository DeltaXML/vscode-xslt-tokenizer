/**
 * Test suite for xsl:character-map names, and the use-character-maps attribute (on xsl:output, xsl:result-document and
 * xsl:character-map itself)
 *
 * - each name in use-character-maps must be a declared character map (XTSE1590), and a module can't declare two with
 *   the same name (XTSE1580)
 * - find references, go to definition, completion and rename include the names in use-character-maps attributes
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XsltTokenDefinitions } from '../../src/xsltTokenDefintions';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

const characterMaps = `<xsl:character-map name="quotes">
		<xsl:output-character character="«" string="&amp;laquo;"/>
	</xsl:character-map>
	<xsl:character-map name="dashes" use-character-maps="quotes">
		<xsl:output-character character="—" string="&amp;mdash;"/>
	</xsl:character-map>`;

function stylesheet(body: string, maps = characterMaps) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
	${maps}
	${body}
</xsl:stylesheet>`;
}

const notFound = (name: string) => `XSLT: xsl:character-map with name '${name}' not found`;

async function analyse(xslt: string) {
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	return { allTokens, document, globals: xslLexer.globalInstructionData };
}

async function problems(xslt: string, imported: GlobalInstructionData[] = []) {
	const { allTokens, document, globals } = await analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, globals, imported, []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const cases: [string, string, [string, string][]][] = [
	['on xsl:output', `<xsl:output use-character-maps="dashes quotes"/>`, []],
	['on xsl:result-document', `<xsl:template name="t"><xsl:result-document href="a.xml" use-character-maps="dashes"/></xsl:template>`, []],
	['an undeclared name', `<xsl:output use-character-maps="dashes quote"/>`, [[notFound('quote'), 'quote']]],
	['a list over two lines', `<xsl:output use-character-maps="dashes\n\t\tquote"/>`, [[notFound('quote'), 'quote']]],
];

suite('Character maps: use-character-maps', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(stylesheet(body)), expected);
		});
	});

	test('an undeclared name on xsl:character-map', async () => {
		assert.deepEqual(await problems(stylesheet('', `<xsl:character-map name="dashes" use-character-maps="quotes"/>`)), [[notFound('quotes'), 'quotes']]);
	});

	test('a name declared twice in a module', async () => {
		assert.deepEqual(await problems(stylesheet(`<xsl:character-map name="quotes"/>`)), [[`XSLT: Duplicate xsl:character-map name 'quotes'`, '"quotes"']]);
	});

	test('declared in an imported module', async () => {
		const imported: GlobalInstructionData = { type: GlobalInstructionType.CharacterMap, name: 'shared', token: { line: 0, startCharacter: 0, length: 6, value: 'shared', tokenType: 0 }, idNumber: 0 };
		assert.deepEqual(await problems(stylesheet(`<xsl:output use-character-maps="shared"/>`), [imported]), []);
	});

	test('find references include use-character-maps names', async () => {
		const xslt = stylesheet(`<xsl:output use-character-maps="dashes quotes"/>
	<xsl:template name="t"><xsl:result-document href="a.xml" use-character-maps="quotes"/></xsl:template>`);
		const { allTokens, document, globals } = await analyse(xslt);
		const declaration = globals.find((g) => g.type === GlobalInstructionType.CharacterMap && g.name === 'quotes')!;
		const references = XSLTReferenceProvider.calculateReferences(declaration, XSLTConfiguration.configuration, XSLTConfiguration.configuration.docType, document, allTokens, globals, []);
		const lines = references.map((t) => [XsltTokenDefinitions.createLocationFromToken(t, document).range.start.line, document.getText(XsltTokenDefinitions.createLocationFromToken(t, document).range)]);
		// on xsl:character-map name="dashes", xsl:output and xsl:result-document
		assert.deepEqual(lines, [[4, 'quotes'], [7, 'quotes'], [8, 'quotes']]);
	});

	test('go to definition from a use-character-maps name', async () => {
		const xslt = stylesheet(`<xsl:output use-character-maps="dashes quotes"/>`);
		const { allTokens, document, globals } = await analyse(xslt);
		const outputLine = document.getText().split('\n').findIndex((l) => l.includes('xsl:output '));
		const position = new vscode.Position(outputLine, document.lineAt(outputLine).text.indexOf('quotes') + 2);
		const definition = XsltTokenDefinitions.findDefinition(true, document, allTokens, globals, [], position).definitionLocation;
		assert.equal(definition?.instruction?.type, GlobalInstructionType.CharacterMap);
		assert.equal(document.getText(definition!.range), 'quotes');
		assert.equal(definition!.range.start.line, 1);
	});

	test('completion of character map names', async () => {
		const marked = stylesheet(`<xsl:output use-character-maps="dashes |"/>`);
		const offset = marked.indexOf('|');
		const document = await vscode.workspace.openTextDocument({ content: marked.substring(0, offset) + marked.substring(offset + 1), language: 'xslt' });
		const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
		const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		assert.deepEqual(items.map((item) => typeof item.label === 'string' ? item.label : item.label.label), ['quotes', 'dashes']);
	});

	test('rename: the declaration and each use-character-maps name', async () => {
		const xslt = stylesheet(`<xsl:output use-character-maps="dashes quotes"/>`);
		const extension = vscode.extensions.getExtension('deltaxml.xslt-xpath');
		await extension?.activate();
		const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
		const outputLine = document.getText().split('\n').findIndex((l) => l.includes('xsl:output '));
		const position = new vscode.Position(outputLine, document.lineAt(outputLine).text.indexOf('quotes') + 1);
		const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>('vscode.executeDocumentRenameProvider', document.uri, position, 'guillemets');
		const edits = edit.get(document.uri).map((e) => [e.range.start.line, document.getText(e.range), e.newText]).sort((a, b) => (a[0] as number) - (b[0] as number));
		assert.deepEqual(edits, [[1, 'quotes', 'guillemets'], [4, 'quotes', 'guillemets'], [outputLine, 'quotes', 'guillemets']]);
	});
});
