/**
 * Test suite for editing Schematron (.sch) files: auto-completion from the ISO Schematron 2025 schema, as SchXslt2 - the
 * Schematron processor bundled with XSpec - implements it (see src/schSchema.ts)
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';

suite('Schematron', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-'));
	let count = 0;

	suiteSetup(async () => {
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
	});

	const completions = async (content: string, marker = '|') => {
		const offset = content.indexOf(marker);
		const file = path.join(dir, `complete${count++}.sch`);
		fs.writeFileSync(file, content.replace(marker, ''));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		assert.strictEqual(document.languageId, 'sch');
		const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
		return list.items.map((item) => typeof item.label === 'string' ? item.label : item.label.label);
	};
	const prefixed = (body: string) => `<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">\n${body}\n</sch:schema>`;
	const unprefixed = (body: string) => `<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">\n${body}\n</schema>`;

	const ruleChildren = ['assert', 'report', 'let', 'extends', 'p', 'include'];

	test('elements: with the Schematron namespace as the default - no prefix, as most Schematron files are written', async () => {
		const names = await completions(unprefixed('<pattern><rule context="a">\n<|\n</rule></pattern>'));
		assert.includeMembers(names, ruleChildren, names.join(', '));
		assert.isFalse(names.some((name) => name.startsWith('sch:')), names.join(', '));
	});

	test('elements: with the prefix of sch:schema, e.g. sch or iso', async () => {
		const names = await completions(prefixed('<sch:pattern><sch:rule context="a">\n<|\n</sch:rule></sch:pattern>'));
		assert.includeMembers(names, ruleChildren.map((name) => 'sch:' + name), names.join(', '));
		const iso = await completions(`<iso:schema xmlns:iso="http://purl.oclc.org/dsdl/schematron"><iso:pattern><iso:rule context="a">\n<|\n</iso:rule></iso:pattern></iso:schema>`);
		assert.includeMembers(iso, ruleChildren.map((name) => 'iso:' + name), iso.join(', '));
	});

	test('ISO Schematron 2025, as SchXslt2 implements it: groups, parameters and the XSLT declarations it copies', async () => {
		const schemaChildren = await completions(unprefixed('<|'));
		assert.includeMembers(schemaChildren, ['ns', 'let', 'param', 'phase', 'pattern', 'group', 'include', 'diagnostics', 'properties',
			'xsl:function', 'xsl:key', 'xsl:accumulator', 'xsl:include', 'xsl:import', 'xsl:use-package'], schemaChildren.join(', '));
		// not Schematron 1.5's key, nor XSLT declarations SchXslt2 ignores
		for (const name of ['key', 'xsl:param', 'xsl:variable', 'xsl:template']) {
			assert.notInclude(schemaChildren, name, schemaChildren.join(', '));
		}
		const assertAttributes = await completions(unprefixed('<pattern><rule context="a"><assert | test="1"/></rule></pattern>'));
		assert.includeMembers(assertAttributes, ['severity', 'properties', 'flag', 'diagnostics', 'role', 'subject', 'id'], assertAttributes.join(', '));
		const severities = await completions(unprefixed('<pattern><rule context="a"><assert severity="|" test="1"/></rule></pattern>'));
		assert.includeMembers(severities, ['info', 'warning', 'error', 'fatal'], severities.join(', '));
		const phaseAttributes = await completions(unprefixed('<phase | id="p"/>'));
		assert.includeMembers(phaseAttributes, ['from', 'when'], phaseAttributes.join(', '));
		const ruleAttributes = await completions(unprefixed('<pattern><rule | context="a"/></pattern>'));
		assert.includeMembers(ruleAttributes, ['visit-each', 'abstract', 'flag'], ruleAttributes.join(', '));
		const patternAttributes = await completions(unprefixed('<pattern |/>'));
		assert.includeMembers(patternAttributes, ['abstract', 'is-a', 'documents'], patternAttributes.join(', '));
	});

	test('formatting: end tags with no prefix are outdented', async () => {
		const file = path.join(dir, `format${count++}.sch`);
		fs.writeFileSync(file, unprefixed('<pattern>\n<rule context="a">\n<assert test="1"/>\n</rule>\n</pattern>'));
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, { tabSize: 2, insertSpaces: true });
		const edit = new vscode.WorkspaceEdit();
		edit.set(document.uri, edits ?? []);
		await vscode.workspace.applyEdit(edit);
		assert.deepEqual(document.getText().split('\n').slice(1, 6), ['  <pattern>', '    <rule context="a">', '      <assert test="1"/>', '    </rule>', '  </pattern>']);
	});

	test('the outline and breadcrumbs: the elements as they\'re written - with no prefix, or the file\'s', async () => {
		const outline = async (content: string) => {
			const file = path.join(dir, `outline${count++}.sch`);
			fs.writeFileSync(file, content);
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
			const names = (list: vscode.DocumentSymbol[]): string[] => list.filter((s) => s.name !== 'attributes').flatMap((s) => [s.name, ...names(s.children)]);
			return names(symbols ?? []);
		};
		assert.deepEqual(await outline(unprefixed('<pattern id="p"><rule context="a"><assert test="1"/></rule></pattern>')), ['schema', 'pattern', 'rule', 'assert']);
		assert.deepEqual(await outline(prefixed('<sch:pattern id="p"><sch:rule context="a"><sch:assert test="1"/></sch:rule></sch:pattern>')), ['sch:schema', 'sch:pattern', 'sch:rule', 'sch:assert']);
	});
});
