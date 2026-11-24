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

// a rule from the debug adapter: a template rule (its xsl:template's start tag), an instruction that processes each
// item it selects - xsl:for-each, xsl:for-each-group (each member of each group) or xsl:iterate - or a built-in rule,
// in a mode
export interface NodeRule {
	path?: string;
	line?: number;
	column?: number;
	label?: string;
	instruction?: boolean;
	builtIn?: string;
	mode?: string;
}

const templateName = /(^|:)template$/;
const iterationName = /(^|:)(for-each|for-each-group|iterate)$/;

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
 * or the built-in rules if none matched - and the xsl:for-each, xsl:for-each-group (a group's members) and xsl:iterate
 * instructions that did. Not nodes only an XPath expression reads (e.g. a path, or for $x in ...). In an input file: a hover on an element (its attributes and text too), and Go
 * to Definition to its templates. In a stylesheet: above each template rule, the nodes it processed. The last run's
 * only - an element is found again by its position among the file's elements, so not after elements are added or
 * removed before it (its name is checked)
 */
export class XsltNodeRules {
	private static rules: NodeRule[] = [];
	private static files = new Map<string, InputFile>();
	private static stylesheet = '';
	private static changed = new vscode.EventEmitter<void>();

	// in the gutter and the overview ruler of an input file: its elements processed by a template rule or an
	// xsl:for-each etc. (green), or only by built-in rules (amber) - the elements the hover has something for
	private static processedDecoration: vscode.TextEditorDecorationType | undefined;
	private static builtInDecoration: vscode.TextEditorDecorationType | undefined;
	// for a Schematron schema's session: a neutral blue instead of the green - a rule checked the element, which isn't
	// that it's valid, as green is taken to say (an assertion may have failed): the problems say that
	private static checkedDecoration: vscode.TextEditorDecorationType | undefined;
	private static forSchematron = false;

	// whether the markers are those of a Schematron schema's session - blue, not green
	public static get markersAreChecked() {
		return XsltNodeRules.forSchematron;
	}
	private static decorateTimer: NodeJS.Timeout | undefined;

	public static register(context: vscode.ExtensionContext, debugType: string) {
		// a stripe in the gutter, as test coverage has - which colors the line number's background, with the theme's
		// colors: extensions can't, but can have an icon there, of a fixed color. 'cover': the full height of the line,
		// so the lines of a start tag, or consecutive elements, have one stripe
		const icon = (name: string) => vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', name);
		const stripe = (iconName: string, rulerColor: string) => vscode.window.createTextEditorDecorationType({
			gutterIconPath: icon(iconName), gutterIconSize: 'cover',
			overviewRulerColor: new vscode.ThemeColor(rulerColor), overviewRulerLane: vscode.OverviewRulerLane.Left
		});
		XsltNodeRules.processedDecoration = stripe('input-processed.svg', 'testing.coveredGutterBackground');
		XsltNodeRules.builtInDecoration = stripe('input-built-in.svg', 'editorOverviewRuler.warningForeground');
		XsltNodeRules.checkedDecoration = stripe('input-checked.svg', 'charts.blue');
		context.subscriptions.push(XsltNodeRules.processedDecoration, XsltNodeRules.builtInDecoration, XsltNodeRules.checkedDecoration);
		context.subscriptions.push(XsltNodeRules.changed.event(() => XsltNodeRules.decorate()));
		context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => XsltNodeRules.decorate()));
		context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
			if (XsltNodeRules.files.size > 0 && vscode.window.visibleTextEditors.some((e) => e.document === event.document)) {
				clearTimeout(XsltNodeRules.decorateTimer);
				XsltNodeRules.decorateTimer = setTimeout(() => XsltNodeRules.decorate(), 300);
			}
		}));
		context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.clearInputMapping', () => XsltNodeRules.clear()));
		// saved by VS Code: not changed outside it (see watch) - when about to be written, as the watcher may report it first
		const saving = (document: vscode.TextDocument) => {
			if (XsltNodeRules.files.size > 0 && document.uri.scheme === 'file') {
				XsltNodeRules.savedAt.set(XsltNodeRules.key(document.fileName), Date.now());
			}
		};
		context.subscriptions.push(vscode.workspace.onWillSaveTextDocument((event) => saving(event.document)));
		context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(saving));
		context.subscriptions.push({ dispose: () => XsltNodeRules.unwatch() });
		context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
			if (event.session.type === debugType && event.event === 'xsltNodeRules') {
				XsltNodeRules.update(event.body as NodeRulesEvent, event.session.name, typeof event.session.configuration.schematronFile === 'string');
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
		XsltNodeRules.unwatch();
		XsltNodeRules.changed.fire();
	}

	// each input file is watched: replaced, changed or deleted outside VS Code - e.g. by a script, or a git checkout -
	// it's another file, so what was recorded for it is dropped. Not when VS Code saved it: edited or formatted, its
	// elements are found again by their position (see elementAt)
	private static watchers: vscode.Disposable[] = [];
	private static savedAt = new Map<string, number>();
	// how long after VS Code saves a file a change to it on disk is taken as that save
	public static saveWindow = 2000;

	private static unwatch() {
		XsltNodeRules.watchers.forEach((w) => w.dispose());
		XsltNodeRules.watchers = [];
	}

	private static watch(file: string) {
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
		const changedOnDisk = () => {
			const key = XsltNodeRules.key(file);
			if (Date.now() - (XsltNodeRules.savedAt.get(key) ?? 0) < XsltNodeRules.saveWindow || !XsltNodeRules.files.has(key)) {
				return;
			}
			XsltNodeRules.files.delete(key);
			if (XsltNodeRules.files.size === 0) {
				XsltNodeRules.rules = [];
				XsltNodeRules.unwatch();
			}
			XsltNodeRules.changed.fire();
		};
		watcher.onDidChange(changedOnDisk);
		watcher.onDidCreate(changedOnDisk);
		watcher.onDidDelete(changedOnDisk);
		XsltNodeRules.watchers.push(watcher);
	}

	// the last run's, replacing the one before - the input files as they were when it ended
	public static update(body: NodeRulesEvent, sessionName = '', schematron = false) {
		XsltNodeRules.forSchematron = schematron;
		XsltNodeRules.rules = body.rules ?? [];
		// an instruction only where the stylesheet has one: Saxon 13 can rewrite e.g. an xsl:for-each over
		// current-group() as one at an instruction within it
		const notShown = new Set<number>();
		XsltNodeRules.rules.forEach((rule, id) => {
			if (rule.instruction && !XsltNodeRules.ruleElement(rule)) {
				notShown.add(id);
			}
		});
		XsltNodeRules.files.clear();
		XsltNodeRules.unwatch();
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
					if (!notShown.has(flat[i + 1])) {
						processed.push({ node: body.names[flat[i]], rule: flat[i + 1], count: flat[i + 2] });
					}
				}
				const ordinal = line >= 1 && line <= lineStarts.length ? ordinals.get(lineStarts[line - 1] + column - 1) : undefined;
				if (ordinal === undefined || processed.length === 0) {
					continue;
				}
				input.elements.set(ordinal, { name: all[ordinal].name, processed });
			}
			XsltNodeRules.files.set(XsltNodeRules.key(file), input);
			XsltNodeRules.watch(file);
		}
		XsltNodeRules.changed.fire();
	}

	// for each visible input file: its markers - and none in other files, e.g. once cleared
	private static decorate() {
		const has = XsltNodeRules.files.size > 0;
		vscode.commands.executeCommand('setContext', 'xslt-xpath.hasInputMapping', has);
		if (!XsltNodeRules.processedDecoration || !XsltNodeRules.builtInDecoration || !XsltNodeRules.checkedDecoration) {
			return;
		}
		for (const editor of vscode.window.visibleTextEditors) {
			const markers = has ? XsltNodeRules.markers(editor.document) : { processed: [], builtIn: [] };
			editor.setDecorations(XsltNodeRules.processedDecoration, XsltNodeRules.forSchematron ? [] : markers.processed);
			editor.setDecorations(XsltNodeRules.checkedDecoration, XsltNodeRules.forSchematron ? markers.processed : []);
			editor.setDecorations(XsltNodeRules.builtInDecoration, markers.builtIn);
		}
	}

	// the start tags of the elements in the input file that the hover has something for: those processed - or whose
	// attributes, text etc. were - by a template rule or an instruction, and those only by built-in rules (not counting
	// whitespace-only text). One marker a line, processed first
	public static markers(document: vscode.TextDocument): { processed: vscode.Range[], builtIn: vscode.Range[] } {
		const result = { processed: [] as vscode.Range[], builtIn: [] as vscode.Range[] };
		const input = document.uri.scheme === 'file' ? XsltNodeRules.files.get(XsltNodeRules.key(document.fileName)) : undefined;
		const root = input ? parseXml(document.getText()) : undefined;
		if (!input || !root) {
			return result;
		}
		const all = [root, ...descendants(root)];
		const processedLines = new Set<number>();
		const builtIn: vscode.Range[] = [];
		for (const [ordinal, recorded] of input.elements) {
			const element = all[ordinal];
			if (!element || element.name !== recorded.name) {
				continue;
			}
			const shown = XsltNodeRules.shownNodes(recorded.processed);
			if (shown.length === 0) {
				continue;
			}
			const range = new vscode.Range(document.positionAt(element.start), document.positionAt(element.contentStart));
			if (shown.some((p) => !XsltNodeRules.rules[p.rule]?.builtIn)) {
				result.processed.push(range);
				for (let line = range.start.line; line <= range.end.line; line++) {
					processedLines.add(line);
				}
			} else {
				builtIn.push(range);
			}
		}
		result.builtIn = builtIn.filter((range) => ![...Array(range.end.line - range.start.line + 1).keys()].some((k) => processedLines.has(range.start.line + k)));
		return result;
	}

	// as the hover lists them: not whitespace-only text the built-in rules processed - there's usually some between each element
	private static shownNodes(processed: ProcessedNode[]) {
		return processed.filter((p) => !(p.node === 'whitespace' && XsltNodeRules.rules[p.rule]?.builtIn));
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

	// a template rule's xsl:template element - or an instruction's xsl:for-each etc. - in its stylesheet as it is now:
	// at the line the debugger gave
	private static ruleElement(rule: NodeRule): XmlElement | undefined {
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
		const name = rule.instruction ? iterationName : templateName;
		return [root, ...descendants(root)].find((e) => name.test(e.name) && e.start >= lineStart && e.start < lineEnd);
	}

	// e.g. 'match="order" mode="summary" priority="2"' - from the stylesheet, as written, else as the debugger named it
	private static ruleLabel(rule: NodeRule): string {
		if (rule.builtIn) {
			return `built-in rule (${rule.builtIn}${rule.mode && rule.mode !== '#default' ? `, mode ${rule.mode}` : ''}) - no template matched`;
		}
		const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
		if (rule.instruction) {
			// e.g. 'for-each-group select="line" group-by="@category"'
			const instruction = XsltNodeRules.ruleElement(rule);
			if (!instruction) {
				return (rule.label ?? 'for-each').replace(/^xsl:/, '');
			}
			const attributes = ['select', 'group-by', 'group-adjacent', 'group-starting-with', 'group-ending-with', 'split-when']
				.filter((name) => instruction.attributes.has(name)).map((name) => ` ${name}="${oneLine(instruction.attributes.get(name)!)}"`).join('');
			return instruction.name.replace(/^.*:/, '') + attributes;
		}
		const template = XsltNodeRules.ruleElement(rule);
		const match = template?.attributes.get('match');
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
		const shown = found ? XsltNodeRules.shownNodes(found.recorded.processed) : [];
		if (!found || shown.length === 0) {
			return undefined;
		}
		const markdown = new vscode.MarkdownString();
		const code = (s: string) => '`' + s.replace(/`/g, '\'') + '`';
		markdown.appendMarkdown(`**Processed by** - in the last debug run${XsltNodeRules.stylesheet ? ` (${XsltNodeRules.stylesheet.replace(/[[\]*_`]/g, '')})` : ''}:\n\n`);
		// by node: the element first, then its attributes, text etc.
		const byNode = new Map<string, ProcessedNode[]>();
		shown.forEach((p) => byNode.set(p.node, [...(byNode.get(p.node) ?? []), p]));
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

	// for an assistant (the input_rules MCP tool): what the last run recorded for an input file, in the file as it is now
	// - its elements, and for each element recorded, what processed it or its attributes, text etc. (not whitespace-only
	// text the built-in rules did) - undefined if the run didn't record the file
	public static recorded(file: string): {
		session: string, schematron: boolean, text: string, all: XmlElement[],
		elements: Map<number, { node: string, nodeText: string, label: string, path?: string, line?: number, builtIn: boolean, builtInRule?: string, count: number }[]>
	} | undefined {
		const input = XsltNodeRules.files.get(XsltNodeRules.key(file));
		if (!input) {
			return undefined;
		}
		const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && XsltNodeRules.key(d.fileName) === XsltNodeRules.key(file));
		let text: string;
		try {
			text = open ? open.getText() : fs.readFileSync(file, 'utf8');
		} catch {
			return undefined;
		}
		const root = parseXml(text);
		if (!root) {
			return undefined;
		}
		const all = [root, ...descendants(root)];
		const elements = new Map<number, { node: string, nodeText: string, label: string, path?: string, line?: number, builtIn: boolean, builtInRule?: string, count: number }[]>();
		// each rule's label once: it's read from its stylesheet
		const labels = new Map<number, string>();
		const labelOf = (id: number) => {
			if (!labels.has(id)) {
				labels.set(id, XsltNodeRules.ruleLabel(XsltNodeRules.rules[id]));
			}
			return labels.get(id)!;
		};
		for (const [ordinal, recorded] of input.elements) {
			if (all[ordinal]?.name !== recorded.name) {
				continue;
			}
			const shown = XsltNodeRules.shownNodes(recorded.processed).flatMap((p) => {
				const rule = XsltNodeRules.rules[p.rule];
				return rule ? [{ node: p.node, nodeText: XsltNodeRules.nodeText(p.node), label: labelOf(p.rule), path: rule.path, line: rule.line, builtIn: !!rule.builtIn, builtInRule: rule.builtIn, count: p.count }] : [];
			});
			if (shown.length > 0) {
				elements.set(ordinal, shown);
			}
		}
		return { session: XsltNodeRules.stylesheet, schematron: XsltNodeRules.forSchematron, text, all, elements };
	}

	// whether the last run recorded any input file
	public static hasRecord(): boolean {
		return XsltNodeRules.files.size > 0;
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
				title, tooltip: 'In the last XSLT debug run - the input elements it processed, or whose attributes or text it did (for xsl:for-each-group, its groups\' members)',
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
