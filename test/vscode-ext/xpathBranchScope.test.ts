/**
 * The scope of an XPath variable declared by for, let, some or every: it ends with the branch - return or satisfies - that
 * uses it, at a ',' or a closing bracket. After a cascade, e.g. let $v := 1 return if ($v) then 1 else 2, the ',' ends all
 * of its branches - so a $v after it is another variable, here a global one. Checked for Find All References (and so
 * Rename), Go to Definition and completion - and that a function call's arguments are counted after such a branch.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';

suite('XPath variables: the scope of a for, let, some or every - ended by a comma after its branches', function () {
	this.timeout(20000);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpath-branch-scope-'));
	let count = 0;

	// a stylesheet with a global $v, and a template with the expression: its document, and the offsets of the global's
	// declaration and of each $v in the expression
	const opened = async (expression: string) => {
		const content = ['<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">',
			'<xsl:variable name="v" select="0"/>',
			'<xsl:function name="f:two"><xsl:param name="a"/><xsl:param name="b"/><xsl:sequence select="$a, $b"/></xsl:function>',
			'<xsl:template match="/">', `<xsl:sequence select="${expression}"/>`, '</xsl:template>', '</xsl:stylesheet>'].join('\n');
		const file = path.join(dir, `scope${count++}.xsl`);
		fs.writeFileSync(file, content);
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const select = content.indexOf('select="', content.indexOf('<xsl:sequence select="', content.indexOf('xsl:template'))) + 'select="'.length;
		const uses = [...expression.matchAll(/\$v\b/g)].map((m) => select + m.index!);
		return { document, content, global: content.indexOf('name="v"') + 'name="'.length, uses, select };
	};
	const offsets = (document: vscode.TextDocument, locations: (vscode.Location | vscode.LocationLink)[] | undefined) =>
		(locations ?? []).map((l) => document.offsetAt('targetUri' in l ? l.targetSelectionRange?.start ?? l.targetRange.start : l.range.start));
	const references = async (document: vscode.TextDocument, offset: number) =>
		offsets(document, await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, document.positionAt(offset)));
	const definition = async (document: vscode.TextDocument, offset: number) =>
		offsets(document, await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, document.positionAt(offset + 1)));
	// a reference found at the $ of a use - or the name after it
	const isAt = (found: number[], use: number) => found.some((offset) => offset === use || offset === use + 1);

	// the expressions, each with the global $v used last - after a for, let, some or every whose branch is ended by ','
	const globalLast: { [name: string]: string } = {
		'let return': '(let $v := 1 return $v, $v)',
		'let return if-else': '(let $v := 1 return if ($v) then 1 else 2, $v)',
		'let return if-else-if': '(let $v := 1 return if ($v) then 1 else if ($v) then 2 else 3, $v)',
		'in a map entry': 'map { \'x\': let $v := 1 return if ($v) then 1 else 2, \'y\': $v }',
		'for, then some': '(for $v in 1 return $v, some $w in 1 satisfies $w, $v)',
		'else ends a return': '(if (1) then let $v := 1 return $v else $v)'
	};

	suiteSetup(async () => {
		// the first document checked waits for the extension's start-up
		const { document, global } = await opened('$v');
		await references(document, global);
	});

	test('Find All References of a global variable: its use after the branch, not the local variable\'s', async () => {
		for (const [name, expression] of Object.entries(globalLast)) {
			const { document, global, uses } = await opened(expression);
			const found = await references(document, global);
			const last = uses[uses.length - 1];
			assert.isTrue(isAt(found, last), `${name}: the global's use is found - ${JSON.stringify(found)}, uses ${JSON.stringify(uses)}`);
			uses.slice(0, -1).forEach((use) => assert.isFalse(isAt(found, use), `${name}: not the local's use at ${use}`));
		}
	});

	test('Go to Definition: the global variable after the branch, the local one in it', async () => {
		// the lines of the definitions found: the global $v's is line 1, the expression's line 4
		const lines = async (document: vscode.TextDocument, use: number) => (await definition(document, use)).map((o) => document.positionAt(o).line);
		for (const [name, expression] of Object.entries(globalLast)) {
			const { document, uses } = await opened(expression);
			assert.deepEqual(await lines(document, uses[uses.length - 1]), [1], `${name}: the global, for the use after the branch`);
			// a use in the branch, after the local's declaration: the local
			if (uses.length > 2) {
				assert.deepEqual(await lines(document, uses[1]), [4], `${name}: the local, in its branch`);
			}
		}
	});

	test('a function call\'s arguments are counted after a branch: f:two(let $v := 1 return $v, 2) is f:two#2', async () => {
		const { document, content } = await opened('f:two(let $v := 1 return $v, 2)');
		const call = content.lastIndexOf('f:two(');
		const declaration = content.indexOf('name="f:two"') + 'name="'.length;
		assert.isTrue(isAt(await references(document, declaration), call) || (await references(document, declaration)).some((o) => o >= call && o <= call + 3),
			`the call is a reference - ${JSON.stringify(await references(document, declaration))}, call at ${call}`);
		assert.isTrue((await definition(document, call + 2)).some((o) => o >= declaration - 1 && o <= declaration + 3), `Go to Definition from the call - ${JSON.stringify(await definition(document, call + 2))}`);
	});

	test('completion: a local variable is offered in its branch, not after the comma that ends it', async () => {
		// the variables offered at the '|', just after a '$'
		const variables = async (withCursor: string) => {
			const { document, select } = await opened(withCursor.replace('|', ''));
			const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(select + withCursor.indexOf('|')));
			return list.items.filter((item) => item.kind === vscode.CompletionItemKind.Variable).map((item) => typeof item.label === 'string' ? item.label : item.label.label);
		};
		assert.include(await variables('(let $local := 1 return $local + $|)'), '$local');
		assert.notInclude(await variables('(let $local := 1 return $local, $|)'), '$local');
		assert.notInclude(await variables('(let $local := 1 return if ($local) then 1 else 2, $|)'), '$local');
		assert.include(await variables('(let $a := 1, $local := 2 return if ($a) then 1 else $|)'), '$local');
	});
});
