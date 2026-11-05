import * as fs from 'fs';
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { XSpecBreakpoints } from '../../src/xspecBreakpoints';

suite('XSpec: breakpoints where there\'s no step', () => {
	const file = path.resolve(__dirname, '../../../sample/xspec-demo/lib/currency.xspec');
	const text = fs.readFileSync(file, 'utf8');
	// 1-based lines, as in the editor
	const step = (line: number) => {
		const result = XSpecBreakpoints.stepLine(text, line - 1);
		return result === undefined ? undefined : result + 1;
	};

	test('the step for a line: itself on a step; the x:call for its x:param; the scenario for its end tag; none outside the scenarios', () => {
		assert.strictEqual(step(16), 16, 'x:scenario');
		assert.strictEqual(step(17), 17, 'x:call');
		assert.strictEqual(step(18), 17, 'x:param in the x:call');
		assert.strictEqual(step(20), 17, 'x:call end tag');
		assert.strictEqual(step(21), 21, 'x:expect');
		assert.strictEqual(step(22), 16, 'x:scenario end tag');
		assert.isUndefined(step(5), 'a comment');
		assert.isUndefined(step(23), 'between scenarios');
		assert.strictEqual(step(26), 25, 'x:param in the second x:call');
	});

	test('a breakpoint added on an x:param is moved to its x:call', async () => {
		const uri = vscode.Uri.file(file);
		await vscode.extensions.getExtension('deltaxml.xslt-xpath')?.activate();
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
		vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(17, 0)), true, 'true()')]);
		const lines = () => vscode.debug.breakpoints.filter((b): b is vscode.SourceBreakpoint => b instanceof vscode.SourceBreakpoint).map((b) => b.location.range.start.line + 1);
		for (let i = 0; i < 50 && lines()[0] !== 17; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.deepEqual(lines(), [17]);
		assert.strictEqual((vscode.debug.breakpoints[0] as vscode.SourceBreakpoint).condition, 'true()', 'the condition is kept');
		vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
	});
});
