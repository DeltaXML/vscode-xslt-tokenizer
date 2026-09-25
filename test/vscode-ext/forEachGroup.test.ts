/**
 * Test suite for the XSLT 4.0 split-when attribute of xsl:for-each-group: the $group and $next variables are in scope
 * only within split-when (and 'break-when', its Saxon 12 name, still accepted by Saxon 13)
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(attributes: string, body = '<xsl:sequence select="current-group()"/>') {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="4.0">
	<xsl:template name="t"><xsl:for-each-group select="1, 2, 3" ${attributes}>${body}</xsl:for-each-group></xsl:template>
</xsl:stylesheet>`;
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const config = { ...XSLTConfiguration.configuration, isVersion4: true };
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(config, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => [d.message, document.getText(d.range)]);
}

const unresolved = (name: string) => [`XPath: The variable/parameter $${name} cannot be resolved`, `$${name}`];

const cases: [string, string, string | undefined, string[][]][] = [
	['$group and $next in split-when', 'split-when="$group[last()] + 1 ne $next"', undefined, []],
	['$group in break-when', 'break-when="count($group) eq 2"', undefined, []],
	['other variables in split-when', 'split-when="$other"', undefined, [unresolved('other')]],
	['$next in group-by', 'group-by="$next"', undefined, [unresolved('next')]],
	['$group within the for-each-group body', 'split-when="$next gt 1"', '<xsl:sequence select="$group"/>', [unresolved('group')]],
];

suite('xsl:for-each-group split-when', () => {
	cases.forEach(([label, attributes, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await problems(attributes, body), expected);
		});
	});
});
