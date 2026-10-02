/**
 * Test suite for the name test of element(...) and attribute(...), in an 'as' attribute, an expression - after
 * 'instance of' - and a pattern. XPath 3.1 allows a name, e.g. my:para or Q{urn:my}para, or '*' - and a type annotation,
 * e.g. element(*, xs:untyped). XPath 4.0 also allows any NameTest, e.g. the wildcards my:*, *:para and Q{urn:my}*, and a
 * union of them, e.g. element(para | heading). As with Saxon 12.8 without syntax extensions, and Saxon 13, the XPath 4.0
 * forms are reported before 4.0.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

// the diagnostics for the kind test in each position
async function lint(version: string, form: string, position: 'as' | 'instance of' | 'match' | 'step') {
	const body = position === 'as' ? `<xsl:variable name="n" as="${form}?" select="()"/><xsl:sequence select="$n"/>` :
		position === 'instance of' ? `<xsl:sequence select=". instance of ${form}"/>` :
		position === 'step' ? `<xsl:sequence select="count(${form})"/>` :
		`</xsl:template><xsl:template match="${form}"><xsl:sequence select="1"/>`;
	const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:my="urn:my" version="${version}">\n<xsl:template name="t">${body}</xsl:template>\n</xsl:stylesheet>`;
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const isVersion4 = version === '4.0';
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, lexer.analyse(xslt), lexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused').map((d) => d.message);
}

const positions: ('as' | 'instance of' | 'match')[] = ['as', 'instance of', 'match'];

// valid in XPath 3.1, and 4.0
const valid31 = ['element(para)', 'element(my:para)', 'element(Q{urn:my}para)', 'element(*)', 'attribute(my:id)', 'element(*, xs:untyped)', 'element(my:para, xs:anyType)'];
// valid in XPath 4.0 - with the message for 3.1
const valid40: [string, string][] = [
	['element(my:*)', `XPath: The wildcard 'my:*' in element(...) requires XPath 4.0 - before it, only a name or '*' is allowed`],
	['element(*:para)', `XPath: The wildcard '*:para' in element(...) requires XPath 4.0 - before it, only a name or '*' is allowed`],
	['element(Q{urn:my}*)', `XPath: The wildcard 'Q{urn:my}*' in element(...) requires XPath 4.0 - before it, only a name or '*' is allowed`],
	['attribute(*:id)', `XPath: The wildcard '*:id' in attribute(...) requires XPath 4.0 - before it, only a name or '*' is allowed`],
	['element(para|heading)', 'XPath: A union of names in element(...), e.g. element(a | b), requires XPath 4.0'],
	['attribute(id | my:id)', 'XPath: A union of names in attribute(...), e.g. attribute(a | b), requires XPath 4.0'],
	['element(my:*|*:heading)', `XPath: The wildcard 'my:*' in element(...) requires XPath 4.0 - before it, only a name or '*' is allowed`],
];

suite('Kind tests: element(...) and attribute(...) name tests', () => {
	for (const version of ['3.0', '4.0']) {
		valid31.forEach((form) => {
			positions.forEach((position) => {
				test(`${version}, ${position}: ${form}`, async () => {
					assert.deepEqual(await lint(version, form, position), []);
				});
			});
		});
	}

	valid40.forEach(([form, message]) => {
		positions.forEach((position) => {
			test(`4.0, ${position}: ${form}`, async () => {
				assert.deepEqual(await lint('4.0', form, position), []);
			});
			test(`3.0, ${position}: ${form} requires XPath 4.0`, async () => {
				assert.deepEqual(await lint('3.0', form, position), [message]);
			});
		});
	});

	test('an undeclared prefix in a wildcard', async () => {
		assert.isNotEmpty(await lint('4.0', 'element(nope:*)', 'as'));
		assert.isNotEmpty(await lint('4.0', 'element(nope:*)', 'instance of'));
	});

	test('a path step with the wildcard Q{uri}*, as in XPath 3.1', async () => {
		assert.deepEqual(await lint('3.0', '/Q{urn:my}*', 'step'), []);
		assert.deepEqual(await lint('4.0', '/Q{urn:my}*', 'step'), []);
	});

	test('a braced URI literal without a local name is still reported', async () => {
		assert.isNotEmpty(await lint('4.0', '/Q{urn:my} para', 'step'));
	});

	test('a type name as an EQName in an as attribute', async () => {
		assert.deepEqual(await lint('3.0', 'Q{http://www.w3.org/2001/XMLSchema}string', 'as'), []);
	});
});
