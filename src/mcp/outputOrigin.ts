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
import * as path from 'path';
import { McpRoot } from './mcpRoot';
import { XsltDebugOutputs } from '../xsltDebug';
import { XmlElement, descendants, localName, parseXml } from '../xspecXml';

export interface OriginResult {
	text: string;
	isError: boolean;
}

// a part of an output line, with where it came from
interface Part {
	text: string;
	source?: { location: vscode.Location, kind?: string };
	input?: { location: vscode.Location, node: string };
}

// The output_origin tool: where a part of a stylesheet's output came from - the instruction that wrote it, in its template
// or function, and the input node it was written for - from the outputs of the last debug session in the window (Run and
// Debug, or Run Without Debugging, with SaxonJ), as Go to XSLT Source and Go to XSLT Input show them in the output view
export class OutputOrigin {
	private static readonly maxParts = 20;
	private static readonly maxText = 80;

	// output: an output's name, or its file name - the one output if there's one; line: 1-based; text: found in the output,
	// its occurrence'th time (1 by default)
	public static async describe(output?: string, line?: number, text?: string, occurrence = 1): Promise<OriginResult> {
		const outputs = XsltDebugOutputs.get();
		const names = outputs.names().filter((n) => outputs.text(n));
		if (names.length === 0) {
			return {
				text: 'No stylesheet output in this window: output_origin uses the output of the last debug session - run the stylesheet in VS Code ' +
					'with Run and Debug, or Run Without Debugging (SaxonJ), first. The outputs are kept until the next session, or until VS Code is restarted.',
				isError: true
			};
		}
		let name: string | undefined;
		if (output) {
			name = names.find((n) => n === output) ?? names.find((n) => path.basename(n) === path.basename(output) ||
				outputs.info(n)?.uri !== undefined && OutputOrigin.uriPath(outputs.info(n)!.uri!) === OutputOrigin.resolve(output));
			if (!name) {
				return { text: `No output '${output}' - the outputs of the last session are:\n${OutputOrigin.list(names)}`, isError: true };
			}
		} else if (text !== undefined) {
			name = names.find((n) => outputs.text(n)!.includes(text));
		} else {
			name = names.length === 1 ? names[0] : undefined;
		}
		if (line === undefined && text === undefined || !name) {
			const why = text !== undefined && !name ? `The text isn't in any output.\n\n` : '';
			return {
				text: `${why}The outputs of the last debug session${OutputOrigin.when()}:\n${OutputOrigin.list(names)}\n\nGive an output (if there's more than one) and a line, or text to find in it.`,
				isError: !!why
			};
		}
		const outputText = outputs.text(name)!;
		const info = outputs.info(name)!;
		let start: number;
		let end: number;
		if (text !== undefined) {
			let found = -1;
			for (let n = 0; n < Math.max(occurrence, 1); n++) {
				found = outputText.indexOf(text, found + 1);
				if (found < 0) {
					return { text: `'${text}' is in ${name} ${n === 0 ? 'nowhere' : `only ${n} time${n === 1 ? '' : 's'}`}`, isError: true };
				}
			}
			start = found;
			end = found + Math.max(text.length, 1);
		} else {
			const lineStarts = [0];
			for (let i = outputText.indexOf('\n'); i > -1; i = outputText.indexOf('\n', i + 1)) {
				lineStarts.push(i + 1);
			}
			if (line! < 1 || line! > lineStarts.length) {
				return { text: `${name} has ${lineStarts.length} line${lineStarts.length === 1 ? '' : 's'} - no line ${line}`, isError: true };
			}
			start = lineStarts[line! - 1];
			end = line! < lineStarts.length ? lineStarts[line!] - 1 : outputText.length;
		}
		const lineNumber = outputText.substring(0, start).split('\n').length;
		const lines: string[] = [`Output ${name}${OutputOrigin.when()}, line ${lineNumber}: ${OutputOrigin.short(outputText.substring(outputText.lastIndexOf('\n', start - 1) + 1, OutputOrigin.lineEnd(outputText, start)).trim())}`];
		if (info.method !== 'xml') {
			lines.push(`Its output method is '${info.method}': only XML output is traced back to the stylesheet.`);
			return { text: lines.join('\n'), isError: true };
		}
		const parts = await OutputOrigin.parts(name, outputText, start, end);
		if (parts.length === 0) {
			lines.push('Where this part of the output came from isn\'t known.');
			return { text: lines.join('\n'), isError: false };
		}
		const parsed = new Map<string, XmlElement | undefined>();
		const documentText = async (uri: vscode.Uri) => (await vscode.workspace.openTextDocument(uri)).getText();
		const parse = async (uri: vscode.Uri) => {
			if (!parsed.has(uri.fsPath)) {
				parsed.set(uri.fsPath, parseXml(await documentText(uri)));
			}
			return parsed.get(uri.fsPath);
		};
		for (const part of parts.slice(0, OutputOrigin.maxParts)) {
			lines.push('', `${OutputOrigin.short(part.text)}`);
			if (part.source) {
				const { location, kind } = part.source;
				const sourceText = await documentText(location.uri);
				const offset = OutputOrigin.offsetOf(sourceText, location.range.start);
				const what = kind === 'source' ? 'copied from a source document node' : kind === 'text' ? 'literal text in the stylesheet' : 'written by';
				lines.push(`  ${what}: ${OutputOrigin.shown(location.uri.fsPath)}:${location.range.start.line + 1}  ${OutputOrigin.short(OutputOrigin.tagAt(sourceText, offset))}`);
				const root = kind === 'source' ? undefined : await parse(location.uri);
				const declaration = root ? OutputOrigin.declaration(root, offset, sourceText) : undefined;
				if (declaration) {
					lines.push(`  in: ${declaration}`);
				}
			} else if (part.text.startsWith('<?xml ')) {
				lines.push('  the XML declaration, written by the serializer (xsl:output)');
			} else {
				lines.push('  where it came from isn\'t known');
			}
			if (part.input) {
				const { location, node } = part.input;
				const root = await parse(location.uri);
				const inputText = await documentText(location.uri);
				const element = root ? [root, ...descendants(root)].find((e) => e.start === OutputOrigin.offsetOf(inputText, location.range.start)) : undefined;
				const xpath = element ? OutputOrigin.path(element) + OutputOrigin.nodeStep(node) : undefined;
				lines.push(`  input: ${xpath ?? XsltDebugOutputs.inputNodeName(node)} - ${OutputOrigin.shown(location.uri.fsPath)}:${location.range.start.line + 1}`);
			}
		}
		if (parts.length > OutputOrigin.maxParts) {
			lines.push('', `... ${parts.length - OutputOrigin.maxParts} more parts on the line`);
		}
		if (info.truncated) {
			lines.push('', 'Only the first part of this output was kept by the debugger.');
		}
		lines.push('', 'An input path is an XPath for its input file: evaluate_xpath gives its line and column, and the nodes around it.');
		return { text: lines.join('\n'), isError: false };
	}

