/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debugger: the template rules each input node was processed by
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseXml, descendants, XmlElement } from './xspecXml';

// a rule from the debug adapter: a template rule (its xsl:template's start tag) or a built-in rule, in a mode
export interface NodeRule {
	path?: string;
	line?: number;
	column?: number;
	label?: string;
	builtIn?: string;
	mode?: string;
}

// the xsltNodeRules event's body: for each file, flat [line, column, n, (name, rule, count) x n, ...] - an element's
// position (where its start tag ends) and, for the element and the attributes, text nodes etc. it has, the rules
export interface NodeRulesEvent {
	rules: NodeRule[];
	names: string[];
	files: { [path: string]: number[] };
	truncated?: boolean;
}

// a node the rule processed: the element itself, or its attribute, text etc. ('attribute:id', 'text')
export interface ProcessedNode {
	node: string;
	rule: number;
	count: number;
}

// an input file's elements processed, by their position in document order - the same element in the file as it is
// now, edited or formatted since, provided it has the same elements before it
interface InputFile {
	path: string;
	elements: Map<number, { name: string, processed: ProcessedNode[] }>;
}

/**
 * After a debug session (or a run without debugging) of the XSLT debugger: for each node of the input files, the
 * template rules that processed it - xsl:apply-templates' rule, those xsl:next-match and xsl:apply-imports went on to,
 * or the built-in rules if none matched. In an input file: a hover on an element (its attributes and text too), and Go
 * to Definition to its templates. In a stylesheet: above each template rule, the nodes it processed. The last run's
 * only - an element is found again by its position among the file's elements, so not after elements are added or
 * removed before it (its name is checked)
 */
export class XsltNodeRules {
	private static rules: NodeRule[] = [];
	private static files = new Map<string, InputFile>();
	private static stylesheet = '';
	private static changed = new vscode.EventEmitter<void>();

