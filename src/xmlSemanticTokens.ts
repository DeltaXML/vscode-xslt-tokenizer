/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import { XSLTokenLevelState, XslLexer } from './xslLexer';

// a token: a CDATA section's '<![CDATA[' and ']]>' as tag punctuation, its content as text - each on one line - or the
// name of a namespace declaration, e.g. xmlns:xsi
export interface XmlToken {
	line: number;
	character: number;
	length: number;
	kind: 'punctuation' | 'text' | 'xmlns';
}

const cdataStart = '<![CDATA[';
const cdataEnd = ']]>';
// an attribute in a start tag: the whitespace before it, its name, and its quoted value
const attributePattern = /(\s+)([^\s=/>]+)\s*=\s*(?:"[^"]*"|'[^']*')/y;

// semantic tokens for an XML file, as in XSLT, where VS Code's XML grammar colors differently: a CDATA section, which the
// grammar colors as a whole - its delimiters and content - as a string, has its delimiters colored as tag punctuation and
// its content as text; a namespace declaration's name, e.g. xmlns:xsi, which the grammar colors as an attribute name, has
// its own token type. Only these have tokens, so everything else keeps the grammar's colors. They're found by a scan of
// the text, not the lexer, so a large file is quick: markup within a comment, processing instruction or CDATA section
// isn't read
export class XmlSemanticTokens implements vscode.DocumentSemanticTokensProvider {

	public static activate(context: vscode.ExtensionContext, legend: vscode.SemanticTokensLegend) {
		context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'xml' }, new XmlSemanticTokens(), legend));
	}

	public provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
		const start = XslLexer.getXsltStartTokenNumber();
		const types = { punctuation: start + XSLTokenLevelState.xmlPunctuation, text: start + XSLTokenLevelState.xmlText, xmlns: start + XSLTokenLevelState.xmlnsName };
		const builder = new vscode.SemanticTokensBuilder();
		XmlSemanticTokens.tokens(document.getText()).forEach((t) => builder.push(t.line, t.character, t.length, types[t.kind], 0));
		return builder.build();
	}

	// the tokens of the text's CDATA sections and namespace declarations, in order - a CDATA section not yet ended, e.g.
	// while it's typed, runs to the end
	public static tokens(text: string): XmlToken[] {
		const tokens: XmlToken[] = [];
		if (!text.includes(cdataStart) && !text.includes('xmlns')) {
			return tokens;
		}
		const lineStarts = [0];
		for (let i = 0; i < text.length; i++) {
			const ch = text.charCodeAt(i);
			if (ch === 10 || (ch === 13 && text.charCodeAt(i + 1) !== 10)) {
				lineStarts.push(i + 1);
			}
		}
		// the line of an offset: the last line start at or before it
		let lineIndex = 0;
		const positionOf = (offset: number) => {
			while (lineIndex + 1 < lineStarts.length && lineStarts[lineIndex + 1] <= offset) {
				lineIndex++;
			}
			return { line: lineIndex, character: offset - lineStarts[lineIndex] };
		};
		// a span within the text, as a token for each line it's on - without the line ends
		const add = (from: number, to: number, kind: XmlToken['kind']) => {
			let offset = from;
			while (offset < to) {
				const { line } = positionOf(offset);
				const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length;
				let end = Math.min(to, lineEnd);
				// not the line's end, \n or \r\n
				let tokenEnd = end;
				while (tokenEnd > offset && (text.charCodeAt(tokenEnd - 1) === 10 || text.charCodeAt(tokenEnd - 1) === 13) && end === lineEnd) {
					tokenEnd--;
				}
				if (tokenEnd > offset) {
					tokens.push({ ...positionOf(offset), length: tokenEnd - offset, kind });
				}
				offset = end;
			}
		};
		let i = 0;
		while (i < text.length) {
			const lt = text.indexOf('<', i);
			if (lt < 0) {
				break;
			}
			if (text.startsWith('<!--', lt)) {
				const close = text.indexOf('-->', lt + 4);
				i = close < 0 ? text.length : close + 3;
			} else if (text.startsWith('<?', lt)) {
				const close = text.indexOf('?>', lt + 2);
				i = close < 0 ? text.length : close + 2;
			} else if (text.startsWith(cdataStart, lt)) {
				const contentStart = lt + cdataStart.length;
				const close = text.indexOf(cdataEnd, contentStart);
				const contentEnd = close < 0 ? text.length : close;
				add(lt, contentStart, 'punctuation');
				add(contentStart, contentEnd, 'text');
				if (close > -1) {
					add(close, close + cdataEnd.length, 'punctuation');
				}
				i = close < 0 ? text.length : close + cdataEnd.length;
			} else if (/^<[^\s/>!?]/.test(text.substring(lt, lt + 2))) {
				// a start tag: its attributes, for the names of namespace declarations - to its '>', outside quotes
				const name = /^<[^\s/>]+/.exec(text.substring(lt, lt + 300));
				let j = lt + (name ? name[0].length : 1);
				attributePattern.lastIndex = j;
				let attribute: RegExpExecArray | null;
				while ((attribute = attributePattern.exec(text)) !== null) {
					if (/^xmlns(:[^\s=]+)?$/.test(attribute[2])) {
						add(attribute.index + attribute[1].length, attribute.index + attribute[1].length + attribute[2].length, 'xmlns');
					}
					j = attributePattern.lastIndex;
				}
				const close = text.indexOf('>', j);
				i = close < 0 ? text.length : close + 1;
			} else {
				i = lt + 1;
			}
		}
		return tokens;
	}
}
