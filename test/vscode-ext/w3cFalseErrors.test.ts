/**
 * Test suite for problems that were reported for stylesheets of the W3C XSLT test suites that are expected to compile
 * (see test/w3c-suite/w3cLint.test.ts) - each with the test case it was found for
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

async function problems(xslt: string) {
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const tokens = lexer.analyse(xslt);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const config = { ...XSLTConfiguration.configuration, isVersion4: lexer.isXSLT40 };
	return XsltTokenDiagnostics.calculateDiagnostics(config, DocumentTypes.XSLT, document, tokens, lexer.globalInstructionData, [], [])
		.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint).map((d) => d.message);
}

const stylesheet = (body: string, root = 'xsl:stylesheet', attributes = '') =>
	`<${root} xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"${attributes}>\n${body}\n</${root}>`;

suite('False errors found with the W3C XSLT test suites', () => {
	test('an enumerated attribute value with whitespace around it, e.g. " no " (doe-0176c, declared-modes-010)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template match="/"><xsl:value-of select="1" disable-output-escaping=" no "/></xsl:template>', 'xsl:stylesheet', ' expand-text=" yes "')), []);
		// still reported: a value that isn't one of them
		const reported = await problems(stylesheet('<xsl:template match="/"><xsl:value-of select="1" disable-output-escaping=" maybe "/></xsl:template>'));
		assert.lengthOf(reported, 1);
		assert.include(reported[0], 'disable-output-escaping');
	});

	test('an enumerated attribute followed by a namespace declaration: the namespace isn\'t its value (accumulator-001)', async () => {
		assert.deepEqual(await problems(`<xsl:package name="urn:a" package-version="1.0" declared-modes="no" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">\n<xsl:template name="main"/>\n</xsl:package>`), []);
	});

	test('an enumerated attribute value on more than one line, or with character references (whitespace-028)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:output method="\n    &#x20;xml&#x20;\n    " indent="\n    &#x0a;no&#x09;"/>')), []);
		// still reported, once
		const reported = await problems(stylesheet('<xsl:output method="\n    &#x20;xmlx\n    "/>'));
		assert.lengthOf(reported, 1);
		assert.include(reported[0], "'xmlx'");
	});

	test('the name of a package is a URI, e.g. urn:simple (package-version-001)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template name="main"/>', 'xsl:package', ' name="urn:simple" package-version="1.0"')), []);
		assert.deepEqual(await problems(stylesheet('<xsl:use-package name="http://example.com/pkg/a" package-version="*"/>\n<xsl:template name="main"/>', 'xsl:package', ' name="urn:b"')), []);
	});
});
