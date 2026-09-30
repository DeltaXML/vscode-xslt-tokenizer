/**
 * Pins down how the XML character and entity references in an href - of an xsl:import or xsl:include, or a
 * fixed-namespaces URI - are handled before it's turned into a file path (see test/unit/hrefPaths.spec.ts for that
 * step). An href is an attribute value, so a&amp;b.xsl is the URI a&b.xsl, and &#x20; is a space. These are what the
 * extension does now: the expectations marked 'ISSUE' are ones that look wrong, continuing the numbering of
 * hrefPaths.spec.ts, and are listed in the summary at the end of this file.
 *
 * The references are decoded before any percent-decoding: &#x25;20 is '%20', which is a space.
 */
import * as vscode from 'vscode';
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

// an href as it's written in the attribute, and the name the code under test gives for it
type Case = [href: string, expected: string];

function check(cases: Case[], name: (href: string) => string | undefined) {
	cases.forEach(([href, expected]) => {
		test(`${JSON.stringify(href)} → ${JSON.stringify(expected)}`, () => {
			assert.strictEqual(name(href), expected);
		});
	});
}

suite('Href references: XslLexer globalInstructionData - imported globals, DCP/Schematron links, included item types', () => {
	const lexer = new XslLexer(XSLTConfiguration.configuration);
	check([
		['a.xsl', 'a.xsl'],
		// ISSUE 11: the '&' and ';' of a reference are dropped, leaving its name in the href - the correct value is
		// in the comment
		['a&amp;b.xsl', 'aampb.xsl'],       // a&b.xsl
		['a&apos;b.xsl', 'aaposb.xsl'],     // a'b.xsl
		['a&#x20;b.xsl', 'a#x20b.xsl'],     // 'a b.xsl'
		['a&#32;b.xsl', 'a#32b.xsl'],       // 'a b.xsl'
		['sub&#x2F;a.xsl', 'sub#x2Fa.xsl'], // sub/a.xsl
		['a&#x25;20b.xsl', 'a#x2520b.xsl'], // a%20b.xsl, i.e. 'a b.xsl'
	], (href) => {
		lexer.analyse(stylesheet(href));
		return lexer.globalInstructionData.find((g) => g.token)?.name;
	});
});

suite('Href references: XslLexerLight analyseLight() - XSLT document links, the symbol provider\'s import errors', () => {
	const lexer = new XslLexerLight(XSLTLightConfiguration.configuration);
	check([
		['a.xsl', 'a.xsl'],
		// ISSUE 11
		['a&amp;b.xsl', 'aampb.xsl'],
		['a&#x20;b.xsl', 'a#x20b.xsl'],
	], (href) => lexer.analyseLight(stylesheet(href))[0]?.name);

	test('ISSUE 11: the document link is to the file with the reference names in it', async () => {
		const document = await vscode.workspace.openTextDocument({ language: 'xslt', content: stylesheet('a&amp;b.xsl') });
		const links = new DocumentLinkProvider(XSLTLightConfiguration.configuration).provideDocumentLinks(document, new vscode.CancellationTokenSource().token);
		assert.strictEqual(links.length, 1);
		assert.match(links[0].target!.path, /\/aampb\.xsl$/);
	});
});

suite('Href references: ImportIndex.moduleReferences() - the import tree and inferred top-level stylesheet', () => {
	check([
		['a.xsl', '/work/proj/a.xsl'],
		// ISSUE 12: the references aren't decoded - the href is used as it's written
		['a&amp;b.xsl', '/work/proj/a&amp;b.xsl'],
		['a&apos;b.xsl', '/work/proj/a&apos;b.xsl'],
		['a&#x20;b.xsl', '/work/proj/a&#x20;b.xsl'],
		['sub&#x2F;a.xsl', '/work/proj/sub&#x2F;a.xsl'],
		// and a file: URI's percent-decoding is of the undecoded text
		['file:///abs/a&#x25;20b.xsl', '/abs/a&#x25;20b.xsl'],
	], (href) => ImportIndex.moduleReferences(stylesheet(href), '/work/proj/main.xsl')[0]?.path);
});

suite('Href references: RecordTypes.attributeOfElementAt() - the hover\'s module href', () => {
	// decoded, as they should be
	check([
		['a.xsl', 'a.xsl'],
		['a&amp;b.xsl', 'a&b.xsl'],
		['a&apos;b.xsl', 'a\'b.xsl'],
		['a&#x20;b.xsl', 'a b.xsl'],
		['a&#32;b.xsl', 'a b.xsl'],
		['sub&#x2F;a.xsl', 'sub/a.xsl'],
		// ISSUE 1 (hrefPaths.spec.ts): decoded to %20, which isn't then percent-decoded
		['a&#x25;20b.xsl', 'a%20b.xsl'],
	], (href) => {
		const text = stylesheet(href);
		return RecordTypes.attributeOfElementAt(text, text.indexOf('<xsl:import') + 1, 'href');
	});
});

suite('Href references: FixedNamespaces - a document URI in a fixed-namespaces attribute', () => {
	// forModule() passes the attribute's raw value to bindings(), which is called here to see the path it reads
	const pathRead = (value: string) => {
		let read: string | undefined;
		FixedNamespaces.bindings(value, new Map(), '/work/proj/main.xsl', (file) => {
			read = file;
			return undefined;
		});
		return read;
	};
	check([
		['ns.xml', '/work/proj/ns.xml'],
		// ISSUE 12: the references aren't decoded
		['a&amp;b.xml', '/work/proj/a&amp;b.xml'],
		['a&#x2F;b.xml', '/work/proj/a&#x2F;b.xml'],
	], pathRead);

	test('ISSUE 12: &#x20; is a separator once decoded, but here it\'s part of the token', () => {
		// fixed-namespaces="#standard&#x20;ns.xml" is the two tokens '#standard' and 'ns.xml'
		const result = FixedNamespaces.bindings('#standard&#x20;ns.xml', new Map(), '/work/proj/main.xsl', () => undefined);
		assert.deepEqual(result.problems.map((p) => p.token), ['#standard&#x20;ns.xml']);
	});
});

/*
 * ISSUES (continued from test/unit/hrefPaths.spec.ts)
 *
 * 11. XslLexer and XslLexerLight drop the '&' and ';' of a reference in an attribute value they keep as a global
 *     instruction's name - tokenChars isn't added to in the lEntity and rEntity states - so a&amp;b.xsl is
 *     'aampb.xsl'. This is the href for the imported globals, XSLT and DCP/Schematron document links, the DCP missing
 *     file checks, and included item types.
 * 12. ImportIndex and fixed-namespaces use the attribute's text as it's written, without decoding the references. So
 *     the only one that's right is the hover, which uses RecordTypes.attributeOfElementAt(), with decodeReferences().
 *
 * The decoding should be: XML references first (&#x25; is '%'), then percent-decoding (ISSUE 1 and 2), then a
 * catalog lookup - whose catalog files' attribute values need their references decoded too - or path resolution.
 */
