/**
 * Test suite for XSLT 4.0 documentation notes: an xsl:note with format="xdoc-md", as the first child of an xsl:function
 * or xsl:template, with Markdown text and xqDoc-style tags such as @param $name and @return:
 * - hover on a function call, an xsl:call-template name, or an xsl:with-param name shows the documentation
 * - signature help for a user-defined function has the descriptions of the function and its parameters
 * - 'Add documentation note' adds a note with the parameters
 * - completions of the tags, and of the parameter names after @param, within a note
 * - the linter reports an @param that isn't a parameter
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { XSLTSignatureHelpProvider } from '../../src/xsltSignatureHelpProvider';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const areaFunction = `<xsl:function name="cx:area" as="xs:double">
    <xsl:note format="xdoc-md">
      Returns the area of a shape, **scaled** when \`$scale &gt; 1\`.

      @param $shape the shape
      @param $scale the scale factor
      @return the area
    </xsl:note>
    <xsl:param name="shape"/>
    <xsl:param name="scale"/>
    <xsl:sequence select="1"/>
  </xsl:function>`;

const drawTemplate = `<xsl:template name="draw">
    <xsl:note format="xdoc-md">
      Draws a shape.

      @param $colour the fill colour
    </xsl:note>
    <xsl:param name="colour"/>
  </xsl:template>`;

function stylesheet(body: string, version = '4.0') {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="${version}">
  ${areaFunction}
  ${drawTemplate}
  ${body}
</xsl:stylesheet>`;
}

async function open(marked: string) {
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	return { document, position: document.positionAt(offset) };
}

async function hoverText(body: string) {
	const { document, position } = await open(stylesheet(body));
	const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
	return (hover?.contents as vscode.MarkdownString[] | undefined)?.map((c) => c.value).join('\n');
}

async function completionLabels(marked: string) {
	const { document, position } = await open(marked);
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	const items = Array.isArray(result) ? result : result?.items ?? [];
	return items.map((item) => item.label as string);
}

async function lint(xslt: string) {
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(xslt);
	return XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], [])
		.filter((d) => d.message !== 'variable is unused').map((d) => [d.message, document.getText(d.range)]);
}

const call = (select: string) => `<xsl:template name="t"><xsl:sequence select="${select}"/></xsl:template>`;

suite('Documentation notes', () => {
	test('hover: a function call', async () => {
		const text = await hoverText(call('cx:ar¦ea(1, 2)'));
		assert.include(text, 'cx:area($shape, $scale) as xs:double');
		assert.include(text, 'Returns the area of a shape, **scaled** when `$scale > 1`.');
		assert.include(text, '*@param* `$shape` — the shape');
		assert.include(text, '*@return* — the area');
	});

	test('hover: an xsl:call-template name', async () => {
		const text = await hoverText(`<xsl:template name="t"><xsl:call-template name="dr¦aw"/></xsl:template>`);
		assert.include(text, 'template draw($colour)');
		assert.include(text, 'Draws a shape.');
	});

	test('hover: an xsl:with-param name', async () => {
		const text = await hoverText(`<xsl:template name="t"><xsl:call-template name="draw"><xsl:with-param name="col¦our" select="'red'"/></xsl:call-template></xsl:template>`);
		assert.include(text, '$colour');
		assert.include(text, 'the fill colour');
	});

	test('signature help: the descriptions of the function and its parameters', async () => {
		const { document, position } = await open(stylesheet(call('cx:area(1, ¦)')));
		const help = await new XSLTSignatureHelpProvider(XSLTConfiguration.configuration).provideSignatureHelp(document, position, new vscode.CancellationTokenSource().token) as vscode.SignatureHelp;
		const signature = help.signatures[0];
		assert.equal(signature.label, 'cx:area($shape, $scale) as xs:double');
		assert.include((signature.documentation as vscode.MarkdownString).value, 'Returns the area of a shape');
		assert.notInclude((signature.documentation as vscode.MarkdownString).value, '@param');
		assert.equal(help.activeParameter, 1);
		assert.equal((signature.parameters[1].documentation as vscode.MarkdownString).value, 'the scale factor');
	});

	test('add documentation note', async () => {
		const body = `<xsl:function name="cx:mag" as="xs:double">\n    <xsl:param name="c"/>\n    <xsl:param name="k"/>\n    <xsl:sequence select="1"/>\n  </xsl:function>`;
		const { document } = await open(stylesheet(body));
		await vscode.window.showTextDocument(document);
		const position = document.positionAt(document.getText().indexOf('cx:mag'));
		const actions = new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const action = actions.find((a) => a.title === 'Add documentation note');
		assert.isDefined(action);
		assert.isTrue(await vscode.workspace.applyEdit(action!.edit!));
		assert.equal(document.getText(), stylesheet(`<xsl:function name="cx:mag" as="xs:double">
    <xsl:note format="xdoc-md">
      description

      @param $c description
      @param $k description
      @return description
    </xsl:note>
    <xsl:param name="c"/>
    <xsl:param name="k"/>
    <xsl:sequence select="1"/>
  </xsl:function>`));
	});

	const noAction: [string, string][] = [
		['a function with a documentation note', stylesheet('').replace('name="cx:area"', 'name="cx:ar¦ea"')],
		['another element', stylesheet(`<xsl:variable na¦me="v" select="1"/>`)],
		['XSLT 3.0', stylesheet(`<xsl:template na¦me="t2"><xsl:sequence select="1"/></xsl:template>`, '3.0')],
	];
	noAction.forEach(([label, marked]) => {
		test(`add documentation note: not offered for ${label}`, async () => {
			const { document, position } = await open(marked);
			const actions = new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
			assert.notInclude(actions.map((a) => a.title), 'Add documentation note');
		});
	});

	const noteBody = (content: string) => `<xsl:function name="cx:mag" as="xs:double">\n    <xsl:note format="xdoc-md">\n      ${content}\n    </xsl:note>\n    <xsl:param name="c"/>\n    <xsl:param name="k"/>\n    <xsl:sequence select="1"/>\n  </xsl:function>`;

	test('completion: tag names after @', async () => {
		assert.deepEqual(await completionLabels(stylesheet(noteBody('Magnitude.\n      @¦'))), ['@param', '@return', '@see', '@since', '@deprecated', '@error']);
	});

	test('completion: the parameters that are not documented, after @param', async () => {
		assert.deepEqual(await completionLabels(stylesheet(noteBody('Magnitude.\n      @param $c the value\n      @param ¦'))), ['$k']);
	});

	test('completion: nothing within the text of a note', async () => {
		assert.deepEqual(await completionLabels(stylesheet(noteBody('Magni¦tude.'))), []);
	});

	test('linter: an @param that is not a parameter', async () => {
		assert.deepEqual(await lint(stylesheet(noteBody('Magnitude.\n      @param $c the value\n      @param $x the other'))), [
			[`XSLT: The documentation note's @param '$x' is not a parameter of this xsl:function`, 'x'],
			['XSLT: The documentation note has no @param for: $k', 'xsl:note']
		]);
	});

	test('hover: a note that is a CDATA section', async () => {
		const body = `<xsl:function name="cx:cd" as="xs:boolean">\n    <xsl:note format="xdoc-md"><![CDATA[\n      True if $a < $b, e.g. <code>, not &lt;.\n\n      @param $a the first\n    ]]></xsl:note>\n    <xsl:param name="a"/>\n    <xsl:sequence select="true()"/>\n  </xsl:function>\n  ${call('cx:c¦d(1)')}`;
		const text = await hoverText(body);
		// escaped for Markdown, so that it's shown as written: 'True if $a < $b, e.g. <code>, not &lt;.'
		assert.include(text, 'True if $a &lt; $b, e.g. &lt;code>, not &amp;lt;.');
		assert.include(text, '*@param* `$a` — the first');
		assert.notInclude(text, 'CDATA');
		assert.notInclude(text, ']]>');
	});

	test('hover: text before a CDATA section that spans the tags', async () => {
		const body = `<xsl:function name="cx:cd" as="xs:boolean">\n    <xsl:note format="xdoc-md">\n      Intro &amp; more.\n      <![CDATA[With <b>code</b>.\n      @param $a the first]]>\n    </xsl:note>\n    <xsl:param name="a"/>\n    <xsl:sequence select="true()"/>\n  </xsl:function>\n  ${call('cx:c¦d(1)')}`;
		const text = await hoverText(body);
		// 'Intro & more.' - the entity reference is decoded - then the CDATA section's text as written
		assert.include(text, 'Intro &amp; more.\nWith &lt;b>code&lt;/b>.');
		assert.include(text, '*@param* `$a` — the first');
		assert.notInclude(text, 'CDATA');
		assert.notInclude(text, ']]>');
	});

	test('completion: tag names within a CDATA section', async () => {
		assert.deepEqual(await completionLabels(stylesheet(noteBody('<![CDATA[Magnitude with a < b.\n      @¦]]>'))), ['@param', '@return', '@see', '@since', '@deprecated', '@error']);
	});

	test('linter: an @param within a CDATA section that is not a parameter', async () => {
		assert.deepEqual(await lint(stylesheet(noteBody('<![CDATA[Magnitude.\n      @param $c the value\n      @param $x the other]]>'))), [
			[`XSLT: The documentation note's @param '$x' is not a parameter of this xsl:function`, 'x'],
			['XSLT: The documentation note has no @param for: $k', 'xsl:note']
		]);
	});

	test('linter: no message for parameters when the note has no @param', async () => {
		assert.deepEqual(await lint(stylesheet(noteBody('Magnitude only.'))), []);
	});

	test('linter: a duplicate @param', async () => {
		assert.deepEqual(await lint(stylesheet(noteBody('Magnitude.\n      @param $c the value\n      @param $k the factor\n      @param c the value again'))), [
			[`XSLT: The documentation note already has an @param for '$c'`, 'c']
		]);
	});

	test('linter: all parameters documented', async () => {
		assert.deepEqual(await lint(stylesheet(noteBody('Magnitude.\n      @param $c the value\n      @param $k the factor'))), []);
	});

	// the note after applying 'Add missing @param' in an editor
	async function addMissingParams(content: string) {
		const document = await vscode.workspace.openTextDocument({ content: stylesheet(noteBody(content)), language: 'xslt' });
		await vscode.window.showTextDocument(document);
		const xslLexer = new XslLexer(XSLTConfiguration.configuration);
		xslLexer.provideCharLevelState = true;
		const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, xslLexer.analyse(document.getText()), xslLexer.globalInstructionData, [], []);
		const missing = diagnostics.find((d) => d.message.startsWith('XSLT: The documentation note has no @param'));
		assert.isDefined(missing);
		const actions = new XSLTCodeActions().provideCodeActions(document, missing!.range, { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const fix = actions.find((a) => a.title === 'Add missing @param');
		assert.isDefined(fix);
		assert.isTrue(await vscode.workspace.applyEdit(fix!.edit!));
		const text = document.getText();
		const noteStart = text.indexOf('<xsl:note', text.indexOf('cx:mag'));
		return text.substring(noteStart, text.indexOf('</xsl:note>', noteStart));
	}

	test('quick fix: add missing @param after the last one', async () => {
		assert.equal(await addMissingParams('Magnitude.\n      @param $c the value\n        on two lines\n      @return the magnitude'),
			'<xsl:note format="xdoc-md">\n      Magnitude.\n      @param $c the value\n        on two lines\n      @param $k description\n      @return the magnitude\n    ');
	});

	test('quick fix: add missing @param within a CDATA section', async () => {
		assert.equal(await addMissingParams('<![CDATA[Magnitude.\n      @param $k the factor]]>'),
			'<xsl:note format="xdoc-md">\n      <![CDATA[Magnitude.\n      @param $k the factor\n      @param $c description]]>\n    ');
	});

	test('linter: braces in the text of a note are not text value templates', async () => {
		const xslt = stylesheet(`<xsl:template name="t2" expand-text="yes">\n    <xsl:note format="xdoc-md">\n      Uses { 'a': 1 } or {not xpath\n    </xsl:note>\n    <xsl:note>{also not xpath <b>{x</b></xsl:note>\n    <xsl:sequence select="1"/>\n  </xsl:template>`);
		assert.deepEqual(await lint(xslt), []);
	});

	test('linter: parameters documented without a $, in a template', async () => {
		assert.deepEqual(await lint(stylesheet(`<xsl:template name="t2">\n    <xsl:note format="xdoc-md">\n      @param p the value\n    </xsl:note>\n    <xsl:param name="p"/>\n  </xsl:template>`)), []);
	});
});
