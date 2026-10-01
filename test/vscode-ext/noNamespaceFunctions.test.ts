/**
 * Test suite for user-defined functions in no namespace - an xsl:function name without a prefix, e.g. name="double" -
 * an XSLT 4.0 extension in Saxon 13 (PE or EE, with --allowSyntaxExtensions:on):
 * - in XSLT 4.0, the declaration and its calls without a prefix, e.g. double(2), are not reported, and go to definition
 *   and hover work for the calls
 * - a function with the name and an arity of a built-in function is reported as a warning: calls without a prefix, with
 *   that number of arguments, call it instead of the built-in function - with another arity, it isn't reported
 * - in XSLT 3.0, or with Saxon-HE as the configured Saxon jar, the name without a prefix is reported (XTSE0740)
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const stylesheet = (functions: string, select: string, version = '4.0') => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}">
  ${functions}
  <xsl:template name="xsl:initial-template"><xsl:sequence select="${select}"/></xsl:template>
</xsl:stylesheet>`;

const double = '<xsl:function name="double"><xsl:param name="x"/><xsl:sequence select="$x * 2"/></xsl:function>';

async function lint(xslt: string) {
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const isVersion4 = xslt.includes('version="4.0"');
	// the range of a diagnostic for an attribute value includes its quotes
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
}

async function open(marked: string) {
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	return { document, position: document.positionAt(marked.indexOf('¦')) };
}

suite('User-defined functions in no namespace', () => {
	test('XSLT 4.0: the declaration and its calls are not reported', async () => {
		assert.deepEqual(await lint(stylesheet(double, 'double(2), double(double(3))')), []);
	});

	test('XSLT 4.0: a call with another number of arguments, or of an undeclared function, is reported', async () => {
		assert.deepEqual(await lint(stylesheet(double, 'double(2, 3), triple(2)')), [
			["XPath: Function: 'double' with 2 arguments not found", 'double'],
			["XPath: Function: 'triple' with 1 arguments not found", 'triple']
		]);
	});

	test('XSLT 4.0: a function that replaces a built-in function', async () => {
		const count = '<xsl:function name="count"><xsl:param name="x"/><xsl:sequence select="0"/></xsl:function>';
		assert.deepEqual(await lint(stylesheet(count, 'count((1, 2))')), [
			["XSLT: The function 'count' replaces the built-in function fn:count#1 - a call of 'count' without a prefix, with 1 argument, calls this function instead", '"count"']
		]);
		// with another arity, the built-in function is still called
		const count2 = '<xsl:function name="count"><xsl:param name="x"/><xsl:param name="y"/><xsl:sequence select="0"/></xsl:function>';
		assert.deepEqual(await lint(stylesheet(count2, 'count((1, 2)), count(1, 2)')), []);
	});

	test('XSLT 3.0: the name without a prefix is reported', async () => {
		assert.deepEqual(await lint(stylesheet(double, 'double(2)', '3.0')), [
			["XSLT: missing namespace prefix in xsl:function name 'double' - a function name without a prefix requires XSLT 4.0 (XTSE0740)", '"double"']
		]);
	});

	test('Saxon-HE: the name without a prefix is reported', async () => {
		const config = vscode.workspace.getConfiguration('XSLT.tasks');
		const previous = config.inspect<string>('saxonJar')?.globalValue;
		await config.update('saxonJar', '/opt/SaxonHE13-0J/saxon-he-13.0.jar', vscode.ConfigurationTarget.Global);
		try {
			assert.deepEqual(await lint(stylesheet(double, 'double(2)')), [
				["XSLT: missing namespace prefix in xsl:function name 'double' - a function name without a prefix is an XSLT 4.0 extension, not available in Saxon-HE (XTSE0740)", '"double"']
			]);
		} finally {
			await config.update('saxonJar', previous, vscode.ConfigurationTarget.Global);
		}
	});

	test('go to definition and hover, for a call', async () => {
		const { document, position } = await open(stylesheet(double, 'dou¦ble(2)'));
		const location = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideDefinition(document, position, new vscode.CancellationTokenSource().token);
		assert.equal(location && document.getText(location.range), 'double');
		assert.include(document.lineAt(location!.range.start.line).text, '<xsl:function name="double">');
		const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
		assert.include((hover?.contents as vscode.MarkdownString[]).map((c) => c.value).join('\n'), 'double($x)');
	});
});
