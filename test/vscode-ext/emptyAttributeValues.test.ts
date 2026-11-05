/**
 * Test suite for empty attribute values of XSLT instructions and declarations: reported where Saxon reports them as a
 * static error, e.g. an xsl:import's href (the module imports itself) or a decimal-format's grouping-separator - not
 * where an empty value is allowed, e.g. xsl:element's namespace, a separator or xsl:result-document's href
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const template = (content: string) => `<xsl:template name="t">${content}</xsl:template>`;

async function lint(body: string, rootAttributes = '') {
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"${rootAttributes}>
${body}
</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(XSLTConfiguration.configuration, DocumentTypes.XSLT, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => d.message).filter((m) => !/not used|is unused/.test(m));
}

const empty = (attribute: string, element: string, reason: string, code: string) => `XSLT: The ${attribute} attribute of ${element} is empty - ${reason} (${code})`;
const yesOrNo = 'it must be yes, no, true, false, 1 or 0';
const singleCharacter = 'it must be a single character';

const reported: [string, string, string[]][] = [
	['an xsl:import\'s href', '<xsl:import href=""/>', [empty('href', 'xsl:import', 'the module imports itself', 'XTSE0210')]],
	['an xsl:include\'s href', '<xsl:include href=""/>', [empty('href', 'xsl:include', 'the module includes itself', 'XTSE0180')]],
	['a template rule\'s mode and priority', '<xsl:template match="a" mode="" priority=""/>',
		[empty('mode', 'xsl:template', 'it must be a list of mode names, or #all', 'XTSE0020'), empty('priority', 'xsl:template', 'it must be a number', 'XTSE0530')]],
	// not also reported as a mode with no template rules
	['an xsl:apply-templates mode', template('<xsl:apply-templates mode="" select="1"/>'),
		[empty('mode', 'xsl:apply-templates', 'it must be a mode name, #current, #default or #unnamed', 'XTSE0020')]],
	['a decimal format\'s characters - not its infinity and NaN strings', '<xsl:decimal-format name="d" grouping-separator="" zero-digit="" infinity="" NaN=""/>',
		[empty('grouping-separator', 'xsl:decimal-format', singleCharacter, 'XTSE0020'), empty('zero-digit', 'xsl:decimal-format', singleCharacter, 'XTSE0020')]],
	['an output character\'s character - not its string', '<xsl:character-map name="c"><xsl:output-character character="" string=""/></xsl:character-map>',
		[empty('character', 'xsl:output-character', singleCharacter, 'XTSE0020')]],
	['the name of a constructed element, attribute or processing instruction - not of a namespace node (the default namespace)',
		template('<xsl:element name=""/><xsl:attribute name=""/><xsl:processing-instruction name=""/><xsl:namespace name="" select="\'u\'"/>'),
		[empty('name', 'xsl:element', 'it must be a QName', 'XTDE0820'), empty('name', 'xsl:attribute', 'it must be a QName', 'XTDE0850'),
			empty('name', 'xsl:processing-instruction', 'it must be an NCName', 'XTDE0890')]],
	['an xsl:message terminate', template('<xsl:message terminate="">m</xsl:message>'), [empty('terminate', 'xsl:message', yesOrNo, 'XTSE0020')]],
	['an xsl:sort order, case-order and stable - not its lang', template('<xsl:for-each select="1"><xsl:sort order="" case-order="" stable="" lang=""/></xsl:for-each>'),
		[empty('order', 'xsl:sort', 'it must be ascending or descending', 'XTSE0020'), empty('case-order', 'xsl:sort', 'it must be upper-first or lower-first', 'XTSE0020'),
			empty('stable', 'xsl:sort', yesOrNo, 'XTSE0020')]],
	['an xsl:number start-at - not its format, lang or grouping-separator', template('<xsl:number value="1" start-at="" format="" lang="" grouping-separator=""/>'),
		[empty('start-at', 'xsl:number', 'it must be a list of integers', 'XTSE0020')]],
	['serialization parameters - not the version, a doctype or the item separator', '<xsl:output name="o" version="" html-version="" normalization-form="" doctype-public="" item-separator=""/>',
		[empty('html-version', 'xsl:output', 'it must be a decimal number', 'XTSE0020'),
			empty('normalization-form', 'xsl:output', 'it must be NFC, NFD, NFKC, NFKD, fully-normalized or none', 'XTSE0020')]],
	['an xsl:result-document format and serialization parameters - not its href or media type',
		template('<xsl:result-document href="" format="" method="" build-tree="" output-version="" media-type=""><a/></xsl:result-document>'),
		[empty('format', 'xsl:result-document', 'it must be the name of an xsl:output', 'XTDE1460'), empty('method', 'xsl:result-document', 'it must be an output method, e.g. xml', 'XTSE0020'),
			empty('build-tree', 'xsl:result-document', yesOrNo, 'XTSE0020')]],
	['an xsl:use-package name and package-version', '<xsl:use-package name="" package-version=""/>',
		[empty('name', 'xsl:use-package', 'it must be the name of a package', 'XTSE3000'), empty('package-version', 'xsl:use-package', 'it must be a version, e.g. 1.0', 'XTSE0020')]],
	['the standard attributes of an XSLT element', '<xsl:template match="a" version="" default-mode="" default-collation=""/>',
		[empty('version', 'xsl:template', 'it must be a number, e.g. 3.0', 'XTSE0110'), empty('default-mode', 'xsl:template', 'it must be a mode name or #unnamed', 'XTSE0020'),
			empty('default-collation', 'xsl:template', 'it must be a list of collation URIs', 'XTSE0125')]],
];

suite('Empty attribute values', () => {
	reported.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await lint(body), expected);
		});
	});

	test('allowed: a namespace, separator, list or no-namespace default', async () => {
		assert.deepEqual(await lint(template('<xsl:value-of select="1" separator=""/><xsl:element name="e" namespace=""/><xsl:attribute name="a" namespace="" separator=""/>') +
			'<xsl:strip-space elements=""/>', ' exclude-result-prefixes="" extension-element-prefixes="" xpath-default-namespace=""'), []);
	});

	test('not an attribute value template, which is split at its braces', async () => {
		assert.deepEqual(await lint(template('<xsl:variable name="t" select="\'no\'"/><xsl:message terminate="{$t}">m</xsl:message><xsl:message terminate=\'{$t}\'>m</xsl:message>')), []);
	});

	test('in apostrophes', async () => {
		assert.deepEqual(await lint('<xsl:import href=\'\'/>'), [empty('href', 'xsl:import', 'the module imports itself', 'XTSE0210')]);
	});

	test('the root element\'s default-mode', async () => {
		assert.deepEqual(await lint('', ' default-mode=""'), [empty('default-mode', 'xsl:stylesheet', 'it must be a mode name or #unnamed', 'XTSE0020')]);
	});
});
