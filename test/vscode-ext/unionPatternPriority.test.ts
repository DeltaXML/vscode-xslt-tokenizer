/**
 * Test suite for template rules whose union patterns have branches with different default priorities - which XSLT 4.0
 * treats as one rule, with the highest, where XSLT 3.0 makes a rule for each (Saxon 13's warning SXWN9052). Reported for
 * XSLT 4.0 - and before, when the stylesheet runs with Saxon's syntax extensions, or with the setting
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { UnionPatternPriority } from '../../src/unionPatternPriority';

suite('Union patterns: default priorities', () => {
	test('the default priority of a pattern that isn\'t a union, as XSLT 3.0 gives it', () => {
		const cases: [string, number][] = [
			['p', 0], ['@d:keep', 0], ['child::p', 0], ['attribute::id', 0], ['Q{urn:d}p', 0], ['processing-instruction(\'x\')', 0], ['element(p)', 0],
			['d:*', -0.25], ['@d:*', -0.25], ['*:p', -0.25], ['element(*, xs:string)', -0.25],
			['*', -0.5], ['@*', -0.5], ['node()', -0.5], ['text()', -0.5], ['/', -0.5], ['element()', -0.5], ['document-node()', -0.5],
			['element(p, xs:string)', 0.25],
			['p[1]', 0.5], ['a/b', 0.5], ['//p', 0.5], ['deltaxml:attributes[empty(*)]', 0.5], ['key(\'k\', 1)', 0.5]
		];
		assert.deepEqual(cases.map(([p]) => [p, UnionPatternPriority.defaultPriority(p)]), cases);
	});

	test('the branches of a union: at its top level, with | or union', () => {
		assert.deepEqual(UnionPatternPriority.branches('@d:* | @other'), ['@d:*', '@other']);
		assert.deepEqual(UnionPatternPriority.branches('a union b|c'), ['a', 'b', 'c']);
		assert.deepEqual(UnionPatternPriority.branches('p[@a = (\'x|y\', \'z\')] | q[x | y]'), ['p[@a = (\'x|y\', \'z\')]', 'q[x | y]']);
		assert.deepEqual(UnionPatternPriority.branches('reunion'), ['reunion']);
	});

	const templates = `  <xsl:template match="@d:* | @other"/>
  <xsl:template match="@d:keep | @d:also"/>
  <xsl:template match="@d:* | @other" priority="-0.25"/>
  <!-- <xsl:template match="@d:* | @other"/> -->`;
	const stylesheet = (version: string, before = '') => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:d="urn:d" version="${version}">
${before}${templates}
</xsl:stylesheet>`;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-'));
	const open = (name: string, content: string) => {
		fs.writeFileSync(path.join(dir, name), content);
		return vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, name)));
	};

	test('XSLT 4.0: a warning for a template rule with branches of different priorities, without a priority attribute', async () => {
		const document = await open('four.xsl', stylesheet('4.0'));
		const diagnostics = UnionPatternPriority.problems(document, true);
		assert.deepEqual(diagnostics.map((d) => [document.getText(d.range), d.range.start.line]), [['@d:* | @other', 1]]);
		assert.include(diagnostics[0].message, '@d:* (-0.25), @other (0)');
		assert.include(diagnostics[0].message, 'SXWN9052');
		assert.notInclude(diagnostics[0].message, 'syntax extensions');
	});

	test('before XSLT 4.0: not reported - unless it\'s run with the syntax extensions, or with the setting', async () => {
		assert.deepEqual(UnionPatternPriority.problems(await open('three.xsl', stylesheet('3.0')), false), []);
		// with an item type, in the stylesheet or a module it imports, it's run with the syntax extensions
		const withTypes = UnionPatternPriority.problems(await open('types.xsl', stylesheet('3.0', '  <xsl:item-type name="d:point" as="record(x, y)"/>\n')), false);
		assert.lengthOf(withTypes, 1);
		assert.include(withTypes[0].message, 'This stylesheet is run with Saxon\'s syntax extensions');
		assert.lengthOf(UnionPatternPriority.problems(await open('importing.xsl', stylesheet('3.0', '  <xsl:import href="types.xsl"/>\n')), false), 1);
		const settings = vscode.workspace.getConfiguration('XSLT.validation');
		await settings.update('xslt40UnionPriorities', true, vscode.ConfigurationTarget.Global);
		try {
			assert.lengthOf(UnionPatternPriority.problems(await open('three.xsl', stylesheet('3.0')), false), 1);
		} finally {
			await settings.update('xslt40UnionPriorities', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('with another prefix for XSLT', async () => {
		const content = `<t:stylesheet xmlns:t="http://www.w3.org/1999/XSL/Transform" version="4.0">
  <t:template match="* | p"/>
</t:stylesheet>`;
		const document = await vscode.workspace.openTextDocument({ content, language: 'xslt' });
		assert.lengthOf(UnionPatternPriority.problems(document, true), 1);
	});
});
