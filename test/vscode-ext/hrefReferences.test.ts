/**
 * How the XML character and entity references in an href - of an xsl:import or xsl:include, or a fixed-namespaces
 * URI - are decoded before it's turned into a file path by HrefPaths.toPath() (see test/unit/hrefPaths.spec.ts). An
 * href is an attribute value, so a&amp;b.xsl is the URI a&b.xsl, and &#x20; is a space. The references are decoded
 * before the percent-decoding: &#x25;20 is '%20', which is a space.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XslLexer } from '../../src/xslLexer';
import { XslLexerLight } from '../../src/xslLexerLight';
import { XSLTConfiguration, XSLTLightConfiguration } from '../../src/languageConfigurations';
import { ImportIndex } from '../../src/importIndex';
import { RecordTypes } from '../../src/recordTypes';
import { FixedNamespaces } from '../../src/fixedNamespaces';
import { DocumentLinkProvider } from '../../src/documentLinkProvider';

const stylesheet = (href: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:import href="${href}"/>
</xsl:stylesheet>`;

// an href as it's written in the attribute, and what the code under test gives for it
type Case = [href: string, expected: string];

function check(cases: Case[], name: (href: string) => string | undefined) {
	cases.forEach(([href, expected]) => {
		test(`${JSON.stringify(href)} → ${JSON.stringify(expected)}`, () => {
			assert.strictEqual(name(href), expected);
		});
	});
}

// the names of the hrefs, with their references decoded
const decodedNames: Case[] = [
	['a.xsl', 'a.xsl'],
	['a&amp;b.xsl', 'a&b.xsl'],
	['a&apos;b.xsl', 'a\'b.xsl'],
	['a&#x20;b.xsl', 'a b.xsl'],
	['a&#32;b.xsl', 'a b.xsl'],
	['sub&#x2F;a.xsl', 'sub/a.xsl'],
	['a&#x25;20b.xsl', 'a%20b.xsl'],
];

suite('Href references: XslLexer globalInstructionData - imported globals, DCP/Schematron links, included item types', () => {
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	check(decodedNames, (href) => {
		lexer.analyse(stylesheet(href));
		return lexer.globalInstructionData.find((g) => g.token)?.name;
	});

	test('the token is the href as it\'s written', () => {
		lexer.analyse(stylesheet('a&amp;b.xsl'));
		assert.strictEqual(lexer.globalInstructionData.find((g) => g.token)?.token.length, '"a&amp;b.xsl"'.length);
	});
});

suite('Href references: XslLexerLight analyseLight() - XSLT document links, the symbol provider\'s import errors', () => {
	const lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
	check(decodedNames, (href) => lexer.analyseLight(stylesheet(href))[0]?.name);

	test('the document link is to the decoded href, and its range is the href as it\'s written', async () => {
		const href = 'a&amp;b&#x20;c.xsl';
		const content = stylesheet(href);
		const document = await vscode.workspace.openTextDocument({ language: 'xslt', content });
		const links = new DocumentLinkProvider(XSLTLightConfiguration.configuration).provideDocumentLinks(document, new vscode.CancellationTokenSource().token);
		assert.strictEqual(links.length, 1);
		assert.match(links[0].target!.fsPath, /[\\/]a&b c\.xsl$/);
		assert.strictEqual(document.getText(links[0].range), `"${href}"`);
	});
});

suite('Href references: ImportIndex.moduleReferences() - the import tree and inferred top-level stylesheet', () => {
	const modulePath = path.resolve('/work/proj/main.xsl');
	check([
		['a.xsl', 'a.xsl'],
		['a&amp;b.xsl', 'a&b.xsl'],
		['a&apos;b.xsl', 'a\'b.xsl'],
		['a&#x20;b.xsl', 'a b.xsl'],
		['sub&#x2F;a.xsl', path.join('sub', 'a.xsl')],
		['a&#x25;20b.xsl', 'a b.xsl'],
	].map(([href, name]) => [href, path.join(path.dirname(modulePath), name)] as Case),
	(href) => ImportIndex.moduleReferences(stylesheet(href), modulePath)[0]?.path);
});

suite('Href references: RecordTypes.attributeOfElementAt() - the hover\'s module href', () => {
	check(decodedNames, (href) => {
		const text = stylesheet(href);
		return RecordTypes.attributeOfElementAt(text, text.indexOf('<xsl:import') + 1, 'href');
	});
});

suite('Href references: FixedNamespaces.forModule() - a document URI in a fixed-namespaces attribute', () => {
	const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'href-references-')));
	const moduleFile = path.join(folder, 'main.xsl');
	const module = (value: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" fixed-namespaces="${value}" version="4.0"/>`;
	suiteSetup(() => fs.writeFileSync(path.join(folder, 'a&b.xml'), '<root xmlns:p="urn:p"/>'));
	suiteTeardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	test('the URI\'s references are decoded', () => {
		const result = FixedNamespaces.forModule(module('a&amp;b.xml'), moduleFile)!;
		assert.strictEqual(result.bindings.get('p'), 'urn:p');
		assert.deepEqual(result.problems, []);
	});

	test('&#x20; separates two tokens', () => {
		const result = FixedNamespaces.forModule(module('#standard&#x20;a&amp;b.xml'), moduleFile)!;
		assert.strictEqual(result.bindings.get('p'), 'urn:p');
		assert.strictEqual(result.bindings.get('xs'), 'http://www.w3.org/2001/XMLSchema');
	});

	test('a problem\'s token and offset are as they\'re written in the value', () => {
		const value = '#standard&#x20;missing&amp;.xml';
		const result = FixedNamespaces.forModule(module(value), moduleFile)!;
		assert.deepEqual(result.problems, [{ token: 'missing&amp;.xml', offset: value.indexOf('missing'), reason: 'unreadable' }]);
	});
});
