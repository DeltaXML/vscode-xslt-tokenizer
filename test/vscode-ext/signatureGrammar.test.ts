/**
 * Test suite for the TextMate grammars of the signatures in hovers - syntaxes/xpath-signature.tmLanguage.json, with the
 * types after 'as' from syntaxes/xpath-type.tmLanguage.json - for the language 'xpath-signature': the scopes of the
 * parts of each kind of signature, from VS Code's tokenization of a file in the language.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XSLTHoverProvider } from '../../src/xsltHoverProvider';

// the tokens of the signature, as [text, scope] - with the last scope of each token, other than the grammar's own
async function tokens(dir: string, index: number, signature: string): Promise<[string, string][]> {
	const file = path.join(dir, `signature${index}.xpsig`);
	fs.writeFileSync(file, signature);
	const captured = await vscode.commands.executeCommand<{ c: string, t: string }[]>('_workbench.captureSyntaxTokens', vscode.Uri.file(file));
	return captured.filter((t) => t.c.trim() !== '').map((t) => [t.c, t.t.split(' ').filter((scope) => !scope.startsWith('source.')).pop() ?? '']);
}

const cases: [string, string, [string, string][]][] = [
	['a function', 'cx:area($shape as cx:shape) as xs:double', [
		['cx:area', 'entity.name.function.xpath'], ['$shape', 'variable.parameter.xpath'], ['as', 'keyword.other.as.xpath'],
		['cx:shape', 'entity.name.type.xpath'], ['xs:double', 'support.type.builtin.xpath']
	]],
	['a template, with a default', `template draw($label as xs:string := 'shape')`, [
		['template', 'keyword.other.template.xpath'], ['draw', 'entity.name.function.xpath'], ['$label', 'variable.parameter.xpath'],
		[':=', 'keyword.operator.assignment.xpath'], [`'shape'`, 'string.quoted.single.xpath']
	]],
	['a record type', `type cx:shape as record(name as xs:string, size? as xs:double, 'unit name' as map(xs:string, record(a as item()*)))`, [
		['type', 'keyword.other.type.xpath'], ['cx:shape', 'entity.name.type.xpath'], ['record', 'storage.type.record.xpath'],
		['name', 'variable.other.property.xpath'], ['size', 'variable.other.property.xpath'], ['?', 'keyword.operator.optional.xpath'],
		[`'unit name'`, 'variable.other.property.xpath'], ['map', 'storage.type.xpath'], ['a', 'variable.other.property.xpath'],
		['item', 'storage.type.xpath'], ['*', 'keyword.operator.occurrence.xpath']
	]],
	['an enumeration type', `type cx:colour as enum('red', 'green')`, [
		['enum', 'storage.type.enum.xpath'], [`'red'`, 'string.quoted.single.xpath'], [`'green'`, 'string.quoted.single.xpath']
	]],
	['a record field', 'size? as xs:double', [
		['size', 'variable.other.property.xpath'], ['?', 'keyword.operator.optional.xpath'], ['as', 'keyword.other.as.xpath']
	]],
	['a variable, with a choice type', `$c as (cx:colour | enum('none'))*`, [
		['$c', 'variable.parameter.xpath'], ['cx:colour', 'entity.name.type.xpath'], ['|', 'keyword.operator.choice.xpath'],
		['enum', 'storage.type.enum.xpath'], ['*', 'keyword.operator.occurrence.xpath']
	]],
	['a function type', '$f as fn(xs:string) as xs:integer', [
		['fn', 'storage.type.function.xpath'], ['xs:string', 'support.type.builtin.xpath'], ['xs:integer', 'support.type.builtin.xpath']
	]],
	['a module', 'module shapes-types.xsl', [
		['module', 'keyword.other.module.xpath'], ['shapes-types.xsl', 'string.unquoted.module.xpath']
	]],
];

suite('Signature grammar', () => {
	let dir: string;
	suiteSetup(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signature-grammar-'));
		// the language has no file extension of its own, as it's only for hovers
		await vscode.workspace.getConfiguration('files').update('associations', { '*.xpsig': XSLTHoverProvider.signatureLanguage }, vscode.ConfigurationTarget.Global);
	});
	suiteTeardown(async () => {
		await vscode.workspace.getConfiguration('files').update('associations', undefined, vscode.ConfigurationTarget.Global);
		fs.rmSync(dir, { recursive: true, force: true });
	});

	cases.forEach(([label, signature, expected], index) => {
		test(label, async () => {
			const found = await tokens(dir, index, signature);
			expected.forEach(([text, scope]) => {
				assert.isTrue(found.some(([t, s]) => t === text && s === scope), `'${text}' as ${scope} in: ${JSON.stringify(found)}`);
			});
		});
	});

	test('in a record type, as is a keyword, not a type name', async () => {
		const found = await tokens(dir, 100, 'type p as record(name as xs:string)');
		assert.deepEqual(found.filter(([t]) => t === 'as').map(([, s]) => s), ['keyword.other.as.xpath', 'keyword.other.as.xpath']);
	});
});
