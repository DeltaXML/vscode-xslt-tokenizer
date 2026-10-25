/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XPath queries on XML files
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { DocumentChangeHandler } from './documentChangeHandler';
import { XMLConfiguration } from './languageConfigurations';
import { XsltSymbolProvider } from './xsltSymbolProvider';
import { XsltDefinitionProvider } from './xsltDefinitionProvider';
import { XsltDebug } from './xsltDebug';
import { unquotedPath } from './settingPaths';

// an item of a query's result, from XPathQuery (in the debug adapter's jar): a node - where it is among the document's
// elements, and for an attribute its name - or an atomic value, or another item (a map, array or function)
export interface XPathQueryItem {
	kind: 'node' | 'atomic' | 'other';
	nodeKind?: string;
	path?: string;
	positions?: number[];
	name?: string;
	textIndex?: number;
	value?: string;
	type?: string;
}

export interface XPathQueryResult {
	count?: number;
	items?: XPathQueryItem[];
	error?: { message: string; code?: string; line?: number; column?: number };
}

// 'Find Nodes with XPath': XPath expressions are written in a query file - an .xpath file, so with the editor's
// highlighting, checking and completion (of node names from the XML context file, too) - kept for the workspace, one
// expression after another, separated by blank lines. The expression at the cursor runs with Saxon (the
// XSLT.tasks.saxonJar setting) on the XML context file; the nodes it finds are listed in VS Code's references peek,
// in the XML file, to go from one to the next, and atomic values are written to an output channel
export class XPathQuery {
	public static readonly fileName = 'queries.xpath';
	public static readonly mainClass = 'com.deltaxml.xslt.debug.XPathQuery';
	// a new query file's text: how it's used, and a first expression - the XML file's root element, quick to run
	public static seed(rootName?: string) {
		return '(: Expressions to find nodes in the XML context file: Ctrl+Enter (Cmd+Enter on macOS), or ▶ above\n' +
			`   an expression, runs the one at the cursor - separate expressions with a blank line :)\n\n/${rootName ?? '*'}\n`;
	}


	// the expression at a line: the lines around it up to blank ones - or, from a blank line, the nearest before it -
	// unless it's only comments. Its first line, for where Saxon's errors are
	public static expressionAt(text: string, line: number): { text: string; startLine: number } | undefined {
		const lines = text.split(/\r?\n/);
		const isBlank = (i: number) => lines[i].trim() === '';
		let at = Math.min(line, lines.length - 1);
		while (at >= 0 && isBlank(at)) {
			at--;
		}
		if (at < 0) {
			return undefined;
		}
		let start = at;
		while (start > 0 && !isBlank(start - 1)) {
			start--;
		}
		let end = at;
		while (end < lines.length - 1 && !isBlank(end + 1)) {
			end++;
		}
		const expression = lines.slice(start, end + 1).join('\n');
		return XPathQuery.withoutComments(expression).trim() === '' ? undefined : { text: expression, startLine: start };
	}

