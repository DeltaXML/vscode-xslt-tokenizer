/**
 * Test suite for the trace code actions: 'Wrap with xdm:trace()' and 'Wrap with trace()' for a selected XPath
 * expression - with the expression as the label - and 'Remove ...() - keep the expression', which unwraps the
 * expression from a trace(), fn:trace() or xdm:trace() call whose name is at the cursor, in brackets only where it
 * needs them to keep its meaning
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { TraceActions } from '../../src/traceActions';

// the expression after removing the trace call whose name starts at '¦'
function removed(xpath: string) {
	const offset = xpath.indexOf('¦');
	const text = xpath.replace('¦', '');
	const call = TraceActions.traceCallAt(text, offset);
	assert.exists(call, xpath);
	return text.substring(0, call!.start) + TraceActions.unwrapped(text, call!) + text.substring(call!.end);
}

const wrapped = (selection: string, functionName = 'xdm:trace', quote = '"') => {
	const { prefix, label, suffix } = TraceActions.wrapSnippet(selection, functionName, quote);
	return prefix + label + suffix;
};

suite('Trace code actions', () => {
	test('wrap: the expression as the label, in the quote the attribute does not use', () => {
		assert.strictEqual(wrapped('$total'), "xdm:trace($total, '$total')");
		assert.strictEqual(wrapped('sum($x)', 'trace'), "trace(sum($x), 'sum($x)')");
		assert.strictEqual(wrapped("concat('a', $b)", 'xdm:trace', "'"), 'xdm:trace(concat(\'a\', $b), "concat(\'a\', $b)")');
		// a quote in the label is doubled
		assert.strictEqual(wrapped("$m?('a b')"), "xdm:trace($m?('a b'), '$m?(''a b'')')");
	});

	test('wrap: a sequence of expressions in brackets; a long label shortened, on one line', () => {
		assert.strictEqual(wrapped('1, 2'), "xdm:trace((1, 2), '1, 2')");
		const long = 'for $line in $order/line\n  return $line/@qty * $line/@price';
		assert.strictEqual(wrapped(long), `xdm:trace(${long}, 'for $line in $order/line return $line/@…')`);
	});

	test('remove: the expression traced, for each trace function, with or without a label', () => {
		assert.strictEqual(removed('sum(¦xdm:trace($x, \'x\'))'), 'sum($x)');
		assert.strictEqual(removed('sum(¦trace($x))'), 'sum($x)');
		assert.strictEqual(removed('¦fn:trace($a/b[1], "b")'), '$a/b[1]');
		// with the cursor within the name
		assert.strictEqual(removed('xdm:tr¦ace($x, \'x\', false()) + 1'), '$x + 1');
	});

	test('remove: an operator expression keeps brackets, unless it stands alone', () => {
		assert.strictEqual(removed('¦xdm:trace(1 + 2, \'x\') * 2'), '(1 + 2) * 2');
		assert.strictEqual(removed('count(¦trace($a | $b, \'x\'))'), 'count($a | $b)');
		assert.strictEqual(removed('¦trace(for $i in 1 to 3 return $i, \'i\')'), 'for $i in 1 to 3 return $i');
		assert.strictEqual(removed('$n &lt; ¦trace($m - 1, \'m\')'), '$n &lt; ($m - 1)');
	});

	test('remove: commas and brackets in strings, nested calls and comments are not the argument\'s end', () => {
		assert.strictEqual(removed('¦xdm:trace(concat(\'a, b\', \')\'), \'c\')'), 'concat(\'a, b\', \')\')');
		assert.strictEqual(removed('¦trace(f((: a, b :) $x), \'f\')'), 'f((: a, b :) $x)');
	});

	test('not a trace call: another function, a variable named trace, or no brackets', () => {
		assert.isUndefined(TraceActions.traceCallAt('my:trace($x)', 1));
		assert.isUndefined(TraceActions.traceCallAt('$trace', 2));
		assert.isUndefined(TraceActions.traceCallAt('trace', 2));
	});

	const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template match="/">
    <xsl:variable name="total" select="1"/>
    <xsl:sequence select="sum((2, $total))"/>
    <xsl:sequence select="count(xdm:trace($total, 'total'))"/>
  </xsl:template>
</xsl:stylesheet>`;

	async function actions(start: number, end: number) {
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		await new XsltSymbolProvider(XSLTConfiguration.configuration, null).getDocumentSymbols(document, false);
		const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
		return (new XSLTCodeActions().provideCodeActions(document, range, { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? []);
	}

	test('offered for a selected expression - a single variable too', async () => {
		const start = content.indexOf('$total))');
		const titles = (await actions(start, start + '$total'.length)).map((a) => a.title);
		assert.includeMembers(titles, ['Wrap with xdm:trace()', 'Wrap with trace()']);
		// not for part of a name
		const partTitles = (await actions(start + 1, start + 4)).map((a) => a.title);
		assert.notInclude(partTitles, 'Wrap with trace()');
	});

	test('offered at the name of a trace call - its edit leaves the expression', async () => {
		const start = content.indexOf('xdm:trace') + 2;
		const action = (await actions(start, start)).find((a) => a.title === 'Remove xdm:trace() - keep the expression');
		assert.exists(action);
		const [[, edits]] = action!.edit!.entries();
		assert.strictEqual(edits[0].newText, '$total');
	});
});