	public static register(context: vscode.ExtensionContext, debugType: string) {
		context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
			if (event.session.type === debugType && event.event === 'xsltNodeRules') {
				XsltNodeRules.update(event.body as NodeRulesEvent, event.session.name);
			}
		}));
		const inputs: vscode.DocumentSelector = { scheme: 'file' };
		context.subscriptions.push(vscode.languages.registerHoverProvider(inputs, { provideHover: (document, position) => XsltNodeRules.hover(document, position) }));
		context.subscriptions.push(vscode.languages.registerDefinitionProvider(inputs, { provideDefinition: (document, position) => XsltNodeRules.definition(document, position) }));
		context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'xslt' }, {
			onDidChangeCodeLenses: XsltNodeRules.changed.event,
			provideCodeLenses: (document) => XsltNodeRules.codeLenses(document)
		}));
		context.subscriptions.push(XsltNodeRules.changed);
	}

	public static clear() {
		XsltNodeRules.rules = [];
		XsltNodeRules.files.clear();
		XsltNodeRules.changed.fire();
	}

	// the last run's, replacing the one before - the input files as they were when it ended
	public static update(body: NodeRulesEvent, sessionName = '') {
		XsltNodeRules.rules = body.rules ?? [];
		XsltNodeRules.files.clear();
		XsltNodeRules.stylesheet = sessionName;
		for (const [file, flat] of Object.entries(body.files ?? {})) {
			let text: string;
			try {
				text = fs.readFileSync(file, 'utf8');
			} catch {
				continue;
			}
			const root = parseXml(text);
			if (!root) {
				continue;
			}
			// each element's position in document order, by where its start tag ends
			const all = [root, ...descendants(root)];
			const ordinals = new Map<number, number>();
			all.forEach((element, k) => ordinals.set(element.contentStart, k));
			const lineStarts = XsltNodeRules.lineStarts(text);
			const input: InputFile = { path: file, elements: new Map() };
			for (let i = 0; i < flat.length;) {
				const [line, column, n] = flat.slice(i, i + 3);
				i += 3;
				const processed: ProcessedNode[] = [];
				for (let k = 0; k < n; k++, i += 3) {
					processed.push({ node: body.names[flat[i]], rule: flat[i + 1], count: flat[i + 2] });
				}
				const ordinal = line >= 1 && line <= lineStarts.length ? ordinals.get(lineStarts[line - 1] + column - 1) : undefined;
				if (ordinal === undefined) {
					continue;
				}
				input.elements.set(ordinal, { name: all[ordinal].name, processed });
			}
			XsltNodeRules.files.set(XsltNodeRules.key(file), input);
		}
		XsltNodeRules.changed.fire();
	}

	// the offset where each line starts: lines end with \n, \r\n or \r, as for an XML parser
	public static lineStarts(text: string): number[] {
		const starts = [0];
		for (let i = 0; i < text.length; i++) {
			const c = text.charCodeAt(i);
			if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) {
				starts.push(i + 1);
			}
		}
		return starts;
	}

	// for comparing paths: the debugger's have symbolic links resolved (e.g. /var on macOS), VS Code's may not
	private static realPaths = new Map<string, string>();
	private static key(file: string) {
		let real = XsltNodeRules.realPaths.get(file);
		if (real === undefined) {
			try {
				real = fs.realpathSync.native(file);
			} catch {
				real = file;
			}
			if (XsltNodeRules.realPaths.size > 1000) {
				XsltNodeRules.realPaths.clear();
			}
			XsltNodeRules.realPaths.set(file, real);
		}
		const normalised = path.normalize(real);
		return process.platform === 'win32' || process.platform === 'darwin' ? normalised.toLowerCase() : normalised;
	}

	// the element processed at the position - in its start tag - with its element in the document as it is now
	private static elementAt(document: vscode.TextDocument, position: vscode.Position) {
		if (XsltNodeRules.files.size === 0 || document.uri.scheme !== 'file') {
			return undefined;
		}
		const input = XsltNodeRules.files.get(XsltNodeRules.key(document.fileName));
		if (!input) {
			return undefined;
		}
		const root = parseXml(document.getText());
		if (!root) {
			return undefined;
		}
		const offset = document.offsetAt(position);
		const all = [root, ...descendants(root)];
		const ordinal = all.findIndex((e) => e.start <= offset && offset < e.contentStart);
		const recorded = ordinal >= 0 ? input.elements.get(ordinal) : undefined;
		return recorded && recorded.name === all[ordinal].name ? { element: all[ordinal], recorded } : undefined;
	}

	// a template rule's xsl:template element, in its stylesheet as it is now: at the line (and column) the debugger gave
	private static template(rule: NodeRule): XmlElement | undefined {
		if (!rule.path || !rule.line) {
			return undefined;
		}
		const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && XsltNodeRules.key(d.fileName) === XsltNodeRules.key(rule.path!));
		let text: string;
		try {
			text = open ? open.getText() : fs.readFileSync(rule.path, 'utf8');
		} catch {
			return undefined;
		}
		const root = parseXml(text);
		if (!root) {
			return undefined;
		}
		const lineStarts = XsltNodeRules.lineStarts(text);
		const lineStart = lineStarts[rule.line - 1] ?? -1;
		const lineEnd = lineStarts[rule.line] ?? text.length;
		return [root, ...descendants(root)].find((e) => /(^|:)template$/.test(e.name) && e.start >= lineStart && e.start < lineEnd);
	}

	// e.g. 'match="order" mode="summary" priority="2"' - from the stylesheet, as written, else as the debugger named it
	private static ruleLabel(rule: NodeRule): string {
		if (rule.builtIn) {
			return `built-in rule (${rule.builtIn}${rule.mode && rule.mode !== '#default' ? `, mode ${rule.mode}` : ''}) - no template matched`;
		}
		const template = XsltNodeRules.template(rule);
		const match = template?.attributes.get('match');
		const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
		// with its mode and priority, if it has them: e.g. two templates for the same pattern, one by xsl:next-match
		const others = ['mode', 'priority'].filter((name) => template?.attributes.has(name)).map((name) => ` ${name}="${oneLine(template!.attributes.get(name)!)}"`).join('');
		return template && match !== undefined ? `match="${oneLine(match)}"${others}` : (rule.label ?? 'template').replace(/^xsl:template /, '');
	}

	private static ruleLink(rule: NodeRule) {
		const file = vscode.Uri.file(rule.path!);
		return `[${path.basename(rule.path!)}:${rule.line}](${file.with({ fragment: `L${rule.line}` }).toString()})`;
	}

	// 'order', '@id', 'text()', 'comment()', 'processing-instruction(x)'
	private static nodeText(node: string) {
		const [kind, name] = [node.substring(0, node.indexOf(':') < 0 ? node.length : node.indexOf(':')), node.substring(node.indexOf(':') + 1)];
		return kind === 'element' ? name : kind === 'attribute' ? `@${name}` : kind === 'text' ? 'text()' : kind === 'whitespace' ? 'text() - whitespace' : kind === 'comment' ? 'comment()' : `processing-instruction(${name})`;
	}

	public static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const found = XsltNodeRules.elementAt(document, position);
		if (!found) {
			return undefined;
		}
		const markdown = new vscode.MarkdownString();
		const code = (s: string) => '`' + s.replace(/`/g, '\'') + '`';
		markdown.appendMarkdown(`**Processed by** - in the last debug run${XsltNodeRules.stylesheet ? ` (${XsltNodeRules.stylesheet.replace(/[[\]*_`]/g, '')})` : ''}:\n\n`);
		// by node: the element first, then its attributes, text etc.
		const byNode = new Map<string, ProcessedNode[]>();
		// not whitespace-only text the built-in rules processed: there's usually some between each element
		found.recorded.processed.filter((p) => !(p.node === 'whitespace' && XsltNodeRules.rules[p.rule]?.builtIn))
			.forEach((p) => byNode.set(p.node, [...(byNode.get(p.node) ?? []), p]));
		const nodes = [...byNode.keys()].sort((a, b) => (a.startsWith('element:') ? 0 : a.startsWith('attribute:') ? 1 : 2) - (b.startsWith('element:') ? 0 : b.startsWith('attribute:') ? 1 : 2));
		const limit = 30;
		nodes.slice(0, limit).forEach((node) => {
			const rules = byNode.get(node)!.map((p) => {
				const rule = XsltNodeRules.rules[p.rule];
				const times = p.count > 1 ? ` ×${p.count}` : '';
				return rule?.builtIn ? `_${XsltNodeRules.ruleLabel(rule)}_${times}` : rule ? `${code(XsltNodeRules.ruleLabel(rule))} ${XsltNodeRules.ruleLink(rule)}${times}` : '';
			});
			markdown.appendMarkdown(`- ${code(XsltNodeRules.nodeText(node))}: ${rules.join(', ')}\n`);
		});
		if (nodes.length > limit) {
			markdown.appendMarkdown(`- … and ${nodes.length - limit} more\n`);
		}
		return new vscode.Hover(markdown, new vscode.Range(document.positionAt(found.element.start), document.positionAt(found.element.contentStart)));
	}

	// the template rules that processed the element, or its attributes, text etc.
	public static definition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
		const found = XsltNodeRules.elementAt(document, position);
		if (!found) {
			return undefined;
		}
		const ids = [...new Set(found.recorded.processed.map((p) => p.rule))];
		const locations = ids.map((id) => XsltNodeRules.rules[id]).filter((rule) => rule?.path && rule.line)
			.map((rule) => new vscode.Location(vscode.Uri.file(rule.path!), new vscode.Position(rule.line! - 1, Math.max(0, (rule.column ?? 1) - 1))));
		return locations.length > 0 ? locations : undefined;
	}

	// for each template rule in the stylesheet: the input elements it processed (or whose attributes etc. it did)
	public static processedBy(file: string): Map<number, { path: string, ordinal: number, name: string, nodes: Set<string>, count: number }[]> {
		const byLine = new Map<number, { path: string, ordinal: number, name: string, nodes: Set<string>, count: number }[]>();
		const key = XsltNodeRules.key(file);
		const ruleLines = new Map<number, number>();
		XsltNodeRules.rules.forEach((rule, id) => {
			if (rule.path && rule.line && XsltNodeRules.key(rule.path) === key) {
				ruleLines.set(id, rule.line);
			}
		});
		if (ruleLines.size === 0) {
			return byLine;
		}
		for (const input of XsltNodeRules.files.values()) {
			const inputPath = input.path;
			for (const [ordinal, element] of input.elements) {
				for (const p of element.processed) {
					const line = ruleLines.get(p.rule);
					if (line === undefined) {
						continue;
					}
					const list = byLine.get(line) ?? [];
					let entry = list.find((e) => e.path === inputPath && e.ordinal === ordinal);
					if (!entry) {
						entry = { path: inputPath, ordinal, name: element.name, nodes: new Set(), count: 0 };
						list.push(entry);
					}
					entry.nodes.add(p.node);
					entry.count += p.count;
					byLine.set(line, list);
				}
			}
		}
		return byLine;
	}

	public static codeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (XsltNodeRules.files.size === 0 || document.uri.scheme !== 'file') {
			return [];
		}
		const byLine = XsltNodeRules.processedBy(document.fileName);
		const lenses: vscode.CodeLens[] = [];
		for (const [line, entries] of byLine) {
			const nodes = entries.reduce((n, e) => n + e.nodes.size, 0);
			const times = entries.reduce((n, e) => n + e.count, 0);
			const files = [...new Set(entries.map((e) => e.path))];
			const position = new vscode.Position(line - 1, 0);
			const title = `processed ${nodes} ${nodes === 1 ? 'node' : 'nodes'}${times > nodes ? ` (${times} times)` : ''} in ${files.length === 1 ? path.basename(files[0]) : `${files.length} files`}`;
			lenses.push(new vscode.CodeLens(new vscode.Range(position, position), {
				title, tooltip: 'In the last XSLT debug run - the input elements it processed, or whose attributes or text it did',
				command: 'xslt-xpath.showProcessedNodes', arguments: [document.uri, position]
			}));
		}
		return lenses;
	}

	// the input elements the template rule at the line processed: their start tags, in the files as they are now
	public static processedLocations(stylesheet: vscode.Uri, line: number): vscode.Location[] {
		const entries = XsltNodeRules.processedBy(stylesheet.fsPath).get(line + 1) ?? [];
		const locations: vscode.Location[] = [];
		const byFile = new Map<string, typeof entries>();
		entries.forEach((e) => byFile.set(e.path, [...(byFile.get(e.path) ?? []), e]));
		for (const [file, fileEntries] of byFile) {
			const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && XsltNodeRules.key(d.fileName) === XsltNodeRules.key(file));
			let text: string;
			try {
				text = open ? open.getText() : fs.readFileSync(file, 'utf8');
			} catch {
				continue;
			}
			const root = parseXml(text);
			const all = root ? [root, ...descendants(root)] : [];
			const uri = open?.uri ?? vscode.Uri.file(file);
			const lineStarts = XsltNodeRules.lineStarts(text);
			const positionAt = (offset: number) => {
				let lo = 0;
				let hi = lineStarts.length - 1;
				while (lo < hi) {
					const mid = (lo + hi + 1) >> 1;
					if (lineStarts[mid] <= offset) {
						lo = mid;
					} else {
						hi = mid - 1;
					}
				}
				return new vscode.Position(lo, offset - lineStarts[lo]);
			};
			fileEntries.sort((a, b) => a.ordinal - b.ordinal).forEach((e) => {
				const element = all[e.ordinal];
				if (element && element.name === e.name) {
					locations.push(new vscode.Location(uri, new vscode.Range(positionAt(element.start), positionAt(element.contentStart))));
				}
			});
		}
		return locations;
	}
}
