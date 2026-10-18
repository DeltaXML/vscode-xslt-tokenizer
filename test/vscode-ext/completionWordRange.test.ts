/**
 * Test suite for the word pattern of the XSLT and XPath languages, and the text completions replace
 *
 * As in XPath, a word is a name including '-' and '.', with a prefix (a QName - but not across '::'), and an optional
 * leading '$' or '@'. A completion item without a range of its own is filtered by, and replaces, the word at the
 * cursor - so typing '$discount-th' and choosing '$discount-threshold' gives '$discount-threshold', not
 * '$discount-$discount-threshold'. An item whose label has no prefix, e.g. 'count' after 'fn:co', replaces only the
 * word's local part.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';

const stylesheet = `<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f"
		xmlns:map="http://www.w3.org/2005/xpath-functions/map" xmlns:math="http://www.w3.org/2005/xpath-functions/math">
  <xsl:param name="discount-threshold" select="20"/>
  <xsl:variable name="discount" select="1"/>
  <xsl:template match="/">
    <xsl:value-of select="CURSOR"/>
  </xsl:template>
  <xsl:function name="f:line-total"><xsl:param name="x"/><xsl:sequence select="$x"/></xsl:function>
</xsl:stylesheet>`;

// the line after typing 'typed' at CURSOR and accepting the first completion item whose label starts with 'label'
async function accept(language: string, content: string, typed: string, label: string): Promise<string> {
	const doc = await vscode.workspace.openTextDocument({ language, content: content.replace('CURSOR', typed) });
	await vscode.window.showTextDocument(doc);
	const line = content.split('\n').findIndex((l) => l.includes('CURSOR'));
	const position = new vscode.Position(line, doc.lineAt(line).text.indexOf(typed) + typed.length);
	try {
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, position);
		const labelOf = (item: vscode.CompletionItem) => typeof item.label === 'string' ? item.label : item.label.label;
		const item = list.items.find((i) => labelOf(i).startsWith(label));
		if (!item) {
			return `(no '${label}' item)`;
		}
		// as VS Code: the item's range, else the word at the position, up to the position
		const word = doc.getWordRangeAtPosition(position);
		const range = item.range instanceof vscode.Range ? item.range : item.range ? item.range.inserting : word ? new vscode.Range(word.start, position) : new vscode.Range(position, position);
		// VS Code only shows an item matching the text it replaces
		const filterText = doc.getText(range).toLowerCase();
		if (!(item.filterText ?? labelOf(item)).toLowerCase().includes(filterText)) {
			return `('${labelOf(item)}' hidden by '${filterText}')`;
		}
		const insert = typeof item.insertText === 'string' ? item.insertText : item.insertText ? item.insertText.value.replace(/\$\{?\d+\}?/g, '') : labelOf(item);
		const text = doc.lineAt(line).text;
		return (text.substring(0, range.start.character) + insert + text.substring(range.end.character)).trim();
	} finally {
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	}
}

suite('Completion - word pattern and replaced text', function () {
	this.timeout(30000);

	test('words are XPath names: with - . and a prefix, not across ::', async () => {
		const doc = await vscode.workspace.openTextDocument({ language: 'xslt', content: '$discount-threshold xsl:value-of child::para @n-1 a.b f:line-total($x) -1.5' });
		await vscode.window.showTextDocument(doc);
		const word = (offset: number) => doc.getText(doc.getWordRangeAtPosition(doc.positionAt(offset)));
		// the language's word pattern reaches the extension host asynchronously, once a document of the language is open
		for (let wait = 0; wait < 20 && word(1) !== '$discount-threshold'; wait++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const at = (text: string) => word(doc.getText().indexOf(text) + 1);
		assert.strictEqual(at('discount'), '$discount-threshold');
		assert.strictEqual(at('threshold'), '$discount-threshold');
		assert.strictEqual(at('value-of'), 'xsl:value-of');
		assert.strictEqual(at('child'), 'child');
		assert.strictEqual(at('para'), 'para');
		assert.strictEqual(at('@n-1'), '@n-1');
		assert.strictEqual(at('a.b'), 'a.b');
		assert.strictEqual(at('line-total'), 'f:line-total');
		assert.strictEqual(at('-1.5'), '-1.5');
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	const xsltCases: [string, string, string][] = [
		['$discount-th', '$discount-threshold', '<xsl:value-of select="$discount-threshold"/>'],
		['count($discount-th', '$discount-threshold', '<xsl:value-of select="count($discount-threshold"/>'],
		['f:line-', 'f:line-total', '<xsl:value-of select="f:line-total()"/>'],
		['map:ke', 'map:keys', '<xsl:value-of select="map:keys()"/>'],
		['xs:inte', 'xs:integer', '<xsl:value-of select="xs:integer()"/>'],
		['string-j', 'string-join', '<xsl:value-of select="string-join()"/>'],
		['fn:co', 'count', '<xsl:value-of select="fn:count()"/>'],
		['fn:string-j', 'string-join', '<xsl:value-of select="fn:string-join()"/>'],
	];
	for (const [typed, label, expected] of xsltCases) {
		test(`XSLT: '${typed}', then '${label}'`, async () => {
			assert.strictEqual(await accept('xslt', stylesheet, typed, label), expected);
		});
	}

	const xpathCases: [string, string, string][] = [
		['string-j', 'string-join', 'string-join()'],
		['map:ke', 'map:keys', 'map:keys()'],
		['fn:co', 'count', 'fn:count()'],
	];
	for (const [typed, label, expected] of xpathCases) {
		test(`XPath: '${typed}', then '${label}'`, async () => {
			assert.strictEqual(await accept('xpath', 'CURSOR', typed, label), expected);
		});
	}
});
