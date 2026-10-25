/**
 * Test suite for 'Find Nodes with XPath': in the query file, the expression at the cursor - expressions are separated
 * by blank lines, and one of only comments isn't one - and a 'declare namespace' prolog, given to Saxon separately;
 * and a node found, located in the XML file by its outline: by the positions of its elements, and an attribute's name
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XPathQuery } from '../../src/xpathQuery';
import { XMLConfiguration } from '../../src/languageConfigurations';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';

const queries = `(: queries :)

//order[@status = 'late']

count(//order)

(: a comment only :)

//order
  [@id = 'B2']
  /item`;

suite('XPath queries on XML files', () => {
	test('the expression at the cursor: up to blank lines - from a blank line, the one before', () => {
		assert.deepEqual(XPathQuery.expressionAt(queries, 2), { text: "//order[@status = 'late']", startLine: 2 });
		assert.deepEqual(XPathQuery.expressionAt(queries, 3), { text: "//order[@status = 'late']", startLine: 2 });
		assert.deepEqual(XPathQuery.expressionAt(queries, 9), { text: "//order\n  [@id = 'B2']\n  /item", startLine: 8 });
		// only comments
		assert.isUndefined(XPathQuery.expressionAt(queries, 0));
		assert.isUndefined(XPathQuery.expressionAt(queries, 6));
	});

	test('where each expression starts - not a comment on its own', () => {
		assert.deepEqual(XPathQuery.expressionStarts(queries), [2, 4, 8]);
	});

	test("each expression's run: on the blank line before it, else above it", () => {
		assert.deepEqual(XPathQuery.runPlaces(queries).map((p) => [p.expressionLine, p.onBlankLine]), [[2, true], [4, true], [8, true]]);
		assert.deepEqual(XPathQuery.runPlaces('//a\n\n//b').map((p) => [p.expressionLine, p.onBlankLine]), [[0, false], [2, true]]);
	});

	test('a namespace prolog: blanked, keeping the positions of the rest, and its bindings', () => {
		const expression = 'declare namespace o = "urn:orders";\n(: note :) declare namespace x=\'urn:x\';\n//o:order/x:note';
		const { xpath, namespaces } = XPathQuery.withoutProlog(expression);
		assert.deepEqual(namespaces, { o: 'urn:orders', x: 'urn:x' });
		assert.strictEqual(xpath.length, expression.length);
		assert.deepEqual(xpath.split('\n').map((line) => line.trim()), ['', '(: note :)', '//o:order/x:note']);
		assert.deepEqual(XPathQuery.withoutProlog('//order').namespaces, {});
	});

	test('a node found: located in the outline, by its elements\' positions', async () => {
		const xml = '<orders xmlns="urn:orders">\n  <order id="A1"><item>pen</item></order>\n  <order id="B2"><item>ink</item><note/></order>\n</orders>';
		const document = await vscode.workspace.openTextDocument({ content: xml, language: 'xml' });
		const symbols = await new XsltSymbolProvider(XMLConfiguration.configuration, null).getDocumentSymbols(document, false) ?? [];
		const text = (range: vscode.Range | undefined) => range ? document.getText(range) : '(none)';
		const at = (range: vscode.Range | undefined) => range ? `${range.start.line}:${range.start.character}` : '(none)';
		assert.strictEqual(text(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'element', positions: [1, 2, 2] }, symbols)), 'note');
		assert.strictEqual(at(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'element', positions: [1, 2, 1] }, symbols)), '2:18');
		assert.strictEqual(text(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'attribute', name: 'id', positions: [1, 2] }, symbols)), 'id');
		// a text node: its element
		assert.strictEqual(at(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'text', positions: [1, 1, 1] }, symbols)), '1:18');
		assert.isUndefined(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'element', positions: [1, 3] }, symbols));
	});
});
