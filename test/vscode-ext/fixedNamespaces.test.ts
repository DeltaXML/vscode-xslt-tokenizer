/**
 * Test suite for XSLT 4.0's fixed-namespaces attribute, on the outermost element of a stylesheet module: it defines all
 * the namespace bindings for XPath expressions, patterns and attributes with QNames - not the in-scope namespaces, which
 * still apply to element names. As in Saxon 13: the tokens #standard, a prefix declared on the element, a standard
 * prefix, prefix=uri, and a URI of an XML document whose outermost element's namespace declarations are used - and
 * XTSE0122 for a token that's none of these. Saxon 12.8 doesn't implement it, so it's only for XSLT 4.0.
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
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { FixedNamespaces } from '../../src/fixedNamespaces';

const stylesheet = (rootAttributes: string, select: string, version = '4.0') => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" ${rootAttributes} version="${version}">
  <xsl:variable name="doc" as="document-node()"><xsl:document><para xmlns="urn:my"/><page xmlns="urn:w"/></xsl:document></xsl:variable>
  <xsl:template name="xsl:initial-template">
    <xsl:sequence select="${select}"/>
  </xsl:template>
</xsl:stylesheet>`;

async function lint(document: vscode.TextDocument, version = '4.0') {
	const text = document.getText();
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	lexer.provideCharLevelState = true;
	const isVersion4 = version === '4.0';
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4 }, isVersion4 ? DocumentTypes.XSLT40 : DocumentTypes.XSLT, document, lexer.analyse(text), lexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused').map((d) => d.message);
}

const lintText = async (text: string, version = '4.0') => lint(await vscode.workspace.openTextDocument({ content: text, language: 'xslt' }), version);

async function completionLabels(marked: string) {
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	return (Array.isArray(result) ? result : result?.items ?? []).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
}

suite('fixed-namespaces', () => {
	suite('the bindings', () => {
		const native = new Map([['my', 'urn:my'], ['math', 'java:java.lang.Math']]);
		const bindings = (value: string, readText?: (file: string) => string | undefined) => FixedNamespaces.bindings(value, native, '/project/main.xsl', readText);

		test('#standard, with a native binding of a standard prefix taking precedence', () => {
			const { bindings: found, problems } = bindings('#standard');
			assert.equal(found.get('xs'), 'http://www.w3.org/2001/XMLSchema');
			assert.equal(found.get('err'), 'http://www.w3.org/2005/xqt-errors');
			assert.equal(found.get('math'), 'java:java.lang.Math');
			assert.isFalse(found.has('my'));
			assert.deepEqual(problems, []);
		});

		test('a prefix declared on the element, a standard prefix, and prefix=uri - the last binding wins', () => {
			const { bindings: found } = bindings('my map w=urn:w my=urn:other');
			assert.deepEqual([...found], [['my', 'urn:other'], ['map', 'http://www.w3.org/2005/xpath-functions/map'], ['w', 'urn:w']]);
		});

		test('the URI of an XML document: the namespace declarations of its outermost element', () => {
			const read = (file: string) => file === path.resolve('/project', 'shared/ns.xml') ? '<?xml version="1.0"?>\n<w:document xmlns:w="urn:w" xmlns:mc="urn:mc" xmlns="urn:default"/>' : undefined;
			const { bindings: found, problems } = bindings('./shared/ns.xml', read);
			assert.deepEqual([...found], [['w', 'urn:w'], ['mc', 'urn:mc']]);
			assert.deepEqual(problems, []);
		});

		test('the tokens that are reported', () => {
			const { problems } = bindings('#nonsense xmlns=urn:x xml=urn:x p=http://www.w3.org/XML/1998/namespace', () => undefined);
			assert.deepEqual(problems.map((p) => [p.token, p.offset, p.reason]), [
				['#nonsense', 0, 'unreadable'], ['xmlns=urn:x', 10, 'xmlns'], ['xml=urn:x', 22, 'xml'], ['p=http://www.w3.org/XML/1998/namespace', 32, 'xml']
			]);
		});
	});

	suite('the linter', () => {
		test('prefix=uri and #standard', async () => {
			assert.deepEqual(await lintText(stylesheet('fixed-namespaces="#standard my=urn:my"', 'count($doc/my:para), xs:integer(2), map:size({})')), []);
		});

		test('a prefix declared on the element', async () => {
			assert.deepEqual(await lintText(stylesheet('xmlns:my="urn:my" fixed-namespaces="#standard my"', 'count($doc/my:para)')), []);
		});

		test('#standard without declarations of the standard prefixes', async () => {
			assert.deepEqual(await lintText(stylesheet('fixed-namespaces="#standard"', 'xs:integer(3), math:pi() gt 3')), []);
		});

		test('a prefix declared on the element, but not in fixed-namespaces, is not in scope for XPath', async () => {
			assert.deepEqual(await lintText(stylesheet('xmlns:my="urn:my" fixed-namespaces="#standard"', 'count($doc/my:para)')), [`XPath: Undeclared prefix in name: 'my:para'`]);
		});

		test('without xsl in fixed-namespaces, the QName of a template name is not in scope', async () => {
			assert.include(await lintText(stylesheet('fixed-namespaces="my=urn:my"', '1')), `XSLT: Undeclared prefix in name: 'xsl:initial-template'`);
		});

		test('a token that is not recognised, and whose document cannot be read', async () => {
			const messages = await lintText(stylesheet('fixed-namespaces="#standard #nonsense"', '1'));
			assert.deepEqual(messages, [`XSLT: The fixed-namespaces token '#nonsense' isn't #standard, a prefix declared on this element, a standard prefix or prefix=uri - and as a URI, the XML document it refers to can't be read (XTSE0122)`]);
		});

		test('the URI of an XML document, relative to the stylesheet', async () => {
			const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-namespaces-')));
			try {
				fs.writeFileSync(path.join(dir, 'sample.xml'), '<w:document xmlns:w="urn:w" xmlns:mc="urn:mc"/>');
				const file = path.join(dir, 'main.xsl');
				fs.writeFileSync(file, stylesheet('fixed-namespaces="#standard ./sample.xml"', 'count($doc/w:page)'));
				assert.deepEqual(await lint(await vscode.workspace.openTextDocument(vscode.Uri.file(file))), []);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});

		test('XSLT 3.0: fixed-namespaces is reported, and the in-scope namespaces apply', async () => {
			const messages = await lintText(stylesheet('xmlns:my="urn:my" fixed-namespaces="#standard"', 'count($doc/my:para)', '3.0'), '3.0');
			assert.deepEqual(messages, [`XSLT: Invalid attribute on element 'xsl:stylesheet': 'fixed-namespaces'`]);
		});
	});

	suite('completion', () => {
		const root = (value: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:my="urn:my" xmlns:xs="http://www.w3.org/2001/XMLSchema" fixed-namespaces="${value}" version="4.0">\n</xsl:stylesheet>`;

		test('the tokens of fixed-namespaces', async () => {
			assert.deepEqual(await completionLabels(root('¦')), ['#standard', 'xsl', 'xs', 'xsi', 'fn', 'math', 'map', 'array', 'err', 'my']);
		});

		test('not the tokens already in fixed-namespaces', async () => {
			assert.deepEqual(await completionLabels(root('#standard ¦ my')), ['xsl', 'xs', 'xsi', 'fn', 'math', 'map', 'array', 'err']);
		});

		test('a function with a prefix from fixed-namespaces', async () => {
			const text = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" fixed-namespaces="#standard my=urn:my" version="4.0">
  <xsl:function name="my:f" as="xs:integer"><xsl:param name="a" as="xs:integer"/><xsl:sequence select="$a"/></xsl:function>
  <xsl:template name="t"><xsl:sequence select="my¦"/></xsl:template>
</xsl:stylesheet>`;
			assert.isTrue((await completionLabels(text)).some((label) => label.startsWith('my:f')));
		});
	});
});