	// the parts of the output from start to end, one for each location - its whitespace, and a start tag's '>' written with
	// the next part, left out - consecutive parts with the same source and input as one
	private static async parts(name: string, text: string, start: number, end: number): Promise<Part[]> {
		const outputs = XsltDebugOutputs.get();
		const starts = outputs.runStarts(name, start, end);
		const parts: Part[] = [];
		let previousKey: string | undefined;
		for (let i = 0; i < starts.length; i++) {
			const partEnd = i + 1 < starts.length ? starts[i + 1] : end;
			const raw = text.substring(starts[i], partEnd);
			const lead = raw.search(/[^\s>]/);
			if (lead < 0) {
				continue;
			}
			const offset = starts[i] + lead;
			const source = await outputs.originAt(name, offset);
			const input = await outputs.inputLocationAt(name, offset);
			const key = `${source?.location.uri.fsPath}:${source?.location.range.start.line}:${source?.location.range.start.character}|${input?.location.uri.fsPath}:${input?.location.range.start.line}:${input?.node}`;
			const partText = raw.substring(lead).trimEnd();
			if (key === previousKey) {
				parts[parts.length - 1].text += partText;
			} else {
				parts.push({ text: partText, source, input });
				previousKey = key;
			}
		}
		return parts;
	}

	// the innermost template, function or global variable or parameter around the offset, e.g. 'xsl:template match="order"
	// mode="summary" - report.xsl:12'
	private static declaration(root: XmlElement, offset: number, text: string): string | undefined {
		let innermost: XmlElement | undefined;
		for (const element of [root, ...descendants(root)]) {
			if (element.start <= offset && offset < element.end && (!innermost || element.start >= innermost.start)) {
				innermost = element;
			}
		}
		for (let e = innermost; e; e = e.parent) {
			const local = localName(e.name);
			const isGlobal = (local === 'variable' || local === 'param') && e.parent === root;
			if (local === 'template' || local === 'function' || isGlobal) {
				const attributes = ['name', 'match', 'mode'].filter((a) => e!.attributes.has(a)).map((a) => `${a}="${e!.attributes.get(a)}"`);
				return `${e.name}${attributes.length ? ' ' + attributes.join(' ') : ''} (line ${text.substring(0, e.start).split('\n').length})`;
			}
		}
		return undefined;
	}

