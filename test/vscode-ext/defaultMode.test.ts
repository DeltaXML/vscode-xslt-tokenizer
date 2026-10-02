/**
 * Test suite for [xsl:]default-mode: templates without a mode attribute, within its scope, are in the default mode -
 * so an xsl:apply-templates for that mode is not reported as using an unknown mode
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, GlobalInstructionData, GlobalInstructionType, XslLexer } from '../../src/xslLexer';
import { XslLexerLight } from '../../src/xslLexerLight';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XsltTokenDefinitions } from '../../src/xsltTokenDefintions';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';

function stylesheet(rootAttributes: string, body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0" ${rootAttributes}>
	${body}
</xsl:stylesheet>`;
}

async function problems(xslt: string, imported: GlobalInstructionData[] = []) {
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, imported, []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const notUsed = (mode: string) => [`XSLT: Template mode '${mode}' not used`, `"${mode}"`];
const applyTemplates = (mode: string) => `<xsl:template name="t"><xsl:apply-templates select="." mode="${mode}"/></xsl:template>`;

const cases: [string, string, string[][]][] = [
	['default-mode on xsl:stylesheet', stylesheet('default-mode="m"', `<xsl:template match="b"/>${applyTemplates('m')}`), []],
	['default-mode on xsl:template', stylesheet('', `<xsl:template match="b" default-mode="m"/>${applyTemplates('m')}`), []],
	['xsl:default-mode on a literal result element', stylesheet('', `<xsl:template name="u"><out xsl:default-mode="m"/></xsl:template>${applyTemplates('m')}`), []],
	['the #unnamed mode', stylesheet('', `<xsl:template match="b"/>${applyTemplates('#unnamed')}`), []],
	['default-mode="#unnamed"', stylesheet('default-mode="#unnamed"', `<xsl:template match="b"/>${applyTemplates('m')}`), [notUsed('m')]],
	['a mode that is not used', stylesheet('default-mode="m"', `<xsl:template match="b"/>${applyTemplates('n')}`), [notUsed('n')]],
];

suite('default-mode', () => {
	cases.forEach(([label, xslt, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(xslt), expected);
		});
	});

	test('default-mode in an imported stylesheet', async () => {
		const imported = new XslLexerLight(XSLTConfiguration.configuration).analyseLight(stylesheet('default-mode="m"', `<xsl:template match="b"/>`));
		assert.deepEqual(await problems(stylesheet('', applyTemplates('m')), imported), []);
	});
});

suite('default-mode: go to definition and find references', () => {
	const lines = [
		`<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0" default-mode="m">`,
		`  <xsl:template match="b"/>`,
		`  <xsl:template match="c" mode="m"/>`,
		`  <xsl:template name="t"><xsl:apply-templates select="." mode="m"/><out xsl:default-mode="m"/></xsl:template>`,
		`</xsl:stylesheet>`,
	];
	// [line, character] of each 'm'
	const defaultMode: [number, number] = [0, lines[0].indexOf('"m"') + 1];
	const templateMode: [number, number] = [2, lines[2].indexOf('"m"') + 1];
	const applyTemplatesMode: [number, number] = [3, lines[3].indexOf('"m"') + 1];
	const lreDefaultMode: [number, number] = [3, lines[3].lastIndexOf('"m"') + 1];

	async function analyse(xslt: string) {
		const xslLexer = new XslLexer(XSLTConfiguration.configuration);
		xslLexer.provideCharLevelState = true;
		const allTokens = xslLexer.analyse(xslt);
		const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
		return { allTokens, document, globals: xslLexer.globalInstructionData };
	}

	// as XsltDefinitionProvider.seekDefinition: a position on a declaration, otherwise its definition
	async function declarationAt(xslt: string, [line, character]: [number, number]) {
		const { allTokens, document, globals } = await analyse(xslt);
		const position = new vscode.Position(line, character);
		const atPosition = globals.find((g) => g.type !== GlobalInstructionType.Mode && g.token.line === line && character >= g.token.startCharacter && character <= g.token.startCharacter + g.token.length);
		const declaration = atPosition ?? XsltTokenDefinitions.findDefinition(true, document, allTokens, globals, [], position).definitionLocation?.instruction;
		return { declaration, allTokens, document, globals };
	}

	async function referencesFrom(position: [number, number]) {
		const { declaration, allTokens, document, globals } = await declarationAt(lines.join('\n'), position);
		assert.isDefined(declaration);
		const references = XSLTReferenceProvider.calculateReferences(declaration!, XSLTConfiguration.configuration, XSLTConfiguration.configuration.docType, document, allTokens, globals, []);
		return references.concat([declaration!.token]).map((t) => [t.line, t.startCharacter]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	}

	// the reference for an xsl:apply-templates mode is its quoted attribute value
	const allUses = [defaultMode, templateMode, [applyTemplatesMode[0], applyTemplatesMode[1] - 1], lreDefaultMode];
	([['default-mode', defaultMode], ['template mode', templateMode], ['apply-templates mode', applyTemplatesMode], ['xsl:default-mode', lreDefaultMode]] as [string, [number, number]][]).forEach(([label, position]) => {
		test(`find references from ${label}`, async () => {
			assert.deepEqual(await referencesFrom(position), allUses);
		});
	});

	test('go to definition from apply-templates: a template mode before a default-mode', async () => {
		const { declaration } = await declarationAt(lines.join('\n'), applyTemplatesMode);
		assert.deepEqual([declaration?.token.line, declaration?.token.startCharacter], templateMode);
	});

	test('go to definition from apply-templates: an xsl:mode declaration first', async () => {
		const withMode = [lines[0], `  <xsl:mode name="m"/>`, ...lines.slice(1)];
		const { declaration } = await declarationAt(withMode.join('\n'), [applyTemplatesMode[0] + 1, applyTemplatesMode[1]]);
		assert.equal(declaration?.type, GlobalInstructionType.ModeInstruction);
	});

	test('go to definition from apply-templates: a default-mode when no template has the mode', async () => {
		const noTemplateMode = lines.filter((_line, index) => index !== 2);
		const { declaration } = await declarationAt(noTemplateMode.join('\n'), [applyTemplatesMode[0] - 1, applyTemplatesMode[1]]);
		assert.deepEqual([declaration?.token.line, declaration?.token.startCharacter], defaultMode);
	});
});
