/**
 * Test suite for renaming a parameter of a function or template: as well as the declaration and its references, the
 * @param for it in the declaration's documentation note (xsl:note format="xdoc-md") is renamed, and for a function
 * parameter, keyword arguments for it in calls of the function, e.g. greeting := 'Hi' - but not keyword arguments with
 * the same name in calls of other functions, or variables with the same name.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTReferenceProvider } from '../../src/xsltReferenceProvider';

const content = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:ex="ex" version="4.0">
  <xsl:function name="ex:greeting">
    <xsl:note format="xdoc-md">
      Greets someone.

      @param $name the name
      @param $greeting the greeting
    </xsl:note>
    <xsl:param name="name"/>
    <xsl:param name="greeting" required="no" select="'Hello'"/>
    <xsl:sequence select="$greeting || ', ' || $name"/>
  </xsl:function>
  <xsl:function name="ex:other">
    <xsl:param name="greeting"/>
    <xsl:sequence select="$greeting"/>
  </xsl:function>
  <xsl:template name="t">
    <xsl:note format="xdoc-md">
      @param $who the person
    </xsl:note>
    <xsl:param name="who"/>
    <xsl:variable name="greeting" select="'x'"/>
    <xsl:sequence select="ex:greeting('Ann', greeting := 'Hi'), ex:other(greeting := $greeting), 'Bob' => ex:greeting(greeting := $who)"/>
  </xsl:template>
  <xsl:template match="/">
    <xsl:call-template name="t"><xsl:with-param name="who" select="'Bob'"/></xsl:call-template>
  </xsl:template>
</xsl:stylesheet>`;

// the text of each line after renaming the symbol at the position of the text, plus the offset
async function rename(text: string, delta: number, newName = 'salutation') {
	const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
	const position = document.positionAt(content.indexOf(text) + delta);
	const provider = new XSLTReferenceProvider();
	const token = new vscode.CancellationTokenSource().token;
	await provider.prepareRename(document, position, token);
	const edit = await provider.provideRenameEdits(document, position, newName, token);
	assert.isTrue(await vscode.workspace.applyEdit(edit!));
	return document.getText().split('\n').map((line) => line.trim());
}

suite('Renaming parameters', () => {
	const functionParamRenamed = (lines: string[]) => {
		assert.include(lines, '@param $salutation the greeting');
		assert.include(lines, `<xsl:param name="salutation" required="no" select="'Hello'"/>`);
		assert.include(lines, `<xsl:sequence select="$salutation || ', ' || $name"/>`);
		// keyword arguments of ex:greeting - but not of ex:other, and not the variable $greeting
		assert.include(lines, `<xsl:sequence select="ex:greeting('Ann', salutation := 'Hi'), ex:other(greeting := $greeting), 'Bob' => ex:greeting(salutation := $who)"/>`);
		assert.include(lines, '<xsl:param name="greeting"/>');
		assert.include(lines, `<xsl:variable name="greeting" select="'x'"/>`);
	};

	test('a function parameter, from its declaration', async () => {
		functionParamRenamed(await rename(`name="greeting" required`, 7));
	});

	test('a function parameter, from a reference', async () => {
		functionParamRenamed(await rename(`$greeting ||`, 2));
	});

	test('a template parameter, with its @param and xsl:with-param', async () => {
		const lines = await rename(`name="who"/>`, 7, 'person');
		assert.include(lines, '@param $person the person');
		assert.include(lines, '<xsl:param name="person"/>');
		assert.include(lines, `<xsl:call-template name="t"><xsl:with-param name="person" select="'Bob'"/></xsl:call-template>`);
		assert.include(lines, `<xsl:sequence select="ex:greeting('Ann', greeting := 'Hi'), ex:other(greeting := $greeting), 'Bob' => ex:greeting(greeting := $person)"/>`);
	});

	test('find all references includes the @param and keyword arguments', async () => {
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		const position = document.positionAt(content.indexOf(`name="greeting" required`) + 7);
		const references = await new XSLTReferenceProvider().provideReferences(document, position, { includeDeclaration: true }, new vscode.CancellationTokenSource().token);
		const lines = (references ?? []).map((r) => r.range.start.line + 1).sort((a, b) => a - b);
		// the @param, the declaration, the reference, and two keyword arguments on one line
		assert.deepEqual(lines, [7, 10, 11, 23, 23]);
	});
});
