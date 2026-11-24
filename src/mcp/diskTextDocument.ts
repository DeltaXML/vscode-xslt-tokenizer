/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as fs from 'fs';
import * as vscode from 'vscode';

// A file's text as it is on disk, as a read-only document. VS Code's copy of a file that isn't shown in an editor - or
// that's in no workspace folder, so isn't watched - isn't updated when the file is changed outside VS Code, e.g. by an AI
// agent that edits files directly: the MCP tools use this instead for such a file, so they check what's there now
export class DiskTextDocument implements vscode.TextDocument {
	public readonly isUntitled = false;
	public readonly isDirty = false;
	public readonly isClosed = false;
	public readonly encoding = 'utf8';
	public readonly fileName: string;
	private readonly lineStarts: number[];

	// the text of the file, with line ends as they are: from the document it's instead of
	public constructor(public readonly uri: vscode.Uri, public readonly languageId: string, public readonly version: number,
		private readonly text: string, public readonly eol: vscode.EndOfLine) {
		this.fileName = uri.fsPath;
		this.lineStarts = [0];
		for (let i = 0; i < text.length; i++) {
			if (text.charCodeAt(i) === 10) {
				this.lineStarts.push(i + 1);
			} else if (text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) !== 10) {
				this.lineStarts.push(i + 1);
			}
		}
	}

	// the document VS Code has for the file, or - when the file's text on disk is different, and the document has no unsaved
	// edits - a document with the text on disk. Not for a file in another encoding than UTF-8, which isn't compared
	public static async current(uri: vscode.Uri): Promise<vscode.TextDocument> {
		const document = await vscode.workspace.openTextDocument(uri);
		if (uri.scheme !== 'file' || document.isDirty) {
			return document;
		}
		let text: string;
		try {
			const bytes = fs.readFileSync(uri.fsPath);
			if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
				return document;
			}
			text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
		} catch {
			return document;
		}
		const lines = (value: string) => value.replace(/\r\n?/g, '\n');
		return lines(text) === lines(document.getText()) ? document : new DiskTextDocument(uri, document.languageId, document.version, text, document.eol);
	}

	public get lineCount() {
		return this.lineStarts.length;
	}

	public save(): Thenable<boolean> {
		return Promise.resolve(false);
	}

	public lineAt(lineOrPosition: number | vscode.Position): vscode.TextLine {
		const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
		if (line < 0 || line >= this.lineStarts.length) {
			throw new Error('Illegal value for `line`');
		}
		const start = this.lineStarts[line];
		const next = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.text.length;
		const full = this.text.substring(start, next);
		const lineText = full.replace(/(\r\n|\r|\n)$/, '');
		const firstNonWhitespace = lineText.search(/\S/);
		return {
			lineNumber: line,
			text: lineText,
			range: new vscode.Range(line, 0, line, lineText.length),
			rangeIncludingLineBreak: new vscode.Range(line, 0, line + 1 < this.lineStarts.length ? line + 1 : line, line + 1 < this.lineStarts.length ? 0 : lineText.length),
			firstNonWhitespaceCharacterIndex: firstNonWhitespace === -1 ? lineText.length : firstNonWhitespace,
			isEmptyOrWhitespace: firstNonWhitespace === -1
		};
	}

	public offsetAt(position: vscode.Position): number {
		const p = this.validatePosition(position);
		return this.lineStarts[p.line] + p.character;
	}

	public positionAt(offset: number): vscode.Position {
		const clamped = Math.max(0, Math.min(offset, this.text.length));
		let low = 0;
		let high = this.lineStarts.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (this.lineStarts[middle] <= clamped) {
				low = middle;
			} else {
				high = middle - 1;
			}
		}
		return new vscode.Position(low, clamped - this.lineStarts[low]);
	}

	public getText(range?: vscode.Range): string {
		if (!range) {
			return this.text;
		}
		const valid = this.validateRange(range);
		return this.text.substring(this.offsetAt(valid.start), this.offsetAt(valid.end));
	}

	public getWordRangeAtPosition(position: vscode.Position, regex = /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g): vscode.Range | undefined {
		const line = this.lineAt(this.validatePosition(position).line).text;
		const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
		for (const match of line.matchAll(new RegExp(regex.source, flags))) {
			if (match[0].length > 0 && match.index! <= position.character && position.character <= match.index! + match[0].length) {
				return new vscode.Range(position.line, match.index!, position.line, match.index! + match[0].length);
			}
		}
		return undefined;
	}

	public validateRange(range: vscode.Range): vscode.Range {
		return new vscode.Range(this.validatePosition(range.start), this.validatePosition(range.end));
	}

	public validatePosition(position: vscode.Position): vscode.Position {
		if (position.line < 0) {
			return new vscode.Position(0, 0);
		}
		if (position.line >= this.lineStarts.length) {
			return this.positionAt(this.text.length);
		}
		const lineLength = this.lineAt(position.line).text.length;
		return new vscode.Position(position.line, Math.max(0, Math.min(position.character, lineLength)));
	}
}
