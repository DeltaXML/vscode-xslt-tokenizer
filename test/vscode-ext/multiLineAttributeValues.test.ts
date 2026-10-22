/**
 * Test suite for attribute values on more than one line, e.g. an xsl:strip-space elements list with a name on each line:
 * the lexer gives a token for each line, and only the first starts with the value's quote and only the last ends with
 * it - each line's names are checked, and a problem is reported on its line, not for a quote or a name's lost characters
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function lint(body: string, rootAttributes = '') {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:b="b" version="3.0"${rootAttributes}>\n${body}\n</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(xslt);
	return XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], [])
		.map((d) => `${d.range.start.line}: ${d.message}`);
}

const names = (found: string) => `XSLT: Expected list of valid names (with declared prefixes) in 'elements' but found ${found}`;

suite('Attribute values on more than one line', () => {
	const cases: [string, string, string[]][] = [
		['names on one line', '  <xsl:strip-space elements="a b:c d"/>', []],
		['a name on each line', '  <xsl:strip-space elements="a\n    b:c\n    d"/>', []],
		['the quotes on lines of their own', '  <xsl:strip-space elements="\n    a b:c\n    d\n  "/>', []],
		['tabs and newlines', '  <xsl:preserve-space elements="\n\ta\tb:c\n\t"/>', []],
		['an invalid name on a later line, reported there', '  <xsl:strip-space elements="a\n    1b\n    c"/>', [`2: ${names('\'1b\'')}`]],
		['an undeclared prefix on the last line', '  <xsl:strip-space elements="\n    a\n    x:c"/>', [`3: ${names('\'x:c\'')}`]],
		['an invalid name on one line', '  <xsl:strip-space elements="a 1b"/>', [`1: ${names('\'1b\'')}`]],
	];
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await lint(body), expected);
		});
	});

	test('exclude-result-prefixes: each line\'s prefixes, an undeclared one reported on its line', async () => {
		assert.deepEqual(await lint('  <xsl:template match="/"/>', ' exclude-result-prefixes="\n    b\n    #default"'), []);
		assert.deepEqual(await lint('  <xsl:template match="/"/>', ' exclude-result-prefixes="b\n    x"'), [`1: XSLT: Namespace prefix 'x' is not declared`]);
	});
});
