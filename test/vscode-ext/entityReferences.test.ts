/**
 * Test suite for entity references, e.g. '&company;': completion after '&' of the entities the DOCTYPE declares and the
 * predefined ones - not in a comment or CDATA section; hover with an entity's value, a predefined entity's character
 * or a character reference's code point; and go to an entity's <!ENTITY> declaration
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { EntityReferences } from '../../src/entityReferences';

const xslt = `<!DOCTYPE xsl:stylesheet [
<!ENTITY company "DeltaXignia Ltd">
<!ENTITY % param "p">
<!ENTITY legal SYSTEM "legal.ent">
]>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template name="t"><out>&company; &legal; &#160; &lt; &</out><!-- & --></xsl:template>
</xsl:stylesheet>`;

suite('Entity references: completion, hover and go to definition', () => {
	let document: vscode.TextDocument;
	const at = (text: string, offset = 1) => document.positionAt(xslt.indexOf(text) + offset);

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension('deltaxml.xslt-xpath');
		await extension?.activate();
		document = await vscode.workspace.openTextDocument({ content: xslt, language: 'xslt' });
	});

	test('the declared entities: general entities, with their values or files - not parameter entities', () => {
		assert.deepEqual(EntityReferences.declared(document).map((e) => [e.name, e.value, e.systemId, document.getText(e.range)]),
			[['company', 'DeltaXignia Ltd', undefined, 'company'], ['legal', undefined, 'legal.ent', 'legal']]);
	});

	test('a declaration: its value, or an external entity\'s system identifier', () => {
		assert.deepEqual(EntityReferences.declarationValue(' "v">'), { value: 'v' });
		assert.deepEqual(EntityReferences.declarationValue(" SYSTEM 'a.ent'>"), { systemId: 'a.ent' });
		assert.deepEqual(EntityReferences.declarationValue(' PUBLIC "-//X//EN" "b.ent">'), { systemId: 'b.ent' });
	});

	test('the reference at a position - also while it\'s typed', () => {
		assert.deepEqual(EntityReferences.referenceIn('a &company; b', 4), { name: 'company', start: 2, end: 11 });
		assert.deepEqual(EntityReferences.referenceIn('a &#xA0;', 3), { name: '#xA0', start: 2, end: 8 });
		assert.deepEqual(EntityReferences.referenceIn('a &com', 6), { name: 'com', start: 2, end: 6 });
		assert.isUndefined(EntityReferences.referenceIn('a & b', 3));
	});

	test('a character reference\'s character', () => {
		assert.deepEqual(EntityReferences.characterOf('#160'), { char: ' ', codePoint: 'U+00A0' });
		assert.deepEqual(EntityReferences.characterOf('#x1F600'), { char: '\u{1F600}', codePoint: 'U+1F600' });
		assert.isUndefined(EntityReferences.characterOf('company'));
	});

	test('completion after &: the declared entities first, then the predefined ones, each with its ;', async () => {
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, at('&</out>'), '&');
		const entities = list.items.filter((i) => i.kind === vscode.CompletionItemKind.Constant)
			.sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
		assert.deepEqual(entities.map((i) => [i.label, i.insertText, i.detail]), [
			['company', 'company;', '"DeltaXignia Ltd"'], ['legal', 'legal;', 'external: legal.ent'],
			['amp', 'amp;', 'predefined: &'], ['apos', 'apos;', "predefined: '"], ['gt', 'gt;', 'predefined: >'],
			['lt', 'lt;', 'predefined: <'], ['quot', 'quot;', 'predefined: "']]);
	});

	test('no completion in a comment', async () => {
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, at('& -->'), '&');
		assert.isEmpty(list.items.filter((i) => i.kind === vscode.CompletionItemKind.Constant && i.label === 'company'));
	});

	test('hover: a declared entity\'s value or file, a predefined entity\'s character, a character reference\'s code point', async () => {
		const hoverText = async (text: string) => {
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, at(text, 2));
			return hovers.flatMap((h) => h.contents.map((c) => typeof c === 'string' ? c : c.value)).join('\n');
		};
		assert.include(await hoverText('&company; '), 'DeltaXignia Ltd');
		assert.include(await hoverText('&legal;'), 'legal.ent');
		assert.include(await hoverText('&lt; '), 'Predefined entity for the character `<`');
		assert.include(await hoverText('&#160;'), 'Character reference: U+00A0');
	});

	test('go to definition: the entity\'s <!ENTITY> declaration', async () => {
		const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, at('&company; ', 3));
		const ranges = locations.map((l) => 'targetRange' in l ? l.targetRange : l.range);
		assert.deepInclude(ranges.map((r) => [r.start.line, document.getText(r)]), [1, 'company']);
	});
});
