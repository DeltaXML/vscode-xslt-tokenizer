/**
 * Test suite for well-formedness errors from elements that aren't well nested: each mistake is reported once, without
 * a cascade of errors for its ancestors
 *
 * - a missing end tag: only the elements an end tag skips over are reported, not the end tag
 * - a stray end tag, with no open element of that name: only the end tag is reported - no open element is closed
 * - a misspelt end tag: the end tag, and its start tag when the parent's end tag closes it
 * - elements still open at the end of the document
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XMLConfiguration, XSLTConfiguration } from '../../src/languageConfigurations';
import { DocumentTypes, LanguageConfiguration, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const unclosed = (name: string) => `XML: Start tag '${name}' has no matching close tag`;
const unexpected = (name: string) => `XML: Unexpected close tag '${name}'`;

async function problems(text: string, config: LanguageConfiguration, docType: DocumentTypes, language: string) {
	const xslLexer = new XslLexer(config);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(text);
	const document = await vscode.workspace.openTextDocument({ content: text, language });
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics(config, docType, document, allTokens, xslLexer.globalInstructionData, [], []);
	return diagnostics.map((d) => [d.message, document.getText(d.range), d.range.start.character]);
}

// [label, XML, expected [message, offset of the reported text]]
const cases: [string, string, [string, string][]][] = [
	['well nested', `<a><b><c/></b></a>`, []],
	['one end tag missing', `<a><b><c></b></a>`, [[unclosed('c'), '<c>']]],
	['two end tags missing', `<a><b><c><d></b></a>`, [[unclosed('d'), '<d>'], [unclosed('c'), '<c>']]],
	['a stray end tag', `<a><b></x></b></a>`, [[unexpected('x'), '</x>']]],
	['a misspelt end tag', `<a><b></bb></a>`, [[unexpected('bb'), '</bb>'], [unclosed('b'), '<b>']]],
	['a missing end tag of the same name as an ancestor', `<a><a><b></a></a>`, [[unclosed('b'), '<b>']]],
	['end tags missing at the end', `<a><b><c>`, [[unclosed('c'), '<c>'], [unclosed('b'), '<b>'], [unclosed('a'), '<a>']]],
];

function expected(text: string, problems: [string, string][], offset = 0) {
	// the reported text: the element's name, in the start or end tag
	return problems.map(([message, tag]) => {
		const name = tag.replace(/[<>/]/g, '');
		const start = text.indexOf(tag) + (tag.startsWith('</') ? 2 : 1) + offset;
		return [message, name, start];
	}).sort((a, b) => <number>a[2] - <number>b[2]);
}

const byStart = (a: (string | number)[], b: (string | number)[]) => <number>a[2] - <number>b[2];

suite('Element nesting errors in XML', () => {
	cases.forEach(([label, xml, probs]) => {
		test(label, async () => {
			const actual = await problems(xml, XMLConfiguration.configuration, DocumentTypes.Other, 'xml');
			assert.deepEqual(actual.sort(byStart), expected(xml, probs));
		});
	});
});

suite('Element nesting errors in XSLT', () => {
	const start = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"><xsl:template name="t">`;
	const end = `</xsl:template></xsl:stylesheet>`;
	cases.filter(([label]) => label !== 'end tags missing at the end').forEach(([label, xml, probs]) => {
		test(label, async () => {
			const xslt = start + xml + end;
			const actual = await problems(xslt, XSLTConfiguration.configuration, DocumentTypes.XSLT, 'xslt');
			assert.deepEqual(actual.sort(byStart), expected(xml, probs, start.length));
		});
	});
});
