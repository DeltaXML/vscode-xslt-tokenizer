/**
 * Test suite for DiskTextDocument: the text of a file as it is on disk, for the MCP tools - when VS Code's copy of a file
 * changed outside it - an AI agent editing files directly - isn't updated
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { DiskTextDocument } from '../../src/mcp/diskTextDocument';

suite('DiskTextDocument', function () {
	this.timeout(30000);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-doc-'));
	suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('the same as VS Code\'s document for the same text: lines, offsets, positions, ranges and words', async () => {
		const text = 'one two\n  three\r\n\nfour\r\n';
		const file = path.join(dir, 'same.txt');
		fs.writeFileSync(file, text);
		const real = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
		const disk = new DiskTextDocument(real.uri, real.languageId, real.version, real.getText(), real.eol);
		assert.strictEqual(disk.lineCount, real.lineCount);
		for (let line = 0; line < real.lineCount; line++) {
			const a = real.lineAt(line);
			const b = disk.lineAt(line);
			assert.deepEqual([b.lineNumber, b.text, b.firstNonWhitespaceCharacterIndex, b.isEmptyOrWhitespace], [a.lineNumber, a.text, a.firstNonWhitespaceCharacterIndex, a.isEmptyOrWhitespace]);
			assert.isTrue(b.range.isEqual(a.range), `range of line ${line}`);
			assert.isTrue(b.rangeIncludingLineBreak.isEqual(a.rangeIncludingLineBreak), `range including the line break of line ${line}`);
		}
		for (let offset = -1; offset <= real.getText().length + 1; offset++) {
			assert.isTrue(disk.positionAt(offset).isEqual(real.positionAt(offset)), `positionAt ${offset}`);
		}
		for (const position of [new vscode.Position(0, 3), new vscode.Position(1, 99), new vscode.Position(9, 9), new vscode.Position(2, 0)]) {
			assert.strictEqual(disk.offsetAt(position), real.offsetAt(position), `offsetAt ${position.line}:${position.character}`);
			assert.isTrue(disk.validatePosition(position).isEqual(real.validatePosition(position)), 'validatePosition');
		}
		const range = new vscode.Range(0, 4, 3, 2);
		assert.strictEqual(disk.getText(range), real.getText(range));
		assert.strictEqual(disk.getText(), real.getText());
		assert.deepEqual(disk.getWordRangeAtPosition(new vscode.Position(1, 4))?.start.character, real.getWordRangeAtPosition(new vscode.Position(1, 4))?.start.character);
		assert.strictEqual(disk.eol, real.eol);
		assert.strictEqual(disk.fileName, real.fileName);
	});

	test('VS Code\'s document when its text is the file\'s - also with other line ends or a BOM; the file\'s text when it was changed outside VS Code', async () => {
		const file = path.join(dir, 'changed.xsl');
		fs.writeFileSync(file, 'one\ntwo\n');
		const uri = vscode.Uri.file(file);
		const real = await vscode.workspace.openTextDocument(uri);
		assert.strictEqual(await DiskTextDocument.current(uri), real);
		// the same text, with a byte order mark and other line ends
		fs.writeFileSync(file, '﻿one\r\ntwo\r\n');
		assert.strictEqual(await DiskTextDocument.current(uri), real);
		// changed: a document is not VS Code's own, VS Code's copy not being updated - with the text on disk
		fs.writeFileSync(file, 'one\nthree\n');
		const current = await DiskTextDocument.current(uri);
		assert.strictEqual(current.getText(), 'one\nthree\n');
		assert.strictEqual(current.lineAt(1).text, 'three');
		assert.strictEqual(current.languageId, real.languageId);
		// not in another encoding than UTF-8: left to VS Code
		fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0x61, 0x00]));
		assert.strictEqual(await DiskTextDocument.current(uri), await vscode.workspace.openTextDocument(uri));
		fs.writeFileSync(file, Buffer.from([0x61, 0xe9, 0x62]));
		assert.strictEqual(await DiskTextDocument.current(uri), await vscode.workspace.openTextDocument(uri));
	});
});