	// an element's path from the root - a position where a sibling has the same name, as xdm:debug() writes it
	public static path(element: XmlElement): string {
		const steps: string[] = [];
		for (let e: XmlElement | undefined = element; e; e = e.parent) {
			const same = e.parent ? e.parent.children.filter((c) => c.name === e!.name) : [e];
			steps.unshift(same.length > 1 ? `${e.name}[${same.indexOf(e) + 1}]` : e.name);
		}
		return '/' + steps.join('/');
	}

	// the step after an element's path for the input node: '/@id', '/text()' - none for the element
	private static nodeStep(node: string): string {
		const name = XsltDebugOutputs.inputNodeName(node);
		return node.startsWith('element') ? '' : '/' + name;
	}

	private static tagAt(text: string, offset: number): string {
		const end = text.indexOf('>', offset);
		return (end > -1 ? text.substring(offset, end + 1) : text.substring(offset)).replace(/\s+/g, ' ');
	}

	private static offsetOf(text: string, position: vscode.Position): number {
		let offset = 0;
		for (let l = 0; l < position.line; l++) {
			offset = text.indexOf('\n', offset) + 1;
		}
		return offset + position.character;
	}

	private static lineEnd(text: string, offset: number): number {
		const end = text.indexOf('\n', offset);
		return end > -1 ? end : text.length;
	}

	private static short(text: string): string {
		const oneLine = text.replace(/\s*\n\s*/g, ' ');
		return oneLine.length > OutputOrigin.maxText ? oneLine.substring(0, OutputOrigin.maxText) + '...' : oneLine;
	}

	private static list(names: string[]): string {
		const outputs = XsltDebugOutputs.get();
		return names.map((n) => {
			const info = outputs.info(n)!;
			const lineCount = outputs.text(n)!.split('\n').length;
			return `  ${n} - ${info.method}, ${lineCount} line${lineCount === 1 ? '' : 's'}${info.truncated ? ' (only the first part kept)' : ''}${info.uri ? ' - written to ' + OutputOrigin.shown(OutputOrigin.uriPath(info.uri)) : ''}`;
		}).join('\n');
	}

	private static when(): string {
		const at = XsltDebugOutputs.get().updatedAt;
		return at ? ` (${at.toLocaleTimeString()})` : '';
	}

	private static uriPath(uri: string): string {
		try {
			return vscode.Uri.parse(uri).fsPath;
		} catch {
			return uri;
		}
	}

	private static resolve(file: string): string {
		const folder = McpRoot.current();
		return path.isAbsolute(file) || !folder ? path.resolve(file) : path.resolve(folder, file);
	}

	private static shown(file: string): string {
		const folder = McpRoot.current();
		return folder && file.startsWith(folder + path.sep) ? path.relative(folder, file) : file;
	}
}
