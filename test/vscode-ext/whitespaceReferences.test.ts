/**
 * Test suite for character references to whitespace in an XPath expression in an attribute, e.g. select="a,&#xA;b" (as
 * in DocBook's stylesheets): the XML parser replaces a reference to a space, tab, newline or carriage return with the
 * character, so it's whitespace in the expression - not a token, and not a problem - and the tokens after it keep their
 * positions in the line
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XPathLexer } from '../../src/xpLexer';

async function analyse(select: string) {
	const line = `  <xsl:template match="/"><xsl:sequence select="${select}"/></xsl:template>`;
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">\n${line}\n</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(xslt);
	const problems = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], []).map((d) => d.message);
	// each XPath token, with whether it's at the position of its text in the line
	const xpath = tokens.filter((t) => t.line === 1 && t.tokenType < XsltTokenDiagnostics.xsltStartTokenNumber && t.value !== '/')
		.map((t) => line.substring(t.startCharacter, t.startCharacter + t.length) === t.value ? t.value : `${t.value} (misplaced)`);
	return { problems, xpath };
}

suite('XPath: character references to whitespace', () => {
	const cases: [string, string, string[]][] = [
		['a newline after a comma', 'a,&#xA;b', ['a', ',', 'b']],
		['lower-case hex, and a space', 'a,&#xa;&#x20;b', ['a', ',', 'b']],
		['decimal', 'a,&#10;b', ['a', ',', 'b']],
		['a tab', '(1,&#9;2)', ['(', '1', ',', '2', ')']],
		['a carriage return and newline', 'a,&#xD;&#xA;b', ['a', ',', 'b']],
		['around an operator', '1&#x20;+&#32;2', ['1', '+', '2']],
		['before a string literal', 'concat(\'x\',&#xA;\'y\')', ['concat', '(', '\'x\'', ',', '\'y\'', ')']],
		['leading zeros', 'a,&#x000A;b', ['a', ',', 'b']],
	];
	cases.forEach(([label, select, expected]) => {
		test(label, async () => {
			assert.deepEqual(await analyse(select), { problems: [], xpath: expected });
		});
	});

	test('the references to whitespace', () => {
		['&#xA;', '&#xa;', '&#10;', '&#x9;', '&#9;', '&#xD;', '&#13;', '&#x20;', '&#32;', '&#x000A;'].forEach((reference) => assert.isTrue(XPathLexer.isWhitespaceReference(reference), reference));
		['&#x41;', '&#65;', '&lt;', '&#xA0;', '&#xA'].forEach((reference) => assert.isFalse(XPathLexer.isWhitespaceReference(reference), reference));
	});
});