	// the expressions' first lines - for the ▶ above each
	public static expressionStarts(text: string): number[] {
		const lines = text.split(/\r?\n/);
		const starts: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() !== '' && (i === 0 || lines[i - 1].trim() === '')) {
				const expression = XPathQuery.expressionAt(text, i);
				if (expression && expression.startLine === i) {
					starts.push(i);
				}
			}
		}
		return starts;
	}

	// where each expression's '▶ Run' goes: on the blank line before it, if there is one (a line with only
	// whitespace on it), otherwise above its first line
	public static runPlaces(text: string): { expressionLine: number; onBlankLine: boolean }[] {
		const lines = text.split(/\r?\n/);
		return XPathQuery.expressionStarts(text).map((line) => ({ expressionLine: line, onBlankLine: line > 0 && lines[line - 1].trim() === '' }));
	}

	public static isQueryFile(document: vscode.TextDocument) {
		return document.languageId === 'xpath' && path.basename(document.uri.fsPath) === XPathQuery.fileName;
	}

	// the query file's blocks of lines - expressions, or only comments - each checked, and completed, on its own:
	// as the file's text with every other block blanked, keeping the positions
	public static separateBlocks(text: string): string[] {
		const lines = text.split('\n');
		const blocks: [number, number][] = [];
		lines.forEach((line, i) => {
			if (line.trim() === '') {
				return;
			}
			if (i > 0 && lines[i - 1].trim() !== '') {
				blocks[blocks.length - 1][1] = i;
			} else {
				blocks.push([i, i]);
			}
		});
		return blocks.map(([start, end]) => XPathQuery.keepLines(lines, start, end));
	}

	// the block at a line, for completion there - from a blank line, none: a new expression starts there
	public static separateBlockAt(text: string, line: number): string {
		const lines = text.split('\n');
		if (line >= lines.length || lines[line].trim() === '') {
			return XPathQuery.keepLines(lines, -1, -1);
		}
		let start = line;
		while (start > 0 && lines[start - 1].trim() !== '') {
			start--;
		}
		let end = line;
		while (end < lines.length - 1 && lines[end + 1].trim() !== '') {
			end++;
		}
		return XPathQuery.keepLines(lines, start, end);
	}

	private static keepLines(lines: string[], start: number, end: number) {
		return lines.map((line, i) => i >= start && i <= end ? line : line.replace(/[^\r]/g, ' ')).join('\n');
	}

	// a 'declare namespace p = "uri";' prolog, as the query file's checks allow, isn't XPath: it's blanked - keeping
	// the positions of the rest, for Saxon's errors - and its bindings given to Saxon separately
	public static withoutProlog(expression: string): { xpath: string; namespaces: { [prefix: string]: string } } {
		const namespaces: { [prefix: string]: string } = {};
		const declaration = /declare\s+namespace\s+([\p{L}_][\p{L}\p{N}_.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*;/uy;
		let xpath = expression;
		let offset = 0;
		for (;;) {
			// after whitespace and comments
			const skipped = /(?:\s|\(:[\s\S]*?:\))*/y;
			skipped.lastIndex = offset;
			offset += skipped.exec(xpath)![0].length;
			declaration.lastIndex = offset;
			const m = declaration.exec(xpath);
			if (!m) {
				break;
			}
			namespaces[m[1]] = m[2] ?? m[3];
			xpath = xpath.substring(0, m.index) + m[0].replace(/[^\n]/g, ' ') + xpath.substring(m.index + m[0].length);
			offset = m.index + m[0].length;
		}
		return { xpath, namespaces };
	}

	private static withoutComments(text: string) {
		return text.replace(/\(:[\s\S]*?:\)/g, '');
	}

	// the range of a node in the XML document: in its outline, from the document element down, by the elements'
	// positions - an element's name in its start tag, an attribute's, a text node's text (with the document), or for
	// another node, its element's name
	public static rangeOf(item: XPathQueryItem, symbols: vscode.DocumentSymbol[], document?: vscode.TextDocument): vscode.Range | undefined {
		if (!item.positions || item.positions.length === 0) {
			return undefined;
		}
		const elements = (list: vscode.DocumentSymbol[]) => list.filter((s) => !(s.kind === vscode.SymbolKind.Array && s.name === 'attributes'));
		let level = elements(symbols);
		let element: vscode.DocumentSymbol | undefined;
		for (const position of item.positions) {
			element = level[position - 1];
			if (!element) {
				return undefined;
			}
			level = elements(element.children);
		}
		if (item.nodeKind === 'attribute' && item.name) {
			const attributes = element!.children.find((s) => s.kind === vscode.SymbolKind.Array && s.name === 'attributes');
			const attribute = attributes?.children.find((s) => s.name === item.name);
			if (attribute) {
				return attribute.selectionRange;
			}
		}
		if (item.nodeKind === 'text' && item.textIndex && document) {
			const text = XPathQuery.textNodeSpan(document.getText(), document.offsetAt(XPathQuery.nameRange(element!).start) - 1, item.textIndex);
			if (text) {
				return new vscode.Range(document.positionAt(text[0]), document.positionAt(text[1]));
			}
		}
		return XPathQuery.nameRange(element!);
	}

	// an element's name in its start tag - its symbol's selection range starts there, but for mixed content goes on
	// to its last child
	private static nameRange(element: vscode.DocumentSymbol) {
		const start = element.selectionRange.start;
		return new vscode.Range(start, start.translate(0, element.name.split(' ')[0].length));
	}

	// where an element's nth text node is, from its start tag's '<': text nodes are the runs of text in its content
	// between child elements, comments and processing instructions - CDATA sections are part of them. Without the
	// whitespace around it, unless it's only whitespace. Found by matching tags - not by the symbols' ranges, which
	// may go on past an element's end tag
	public static textNodeSpan(xml: string, elementStart: number, textIndex: number): [number, number] | undefined {
		// after a tag's '>' - not one in an attribute value
		const tagEnd = (from: number) => {
			let quote = '';
			for (let i = from; i < xml.length; i++) {
				const c = xml[i];
				if (quote) {
					quote = c === quote ? '' : quote;
				} else if (c === '"' || c === "'") {
					quote = c;
				} else if (c === '>') {
					return i + 1;
				}
			}
			return xml.length;
		};
		const after = (from: number, end: string) => {
			const i = xml.indexOf(end, from);
			return i < 0 ? xml.length : i + end.length;
		};
		let at = tagEnd(elementStart);
		if (xml[at - 2] === '/') {
			return undefined;
		}
		const runs: [number, number][] = [];
		let runStart = at;
		let depth = 0;
		const endRun = (end: number) => {
			if (depth === 0 && end > runStart) {
				runs.push([runStart, end]);
			}
		};
		while (at < xml.length) {
			if (xml.startsWith('<![CDATA[', at)) {
				at = after(at, ']]>');
				continue;
			}
			if (xml.startsWith('</', at) && depth === 0) {
				// its end tag
				break;
			}
			if (xml[at] !== '<') {
				at++;
				continue;
			}
			endRun(at);
			if (xml.startsWith('<!--', at)) {
				at = after(at, '-->');
			} else if (xml.startsWith('<?', at)) {
				at = after(at, '?>');
			} else if (xml.startsWith('</', at)) {
				depth--;
				at = tagEnd(at);
			} else {
				at = tagEnd(at);
				depth += xml[at - 2] === '/' ? 0 : 1;
			}
			if (depth === 0) {
				runStart = at;
			}
		}
		endRun(at);
		const run = runs[textIndex - 1];
		if (!run) {
			return undefined;
		}
		const text = xml.substring(run[0], run[1]);
		const leading = text.length - text.trimStart().length;
		return text.trim() === '' ? run : [run[0] + leading, run[0] + text.trimEnd().length];
	}

	// a query's result in brief, shown after its expression: the first node found, as a path - or the values, as
	// XPath literals, cut short if they're long
	public static resultSummary(result: XPathQueryResult, maxLength = 60): string {
		const items = result.items ?? [];
		const count = result.count ?? items.length;
		if (count === 0) {
			return '= ()  nothing found';
		}
		const ofCount = count > 1 ? `  (${count} items)` : '';
		if (items[0].kind === 'node') {
			return `→ ${XPathQuery.cutShort(items[0].path ?? '', maxLength)}${count > 1 ? `  (1 of ${count})` : ''}`;
		}
		const literals = items.map((item) => item.kind === 'node' ? item.path ?? '' : item.kind === 'other' ? item.value ?? '' :
			/^(string|untypedAtomic|anyURI)$/.test(item.type ?? '') ? `'${(item.value ?? '').replace(/'/g, "''")}'` :
				item.type === 'boolean' ? `${item.value}()` : item.value ?? '');
		const values = count > 1 ? `(${literals.join(', ')}${count > items.length ? ', …' : ''})` : literals[0];
		return `= ${XPathQuery.cutShort(values, maxLength)}${values.length > maxLength || count > items.length ? ofCount : ''}`;
	}

	private static cutShort(text: string, maxLength: number) {
		const oneLine = text.replace(/\s*\n\s*/g, ' ');
		return oneLine.length > maxLength ? oneLine.substring(0, maxLength - 1) + '…' : oneLine;
	}

	private diagnostics = vscode.languages.createDiagnosticCollection('xpath-query');
	private output = vscode.window.createOutputChannel('XPath Query');
	// each query file's latest results, by the expression's text - so they stay with it as lines are added before it -
	// and the XML file it ran on
	private results = new Map<string, { expression: string; target: string; summary: string }[]>();
	private changed = new vscode.EventEmitter<void>();

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(this.diagnostics, this.output);
		context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.findNodesWithXPath', () => this.openQueryFile()));
		context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.runXPathQuery', (uri?: vscode.Uri, line?: number) => this.run(uri, line)));
		// '▶ Run on orders.xml' for each expression: on the blank line before it, as an inlay hint, which takes no space
		// of its own - or, with no blank line before it, e.g. on the first line, as a CodeLens above it
		const selector = { language: 'xpath', pattern: '**/' + XPathQuery.fileName };
		const runTitle = () => {
			const target = DocumentChangeHandler.lastActiveXMLNonXSLUri;
			return target ? `▶ Run on ${path.basename(target.fsPath)}` : '▶ Run - first open an XML file';
		};
		const changed = this.changed;
		context.subscriptions.push(changed);
		context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.showXPathQueryOutput', () => this.output.show(true)));
		context.subscriptions.push(vscode.languages.registerCodeLensProvider(selector, {
			onDidChangeCodeLenses: changed.event,
			provideCodeLenses: (document) => XPathQuery.runPlaces(document.getText()).filter((place) => !place.onBlankLine).map((place) =>
				new vscode.CodeLens(new vscode.Range(place.expressionLine, 0, place.expressionLine, 0),
					{ title: runTitle(), command: 'xslt-xpath.runXPathQuery', arguments: [document.uri, place.expressionLine] }))
		}));
		context.subscriptions.push(vscode.languages.registerInlayHintsProvider(selector, {
			onDidChangeInlayHints: changed.event,
			provideInlayHints: (document, range) => {
				const text = document.getText();
				const runs = XPathQuery.runPlaces(text).filter((place) => place.onBlankLine &&
					range.contains(new vscode.Position(place.expressionLine - 1, 0))).map((place) => {
					const label = new vscode.InlayHintLabelPart(runTitle());
					label.command = { title: runTitle(), command: 'xslt-xpath.runXPathQuery', arguments: [document.uri, place.expressionLine] };
					label.tooltip = 'Run the expression below on the XML context file';
					return new vscode.InlayHint(new vscode.Position(place.expressionLine - 1, 0), [label]);
				});
				return runs.concat(this.resultHints(document, text));
			}
		}));
		// the location of the cursor in the XML file: added to the query file from the XML file's editor - or, from the
		// query file, offered as a completion at the start of an expression
		context.subscriptions.push(vscode.commands.registerCommand('xslt-xpath.addXPathLocationToQueries', () => this.addLocation()));
		context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
			provideCompletionItems: async (document, position) => {
				const start = XPathQuery.locationCompletionStart(document.getText(), position.line, position.character);
				const xmlEditor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === DocumentChangeHandler.lastActiveXMLNonXSLUri?.toString());
				const location = start !== undefined && xmlEditor ? await XPathQuery.cursorLocation(xmlEditor) : undefined;
				if (!location) {
					return undefined;
				}
				const item = new vscode.CompletionItem(location, vscode.CompletionItemKind.Reference);
				item.detail = `cursor in ${path.basename(xmlEditor!.document.uri.fsPath)}`;
				item.range = new vscode.Range(position.line, start!, position.line, position.character);
				item.sortText = '!';
				return [item];
			}
		}, '/'));
		// the file it runs on is shown with each expression
		context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => changed.fire()));
		context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
			if (path.basename(e.document.uri.fsPath) === XPathQuery.fileName) {
				this.diagnostics.delete(e.document.uri);
			}
		}));
	}

	// the location of an XML editor's cursor, e.g. /orders/order[2]/@id - from its outline, built first if VS Code
	// hasn't asked for it yet
	private static async cursorLocation(editor: vscode.TextEditor): Promise<string | undefined> {
		await XsltDefinitionProvider.contextFileSymbols(editor.document.uri);
		return XsltSymbolProvider.getXPathFromSelection(undefined, editor);
	}

	// where a location typed at a line's cursor would start: at the start of an expression - only comments before it -
	// and replacing what's typed so far, e.g. '/ord'
	public static locationCompletionStart(text: string, line: number, character: number): number | undefined {
		const lines = text.split(/\r?\n/);
		let start = line;
		while (start > 0 && lines[start - 1].trim() !== '') {
			start--;
		}
		if (XPathQuery.withoutComments(lines.slice(start, line).join('\n')).trim() !== '') {
			return undefined;
		}
		const typed = /^(\s*)([/\w:.@[\]-]*)$/.exec(lines[line].substring(0, character));
		return typed ? typed[1].length : undefined;
	}

	// the query file's text with an expression added at the end, after a blank line - or, if it's there already, as
	// it is - and the expression's line
	public static withExpression(text: string, expression: string): { text: string; line: number } {
		const existing = XPathQuery.expressionStarts(text).find((line) => XPathQuery.expressionAt(text, line)!.text.trim() === expression);
		if (existing !== undefined) {
			return { text, line: existing };
		}
		const before = text.replace(/\s*$/, '');
		const added = before === '' ? expression + '\n' : `${before}\n\n${expression}\n`;
		return { text: added, line: added.split('\n').length - 2 };
	}

	// from the XML file's editor: its cursor's location, as an expression in the query file, ready to run or change
	private async addLocation() {
		const xmlEditor = vscode.window.activeTextEditor;
		const location = xmlEditor ? await XPathQuery.cursorLocation(xmlEditor) : undefined;
		if (!location) {
			vscode.window.showInformationMessage('XPath query: put the cursor on an element or attribute in an XML file first.');
			return;
		}
		const queryEditor = await this.openQueryFile();
		const document = queryEditor.document;
		const { text, line } = XPathQuery.withExpression(document.getText(), location);
		if (text !== document.getText()) {
			await queryEditor.edit((edit) => edit.replace(new vscode.Range(0, 0, document.lineCount, 0), text));
		}
		const end = document.lineAt(line).range.end;
		queryEditor.selection = new vscode.Selection(end, end);
		queryEditor.revealRange(new vscode.Range(end, end));
	}

	// after each expression run on the XML context file, unchanged since, its result in brief
	private resultHints(document: vscode.TextDocument, text: string): vscode.InlayHint[] {
		const results = this.results.get(document.uri.toString()) ?? [];
		const target = DocumentChangeHandler.lastActiveXMLNonXSLUri?.toString();
		return XPathQuery.expressionStarts(text).flatMap((line) => {
			const expression = XPathQuery.expressionAt(text, line)!;
			const result = results.find((r) => r.expression === expression.text && r.target === target);
			if (!result) {
				return [];
			}
			const lastLine = line + expression.text.split('\n').length - 1;
			const label = new vscode.InlayHintLabelPart(result.summary);
			label.command = { title: 'Show All', command: 'xslt-xpath.showXPathQueryOutput' };
			label.tooltip = 'The latest result - all of it in the XPath Query output';
			const hint = new vscode.InlayHint(document.lineAt(lastLine).range.end, [label]);
			hint.paddingLeft = true;
			return [hint];
		});
	}

	private setResult(queryDocument: vscode.TextDocument, expression: string, summary?: string) {
		const key = queryDocument.uri.toString();
		const target = DocumentChangeHandler.lastActiveXMLNonXSLUri?.toString() ?? '';
		const results = (this.results.get(key) ?? []).filter((r) => r.expression !== expression);
		if (summary !== undefined) {
			results.push({ expression, target, summary });
		}
		this.results.set(key, results);
		this.changed.fire();
	}

	private queryFileUri(): vscode.Uri {
		const storage = this.context.storageUri ?? this.context.globalStorageUri;
		return vscode.Uri.joinPath(storage, XPathQuery.fileName);
	}

	// the query file, in an editor group below the XML file - which becomes the XML context file
	private async openQueryFile() {
		const active = vscode.window.activeTextEditor;
		if (active && active.document.languageId !== 'xslt' && active.document.languageId !== 'xpath' && /^(xml|bpmn|dcp|sch)$/.test(active.document.languageId)) {
			DocumentChangeHandler.setLastActiveXMLNonXSLUri(active.document.uri);
			DocumentChangeHandler.refreshStatusBarItem();
		}
		const uri = this.queryFileUri();
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
			// the root element: the XML file's outline has only it at the top - not comments, processing instructions or
			// a DOCTYPE. Usually cached, as VS Code's outline and breadcrumbs ask for it, and needed for completion anyway
			const target = DocumentChangeHandler.lastActiveXMLNonXSLUri;
			const symbols = target ? await XsltDefinitionProvider.contextFileSymbols(target) : undefined;
			await vscode.workspace.fs.writeFile(uri, Buffer.from(XPathQuery.seed(symbols?.[0]?.name), 'utf8'));
		}
		const document = await vscode.workspace.openTextDocument(uri);
		const open = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
		if (open) {
			return vscode.window.showTextDocument(document, { viewColumn: open.viewColumn });
		}
		await vscode.commands.executeCommand('workbench.action.newGroupBelow');
		const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Active, preview: false });
		const last = document.lineCount - 1;
		editor.selection = new vscode.Selection(last, document.lineAt(last).text.length, last, document.lineAt(last).text.length);
		return editor;
	}

	// runs the expression at the line (or the cursor) of the query file
	private async run(uri?: vscode.Uri, line?: number) {
		const editor = vscode.window.activeTextEditor;
		const queryDocument = uri ? await vscode.workspace.openTextDocument(uri) : editor?.document;
		if (!queryDocument) {
			return;
		}
		if (!XPathQuery.isQueryFile(queryDocument)) {
			vscode.window.showInformationMessage(`XPath query: runs an expression in the ${XPathQuery.fileName} editor - open it with 'Find Nodes with XPath...'.`);
			return;
		}
		const at = line ?? (editor && editor.document === queryDocument ? editor.selection.active.line : 0);
		const expression = XPathQuery.expressionAt(queryDocument.getText(), at);
		if (!expression) {
			vscode.window.showInformationMessage('XPath query: no expression at the cursor - write one, then press Ctrl+Enter.');
			return;
		}
		const target = DocumentChangeHandler.lastActiveXMLNonXSLUri;
		if (!target) {
			vscode.window.showErrorMessage('XPath query: open the XML file to query first - or pick an XML context file from the status bar.');
			return;
		}
		const saxonJar = unquotedPath(vscode.workspace.getConfiguration('XSLT.tasks').get<string>('saxonJar'));
		if (!saxonJar) {
			vscode.window.showErrorMessage('XPath query: set the "XSLT.tasks.saxonJar" setting to your Saxon jar path first.');
			return;
		}
		const xmlDocument = await vscode.workspace.openTextDocument(target);
		const { xpath, namespaces } = XPathQuery.withoutProlog(expression.text);
		this.diagnostics.delete(queryDocument.uri);
		let result: XPathQueryResult;
		try {
			result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Evaluating XPath' }, () =>
				this.evaluate(saxonJar, { xpath, xml: xmlDocument.getText(), systemId: target.toString(), namespaces }));
		} catch (e: any) {
			vscode.window.showErrorMessage(`XPath query: Saxon couldn't be run - ${e?.message ?? e}`);
			return;
		}
		if (result.error) {
			this.setResult(queryDocument, expression.text);
			this.showError(queryDocument, expression, result.error);
			return;
		}
		this.setResult(queryDocument, expression.text, XPathQuery.resultSummary(result));
		await this.showResult(queryDocument, xmlDocument, expression.text, result);
	}

	private evaluate(saxonJar: string, request: object): Promise<XPathQueryResult> {
		const adapterJar = vscode.Uri.joinPath(this.context.extensionUri, 'xslt-resources', 'xslt-debugger', 'xslt-debugger.jar').fsPath;
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		// a relative path is relative to the workspace folder, as for tasks
		const jar = folder && !path.isAbsolute(saxonJar) ? path.join(folder, saxonJar) : saxonJar;
		return new Promise((resolve, reject) => {
			const child = cp.spawn(XsltDebug.javaCommand, ['-cp', [adapterJar, jar].join(path.delimiter), XPathQuery.mainClass], { cwd: folder });
			let stdout = '';
			let stderr = '';
			child.stdout.on('data', (data: Buffer) => stdout += data.toString('utf8'));
			child.stderr.on('data', (data: Buffer) => stderr += data.toString('utf8'));
			child.on('error', reject);
			child.on('close', () => {
				try {
					resolve(JSON.parse(stdout));
				} catch {
					reject(new Error(stderr.trim().split('\n').slice(0, 3).join(' ') || 'no result'));
				}
			});
			child.stdin.end(JSON.stringify(request), 'utf8');
		});
	}

	private showError(queryDocument: vscode.TextDocument, expression: { text: string; startLine: number }, error: NonNullable<XPathQueryResult['error']>) {
		const lines = expression.text.split('\n');
		const lineIndex = Math.min(Math.max((error.line ?? 1) - 1, 0), lines.length - 1);
		const column = Math.min(Math.max((error.column ?? 1) - 1, 0), lines[lineIndex].length);
		const line = expression.startLine + lineIndex;
		const range = new vscode.Range(line, Math.max(0, column - 1), line, Math.max(column, lines[lineIndex].length));
		const diagnostic = new vscode.Diagnostic(range, `Saxon: ${error.message}`, vscode.DiagnosticSeverity.Error);
		diagnostic.code = error.code;
		diagnostic.source = 'XPath query';
		this.diagnostics.set(queryDocument.uri, [diagnostic]);
		vscode.window.setStatusBarMessage(`XPath query: ${error.code ?? 'error'} - see the Problems view`, 5000);
	}

	private async showResult(queryDocument: vscode.TextDocument, xmlDocument: vscode.TextDocument, expression: string, result: XPathQueryResult) {
		const items = result.items ?? [];
		const count = result.count ?? items.length;
		const nodes = items.filter((item) => item.kind === 'node');
		const summary = `${count} ${count === 1 ? 'item' : 'items'} for ${expression.replace(/\s+/g, ' ').trim()}` +
			(count > items.length ? ` (the first ${items.length} shown)` : '');
		this.output.appendLine(summary);
		for (const item of items) {
			this.output.appendLine('  ' + (item.kind === 'node' ? `${item.path}${item.value !== undefined ? '  ' + JSON.stringify(item.value) : ''}` :
				item.type ? `${item.value} (xs:${item.type})` : `${item.value}`));
		}
		// a value - e.g. count(//item) - or nothing found: shown only after the expression, and in the output
		if (nodes.length === 0) {
			return;
		}
		const symbols = await new XsltSymbolProvider(XMLConfiguration.configuration, null).getDocumentSymbols(xmlDocument, false) ?? [];
		const locations = nodes.map((item) => XPathQuery.rangeOf(item, symbols, xmlDocument)).filter((range): range is vscode.Range => !!range)
			.map((range) => new vscode.Location(xmlDocument.uri, range));
		if (locations.length === 0) {
			vscode.window.showInformationMessage(`XPath query: ${nodes.length} nodes found, but not in the XML file's outline - e.g. if it isn't well-formed`);
			return;
		}
		// in the XML file's editor - the one it was opened from, not the query file's group
		const queryColumn = vscode.window.visibleTextEditors.find((e) => e.document === queryDocument)?.viewColumn;
		const xmlEditor = vscode.window.visibleTextEditors.find((e) => e.document === xmlDocument && e.viewColumn !== queryColumn);
		await vscode.window.showTextDocument(xmlDocument, { viewColumn: xmlEditor?.viewColumn ?? vscode.ViewColumn.One, preserveFocus: false });
		vscode.window.setStatusBarMessage(`XPath query: ${summary}`, 10000);
		await vscode.commands.executeCommand('editor.action.showReferences', xmlDocument.uri, locations[0].range.start, locations);
	}
}
