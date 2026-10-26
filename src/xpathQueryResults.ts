/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XPath queries on XML files
 */
import * as vscode from 'vscode';

// the API of VS Code's References view - the built-in 'vscode.references-view' extension's exports - as its
// references-view.d.ts gives it: the view shows an input's tree, as for 'Find All References' or call hierarchy
interface SymbolTree {
	setInput(input: SymbolTreeInput<unknown>): void;
	getInput(): SymbolTreeInput<unknown> | undefined;
}

interface SymbolTreeInput<T> {
	readonly contextValue: string;
	readonly title: string;
	readonly location: vscode.Location;
	resolve(): vscode.ProviderResult<SymbolTreeModel<T>>;
	with(location: vscode.Location): SymbolTreeInput<T>;
}

interface SymbolTreeModel<T> {
	message: string | undefined;
	provider: vscode.TreeDataProvider<T>;
	navigation?: SymbolItemNavigation<T>;
	highlights?: SymbolItemEditorHighlights<T>;
	dispose?(): void;
}

interface SymbolItemNavigation<T> {
	nearest(uri: vscode.Uri, position: vscode.Position): T | undefined;
	next(from: T): T;
	previous(from: T): T;
	location(item: T): vscode.Location | undefined;
}

interface SymbolItemEditorHighlights<T> {
	getEditorHighlights(item: T, uri: vscode.Uri): vscode.Range[] | undefined;
}

// a query's nodes, in the XML file, and its result in brief - for the view's message
export interface XPathQueryFound {
	locations: vscode.Location[];
	message: string;
}

type Item = { file: vscode.Uri } | { match: vscode.Location; index: number };

// a query's nodes in the References view: the XML file, and under it each node - its line, with the node's name or
// text highlighted - to go to, as with 'Find All References'. F4 and Shift+F4 go from one to the next
class XPathQueryResultsModel implements vscode.TreeDataProvider<Item>, SymbolItemNavigation<Item>, SymbolItemEditorHighlights<Item> {
	private file: Item;
	private matches: Item[];

	constructor(private found: XPathQueryFound, private document: vscode.TextDocument) {
		this.file = { file: document.uri };
		this.matches = found.locations.map((match, index) => ({ match, index }));
	}

	getTreeItem(item: Item): vscode.TreeItem {
		if ('file' in item) {
			const treeItem = new vscode.TreeItem(item.file, vscode.TreeItemCollapsibleState.Expanded);
			treeItem.iconPath = vscode.ThemeIcon.File;
			treeItem.description = true;
			return treeItem;
		}
		const { label, highlight } = XPathQueryResults.preview(this.document.lineAt(item.match.range.start.line).text, item.match.range);
		const treeItem = new vscode.TreeItem({ label, highlights: [highlight] }, vscode.TreeItemCollapsibleState.None);
		treeItem.command = { title: 'Open Node', command: 'vscode.open', arguments: [item.match.uri, { selection: new vscode.Range(item.match.range.start, item.match.range.start) }] };
		return treeItem;
	}

	getChildren(item?: Item): Item[] {
		return !item ? (this.matches.length > 0 ? [this.file] : []) : 'file' in item ? this.matches : [];
	}

	getParent(item: Item): Item | undefined {
		return 'match' in item ? this.file : undefined;
	}

	nearest(uri: vscode.Uri, position: vscode.Position): Item | undefined {
		if (uri.toString() !== this.document.uri.toString()) {
			return this.matches[0];
		}
		return this.matches.find((m) => 'match' in m && !m.match.range.end.isBefore(position)) ?? this.matches[0];
	}

	next(from: Item): Item {
		return 'file' in from ? this.matches[0] : this.matches[(from.index + 1) % this.matches.length];
	}

	previous(from: Item): Item {
		return 'file' in from ? this.matches[this.matches.length - 1] : this.matches[(from.index - 1 + this.matches.length) % this.matches.length];
	}

	location(item: Item): vscode.Location | undefined {
		return 'match' in item ? item.match : undefined;
	}

	getEditorHighlights(_item: Item, uri: vscode.Uri): vscode.Range[] | undefined {
		return uri.toString() === this.document.uri.toString() ? this.found.locations.map((l) => l.range) : undefined;
	}
}

// a query run, as the References view's input: shown first with the nodes already found - and, from the view's
// history or its Refresh, run again on the XML file as it is then
class XPathQueryInput implements SymbolTreeInput<Item> {
	readonly contextValue = 'xpathQuery';

	constructor(readonly title: string, readonly location: vscode.Location, private find: () => Promise<XPathQueryFound | undefined>,
		private found?: XPathQueryFound) { }

	async resolve(): Promise<SymbolTreeModel<Item> | undefined> {
		const found = this.found ?? await this.find();
		this.found = undefined;
		if (!found) {
			return undefined;
		}
		const model = new XPathQueryResultsModel(found, await vscode.workspace.openTextDocument(this.location.uri));
		return { message: found.message, provider: model, navigation: model, highlights: model };
	}

	with(location: vscode.Location): XPathQueryInput {
		return new XPathQueryInput(this.title, location, this.find);
	}
}

export class XPathQueryResults {
	// a node's line in the view: from the start of a word up to 8 characters before it - not the indentation - to some
	// way after it, with the node's name or text (on its first line) highlighted, as for 'Find All References'
	public static preview(line: string, range: vscode.Range): { label: string; highlight: [number, number] } {
		const start = range.start.character;
		const end = range.end.line === range.start.line ? range.end.character : line.length;
		let from = Math.max(0, start - 8);
		while (from > 0 && /[\w.:-]/.test(line[from - 1])) {
			from--;
		}
		const before = line.substring(from, start).replace(/^\s+/, '');
		const label = before + line.substring(start, Math.min(line.length, end + 331));
		return { label, highlight: [before.length, before.length + end - start] };
	}

	// in the References view - or, if it's not there (the built-in extension is disabled), a peek
	public static async show(title: string, found: XPathQueryFound, find: () => Promise<XPathQueryFound | undefined>) {
		const first = found.locations[0];
		const referencesView = vscode.extensions.getExtension<SymbolTree>('vscode.references-view');
		const tree = await referencesView?.activate().then((api) => api, () => undefined);
		if (!tree?.setInput) {
			await vscode.commands.executeCommand('editor.action.showReferences', first.uri, first.range.start, found.locations);
			return;
		}
		tree.setInput(new XPathQueryInput(title, first, find, found));
	}
}
