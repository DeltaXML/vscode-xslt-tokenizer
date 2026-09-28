/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import { RecordTypes } from './recordTypes';
import { SchemaQuery } from './schemaQuery';
import { XSLTConfiguration } from './languageConfigurations';

// an instruction, or a literal result element, to wrap the selected instructions in: its start and end lines, as
// snippet text, with '\t' for each indentation step - the selection is the content of the element 'contentParent',
// at 'depth' steps
export interface Wrapper {
	name: string;
	open: string[];
	close: string[];
	depth: number;
	contentParent: string;
}

// the name of the wrapper for a literal result element
export const literalElement = 'literal element';

export const wrappers: Wrapper[] = [
	{ name: 'xsl:if', open: ['<xsl:if test="${1}">'], close: ['</xsl:if>'], depth: 1, contentParent: 'xsl:if' },
	{ name: 'xsl:choose', open: ['<xsl:choose>', '\t<xsl:when test="${1}">'], close: ['\t</xsl:when>', '\t<xsl:otherwise>${0}</xsl:otherwise>', '</xsl:choose>'], depth: 2, contentParent: 'xsl:when' },
	{ name: 'xsl:for-each', open: ['<xsl:for-each select="${1}">'], close: ['</xsl:for-each>'], depth: 1, contentParent: 'xsl:for-each' },
	{ name: 'xsl:for-each-group', open: ['<xsl:for-each-group select="${1}" group-by="${2}">'], close: ['</xsl:for-each-group>'], depth: 1, contentParent: 'xsl:for-each-group' },
	{ name: 'xsl:where-populated', open: ['<xsl:where-populated>'], close: ['</xsl:where-populated>${0}'], depth: 1, contentParent: 'xsl:where-populated' },
	{ name: 'xsl:try', open: ['<xsl:try>'], close: ['\t<xsl:catch>${0}</xsl:catch>', '</xsl:try>'], depth: 1, contentParent: 'xsl:try' },
	{ name: 'xsl:variable', open: ['<xsl:variable name="${1:name}">'], close: ['</xsl:variable>'], depth: 1, contentParent: 'xsl:variable' },
	{ name: 'xsl:copy', open: ['<xsl:copy>'], close: ['</xsl:copy>${0}'], depth: 1, contentParent: 'xsl:copy' },
	{ name: 'xsl:element', open: ['<xsl:element name="${1}">'], close: ['</xsl:element>'], depth: 1, contentParent: 'xsl:element' },
	{ name: 'xsl:result-document', open: ['<xsl:result-document href="${1}">'], close: ['</xsl:result-document>'], depth: 1, contentParent: 'xsl:result-document' },
	{ name: 'xsl:message', open: ['<xsl:message>'], close: ['</xsl:message>${0}'], depth: 1, contentParent: 'xsl:message' },
	{ name: literalElement, open: ['<${1:div}>'], close: ['</${1:div}>'], depth: 1, contentParent: 'xsl:if' }
];

// the wrappers chosen before, most recent first - listed first
const recentWrappers: string[] = [];

// the range [start, end) of the instructions to wrap: the selection, if it's a sequence of complete elements - with
// any text or comments between them - or for an empty selection, the element whose start tag is at the offset -
// undefined if it's neither. This is checked for each code action request, so it only looks at the text around the
// selection
export function wrapTarget(text: string, start: number, end: number): { start: number, end: number } | undefined {
	const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
	if (start === end) {
		const tagStart = text.lastIndexOf('<', start);
		if (tagStart < 0 || '/!?'.includes(text.charAt(tagStart + 1))) {
			return undefined;
		}
		const startRgx = new RegExp(RecordTypes.tagPattern, 'y');
		startRgx.lastIndex = tagStart;
		const startTag = startRgx.exec(text);
		if (!startTag || startRgx.lastIndex < start || startTag[1]) {
			return undefined;
		}
		if (startTag[3]) {
			return { start: tagStart, end: startRgx.lastIndex };
		}
		// the matching end tag
		const markup = RecordTypes.blankMarkup(text.substring(tagStart));
		tagRgx.lastIndex = startTag[0].length;
		let depth = 1;
		let match: RegExpExecArray | null;
		while ((match = tagRgx.exec(markup)) !== null) {
			if (match[1]) {
				if (--depth === 0) {
					return { start: tagStart, end: tagStart + tagRgx.lastIndex };
				}
			} else if (!match[3]) {
				depth++;
			}
		}
		return undefined;
	}
	const selection = text.substring(start, end);
	const leading = selection.length - selection.trimStart().length;
	const trimmed = selection.trim();
	if (!trimmed.startsWith('<') || trimmed.startsWith('</') || !trimmed.endsWith('>')) {
		return undefined;
	}
	const markup = RecordTypes.blankMarkup(trimmed);
	if (markup.charAt(0) !== '<') {
		// a comment, CDATA section or processing instruction
		return undefined;
	}
	let depth = 0;
	let hasElement = false;
	let match: RegExpExecArray | null;
	while ((match = tagRgx.exec(markup)) !== null) {
		if (match[1]) {
			if (--depth < 0) {
				return undefined;
			}
		} else {
			hasElement = true;
			if (!match[3]) {
				depth++;
			}
		}
	}
	// the markup outside tags mustn't contain an unmatched '<', e.g. from a partly selected tag
	const outsideTags = markup.replace(new RegExp(RecordTypes.tagPattern, 'g'), '');
	return depth === 0 && hasElement && !outsideTags.includes('<') ? { start: start + leading, end: start + leading + trimmed.length } : undefined;
}

