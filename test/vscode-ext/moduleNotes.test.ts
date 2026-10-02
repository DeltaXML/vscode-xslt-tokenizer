/**
 * Test suite for XSLT 4.0 module notes - an xsl:note with format="xdoc-md" as the first child of the xsl:stylesheet -
 * with @param $name for the global parameters, @variable $name for the global variables, and @author and @version - and
 * notes of their own for global parameters and variables, which need no tag in the module note:
 * - hover on a global variable reference, or its declaration's name, shows its type and documentation - and for a
 *   parameter of a function or template, its @param
 * - hover on the href of an xsl:import or xsl:include shows the module's note
 * - the linter checks the module note's @param and @variable tags, and tags that don't apply
 * - completions, 'Add documentation note', the quick fix for missing tags, and rename
 *
 * The cursor position is marked by '¦'.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTConfiguration } from '../../src/languageConfigurations';
import { XsltDefinitionProvider } from '../../src/xsltDefinitionProvider';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';
import { XSLTCodeActions } from '../../src/xsltCodeActions';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';
import { DocumentTypes, XslLexer } from '../../src/xslLexer';
import { XsltTokenDiagnostics } from '../../src/xsltTokenDiagnostics';

const root = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="cx" version="4.0">`;
const moduleNote = (tags: string) => `  <xsl:note format="xdoc-md">
    Draws shapes.

${tags}
  </xsl:note>`;
const tags = `    @param $scale the scale factor
    @variable $origin the point all shapes start from
    @variable $unit the unit of length
    @author Ann
    @version 1.2`;
const declarations = `  <xsl:item-type name="cx:colour" as="enum('red', 'green')"/>
  <xsl:param name="scale" as="xs:double" select="1"/>
  <xsl:param name="colour" as="cx:colour" select="'red'">
    <xsl:note format="xdoc-md">
      The fill colour, used for **every** shape.
    </xsl:note>
  </xsl:param>
  <xsl:variable name="origin" select="0"/>
  <xsl:variable name="unit" select="'cm'"/>
  <xsl:function name="cx:area" as="xs:double">
    <xsl:note format="xdoc-md">
      Area.
      @param $s the size
    </xsl:note>
    <xsl:param name="s"/>
    <xsl:sequence select="$s * $scale"/>
  </xsl:function>
  <xsl:template name="t"><xsl:variable name="local" select="1"/><xsl:sequence select="$scale, $colour, $origin, $unit, $local, cx:area(2)"/></xsl:template>`;

const stylesheet = (note = moduleNote(tags), body = declarations) => `${root}\n${note}\n${body}\n</xsl:stylesheet>`;

async function open(marked: string) {
	const offset = marked.indexOf('¦');
	const document = await vscode.workspace.openTextDocument({ content: marked.replace('¦', ''), language: 'xslt' });
	return { document, position: document.positionAt(offset) };
}

async function hoverAt(marked: string) {
	const { document, position } = await open(marked);
	const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
	return (hover?.contents as vscode.MarkdownString[] | undefined)?.map((c) => c.value).join('\n');
}

// the stylesheet, with the cursor at the offset of the text in it, plus the delta
const at = (text: string, delta: number, xslt = stylesheet()) => xslt.substring(0, xslt.indexOf(text) + delta) + '¦' + xslt.substring(xslt.indexOf(text) + delta);

async function diagnostics(xslt: string) {
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	const xslLexer = new XslLexer(XSLTConfiguration.configuration);
	xslLexer.provideCharLevelState = true;
	const all = XsltTokenDiagnostics.calculateDiagnostics({ ...XSLTConfiguration.configuration, isVersion4: true }, DocumentTypes.XSLT40, document, xslLexer.analyse(xslt), xslLexer.globalInstructionData, [], []);
	return { document, diagnostics: all.filter((d) => d.message !== 'variable is unused') };
}

const lint = async (xslt: string) => {
	const { document, diagnostics: found } = await diagnostics(xslt);
	return found.map((d) => [d.message, document.getText(d.range)]);
};

async function completionLabels(marked: string) {
	const { document, position } = await open(marked);
	const result = await new XsltDefinitionProvider(XSLTConfiguration.configuration).provideCompletionItems(document, position, new vscode.CancellationTokenSource().token, { triggerKind: vscode.CompletionTriggerKind.Invoke, triggerCharacter: undefined });
	return (Array.isArray(result) ? result : result?.items ?? []).map((item) => item.label as string);
}

async function applyNoteAction(xslt: string, at: string) {
	const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	await vscode.window.showTextDocument(document);
	const position = document.positionAt(xslt.indexOf(at) + 1);
	const actions = new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
	const action = actions.find((a) => a.title === 'Add documentation note');
	assert.isDefined(action, 'action offered');
	assert.isTrue(await vscode.workspace.applyEdit(action!.edit!));
	return document.getText();
}

async function rename(text: string, delta: number, newName: string) {
	const { document, position } = await open(at(text, delta));
	const provider = new XSLTReferenceProvider();
	const token = new vscode.CancellationTokenSource().token;
	await provider.prepareRename(document, position, token);
	const edit = await provider.provideRenameEdits(document, position, newName, token);
	assert.isTrue(await vscode.workspace.applyEdit(edit!));
	return document.getText();
}

suite('Module notes', () => {
	test('hover: a global parameter, with its @param in the module note', async () => {
		const text = await hoverAt(at('$scale,', 2));
		assert.include(text, '$scale as xs:double');
		assert.include(text, 'the scale factor\n\n---\nGlobal parameter, declared in this stylesheet');
	});

	test('hover: a global parameter with a note of its own, and an enumeration type', async () => {
		const text = await hoverAt(at('$colour,', 2));
		assert.include(text, '$colour as cx:colour');
		assert.include(text, 'The fill colour, used for **every** shape.');
		assert.include(text, "Values: `'red'`, `'green'`");
	});

	test('hover: a global variable, with its @variable in the module note', async () => {
		const text = await hoverAt(at('$origin,', 2));
		assert.include(text, 'the point all shapes start from\n\n---\nGlobal variable, declared in this stylesheet');
	});

	test('hover: the name of a global parameter declaration', async () => {
		assert.include(await hoverAt(at('name="scale"', 8)), 'the scale factor');
	});

	test('hover: the name of a global variable declaration', async () => {
		assert.include(await hoverAt(at('name="unit"', 7)), 'the unit of length');
	});

	test('hover: a parameter of a function, with its @param', async () => {
		const text = await hoverAt(at('$s *', 1));
		assert.include(text, 'the size\n\n---\nParameter of the function: `cx:area`');
	});

	test('hover: nothing for a local variable', async () => {
		assert.isUndefined(await hoverAt(at('$local,', 2)));
	});

	test('hover: no documentation for a global variable, without a module note', async () => {
		const text = await hoverAt(at('$origin,', 2, stylesheet('')));
		assert.include(text, '$origin');
		assert.include(text, 'Global variable, declared in this stylesheet');
		assert.notInclude(text, '---');
	});

	test('linter: all documented - a global parameter with a note of its own needs no @param', async () => {
		assert.deepEqual(await lint(stylesheet()), []);
	});

	test('linter: unknown, duplicate and missing tags', async () => {
		const note = moduleNote(`    @param $scale the scale factor
    @param $nope not a parameter
    @param $scale again
    @variable $origin the point
    @variable $scale not a variable`);
		assert.deepEqual(await lint(stylesheet(note)), [
			[`XSLT: The documentation note's @param '$nope' is not a parameter of this module`, 'nope'],
			[`XSLT: The documentation note already has an @param for '$scale'`, 'scale'],
			[`XSLT: The module note's @variable '$scale' is not a global variable of this module`, 'scale'],
			['XSLT: The module note has no @variable for: $unit', 'xsl:note']
		]);
	});

	test('linter: tags that are not for a module note, or the note of a global variable', async () => {
		const body = declarations.replace(`<xsl:variable name="unit" select="'cm'"/>`, `<xsl:variable name="unit" select="'cm'">\n    <xsl:note format="xdoc-md">\n      Centimetres.\n      @param $x no\n      @return no\n    </xsl:note>\n  </xsl:variable>`);
		assert.deepEqual(await lint(stylesheet(moduleNote(tags.replace('    @variable $unit the unit of length\n', '') + '\n    @return nothing'), body)), [
			[`XSLT: @return is not for the module note of an xsl:stylesheet, as a module isn't a function or template`, '@return'],
			['XSLT: @param is not for the note of a global xsl:variable - its own documentation is the note\'s text', '@param'],
			['XSLT: @return is not for the note of a global xsl:variable - its own documentation is the note\'s text', '@return']
		]);
	});

	test('linter: @variable in the note of a function', async () => {
		const body = declarations.replace('@param $s the size', '@param $s the size\n      @variable $v no');
		assert.deepEqual(await lint(stylesheet(moduleNote(tags), body)), [
			['XSLT: @variable is not for an xsl:function - it is for a global variable, in the module note', '@variable']
		]);
	});

	test('quick fix: add missing @variable', async () => {
		const xslt = stylesheet(moduleNote(tags.replace('    @variable $unit the unit of length\n', '')));
		const { document, diagnostics: found } = await diagnostics(xslt);
		await vscode.window.showTextDocument(document);
		const missing = found.find((d) => d.message.startsWith('XSLT: The module note has no @variable'));
		assert.isDefined(missing);
		const actions = new XSLTCodeActions().provideCodeActions(document, missing!.range, { diagnostics: found, triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		const fix = actions.find((a) => a.title === 'Add missing @variable');
		assert.isDefined(fix);
		assert.isTrue(await vscode.workspace.applyEdit(fix!.edit!));
		assert.include(document.getText(), '    @variable $origin the point all shapes start from\n    @variable $unit description\n    @author Ann');
	});

	test('completion: the tags of a module note', async () => {
		assert.deepEqual(await completionLabels(at('@author', 1)), ['@param', '@variable', '@see', '@since', '@deprecated', '@author', '@version']);
	});

	test('completion: the global variables without an @variable', async () => {
		const xslt = stylesheet(moduleNote('    @variable ¦'));
		assert.deepEqual(await completionLabels(xslt), ['$origin', '$unit']);
	});

	test('completion: the tags of the note of a global parameter', async () => {
		assert.deepEqual(await completionLabels(at('The fill colour', 0).replace('¦The fill colour', '@¦\n      The fill colour')), ['@see', '@since', '@deprecated']);
	});

	test('add documentation note: a module note, with the globals that have no note of their own', async () => {
		const text = await applyNoteAction(stylesheet(''), '<xsl:stylesheet');
		assert.include(text, `${root}\n  <xsl:note format="xdoc-md">\n    description\n\n    @param $scale description\n    @variable $origin description\n    @variable $unit description\n  </xsl:note>\n`);
	});

	test('add documentation note: a global variable', async () => {
		const text = await applyNoteAction(stylesheet(), `<xsl:variable name="unit"`);
		assert.include(text, `  <xsl:variable name="unit" select="'cm'">\n    <xsl:note format="xdoc-md">\n      description\n    </xsl:note>\n  </xsl:variable>`);
	});

	test('add documentation note: not for a local variable', async () => {
		const xslt = stylesheet();
		const document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
		const position = document.positionAt(xslt.indexOf('<xsl:variable name="local"') + 1);
		const actions = new XSLTCodeActions().provideCodeActions(document, new vscode.Range(position, position), { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined }) ?? [];
		assert.notInclude(actions.map((a) => a.title), 'Add documentation note');
	});

	test('rename: a global parameter, with its @param in the module note', async () => {
		const text = await rename('$scale,', 2, 'size');
		assert.include(text, '@param $size the scale factor');
		assert.include(text, '<xsl:param name="size" as="xs:double" select="1"/>');
		assert.include(text, '<xsl:sequence select="$s * $size"/>');
		assert.include(text, 'select="$size, $colour');
	});

	test('rename: a global variable, with its @variable in the module note', async () => {
		const text = await rename('name="origin"', 7, 'start');
		assert.include(text, '@variable $start the point all shapes start from');
		assert.include(text, '<xsl:variable name="start" select="0"/>');
		assert.include(text, '$colour, $start, $unit');
	});

	test('hover: the module note of an imported module', async () => {
		const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'module-notes-')));
		try {
			fs.writeFileSync(path.join(dir, 'shapes.xsl'), stylesheet());
			const main = `${root}\n  <xsl:import href="shapes.xsl"/>\n</xsl:stylesheet>`;
			fs.writeFileSync(path.join(dir, 'main.xsl'), main);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'main.xsl')));
			const position = document.positionAt(main.indexOf('shapes.xsl') + 2);
			const hover = await new XSLTHoverProvider(new XsltDefinitionProvider(XSLTConfiguration.configuration), XSLTConfiguration.configuration).provideHover(document, position, new vscode.CancellationTokenSource().token);
			const text = (hover?.contents as vscode.MarkdownString[]).map((c) => c.value).join('\n');
			assert.include(text, 'module shapes.xsl');
			assert.include(text, 'Draws shapes.');
			assert.include(text, '*@variable* `$origin` — the point all shapes start from');
			assert.include(text, '*@author* — Ann');
			assert.include(text, `Stylesheet module: ${path.join(dir, 'shapes.xsl')}`);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
	test('hover: a preview of the module note, on its start tag', async () => {
		const text = await hoverAt(at('<xsl:note format="xdoc-md">\n    Draws', 3));
		assert.include(text, 'Draws shapes.');
		assert.include(text, '*@param* `$scale` — the scale factor');
		assert.include(text, '*@version* — 1.2');
		assert.include(text, 'Preview of the module note, as shown for an xsl:import or xsl:include of this module');
	});

	test('hover: no preview on the start tag of another note', async () => {
		const text = await hoverAt(at('<xsl:note format="xdoc-md">\n      The fill', 3));
		assert.notInclude(text ?? '', 'Preview of the module note');
	});

	test('hover: no preview within the module note', async () => {
		const text = await hoverAt(at('Draws shapes', 3));
		assert.notInclude(text ?? '', 'Preview of the module note');
	});
});
