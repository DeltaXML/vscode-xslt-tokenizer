/**
 * Test suite for XPath 4.0 keyword argument completions: at the start of a function call argument, an item
 * 'name := ' for each parameter of the called function not already supplied, by position or keyword - for
 * user-defined functions and built-in functions. After a keyword argument, only keyword arguments are offered, as a
 * positional argument can't follow one. None in XSLT 3.0, or for the value of a keyword argument.
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';

async function completions(expression: string, version = '4.0', commaTrigger = false) {
	const marked = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:ex="ex" version="${version}">
  <xsl:function name="ex:greeting" as="xs:string">
    <xsl:note format="xdoc-md">
      @param $name the person's name
    </xsl:note>
    <xsl:param name="name" as="xs:string"/>
    <xsl:param name="greeting" as="xs:string" required="no" select="'Hello'"/>
    <xsl:param name="punctuation" as="xs:string" required="no" select="'!'"/>
    <xsl:sequence select="$greeting || ', ' || $name || $punctuation"/>
  </xsl:function>
  <xsl:template match="/">
    <xsl:sequence select="${expression}"/>
  </xsl:template>
</xsl:stylesheet>`;
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	if (commaTrigger) {
		DocumentChangeHandler.setCommaTrigger(document, offset);
	}
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, document.positionAt(offset), new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	return Array.isArray(result) ? result : result?.items ?? [];
}

const labels = async (expression: string, version?: string, commaTrigger?: boolean) =>
	(await completions(expression, version, commaTrigger)).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
const keywordLabels = async (expression: string, version?: string, commaTrigger?: boolean) =>
	(await labels(expression, version, commaTrigger)).filter((label) => label.endsWith(' :='));

suite('Keyword argument completions', () => {
	test('each parameter, at the first argument', async () => {
		assert.deepEqual(await keywordLabels('ex:greeting(¦'), ['name :=', 'greeting :=', 'punctuation :=']);
	});

	test('each parameter, within an empty argument list', async () => {
		assert.deepEqual(await keywordLabels('ex:greeting(¦)'), ['name :=', 'greeting :=', 'punctuation :=']);
	});

	test('the parameters not supplied by position', async () => {
		assert.deepEqual(await keywordLabels("ex:greeting('Ann', ¦"), ['greeting :=', 'punctuation :=']);
	});

	test('with other completions, before a keyword argument', async () => {
		const items = await labels("ex:greeting('Ann', ¦");
		assert.includeMembers(items, ['greeting :=', 'count']);
	});

	test('not the first parameter, for an arrow operator', async () => {
		assert.deepEqual(await keywordLabels("'Ann' => ex:greeting(¦"), ['greeting :=', 'punctuation :=']);
	});

	test('a partly typed name', async () => {
		const items = await completions("ex:greeting('Ann', gre¦");
		const item = items.find((i) => i.label === 'greeting :=');
		assert.isDefined(item);
		assert.equal(item!.insertText, 'greeting := ');
		assert.equal(item!.filterText, 'greeting');
		assert.equal(item!.detail, 'xs:string');
	});

	test('only keyword arguments, after a keyword argument', async () => {
		assert.deepEqual(await labels("ex:greeting('Ann', punctuation := '?', ¦"), ['greeting :=']);
	});

	test('not a parameter supplied by keyword after the cursor', async () => {
		assert.deepEqual(await keywordLabels("ex:greeting('Ann', ¦, punctuation := '?')"), ['greeting :=']);
	});

	test('the @param text of a documentation note', async () => {
		const item = (await completions('ex:greeting(¦')).find((i) => i.label === 'name :=');
		assert.equal((item!.documentation as vscode.MarkdownString).value, "the person's name");
	});

	test('a built-in function', async () => {
		assert.deepEqual(await keywordLabels('format-number(1234.5, ¦'), ['picture :=', 'options :=']);
	});

	test('the innermost call', async () => {
		assert.deepEqual(await keywordLabels("ex:greeting(string-join(('a', 'b'), ¦"), ['separator :=']);
	});

	test('after a comma typed in the argument list', async () => {
		assert.deepEqual(await labels("ex:greeting('Ann', ¦", '4.0', true), ['greeting :=', 'punctuation :=']);
	});

	test('none for the value of a keyword argument', async () => {
		assert.deepEqual(await keywordLabels('ex:greeting(greeting := ¦'), []);
	});

	test('none in XSLT 3.0', async () => {
		assert.deepEqual(await keywordLabels('ex:greeting(¦', '3.0'), []);
	});
});
