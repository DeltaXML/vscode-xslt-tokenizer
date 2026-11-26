/**
 * Test suite for completion in an XML file without a schema (and without Red Hat's XML extension, which the tests don't
 * have): the names the document uses. After '<', the children of elements with the parent's name, inserted with the
 * attributes they always have, and empty if they always are; in a start tag, the attributes elements with its name have,
 * and xmlns:xsi on the root, the xsi: attributes once it's declared, and xml:lang, xml:space and xml:base; in a value,
 * the values the attribute has elsewhere, when they repeat. No general snippets.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { revertAndCloseEditorsIn } from './testEditors';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xml-completions-'));
let fileCount = 0;

const orders = `<orders>
  <order id="1" status="open">
    <item>1</item>
    <note>first</note>
    <line/>
  </order>
  <order id="2" status="closed">
    <item>2</item>
    <line/>
  </order>
  <order id="3" status="open">
    MARK
  </order>
</orders>
`;

// the items at '|' in the text - with MARK in orders replaced by it
async function completions(text: string, trigger?: string) {
	const file = path.join(folder, `${++fileCount}.xml`);
	fs.writeFileSync(file, text.replace('|', ''));
	const document = await vscode.workspace.openTextDocument(file);
	assert.strictEqual(document.languageId, 'xml');
	const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(text.indexOf('|')), trigger);
	// not VS Code's suggestions of the words in the document, which it shows when no provider has any
	return list.items.filter((item) => item.kind !== vscode.CompletionItemKind.Text);
}

const labels = (items: vscode.CompletionItem[]) => items.map((i) => typeof i.label === 'string' ? i.label : i.label.label);
const insert = (items: vscode.CompletionItem[], label: string) => {
	const item = items.find((i) => (typeof i.label === 'string' ? i.label : i.label.label) === label);
	return item?.insertText instanceof vscode.SnippetString ? item.insertText.value : item?.insertText;
};

suite('XML completion without a schema: the names the document uses', () => {
	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	suiteTeardown(async () => {
		await revertAndCloseEditorsIn(folder);
	});

	test('after <: the children of other elements with the parent\'s name, in the order first seen - no general snippets', async () => {
		const items = await completions(orders.replace('MARK', '<|'), '<');
		assert.deepEqual(labels(items).slice(0, 3), ['item', 'note', 'line']);
		assert.notInclude(labels(items), 'block-start-end-tag');
		assert.match(items[0].detail ?? '', /^element - in order: 2 of 3/);
	});

	test('inserted with an end tag - or empty, if it always is - and with the attributes it always has', async () => {
		const items = await completions(orders.replace('MARK', '<|'), '<');
		assert.strictEqual(insert(items, 'item'), 'item>$0</item>');
		assert.strictEqual(insert(items, 'line'), 'line/>$0');
		const inRoot = await completions(orders.replace('  <order id="3" status="open">\n    MARK\n  </order>', '  <|'), '<');
		assert.strictEqual(insert(inRoot, 'order'), 'order id="${1}" status="${2}">$0</order>');
	});

	test('a tag that goes on after the name: only the name is replaced', async () => {
		const items = await completions(orders.replace('MARK', '<ite|m>3</item>'));
		const item = items.find((i) => labels([i])[0] === 'item')!;
		// no snippet: the name - which VS Code gives as the text to insert
		assert.strictEqual(item.insertText, 'item');
		assert.strictEqual((item.range as vscode.Range).end.character - (item.range as vscode.Range).start.character, 'item'.length);
	});

	test('a start tag: the attributes of other elements with its name, not those it has - and the xml: attributes', async () => {
		const items = await completions(orders.replace('MARK', '<order status="open" |'));
		assert.deepEqual(labels(items), ['id', 'xml:lang', 'xml:space', 'xml:base']);
		assert.strictEqual(insert(items, 'id'), 'id="$1"$0');
		assert.match(items[0].detail ?? '', /^attribute - on 3 of 3 order/);
	});

	test('the root: xmlns:xsi - and, once declared, the xsi: attributes, as Red Hat\'s XML extension isn\'t installed', async () => {
		assert.include(labels(await completions('<orders |>\n  <order/>\n</orders>\n')), 'xmlns:xsi');
		assert.strictEqual(insert(await completions('<orders |>\n</orders>\n'), 'xmlns:xsi'), 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"$0');
		const declared = labels(await completions('<orders xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" |>\n</orders>\n'));
		assert.includeMembers(declared, ['xsi:noNamespaceSchemaLocation', 'xsi:schemaLocation', 'xsi:type', 'xsi:nil']);
		assert.notInclude(declared, 'xmlns:xsi');
		assert.notInclude(labels(await completions(orders.replace('MARK', '<order |'))), 'xmlns:xsi');
	});

	test('a value: those the attribute has elsewhere, the most used first - not when each is different, e.g. an id', async () => {
		const status = await completions(orders.replace('MARK', '<order status="|"/>'), '"');
		assert.deepEqual(labels(status), ['open', 'closed']);
		assert.isEmpty(await completions(orders.replace('MARK', '<order id="|"/>'), '"'));
		assert.deepEqual(labels(await completions(orders.replace('MARK', '<note xml:space="|"/>'), '"')), ['preserve', 'default']);
	});

	test('nothing in text, a comment or an end tag - nor in an empty file', async () => {
		assert.isEmpty(await completions(orders.replace('MARK', 'some |text')));
		assert.isEmpty(await completions(orders.replace('MARK', '<!-- <|')));
		assert.isEmpty(await completions(orders.replace('MARK', '</|')));
		assert.isEmpty(await completions('<|', '<'));
	});

	test('a new element\'s content: every element name but the root\'s and its own', async () => {
		const items = await completions(orders.replace('MARK', '<extra><|</extra>'), '<');
		assert.includeMembers(labels(items), ['order', 'item', 'note', 'line']);
		assert.notInclude(labels(items), 'orders');
		assert.notInclude(labels(items), 'extra');
	});

	test('after <!: a comment - and within the root element, a CDATA section', async () => {
		const inRoot = await completions(orders.replace('MARK', '<!|'), '!');
		assert.deepEqual(labels(inRoot), ['<!-- -->', '<![CDATA[]]>']);
		assert.strictEqual(insert(inRoot, '<!-- -->'), '-- ${1} -->${0}');
		assert.deepEqual(labels(await completions('<!|\n<orders/>\n', '!')), ['<!-- -->']);
	});

	test('after <?: a processing instruction - and before the root, the XML declaration at the start, and an xml-model for a Schematron schema', async () => {
		assert.deepEqual(labels(await completions('<?|\n<orders/>\n', '?')),
			['<?xml version="1.0" encoding="UTF-8"?>', '<?xml-model href="…" ?> (Schematron)', '<?name value?>', '<?name?>']);
		assert.deepEqual(labels(await completions('<?xml version="1.0"?>\n<?|\n<orders/>\n', '?')),
			['<?xml-model href="…" ?> (Schematron)', '<?name value?>', '<?name?>']);
		assert.deepEqual(labels(await completions(orders.replace('MARK', '<?|'), '?')), ['<?name value?>', '<?name?>']);
		const model = await completions('<?|\n<orders/>\n', '?');
		assert.strictEqual(insert(model, '<?xml-model href="…" ?> (Schematron)'), 'xml-model href="${1:rules.sch}" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>${0}');
	});

	test('not within a comment', async () => {
		assert.isEmpty(await completions(orders.replace('MARK', '<!-- <!| -->'), '!'));
	});
});
