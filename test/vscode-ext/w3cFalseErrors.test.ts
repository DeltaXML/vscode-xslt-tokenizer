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

	test('multiplying an attribute, e.g. @price * @qty - not @ followed by a wildcard (expression-0601, sort)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template match="order"><r v="{@price * @qty}" w="{sum(for $i in item return $i/@price * $i/@qty)}"><xsl:value-of select="@height*@width"/><xsl:copy-of select="@*"/></r></xsl:template>')), []);
	});

	test('a string literal operand of an arithmetic operator: allowed in XSLT 1.0 backwards compatible mode (select-3401)', async () => {
		const body = '<xsl:template match="doc"><xsl:value-of select="\' 6 \'*div"/><xsl:value-of select="\'2\' div 1"/></xsl:template>';
		assert.deepEqual(await problems(stylesheet(body).replace('version="3.0"', 'version="1.0"')), []);
		// a type error otherwise
		assert.lengthOf(await problems(stylesheet(body)), 2);
	});

	test('a name or wildcard within a kind test doesn\'t need a context item, e.g. in a function (higher-order-functions-075)', async () => {
		const fn = (select: string) => stylesheet(`<xsl:function name="f:f" xmlns:f="urn:f" xmlns:io="urn:io"><xsl:param name="node"/><xsl:sequence select="${select}"/></xsl:function>`, 'xsl:stylesheet', ' xmlns:xs="http://www.w3.org/2001/XMLSchema"');
		for (const select of ['$node instance of element(*)', '$node instance of element(io:x)', '$node instance of attribute(*, xs:string)', '$node instance of document-node(element(a))',
			'function($r as element(io:realworld)) as item()+ { 1 }']) {
			assert.deepEqual(await problems(fn(select)), [], select);
		}
		// a step still needs one
		assert.deepEqual(await problems(fn('count(*)')), ['XPath: Context-item is missing for: \'*\'']);
	});

	test('an occurrence indicator after whitespace, e.g. as="xs:integer *" (sequence types)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:variable name="q" as="xs:integer *" select="1, 2"/><xsl:variable name="r" as="xs:string ?" select="()"/><xsl:template name="t"><xsl:sequence select="$q, $r"/></xsl:template>', 'xsl:stylesheet', ' xmlns:xs="http://www.w3.org/2001/XMLSchema"')), []);
	});

	test('xsl:element and xsl:attribute with a namespace attribute: the name\'s prefix needn\'t be declared (namespace-3118, attribute-0601)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template match="/"><xsl:element name="q:foo" namespace="http://a.com/"/><xsl:element namespace="http://b.com/" name="baz:foo"/><out><xsl:attribute name="c:x" namespace="http://c.com/">1</xsl:attribute></out></xsl:template>')), []);
		// still reported: without the namespace attribute
		assert.deepEqual(await problems(stylesheet('<xsl:template match="/"><xsl:element name="q:foo"/></xsl:template>')), ['XSLT: Undeclared prefix in name: \'q:foo\'']);
	});

	test('a prefix declared on the same element, after the attribute using it (call-template-0703, backwards-014, boolean-024)', async () => {
		const body = '<xsl:variable name="S:v" select="1" xmlns:S="urn:s"/><xsl:template name="t"><xsl:param name="S:p" xmlns:S="urn:s"/></xsl:template>' +
			'<xsl:template match="/"><xsl:call-template name="t"><xsl:with-param name="S:p" select="$S:v" xmlns:S="urn:s"/></xsl:call-template>' +
			'<xsl:value-of select="xs:boolean(\'0\')" xmlns:xs="http://www.w3.org/2001/XMLSchema"/><b c="{f:g()}" xmlns:f="http://f.com/"/></xsl:template>';
		assert.deepEqual((await problems(stylesheet(body))).filter((p) => /prefix/.test(p)), []);
	});

	test('the xml prefix is always declared (attribute-0901, wildcard-type-003)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template match="/"><xsl:value-of select="@xml:att1"/></xsl:template>')), []);
		// XPath 4.0: a wildcard in attribute()
		assert.deepEqual(await problems(stylesheet('<xsl:template match="attribute(xml:*)"/>').replace('version="3.0"', 'version="4.0"')), []);
	});

	test('XSLT 4.0 type patterns, e.g. ~xs:integer (match-410, next-match-405)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template match="~xs:integer"/><xsl:template match="~xs:short[. lt 20]"/>', 'xsl:stylesheet', ' xmlns:xs="http://www.w3.org/2001/XMLSchema"').replace('version="3.0"', 'version="4.0"')), []);
	});

	test('EQNames: after @ or # and in xsl:use-attribute-sets on a literal result element (attribute-set-0102, catalog-010, expression-4302)', async () => {
		const body = '<xsl:attribute-set name="Q{http://example.com/ns}set1"/><xsl:template match="/"><out xsl:use-attribute-sets="Q{http://example.com/ns}set1">' +
			'<xsl:sequence select="//@Q{http://www.w3.org/2001/XMLSchema-instance}type, @Q{}*, @Q{urn:a}*, #Q{http://example.ns}blah"/></out></xsl:template>';
		assert.deepEqual(await problems(stylesheet(body).replace('version="3.0"', 'version="4.0"')), []);
	});

	test('< and > written as numeric character references, e.g. 1&#60;2 (boolean-051, math-2509)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template match="/"><xsl:value-of select="1&#60;2, 1 &#x3C; 2, 2&#62;1"/></xsl:template>')), []);
	});

	test('a known namespace declared on an inner element, e.g. xs:float (math-0105)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template match="/" xmlns:xs="http://www.w3.org/2001/XMLSchema"><xsl:value-of select="xs:float(\'INF\') + 3"/></xsl:template>')), []);
	});

	test('a function guarded by use-when="function-available(...)" on the element or an ancestor (use-when-0112, version-026)', async () => {
		const body = '<xsl:template match="p" xmlns:saxon="http://saxon.sf.net/"><a><xsl:value-of select="saxon:line-number()" use-when="function-available(\'saxon:line-number\')"/></a>' +
			'<b use-when="function-available(\'burnish\', 2)"><xsl:value-of select="burnish(1, 2)"/></b><c><xsl:value-of select="nosuch(1)"/></c></xsl:template>';
		// still reported: a function that isn't guarded
		assert.deepEqual(await problems(stylesheet(body)), ['XPath: Function: \'nosuch\' with 1 arguments not found']);
	});

	test('forwards compatible mode, for a higher version: an unknown top-level element, an unknown instruction with xsl:fallback, an unknown attribute (version-004, forwards-201)', async () => {
		const body = '<xsl:new-declaration/><xsl:template match="/"><xsl:non-existent-element processing="magic"><xsl:fallback>F</xsl:fallback><xsl:ignored/></xsl:non-existent-element>' +
			'<xsl:value-of select="1" new-attribute="x"/></xsl:template>';
		assert.deepEqual(await problems(stylesheet(body).replace('version="3.0"', 'version="8.5"')), []);
		// an element with a higher version, within a 3.0 stylesheet
		assert.deepEqual(await problems(stylesheet('<xsl:template match="/"><xsl:future version="9.0"><xsl:fallback/></xsl:future></xsl:template>')), []);
		// without xsl:fallback, an unknown instruction is still an error (XTSE0010, error-0010bb)
		assert.lengthOf(await problems(stylesheet('<xsl:template match="/"><xsl:banana/></xsl:template>').replace('version="3.0"', 'version="22.0"')), 1);
		// and in XSLT 3.0, all are reported
		assert.isAbove((await problems(stylesheet(body))).length, 0);
	});

	test('a simplified stylesheet: a literal result element with a sequence constructor (for-each-group-001, math-3318)', async () => {
		const simplified = '<table xsl:version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><tr/><xsl:for-each-group select="*" group-by="@c"><xsl:value-of select="1"/></xsl:for-each-group></table>';
		assert.deepEqual(await problems(simplified), []);
		// a declaration isn't allowed there
		assert.deepEqual(await problems(simplified.replace('<tr/>', '<xsl:template match="/"/>')), ['XSLT: instruction: xsl:template not valid in this context']);
		// without xsl:version, it isn't a simplified stylesheet (XTSE0150, error-0150d)
		assert.isAbove((await problems(simplified.replace(' xsl:version="3.0"', ''))).length, 0);
	});

	test('the name of a package is a URI, e.g. urn:simple (package-version-001)', async () => {
		assert.deepEqual(await problems(stylesheet('<xsl:template name="main"/>', 'xsl:package', ' name="urn:simple" package-version="1.0"')), []);
		assert.deepEqual(await problems(stylesheet('<xsl:use-package name="http://example.com/pkg/a" package-version="*"/>\n<xsl:template name="main"/>', 'xsl:package', ' name="urn:b"')), []);
	});
});
