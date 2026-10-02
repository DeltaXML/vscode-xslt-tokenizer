/**
 * Test suite for references in XSLT 4.0 documentation notes - an xsl:note with format="xdoc-md" - to declarations
 * outside the note, as the first word of an @see tag's text, or as a Markdown code span: my:area#2, my:area(),
 * my:area (a function, item type or template), $name (a parameter of the documented function or template, or a global
 * variable or parameter) and 'template name':
 * - go to definition and hover, as for a use of the declaration - and for a built-in function, its signature
 * - find references and rename of the declaration include them
 * - the linter reports an @see that refers to nothing - but not other text, a built-in function or type, or a code span
 * - the reference after @see is highlighted as code
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
import { XdocNotes } from '../../src/xdocNote';
import { XsltSemanticTokensProvider } from '../../src/extension';

function stylesheet(note: string) {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="4.0">
  <xsl:param name="gscale" as="xs:double" select="1"/>
  <xsl:item-type name="cx:point" as="record(x as xs:double, y as xs:double)"/>
  <xsl:function name="cx:area" as="xs:double">
    <xsl:note format="xdoc-md">
      Returns the area of a shape.

      @param $shape the shape
      @param $scale the scale factor
    </xsl:note>
    <xsl:param name="shape"/>
    <xsl:param name="scale"/>
    <xsl:sequence select="1"/>
  </xsl:function>
  <xsl:function name="cx:scaled">
    <xsl:param name="value"/>
    <xsl:param name="factor" required="no" select="1"/>
    <xsl:sequence select="$value * $factor"/>
  </xsl:function>
  <xsl:template name="draw">
    <xsl:note format="xdoc-md">
      ${note}

      @param $colour the fill colour
    </xsl:note>
    <xsl:param name="colour"/>
    <xsl:sequence select="cx:area(1, 2)"/>
  </xsl:template>
</xsl:stylesheet>`;
}

async function open(marked: string) {
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	return { document, position: document.positionAt(offset) };
}

const cancel = () => new vscode.CancellationTokenSource().token;

// the text of the line of the definition
async function definitionLine(note: string) {
	const { document, position } = await open(stylesheet(note));
	const location = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideDefinition(document, position, cancel());
	return location ? { line: document.lineAt(location.range.start.line).text.trim(), name: document.getText(location.range) } : undefined;
}

async function hoverText(note: string) {
	const { document, position } = await open(stylesheet(note));
	const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, cancel());
	return (hover?.contents as vscode.MarkdownString[] | undefined)?.map((c) => c.value).join('\n');
}

async function lint(note: string) {
	const xslt = stylesheet(note);
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
}

// the trimmed lines of the stylesheet after renaming the symbol at the cursor
async function rename(note: string, newName: string) {
	const { document, position } = await open(stylesheet(note));
	const provider = new XSLTReferenceProvider();
	await provider.prepareRename(document, position, cancel());
	const edit = await provider.provideRenameEdits(document, position, newName, cancel());
	assert.isTrue(await vscode.workspace.applyEdit(edit!));
	return document.getText().split('\n').map((line) => line.trim());
}

async function completions(note: string) {
	const { document, position } = await open(stylesheet(note));
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, cancel(), { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	return Array.isArray(result) ? result : result?.items ?? [];
}

suite('Documentation notes: references', () => {
	test('definition: a function with an arity, after @see', async () => {
		assert.deepEqual(await definitionLine('@see cx:ar¦ea#2'), { line: '<xsl:function name="cx:area" as="xs:double">', name: 'cx:area' });
	});

	test('definition: an unprefixed template name, after @see', async () => {
		assert.deepEqual(await definitionLine('@see dr¦aw for drawing'), { line: '<xsl:template name="draw">', name: 'draw' });
	});

	test('definition: code spans for a function, an item type, a template and a global parameter', async () => {
		assert.equal((await definitionLine('Uses `cx:ar¦ea()`.'))?.name, 'cx:area');
		assert.equal((await definitionLine('Takes a `cx:poi¦nt`.'))?.name, 'cx:point');
		assert.equal((await definitionLine('Like `template dr¦aw`.'))?.name, 'draw');
		assert.equal((await definitionLine('Scaled by `$gsc¦ale`.'))?.name, 'gscale');
	});

	test('definition: a parameter of the documented template, in a code span', async () => {
		assert.deepEqual(await definitionLine('Fills with `$col¦our`.'), { line: '<xsl:param name="colour"/>', name: 'colour' });
	});

	test('definition: not an unprefixed name in a code span, or a function with another arity', async () => {
		assert.isUndefined(await definitionLine('In `c¦m`.'));
		assert.isUndefined(await definitionLine('@see cx:ar¦ea#3'));
	});

	test('hover: as for a use of the declaration', async () => {
		const fn = await hoverText('@see cx:ar¦ea#2');
		assert.include(fn, 'cx:area($shape, $scale) as xs:double');
		assert.include(fn, 'Returns the area of a shape.');
		assert.include(await hoverText('Takes a `cx:poi¦nt`.'), 'type cx:point as record(x as xs:double, y as xs:double)');
		assert.include(await hoverText('Scaled by `$gsc¦ale`.'), 'Global parameter, declared in this stylesheet');
		const param = await hoverText('Fills with `$col¦our`.');
		assert.include(param, 'the fill colour');
		assert.include(param, 'Parameter of the template: `draw`');
	});

	test('hover: a built-in function', async () => {
		assert.include(await hoverText('@see fn:s¦um#1'), 'sum(');
	});

	test('find references of a function include the notes', async () => {
		const { document } = await open(stylesheet('@see cx:area#2 and `cx:area`'));
		const position = document.positionAt(document.getText().indexOf('name="cx:area"') + 8);
		const locations = await new XSLTReferenceProvider().provideReferences(document, position, { includeDeclaration: true }, cancel());
		const lines = (locations ?? []).map((l) => document.lineAt(l.range.start.line).text.trim()).sort();
		assert.deepEqual(lines, ['<xsl:function name="cx:area" as="xs:double">', '<xsl:sequence select="cx:area(1, 2)"/>', '@see cx:area#2 and `cx:area`', '@see cx:area#2 and `cx:area`']);
	});

	test('rename a function from a reference in a note', async () => {
		const lines = await rename('@see cx:ar¦ea#2 and `cx:area()`', 'cx:size');
		assert.include(lines, '<xsl:function name="cx:size" as="xs:double">');
		assert.include(lines, '<xsl:sequence select="cx:size(1, 2)"/>');
		assert.include(lines, '@see cx:size#2 and `cx:size()`');
	});

	test('rename a parameter from a reference in its note', async () => {
		const lines = await rename('Fills with `$col¦our`.', 'fill');
		assert.include(lines, '<xsl:param name="fill"/>');
		assert.include(lines, '@param $fill the fill colour');
		assert.include(lines, 'Fills with `$fill`.');
	});

	test('lint: an @see that refers to nothing', async () => {
		assert.deepEqual(await lint('@see cx:aera#2'), [["XSLT: The documentation note's @see 'cx:aera#2' is not a function with 2 arguments declared in this stylesheet or the modules it includes or imports", 'cx:aera#2']]);
		assert.deepEqual(await lint('@see $nope'), [["XSLT: The documentation note's @see '$nope' is not a parameter or global variable declared in this stylesheet or the modules it includes or imports", '$nope']]);
		assert.deepEqual(await lint('@see template cx:nothing'), [["XSLT: The documentation note's @see 'template cx:nothing' is not a named template declared in this stylesheet or the modules it includes or imports", 'template cx:nothing']]);
	});

	test('lint: not other text, built-ins, undeclared prefixes or code spans', async () => {
		for (const note of ['@see https://example.com', '@see the specification', '@see xs:string', '@see fn:sum#1', '@see sum#1', '@see urn:isbn', 'Uses `cx:nothing` and `$nope`.', '@see cx:area#2.', '@see `cx:area#2`']) {
			assert.deepEqual(await lint(note), [], note);
		}
	});

	test('completions: after @see, the declarations - functions by arity, and a template by its name alone', async () => {
		const items = await completions('@see ¦');
		assert.deepEqual(items.map((item) => item.label), ['$colour', '$gscale', 'cx:area#2', 'cx:scaled#1', 'cx:scaled#2', 'cx:point', 'draw']);
		const area = items.find((item) => item.label === 'cx:area#2')!;
		assert.equal(area.detail, 'cx:area($shape, $scale) as xs:double');
		assert.include((area.documentation as vscode.MarkdownString).value, 'Returns the area of a shape.');
		assert.equal(items.find((item) => item.label === 'cx:scaled#1')!.detail, 'cx:scaled($value)');
	});

	test('completions: after @see, replacing the name being typed', async () => {
		const { document, position } = await open(stylesheet('@see cx:ar¦'));
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, cancel(), { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const item = (Array.isArray(result) ? result : result?.items ?? []).find((i) => i.label === 'cx:area#2')!;
		assert.equal(document.getText(item.range as vscode.Range), 'cx:ar');
		assert.equal(item.insertText, 'cx:area#2');
	});

	test('completions: in a code span, template names with template, and the closing backtick', async () => {
		const items = await completions('Uses `¦');
		assert.deepEqual(items.map((item) => item.label), ['$colour', '$gscale', 'cx:area#2', 'cx:scaled#1', 'cx:scaled#2', 'cx:point', 'template draw']);
		assert.equal(items.find((item) => item.label === 'cx:area#2')!.insertText, 'cx:area#2`');
		assert.equal((await completions('Uses `cx¦`')).find((item) => item.label === 'cx:area#2')!.insertText, 'cx:area#2');
	});

	test('completions: not after a closed code span, or later in an @see', async () => {
		assert.deepEqual((await completions('Uses `cx:area` and ¦')).map((item) => item.label), []);
		assert.deepEqual((await completions('@see cx:area#2 and ¦')).map((item) => item.label), []);
	});

	test('highlighting: the reference after @see is code', async () => {
		const legend = XslLexer.getTextmateTypeLegend().concat(XdocNotes.tokenTypes);
		const { document } = await open(stylesheet('@see cx:area#2 for the area\n      @see the specification'));
		const result = await new XsltSemanticTokensProvider(XSLTConfiguration.configuration).provideDocumentSemanticTokens(document, cancel());
		const tokens: string[][] = [];
		let line = 0;
		let character = 0;
		for (let i = 0; i < result.data.length; i += 5) {
			line += result.data[i];
			character = result.data[i] === 0 ? character + result.data[i + 1] : result.data[i + 1];
			tokens.push([document.lineAt(line).text.substring(character, character + result.data[i + 2]), legend[result.data[i + 3]]]);
		}
		const seeTokens = tokens.filter((t) => t[1].startsWith('xdoc') && /^(@see|cx:area#2| for the area| the specification)$/.test(t[0]));
		assert.deepEqual(seeTokens, [['@see', 'xdocTag'], ['cx:area#2', 'xdocCode'], [' for the area', 'xdocText'], ['@see', 'xdocTag'], [' the specification', 'xdocText']]);
	});
});
