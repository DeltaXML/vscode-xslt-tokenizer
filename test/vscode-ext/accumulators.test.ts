/**
 * Test suite for XSLT 3.0 accumulators and the use-accumulators attribute (on xsl:mode, xsl:source-document etc.)
 *
 * - each name in use-accumulators must be a declared accumulator
 * - a declared accumulator that isn't listed in any use-accumulators attribute gets a warning, as it's only applicable
 *   to documents loaded with doc() etc. (not the principal source document, where XTDE3362 is raised at run time)
 * - find references and go to definition include the names in use-accumulators attributes
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XsltTokenDefinitions } from '../../src/xsltTokenDefintions';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';

const accumulator = `<xsl:accumulator name="count" as="xs:integer" initial-value="0">
		<xsl:accumulator-rule match="a" select="$value + 1"/>
	</xsl:accumulator>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="3.0">
	${accumulator}
	${body}
</xsl:stylesheet>`;
}

const notApplicable = (name: string) => `XSLT: The accumulator '${name}' is not listed in any use-accumulators attribute, e.g. on xsl:mode, so it only applies to documents loaded with functions such as doc()`;
const notFound = (name: string) => `XSLT: xsl:accumulator with name '${name}' not found`;

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
	['listed on xsl:mode', `<xsl:mode use-accumulators="count"/>`, []],
	['#all on xsl:mode', `<xsl:mode use-accumulators="#all"/>`, []],
	['listed on xsl:source-document', `<xsl:template match="/"><xsl:source-document href="in.xml" use-accumulators="count"><xsl:sequence select="1"/></xsl:source-document></xsl:template>`, []],
	['listed on xsl:global-context-item', `<xsl:global-context-item use-accumulators="count"/>`, []],
	['not listed', `<xsl:mode name="m"/>`, [[notApplicable('count'), '"count"']]],
	['undeclared name', `<xsl:mode use-accumulators="count counter"/>`, [[notFound('counter'), 'counter']]],
	['undeclared names only', `<xsl:mode use-accumulators="  total "/>`, [[notFound('total'), 'total'], [notApplicable('count'), '"count"']]],
];

suite('Accumulators: use-accumulators', () => {
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(stylesheet(body)), expected);
		});
	});

	test('listed in an imported module', async () => {
		const importedUse: GlobalInstructionData = { type: GlobalInstructionType.AccumulatorUse, name: 'count', token: { line: 0, startCharacter: 0, length: 5, value: 'count', tokenType: 0 }, idNumber: 0 };
		assert.deepEqual(await problems(stylesheet(''), [importedUse]), []);
	});

	test('the lexer records names used in use-accumulators', async () => {
		const { globals } = await analyse(stylesheet(`<xsl:mode use-accumulators="count other"/>`));
		assert.deepEqual(globals.filter((g) => g.type === GlobalInstructionType.AccumulatorUse).map((g) => g.name), ['count', 'other']);
	});

	test('find references include use-accumulators names', async () => {
		const xslt = stylesheet(`<xsl:mode use-accumulators="other count"/>
	<xsl:template match="/"><xsl:sequence select="accumulator-after('count')"/></xsl:template>`);
		const { allTokens, document, globals } = await analyse(xslt);
		const declaration = globals.find((g) => g.type === GlobalInstructionType.Accumulator && g.name === 'count')!;
		const references = XSLTReferenceProvider.calculateReferences(declaration, XSLTConfiguration.configuration, XSLTConfiguration.configuration.docType, document, allTokens, globals, []);
		const texts = references.map((t) => document.getText(XsltTokenDefinitions.createLocationFromToken(t, document).range));
		assert.deepEqual(texts, ['count', 'count']);
	});

	test('go to definition from a use-accumulators name', async () => {
		const xslt = stylesheet(`<xsl:mode use-accumulators="other count"/>`);
		const { allTokens, document, globals } = await analyse(xslt);
		const modeLine = document.getText().split('\n').findIndex((l) => l.includes('xsl:mode'));
		const position = new vscode.Position(modeLine, document.lineAt(modeLine).text.indexOf('count') + 2);
		const definition = XsltTokenDefinitions.findDefinition(true, document, allTokens, globals, [], position).definitionLocation;
		assert.equal(definition?.instruction?.type, GlobalInstructionType.Accumulator);
		assert.equal(document.getText(definition!.range), 'count');
	});
});

suite('Accumulators: use-accumulators completions', () => {
	async function completionLabels(body: string) {
		const marked = stylesheet(`<xsl:accumulator name="total" initial-value="0">
		<xsl:accumulator-rule match="a" select="$value + 1"/>
	</xsl:accumulator>
	${body}`);
		const offset = marked.indexOf('|');
		const text = marked.substring(0, offset) + marked.substring(offset + 1);
		const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
		const provider = new XsltDefinitionProvider(XSLTConfiguration.configuration);
		const result = await provider.provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		return items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
	}

	test('accumulator names and #all on xsl:mode', async () => {
		assert.deepEqual(await completionLabels(`<xsl:mode use-accumulators="|"/>`), ['count', 'total', '#all']);
	});

	test('accumulator names on xsl:source-document', async () => {
		assert.includeMembers(await completionLabels(`<xsl:template name="t"><xsl:source-document href="a.xml" use-accumulators="count |"/></xsl:template>`), ['count', 'total']);
	});
});
