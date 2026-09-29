/**
 * Test suite for XSLT 4.0 documentation notes: an xsl:note with format="xdoc-md", as the first child of an xsl:function
 * xsl:template or xsl:item-type, with Markdown text and xqDoc-style tags such as @param $name and @return:
 * - hover on a function call, an xsl:call-template name, an xsl:with-param name, or the name of an xsl:item-type where
 *   it's used shows the documentation - as does hover on the name of the declaration itself, or of one of its xsl:params
 * - signature help for a user-defined function has the descriptions of the function and its parameters
 * - 'Add documentation note' adds a note with the parameters
 * - completions of the tags, and of the parameter names after @param, within a note
 * - the linter reports an @param that isn't a parameter
 * - @field name documents a field of an xsl:item-type's record type: shown in hovers of the type and of the field, with
 *   completions, checks and fixes like those of @param
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

const pointType = `<xsl:item-type name="cx:point" as="record(x as xs:double, y as xs:double)">
    <xsl:note format="xdoc-md">
      A point on a **plane**.

      @field x the horizontal position
      @field y the vertical position
      @since 2.0
    </xsl:note>
  </xsl:item-type>
  <xsl:item-type name="cx:colour" as="enum('red', 'green')"/>`;

function stylesheet(body: string, version = '4.0') {
	return `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="com.example.cx" version="${version}">
  ${pointType}
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

// the hover after the linter has recorded the record field references
async function fieldHoverText(body: string) {
	const { document, position } = await open(stylesheet(body));
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const allTokens = xslLexer.analyse(document.getText());
	XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, allTokens, xslLexer.globalInstructionData, [], []);
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

	test('hover: a named item type in an as attribute', async () => {
		const text = await hoverText(`<xsl:variable name="p" as="cx:po¦int?" select="()"/>`);
		assert.include(text, 'type cx:point as record(x as xs:double, y as xs:double)');
		assert.include(text, 'A point on a **plane**.');
		assert.include(text, '*@field* `x` — the horizontal position');
		assert.include(text, '*@since* — 2.0');
		assert.include(text, 'Named item type, declared in this stylesheet');
	});

	test('hover: a named item type in an XPath expression', async () => {
		const text = await hoverText(call('1 instance of cx:p¦oint'));
		assert.include(text, 'type cx:point as record(x as xs:double, y as xs:double)');
		assert.include(text, 'A point on a **plane**.');
	});

	test('hover: a named item type without a note', async () => {
		const text = await hoverText(`<xsl:variable name="c" as="cx:col¦our" select="'red'"/>`);
		assert.include(text, `type cx:colour as enum('red', 'green')`);
		assert.include(text, 'Named item type, declared in this stylesheet');
	});

	test('hover: nothing for an element name matching a named item type', async () => {
		assert.isUndefined(await hoverText(call('cx:po¦int')));
	});

	const declarationHovers: [string, string, string[]][] = [
		['an xsl:function', stylesheet('').replace('name="cx:area"', 'name="cx:ar¦ea"'),
			['cx:area($shape, $scale) as xs:double', 'Returns the area of a shape', '*@param* `$shape` — the shape', 'User-defined function, declared in this stylesheet']],
		['a named xsl:template', stylesheet('').replace('name="draw"', 'name="dr¦aw"'), ['template draw($colour)', 'Draws a shape.', 'Named template, declared in this stylesheet']],
		['an xsl:item-type', stylesheet('').replace('name="cx:point"', 'name="cx:po¦int"'),
			['type cx:point as record(x as xs:double, y as xs:double)', 'A point on a **plane**.', '*@field* `x` — the horizontal position']],
		['an xsl:item-type without a note', stylesheet('').replace('name="cx:colour"', 'name="cx:col¦our"'), [`type cx:colour as enum('red', 'green')`]],
		['an xsl:param of a function', stylesheet('').replace('name="scale"', 'name="sc¦ale"'), ['$scale', 'the scale factor', 'Parameter of the function: `cx:area`']],
		['an xsl:param of a template', stylesheet('').replace('name="colour"', 'name="col¦our"'), ['$colour', 'the fill colour', 'Parameter of the template: `draw`']],
	];
	declarationHovers.forEach(([label, marked, expected]) => {
		test(`hover: the name of ${label}`, async () => {
			const { document, position } = await open(marked);
			const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
			const text = (hover?.contents as vscode.MarkdownString[] | undefined)?.map((c) => c.value).join('\n');
			expected.forEach((part) => assert.include(text, part));
		});
	});

	// global parameters and variables are in moduleNotes.test.ts
	test('hover: the name of a global xsl:param, without documentation', async () => {
		const text = await hoverText(`<xsl:param name="¦g" select="1"/>`);
		assert.include(text, '$g');
		assert.include(text, 'Global parameter, declared in this stylesheet');
	});

	test('hover: nothing for the name of a local xsl:variable', async () => {
		assert.isUndefined(await hoverText(`<xsl:template name="t2"><xsl:variable name="v¦v" select="1"/></xsl:template>`));
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

	test('add documentation note: an empty xsl:item-type', async () => {
		const { document } = await open(stylesheet(`<xsl:item-type name="cx:size" as="enum('s', 'm')" />`));
		await vscode.window.showTextDocument(document);
		const position = document.positionAt(document.getText().indexOf('cx:size'));
		const actions = new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const action = actions.find((a) => a.title === 'Add documentation note');
		assert.isDefined(action);
		assert.isTrue(await vscode.workspace.applyEdit(action!.edit!));
		assert.equal(document.getText(), stylesheet(`<xsl:item-type name="cx:size" as="enum('s', 'm')">
    <xsl:note format="xdoc-md">
      description
    </xsl:note>
  </xsl:item-type>`));
	});

	test('linter: an @param in the note of an xsl:item-type', async () => {
		assert.deepEqual(await lint(stylesheet(`<xsl:item-type name="cx:size" as="enum('s', 'm')">\n    <xsl:note format="xdoc-md">\n      A size.\n      @param $s small\n    </xsl:note>\n  </xsl:item-type>`)), [
			[`XSLT: The documentation note's @param '$s' is not a parameter of this xsl:item-type`, 's']
		]);
	});

	const noAction: [string, string][] = [
		['a function with a documentation note', stylesheet('').replace('name="cx:area"', 'name="cx:ar¦ea"')],
		['an xsl:item-type with a documentation note', stylesheet('').replace('name="cx:point"', 'name="cx:po¦int"')],
		['an xsl:item-type with a note that is not a documentation note', stylesheet(`<xsl:item-type na¦me="cx:size" as="xs:string">\n    <xsl:note>A size.</xsl:note>\n  </xsl:item-type>`)],
		['a template with a note that is not a documentation note', stylesheet(`<xsl:template na¦me="t2">\n    <xsl:note>Internal.</xsl:note>\n    <xsl:sequence select="1"/>\n  </xsl:template>`)],
		['an xsl:item-type with no note, in XSLT 3.0', stylesheet(`<xsl:item-type na¦me="cx:size" as="xs:string"/>`, '3.0')],
		['another element', stylesheet(`<xsl:template name="t2"><xsl:sequence se¦lect="1"/></xsl:template>`)],
		['a local xsl:variable', stylesheet(`<xsl:template name="t2"><xsl:variable na¦me="v" select="1"/></xsl:template>`)],
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
	// an xsl:item-type with a documentation note - the cursor, if any, is marked in the note's content
	const itemTypeNote = (asText: string, content: string) => `<xsl:item-type name="cx:size" as="${asText}">\n    <xsl:note format="xdoc-md">\n      ${content}\n    </xsl:note>\n  </xsl:item-type>`;
	const sizeRecord = `record(w as xs:double, h as xs:double, 'unit name'? as xs:string)`;

	test('hover: a record field, with its @field text', async () => {
		const text = await fieldHoverText(`<xsl:variable name="p" as="cx:point" select="{ 'x': 1, 'y': 2 }"/>\n  ${call('$p?¦y')}`);
		assert.include(text, 'y as xs:double');
		assert.include(text, 'the vertical position');
		assert.include(text, 'Field of the record type: `cx:point`');
	});

	test('hover: a record field of an item type declared as another', async () => {
		const text = await fieldHoverText(`<xsl:item-type name="cx:location" as="cx:point"/>\n  <xsl:variable name="p" as="cx:location" select="{ 'x': 1, 'y': 2 }"/>\n  ${call('$p?¦x')}`);
		assert.include(text, 'the horizontal position');
	});

	test('hover: a record field without an @field', async () => {
		const text = await fieldHoverText(`<xsl:variable name="q" as="record(r as xs:double)" select="{ 'r': 1 }"/>\n  ${call('$q?¦r')}`);
		assert.include(text, 'Field of the record type');
		assert.notInclude(text, '---');
	});

	test('add documentation note: an xsl:item-type with a record type has an @field for each field', async () => {
		const { document } = await open(stylesheet(`<xsl:item-type name="cx:size" as="${sizeRecord}"/>`));
		await vscode.window.showTextDocument(document);
		const position = document.positionAt(document.getText().indexOf('cx:size'));
		const actions = new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const action = actions.find((a) => a.title === 'Add documentation note');
		assert.isDefined(action);
		assert.isTrue(await vscode.workspace.applyEdit(action!.edit!));
		assert.equal(document.getText(), stylesheet(itemTypeNote(sizeRecord, `description\n\n      @field w description\n      @field h description\n      @field 'unit name' description`)));
	});

	test('completion: tag names for an xsl:item-type', async () => {
		assert.deepEqual(await completionLabels(stylesheet(itemTypeNote(sizeRecord, 'A size.\n      @¦'))), ['@field', '@see', '@since', '@deprecated']);
	});

	test('completion: no @field for a function', async () => {
		assert.notInclude(await completionLabels(stylesheet(noteBody('Magnitude.\n      @¦'))), '@field');
	});

	test('completion: the fields that are not documented, after @field', async () => {
		assert.deepEqual(await completionLabels(stylesheet(itemTypeNote(sizeRecord, 'A size.\n      @field w the width\n      @field ¦'))), ['h', `'unit name'`]);
	});

	test('linter: all fields documented, one with a quoted name', async () => {
		assert.deepEqual(await lint(stylesheet(itemTypeNote(sizeRecord, `A size.\n      @field w the width\n      @field h the height\n      @field 'unit name' e.g. cm`))), []);
	});

	test('linter: no message for fields when the note has no @field', async () => {
		assert.deepEqual(await lint(stylesheet(itemTypeNote(sizeRecord, 'A size.'))), []);
	});

	test('linter: an unknown, a duplicate and missing @field', async () => {
		assert.deepEqual(await lint(stylesheet(itemTypeNote(sizeRecord, 'A size.\n      @field w the width\n      @field d the depth\n      @field w again'))), [
			[`XSLT: The documentation note's @field 'd' is not a field of the record type cx:size`, 'd'],
			[`XSLT: The documentation note already has an @field for 'w'`, 'w'],
			[`XSLT: The documentation note has no @field for: h, 'unit name'`, 'xsl:note']
		]);
	});

	test('linter: @field for an item type that is not a record type', async () => {
		assert.deepEqual(await lint(stylesheet(itemTypeNote(`enum('s', 'm')`, 'A size.\n      @field s small'))), [
			['XSLT: @field is for the fields of a record type, declared with xsl:item-type - not for the item type cx:size, which is not a record type', '@field']
		]);
	});

	test('linter: @field in the note of a function', async () => {
		assert.deepEqual(await lint(stylesheet(noteBody('Magnitude.\n      @field c the value'))), [
			['XSLT: @field is for the fields of a record type, declared with xsl:item-type - not for an xsl:function', '@field']
		]);
	});

	test('quick fix: add missing @field after the last one', async () => {
		const document = await vscode.workspace.openTextDocument({ content: stylesheet(itemTypeNote(sizeRecord, 'A size.\n      @field h the height\n      @since 2.0')), language: 'xslt' });
		await vscode.window.showTextDocument(document);
		const xslLexer = new XslLexer(XSLTConfiguration.configuration);
		xslLexer.provideCharLevelState = true;
		const diagnostics = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, xslLexer.analyse(document.getText()), xslLexer.globalInstructionData, [], []);
		const missing = diagnostics.find((d) => d.message.startsWith('XSLT: The documentation note has no @field'));
		assert.isDefined(missing);
		const actions = new XSLTCodeActions().provideCodeActions(document, missing!.range, { diagnostics, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const fix = actions.find((a) => a.title === 'Add missing @field');
		assert.isDefined(fix);
		assert.isTrue(await vscode.workspace.applyEdit(fix!.edit!));
		assert.equal(document.getText(), stylesheet(itemTypeNote(sizeRecord, `A size.\n      @field h the height\n      @field w description\n      @field 'unit name' description\n      @since 2.0`)));
	});
	test('linter: @return and @error in the note of an xsl:item-type', async () => {
		assert.deepEqual(await lint(stylesheet(itemTypeNote(sizeRecord, 'A size.\n      @return a size\n      @error none\n      @since 2.0'))), [
			['XSLT: @return is not for an xsl:item-type, which is a type, not a function or template', '@return'],
			['XSLT: @error is not for an xsl:item-type, which is a type, not a function or template', '@error']
		]);
	});

	// the documentation of each completion
	async function completionDocs(marked: string) {
		const { document, position } = await open(marked);
		const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
		const items = Array.isArray(result) ? result : result?.items ?? [];
		return new Map(items.map((item) => [item.label as string, (item.documentation as vscode.MarkdownString | undefined)?.value ?? String(item.documentation)]));
	}

	const pointVariable = `<xsl:variable name="p" as="cx:point" select="{ 'x': 1, 'y': 2 }"/>`;
	const fieldCompletionCases: [string, string][] = [
		['a lookup', `${pointVariable}\n  ${call('$p?¦')}`],
		['a partly typed lookup', `${pointVariable}\n  ${call('$p?y¦')}`],
		['a child step on a JNode', `${pointVariable}\n  ${call('jtree($p)/¦')}`],
		['a map constructor key', `<xsl:variable name="q" as="cx:point" select="{ ¦ }"/>`],
		['an xsl:map-entry element', `<xsl:variable name="q" as="cx:point"><xsl:map><¦</xsl:map></xsl:variable>`],
		['an xsl:map-entry key', `<xsl:variable name="q" as="cx:point"><xsl:map><xsl:map-entry key="¦" select="1"/></xsl:map></xsl:variable>`],
	];
	fieldCompletionCases.forEach(([label, body]) => {
		test(`completion: field documentation with its @field text, for ${label}`, async () => {
			const docs = await completionDocs(stylesheet(body));
			const entry = [...docs.entries()].find(([name]) => /\by\b/.test(name));
			assert.isDefined(entry, `completions: ${[...docs.keys()].join(', ')}`);
			assert.include(entry![1], 'the vertical position');
			assert.include(entry![1], 'Field of the record type: `cx:point`');
		});
	});
	// the hover on the name of an item type, where it's used in an 'as' attribute
	const enumHover = (declarations: string, typeName: string) => hoverText(`${declarations}\n  <xsl:variable name="e" as="${typeName.replace(/^(.{3})/, '$1¦')}" select="()"/>`);

	test('hover: the values of an enumeration type, on one line', async () => {
		const text = await enumHover('', 'cx:colour');
		assert.include(text, "Values: `'red'`, `'green'`\n\n---\nNamed item type, declared in this stylesheet");
	});

	test('hover: the values of an enumeration type, as a list', async () => {
		const text = await enumHover(`<xsl:item-type name="cx:size" as="enum('xs', 's', 'm', 'l', 'xl')"/>`, 'cx:size');
		assert.include(text, "Values:\n\n- `'xs'`\n- `'s'`\n- `'m'`\n- `'l'`\n- `'xl'`");
	});

	test('hover: the values of an item type declared as an enumeration type', async () => {
		const text = await enumHover(`<xsl:item-type name="cx:shade" as="cx:colour"/>`, 'cx:shade');
		assert.include(text, 'type cx:shade as cx:colour');
		assert.include(text, "Values: `'red'`, `'green'`");
	});

	test('hover: the values of a choice of enumeration types, without duplicates', async () => {
		const text = await enumHover(`<xsl:item-type name="cx:paint" as="(cx:colour | enum('none', 'red'))"/>`, 'cx:paint');
		assert.include(text, "Values: `'red'`, `'green'`, `'none'`");
	});

	test('hover: an enumeration value with a quote', async () => {
		const text = await enumHover(`<xsl:item-type name="cx:word" as="enum('it''s', 'is')"/>`, 'cx:word');
		assert.include(text, 'Values: `"it\'s"`, `\'is\'`');
	});

	test('hover: the values of an enumeration type, with its documentation note', async () => {
		const text = await enumHover(`<xsl:item-type name="cx:mode" as="enum('on', 'off')">\n    <xsl:note format="xdoc-md">\n      A switch.\n    </xsl:note>\n  </xsl:item-type>`, 'cx:mode');
		assert.include(text, "A switch.\n\nValues: `'on'`, `'off'`\n\n---\n");
	});

	test('hover: the values of an enumeration type, on the name of its declaration', async () => {
		const { document, position } = await open(stylesheet('').replace('name="cx:colour"', 'name="cx:col¦our"'));
		const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
		assert.include((hover?.contents as vscode.MarkdownString[]).map((c) => c.value).join('\n'), "Values: `'red'`, `'green'`");
	});

	test('hover: no values for a record type', async () => {
		assert.notInclude(await enumHover('', 'cx:point'), 'Values:');
	});

	test('hover: the values of a record field with an enumeration type', async () => {
		const text = await fieldHoverText(`<xsl:item-type name="cx:pen" as="record(colour as cx:colour, width as xs:double)"/>\n  <xsl:variable name="pen" as="cx:pen" select="{ 'colour': 'red', 'width': 1 }"/>\n  ${call('$pen?col¦our')}`);
		assert.include(text, 'colour as cx:colour');
		assert.include(text, "Values: `'red'`, `'green'`\n\n---\nField of the record type: `cx:pen`");
	});
});
