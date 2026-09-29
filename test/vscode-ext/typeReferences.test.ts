/**
 * Test suite for XPath 4.0 types in attribute values with quotes written as references, e.g.
 * as="enum(&quot;it's&quot;, 'is')" or as="record(&quot;nick name&quot; as xs:string)" - Saxon 13 replaces the references
 * before parsing the type, so the extension does too: for the values of an enumeration type, the fields of a record type,
 * and the hover, while go to definition and rename use the offsets of the text as written. Character references, e.g.
 * &#39;, are replaced in types too - though the XPath lexer doesn't yet treat them as quotes elsewhere in an attribute.
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';
import { RecordTypes } from '../../src/recordTypes';

const declarations = `<xsl:item-type name="cx:word" as="enum(&quot;it's&quot;, 'is', &quot;a, b&quot;)"/>
  <xsl:item-type name="cx:person" as="record(&quot;nick name&quot; as xs:string, mood as enum(&apos;glad&apos;, &apos;sad&apos;), age as xs:integer)"/>`;

function stylesheet(body: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">
  ${declarations}
  ${body}
</xsl:stylesheet>`;
}

// the document, with the linter's diagnostics - and so its record field references, for hover and rename
async function analyse(marked: string) {
	const offset = marked.indexOf('¦');
	const text = marked.replace('¦', '');
	const document = await vscode.workspace.openTextDocument({ content: text, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, xslLexer.analyse(text), xslLexer.globalInstructionData, [], []);
	return { document, position: document.positionAt(offset), diagnostics };
}

const lint = async (body: string) => (await analyse(stylesheet(body))).diagnostics.filter((d) => d.message !== 'variable is unused').map((d) => d.message);

async function hoverText(body: string) {
	const { document, position } = await analyse(stylesheet(body));
	const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
	return (hover?.contents as vscode.MarkdownString[] | undefined)?.map((c) => c.value).join('\n');
}

const call = (select: string) => `<xsl:template name="t"><xsl:sequence select="${select}"/></xsl:template>`;
const person = `<xsl:variable name="p" as="cx:person" select="{ 'nick name': 'Al', 'mood': 'glad', 'age': 3 }"/>`;

suite('Types with quotes written as references', () => {
	test('hover: the values of an enumeration type, and the type with the references replaced', async () => {
		const text = await hoverText(`<xsl:variable name="w" as="cx:w¦ord" select="'is'"/>`);
		assert.include(text, `type cx:word as enum("it's", 'is', "a, b")`);
		assert.include(text, `Values: \`"it's"\`, \`'is'\`, \`'a, b'\``);
	});

	test('linter: a value that is not one of the values', async () => {
		assert.deepEqual(await lint(`<xsl:variable name="w" as="cx:word" select="'nope'"/>`), [
			`XPath: 'nope' is not one of the values of the enumeration type: cx:word`
		]);
	});

	test('linter: values of the enumeration type', async () => {
		assert.deepEqual(await lint(`<xsl:variable name="w" as="cx:word" select="'is'"/><xsl:variable name="w2" as="cx:word" select="'a, b'"/>`), []);
	});

	test('linter: the fields of a record type with a quoted name', async () => {
		assert.deepEqual(await lint(person), []);
		const messages = await lint(`<xsl:variable name="p" as="cx:person" select="{ 'nick nam': 'Al', 'mood': 'glad', 'age': 3 }"/>`);
		assert.isTrue(messages.some((m) => m.includes(`'nick nam'`)), messages.join('\n'));
	});

	test('linter: a field with an enumeration type after a quoted name', async () => {
		const messages = await lint(`<xsl:variable name="p" as="cx:person" select="{ 'nick name': 'Al', 'mood': 'cross', 'age': 3 }"/>`);
		assert.isTrue(messages.some((m) => m.startsWith(`XPath: 'cross' is not one of the values`)), messages.join('\n'));
	});

	test('hover: a field with an enumeration type written with references', async () => {
		const text = await hoverText(`${person}\n  ${call('$p?mo¦od')}`);
		assert.include(text, `mood as enum('glad', 'sad')`);
		assert.include(text, "Values: `'glad'`, `'sad'`");
	});

	test('go to definition: a field after one with a quoted name', async () => {
		const { document, position } = await analyse(stylesheet(`${person}\n  ${call('$p?a¦ge')}`));
		const location = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideDefinition(document, position, new vscode.CancellationTokenSource().token);
		assert.isDefined(location);
		assert.equal(document.getText(location!.range), 'age');
	});

	test('rename: a field with a quoted name, keeping its references', async () => {
		const { document, position } = await analyse(stylesheet(`${person}\n  ${call(`$p?'nick¦ name'`)}`));
		const provider = new XSLTReferenceProvider();
		const token = new vscode.CancellationTokenSource().token;
		assert.isDefined(await provider.prepareRename(document, position, token));
		const edit = await provider.provideRenameEdits(document, position, 'alias', token);
		assert.isTrue(await vscode.workspace.applyEdit(edit!));
		const text = document.getText();
		assert.include(text, `as="record(&quot;alias&quot; as xs:string, mood as enum(&apos;glad&apos;, &apos;sad&apos;), age as xs:integer)"`);
		assert.include(text, `{ 'alias': 'Al', 'mood': 'glad', 'age': 3 }`);
		assert.include(text, `select="$p?'alias'"`);
	});
	test('types with character references for quotes', () => {
		assert.deepEqual(RecordTypes.resolveEnum(`enum(&#39;a&#39;, &#x22;b, c&#x22;, &quot;d&apos;s&quot;)`, new Map()), ['a', 'b, c', "d's"]);
		const record = RecordTypes.resolve(`record(&#34;nick name&#34; as xs:string, age as xs:integer)`, new Map(), 0, 100);
		assert.deepEqual(record?.fields.map((f) => [f.name, f.nameOffset, f.type]), [['nick name', 112, 'xs:string'], ['age', 141, 'xs:integer']]);
	});
});