// the wrappers allowed in the element containing the target, that can contain the target's elements - using the
// XSLT 3.0 or 4.0 schema - with the recently chosen wrappers first
export function wrappersFor(text: string, target: { start: number, end: number }, isVersion4: boolean): Wrapper[] {
	const schemaQuery = new SchemaQuery(isVersion4 ? XSLTConfiguration.schemaData4 : XSLTConfiguration.configuration.schemaData!);
	const expectedElements = (name: string) => {
		// a literal result element has a sequence constructor, as xsl:if does
		const elements = schemaQuery.getExpected(name.startsWith('xsl:') ? name : 'xsl:if').elements.map((e) => e[0]);
		// a sequence constructor allows literal result elements
		return elements.includes('xsl:sequence') ? elements.concat(literalElement) : elements;
	};
	const ancestors = RecordTypes.openElements(RecordTypes.blankMarkup(text.substring(0, target.start)), target.start);
	const parent = ancestors[ancestors.length - 1];
	if (!parent) {
		return [];
	}
	const allowedInParent = expectedElements(parent.name);
	// the elements of the target, at its top level
	const selectedNames: string[] = [];
	const tagRgx = new RegExp(RecordTypes.tagPattern, 'g');
	const markup = RecordTypes.blankMarkup(text.substring(target.start, target.end));
	let depth = 0;
	let match: RegExpExecArray | null;
	while ((match = tagRgx.exec(markup)) !== null) {
		if (match[1]) {
			depth--;
		} else {
			if (depth === 0) {
				selectedNames.push(match[2].startsWith('xsl:') ? match[2] : literalElement);
			}
			depth += match[3] ? 0 : 1;
		}
	}
	const allowed = wrappers.filter((wrapper) => {
		const content = expectedElements(wrapper.contentParent);
		return allowedInParent.includes(wrapper.name) && selectedNames.every((name) => content.includes(name));
	});
	const recency = (wrapper: Wrapper) => {
		const index = recentWrappers.indexOf(wrapper.name);
		return index === -1 ? recentWrappers.length : index;
	};
	return allowed.sort((a, b) => recency(a) - recency(b));
}

export function addRecentWrapper(name: string) {
	const index = recentWrappers.indexOf(name);
	if (index > -1) {
		recentWrappers.splice(index, 1);
	}
	recentWrappers.unshift(name);
}

// the edit for the wrapper: when the target starts and ends its lines, the range is its whole lines, and the lines
// of the target are indented by the wrapper's depth - otherwise it's wrapped where it is, on one line
export function wrapEdit(text: string, target: { start: number, end: number }, wrapper: Wrapper, indentUnit: string): { start: number, end: number, snippet: string } {
	const escape = (s: string) => s.replace(/[$}\\]/g, '\\$&');
	const lineStart = text.lastIndexOf('\n', target.start - 1) + 1;
	const lineEndIndex = text.indexOf('\n', target.end);
	const lineEnd = lineEndIndex === -1 ? text.length : (text.charAt(lineEndIndex - 1) === '\r' ? lineEndIndex - 1 : lineEndIndex);
	const isWholeLines = text.substring(lineStart, target.start).trim() === '' && text.substring(target.end, lineEnd).trim() === '';
	if (!isWholeLines) {
		const inline = (lines: string[]) => lines.map((line) => line.replace(/^\t+/, '')).join('');
		return { start: target.start, end: target.end, snippet: inline(wrapper.open) + escape(text.substring(target.start, target.end)) + inline(wrapper.close) };
	}
	const newLine = text.includes('\r\n') ? '\r\n' : '\n';
	const indent = text.substring(lineStart, target.start);
	const step = (line: string) => line.replace(/^\t+/, (tabs) => indentUnit.repeat(tabs.length));
	const content = text.substring(lineStart, lineEnd).split(/\r?\n/).map((line) => line.trim() === '' ? '' : indentUnit.repeat(wrapper.depth) + escape(line));
	const lines = wrapper.open.map((line) => indent + step(line)).concat(content, wrapper.close.map((line) => indent + step(line)));
	return { start: lineStart, end: lineEnd, snippet: lines.join(newLine) };
}

// the 'Wrap with...' command: a quick pick of the wrappers for the target, then the snippet edit - from the code
// action, with its document and selection, or from the Command Palette, for the active editor's selection
export async function wrapWith(uri?: vscode.Uri, start?: number, end?: number) {
	const editor = uri ? vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString()) : vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	const text = editor.document.getText();
	const target = wrapTarget(text, start ?? editor.document.offsetAt(editor.selection.start), end ?? editor.document.offsetAt(editor.selection.end));
	if (!target) {
		vscode.window.showInformationMessage('Select complete elements, or place the cursor on a start tag, to wrap them');
		return;
	}
	const isVersion4 = /\sversion\s*=\s*["']4\.0["']/.test(text.substring(0, 3000));
	const available = wrappersFor(text, target, isVersion4);
	if (available.length === 0) {
		vscode.window.showInformationMessage('No instruction can wrap the selection here');
		return;
	}
	const picked = await vscode.window.showQuickPick(available.map((wrapper) => ({ label: wrapper.name, wrapper })), { placeHolder: 'Wrap with...' });
	if (!picked) {
		return;
	}
	addRecentWrapper(picked.wrapper.name);
	const insertSpaces = editor.options.insertSpaces !== false;
	const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 2;
	const edit = wrapEdit(text, target, picked.wrapper, insertSpaces ? ' '.repeat(tabSize) : '\t');
	const range = new vscode.Range(editor.document.positionAt(edit.start), editor.document.positionAt(edit.end));
	await editor.insertSnippet(new vscode.SnippetString(edit.snippet), range, { undoStopBefore: true, undoStopAfter: true, keepWhitespace: true });
}
