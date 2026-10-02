/**
 * Test suite for completions within element(...) and attribute(...) - in an 'as' attribute, an expression and a pattern:
 * the element or attribute names of the XML context file, then those used in the stylesheet's name tests, and '*' - with
 * XPath 4.0's wildcards for the prefixed names' local names and prefixes, e.g. *:note and lib:* for lib:note - which
 * match in any namespace, as an unprefixed name only matches in no namespace - or after the comma, the type annotations
 * that don't need a
 * schema, e.g. xs:untyped. Only these are offered, not the types that are offered elsewhere in an 'as' attribute.
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { XPathDocumentChangeHandler } from '../../src/xpathDocumentChangeHandler';

const contextXml = '<books xmlns:lib="urn:lib"><book title="t" year="2000"><chapter lib:id="c1"/></book><lib:note/></books>';

// the labels of the completions at the cursor, in their sort order
async function labels(body: string, version = '4.0') {
	const text = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:lib="urn:lib" version="${version}">\n  ${body}\n  <xsl:template match="section/@level"/>\n</xsl:stylesheet>`;
	const offset = text.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: text.replace('¦', ''), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? '')).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

const asVariable = (type: string) => `<xsl:template match="/"><xsl:variable name="v" as="${type}" select="()"/></xsl:template>`;
const elementNames = ['books', 'book', 'chapter', 'lib:note', 'section', '*', '*:note', 'lib:*'];
const attributeNames = ['title', 'year', 'lib:id', 'level', '*', '*:id', 'lib:*'];

suite('Kind tests: completions of names', () => {
	const xmlPath = path.join(os.tmpdir(), `kind-test-context-${Date.now()}.xml`);
	suiteSetup(() => {
		fs.writeFileSync(xmlPath, contextXml);
		const contextUri = vscode.Uri.file(xmlPath);
		XsltSymbolProvider.documentSymbols.delete(contextUri);
		DocumentChangeHandler.lastActiveXMLNonXSLUri = contextUri;
	});
	suiteTeardown(() => {
		DocumentChangeHandler.lastActiveXMLNonXSLUri = null;
		fs.rmSync(xmlPath, { force: true });
	});

	const cases: [string, string, string[]][] = [
		['element() in an as attribute', asVariable('element(¦)'), elementNames],
		['a partly typed name', asVariable('element(bo¦)'), elementNames],
		['a name after | in a union', asVariable('element(book | ¦)'), elementNames],
		['attribute() in an as attribute', asVariable('attribute(¦)'), attributeNames],
		['element() after instance of', `<xsl:template match="/"><xsl:sequence select=". instance of element(¦)"/></xsl:template>`, elementNames],
		['attribute() in a pattern', `<xsl:template match="attribute(ti¦)"/>`, attributeNames],
		['the type annotation of an element', asVariable('element(*, ¦)'), ['xs:untyped', 'xs:anyType']],
		['the type annotation of an attribute', asVariable('attribute(title, ¦)'), ['xs:untypedAtomic', 'xs:anySimpleType']],
	];
	cases.forEach(([label, body, expected]) => {
		test(label, async () => {
			assert.deepEqual(await labels(body), expected);
		});
	});

	test("after '*:', the local names of all the names", async () => {
		const localNames = ['*:books', '*:book', '*:chapter', '*:note', '*:section'];
		assert.deepEqual(await labels(asVariable('element(*:¦)')), localNames);
		assert.deepEqual(await labels(asVariable('element(*:bo¦)')), localNames);
		assert.deepEqual(await labels(`<xsl:template match="/"><xsl:sequence select=". instance of attribute(*:¦)"/></xsl:template>`), ['*:title', '*:year', '*:id', '*:level']);
	});

	test("after a typed '*', '*' and the wildcards for all the names", async () => {
		assert.deepEqual(await labels(asVariable('element(*¦)')), ['*', '*:books', '*:book', '*:chapter', '*:note', '*:section', 'lib:*']);
		assert.deepEqual(await labels(asVariable('attribute(*¦)')), ['*', '*:title', '*:year', '*:id', '*:level', 'lib:*']);
	});

	test("XSLT 3.0: after a typed '*', the names as before", async () => {
		assert.deepEqual(await labels(asVariable('element(*¦)'), '3.0'), ['books', 'book', 'chapter', 'lib:note', 'section', '*']);
	});

	test("a typed '*' triggers completion at the start of a name, not elsewhere", () => {
		const triggers = (lineBefore: string, text = '*') => XPathDocumentChangeHandler.isKindTestWildcardStart(text, lineBefore);
		assert.isTrue(triggers('<xsl:variable name="v" as="element('));
		assert.isTrue(triggers('select=". instance of attribute( '));
		assert.isTrue(triggers('match="element(book | '));
		assert.isFalse(triggers('select="$a '));
		assert.isFalse(triggers('select="count(//'));
		assert.isFalse(triggers('as="element(book, '));
		assert.isFalse(triggers('select="my-element('));
		assert.isFalse(triggers('as="element(', ':'));
	});

	test('XSLT 3.0: no wildcards for the prefixes', async () => {
		assert.deepEqual(await labels(asVariable('element(¦)'), '3.0'), ['books', 'book', 'chapter', 'lib:note', 'section', '*']);
	});

	test('outside a kind test, the other completions', async () => {
		const found = await labels(`<xsl:template match="/"><xsl:sequence select="count(¦)"/></xsl:template>`);
		assert.include(found, 'ancestor::');
	});

	test('without a context file: the names in the stylesheet', async () => {
		DocumentChangeHandler.lastActiveXMLNonXSLUri = null;
		try {
			assert.deepEqual(await labels(asVariable('element(¦)')), ['section', '*']);
		} finally {
			DocumentChangeHandler.lastActiveXMLNonXSLUri = vscode.Uri.file(xmlPath);
		}
	});
	// Saxon 12.8 and 13 don't implement XSLT 4.0's ##any - an unprefixed name then matches nothing - but don't report it
	test('xpath-default-namespace="##any" is not reported', async () => {
		for (const version of ['3.0', '4.0']) {
			const xslt = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="${version}" xpath-default-namespace="##any">
  <xsl:template match="book"><xsl:for-each select="*" xpath-default-namespace="##any"><out xsl:xpath-default-namespace="##any"><xsl:sequence select="book"/></out></xsl:for-each></xsl:template>
</xsl:stylesheet>`;
			const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
			const lexer = new XslLexer(XSLTConfiguration.configuration);
			lexer.provideCharLevelState = true;
			const isVersion4 = version === '4.0';
			const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, lexer.analyse(xslt), lexer.globalInstructionData, [], []);
			assert.deepEqual(diagnostics.map((d) => d.message), [], version);
		}
	});
});
