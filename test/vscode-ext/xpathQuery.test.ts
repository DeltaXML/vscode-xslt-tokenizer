/**
 * Test suite for 'Find Nodes with XPath': in the query file, the expression at the cursor - expressions are separated
 * by blank lines, and one of only comments isn't one - and a 'declare namespace' prolog, given to Saxon separately;
 * and a node found, located in the XML file by its outline: by the positions of its elements, and an attribute's name
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XPathQuery } from '../../src/xpathQuery';
import { XPathQueryResults } from '../../src/xpathQueryResults';
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

	test('each block checked on its own: the others blanked, keeping positions', () => {
		const text = '//a\n\n(: c :)\n\n1 +\r\n 2\n';
		const blank = (s: string) => s.replace(/[^\r\n]/g, ' ');
		assert.deepEqual(XPathQuery.separateBlocks(text), [
			'//a\n\n' + blank('(: c :)\n\n1 +\r\n 2\n'),
			blank('//a\n\n') + '(: c :)\n\n' + blank('1 +\r\n 2\n'),
			blank('//a\n\n(: c :)\n\n') + '1 +\r\n 2\n']);
		assert.strictEqual(XPathQuery.separateBlockAt(text, 5), XPathQuery.separateBlocks(text)[2]);
		// from a blank line: a new expression
		assert.strictEqual(XPathQuery.separateBlockAt(text, 1), blank(text));
	});

	test("a result in brief: the first node's path, or the values as literals, cut short", () => {
		const node = (path: string) => ({ kind: 'node' as const, nodeKind: 'attribute', path });
		assert.strictEqual(XPathQuery.resultSummary({ count: 3, items: [node('/orders/order[1]/@id'), node('/orders/order[2]/@id'), node('/orders/order[3]/@id')] }),
			'→ /orders/order[1]/@id  (1 of 3)');
		assert.strictEqual(XPathQuery.resultSummary({ count: 1, items: [node('/orders')] }), '→ /orders');
		assert.strictEqual(XPathQuery.resultSummary({ count: 0, items: [] }), '= ()  nothing found');
		assert.strictEqual(XPathQuery.resultSummary({ count: 1, items: [{ kind: 'atomic', type: 'decimal', value: '3' }] }), '= 3');
		assert.strictEqual(XPathQuery.resultSummary({ count: 3, items: [{ kind: 'atomic', type: 'string', value: "it's" },
			{ kind: 'atomic', type: 'boolean', value: 'true' }, { kind: 'atomic', type: 'untypedAtomic', value: 'pen' }] }), "= ('it''s', true(), 'pen')");
		const many = Array.from({ length: 20 }, (_, i) => ({ kind: 'atomic' as const, type: 'string', value: 'item' + i }));
		assert.strictEqual(XPathQuery.resultSummary({ count: 20, items: many }, 30), "= ('item0', 'item1', 'item2', '…  (20 items)");
	});

	test("a new query file's first expression: the root element - the only top-level symbol of the XML file's outline", async () => {
		const xml = '<?xml version="1.0"?>\n<?pi <b?>\n<!-- c -->\n<!DOCTYPE x:a [\n<!ENTITY logo "<img/>">\n]>\n<x:a xmlns:x="urn:x"><b/></x:a>\n<!-- after -->';
		const document = await vscode.workspace.openTextDocument({ content: xml, language: 'xml' });
		const symbols = await new XsltSymbolProvider(XMLConfiguration.configuration, null).getDocumentSymbols(document, false) ?? [];
		assert.deepEqual(symbols.map((symbol) => symbol.name), ['x:a']);
		assert.strictEqual(XPathQuery.seed('x:a'), '\n/x:a\n');
		assert.strictEqual(XPathQuery.seed(), '\n/*\n');
		// its ▶ Run on the blank line
		assert.deepEqual(XPathQuery.runPlaces(XPathQuery.seed('x:a')), [{ expressionLine: 1, onBlankLine: true }]);
	});

	test('the ▶ Run hover: the shortcut for this OS only', () => {
		assert.include(XPathQuery.runTooltip('darwin'), 'Cmd+Enter runs');
		assert.notInclude(XPathQuery.runTooltip('darwin'), 'Ctrl');
		assert.include(XPathQuery.runTooltip('win32'), 'Ctrl+Enter runs');
		assert.notInclude(XPathQuery.runTooltip('linux'), 'Cmd');
	});

	test("an XML file's cursor location: offered at the start of an expression, after comments only", () => {
		const text = '(: c :)\n/ord\n\n//a\n  /b\n\n  ';
		assert.strictEqual(XPathQuery.locationCompletionStart(text, 1, 4), 0);
		assert.strictEqual(XPathQuery.locationCompletionStart(text, 6, 2), 2);
		assert.isUndefined(XPathQuery.locationCompletionStart(text, 4, 4));
		assert.strictEqual(XPathQuery.locationCompletionStart(text, 3, 3), 0);
		assert.isUndefined(XPathQuery.locationCompletionStart('count(/', 0, 7));
	});

	test('a location added to the query file: after a blank line - or, if already there, as it is', () => {
		assert.deepEqual(XPathQuery.withExpression('(: c :)\n\n/a\n\n\n', '/a/b[2]'), { text: '(: c :)\n\n/a\n\n/a/b[2]\n', line: 4 });
		assert.deepEqual(XPathQuery.withExpression('/a/b[2]\n\n//c', '/a/b[2]'), { text: '/a/b[2]\n\n//c', line: 0 });
		assert.deepEqual(XPathQuery.withExpression('', '/a'), { text: '\n/a\n', line: 1 });
	});

	test("a text node: the nth run of text between its element's children, comments and processing instructions", async () => {
		const xml = '<p a=">">one <b>x</b> two<!-- c --> <![CDATA[<three>]]> <?pi?>\n  <i/>  four  </p>';
		const document = await vscode.workspace.openTextDocument({ content: xml, language: 'xml' });
		const symbols = await new XsltSymbolProvider(XMLConfiguration.configuration, null).getDocumentSymbols(document, false) ?? [];
		const text = (textIndex: number, positions = [1]) => {
			const range = XPathQuery.rangeOf({ kind: 'node', nodeKind: 'text', positions, textIndex }, symbols, document);
			return range ? document.getText(range) : '(none)';
		};
		assert.deepEqual([1, 2, 3, 4, 5].map((i) => text(i)), ['one', 'two', '<![CDATA[<three>]]>', '\n  ', 'four']);
		// in a child element
		assert.strictEqual(text(1, [1, 1]), 'x');
		// no such text node: the element's name - only, though its symbol's selection range goes on to its last child
		assert.strictEqual(text(6), 'p');
		assert.strictEqual(document.getText(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'element', positions: [1] }, symbols)), 'p');
	});

	test("a node's line in the References view: from a word's start before it, not the indentation, with the node highlighted", () => {
		const preview = (line: string, start: number, end: number, endLine = 0) => {
			const { label, highlight } = XPathQueryResults.preview(line, new vscode.Range(0, start, endLine, end));
			return label.substring(0, highlight[0]) + '[' + label.substring(highlight[0], highlight[1]) + ']' + label.substring(highlight[1]);
		};
		assert.strictEqual(preview('    <order id="A1">', 5, 10), '<[order] id="A1">');
		assert.strictEqual(preview('<orders><order id="A1" status="late">', 23, 29), 'id="A1" [status]="late">');
		// a text node going on to another line: highlighted to the end of its first
		assert.strictEqual(preview('  <p>one two', 5, 3, 1), '<p>[one two]');
	});

	test("the query file's group: a quarter of the height the XML file's group had", () => {
		// one group, split
		assert.deepEqual(XPathQuery.withQuarterBelow({ orientation: 1, groups: [{ size: 400 }, { size: 400 }] }, 1),
			{ orientation: 1, groups: [{ size: 600 }, { size: 200 }] });
		// the XML file in the second of two side by side: its column now two rows
		assert.deepEqual(XPathQuery.withQuarterBelow({ orientation: 0, groups: [{ size: 500 }, { size: 500, groups: [{ size: 400 }, { size: 400 }] }] }, 2),
			{ orientation: 0, groups: [{ size: 500 }, { size: 500, groups: [{ size: 600 }, { size: 200 }] }] });
		// not where it's expected: unchanged
		assert.isUndefined(XPathQuery.withQuarterBelow({ orientation: 1, groups: [{ size: 800 }] }, 1));
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
		// a text node: its element - or, with the document, its text
		assert.strictEqual(at(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'text', positions: [1, 1, 1] }, symbols)), '1:18');
		assert.strictEqual(text(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'text', positions: [1, 1, 1], textIndex: 1 }, symbols, document)), 'pen');
		assert.isUndefined(XPathQuery.rangeOf({ kind: 'node', nodeKind: 'element', positions: [1, 3] }, symbols));
	});
});
