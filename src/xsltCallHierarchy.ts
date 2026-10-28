/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT call hierarchy
 */
import * as vscode from 'vscode';
import { TokenLevelState } from './xpLexer';
import { XslLexer } from './xslLexer';
import { XSLTConfiguration } from './languageConfigurations';
import { XsltTokenDiagnostics } from './xsltTokenDiagnostics';

const builtInPrefixes = new Set(['fn', 'map', 'array', 'math', 'xs']);

/**
 * The static call hierarchy of stylesheet functions and templates ('Show Call Hierarchy'): incoming calls - the
 * templates, functions and other declarations calling a function or named template, found as 'Find All References'
 * finds them, across modules - and outgoing calls: the stylesheet functions and named templates a declaration calls,
 * resolved as 'Go to Definition' resolves them. Template rules are called by xsl:apply-templates, which depends on the
 * node at run time, so they're callers but not callees.
 */
export class XsltCallHierarchyProvider implements vscode.CallHierarchyProvider {

	// a function or named template called at the position, else the top-level declaration it's in
	public async prepareCallHierarchy(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CallHierarchyItem | undefined> {
		if (XsltCallHierarchyProvider.callAt(document, position)) {
			const target = await XsltCallHierarchyProvider.definition(document.uri, position);
			if (target) {
				return XsltCallHierarchyProvider.itemAt(target.uri, target.range.start);
			}
		}
		return XsltCallHierarchyProvider.itemAt(document.uri, position);
	}

	public async provideCallHierarchyIncomingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyIncomingCall[]> {
		if (!XsltCallHierarchyProvider.isCallable(item)) {
			return [];
		}
		const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', item.uri, item.selectionRange.start) ?? [];
		// grouped by the declaration each is in - not the item's own name
		const calls = new Map<string, { from: vscode.CallHierarchyItem; ranges: vscode.Range[] }>();
		for (const reference of references) {
			if (reference.uri.toString() === item.uri.toString() && item.selectionRange.contains(reference.range)) {
				continue;
			}
			const from = await XsltCallHierarchyProvider.itemAt(reference.uri, reference.range.start);
			if (!from) {
				continue;
			}
			const key = from.uri.toString() + '#' + from.range.start.line + ':' + from.range.start.character;
			const call = calls.get(key) ?? { from, ranges: [] };
			call.ranges.push(reference.range);
			calls.set(key, call);
		}
		return [...calls.values()].map((c) => new vscode.CallHierarchyIncomingCall(c.from, c.ranges));
	}

	public async provideCallHierarchyOutgoingCalls(item: vscode.CallHierarchyItem): Promise<vscode.CallHierarchyOutgoingCall[]> {
		const document = await vscode.workspace.openTextDocument(item.uri);
		const calls = new Map<string, { to: vscode.CallHierarchyItem; ranges: vscode.Range[] }>();
		for (const range of XsltCallHierarchyProvider.callRanges(document, item.range)) {
			// within the name: at its first character, Go to Definition may take the character before it
			const target = await XsltCallHierarchyProvider.definition(document.uri, range.start.translate(0, 1));
			const to = target ? await XsltCallHierarchyProvider.itemAt(target.uri, target.range.start) : undefined;
			if (!to) {
				continue;
			}
			const key = to.uri.toString() + '#' + to.range.start.line + ':' + to.range.start.character;
			const call = calls.get(key) ?? { to, ranges: [] };
			call.ranges.push(range);
			calls.set(key, call);
		}
		return [...calls.values()].map((c) => new vscode.CallHierarchyOutgoingCall(c.to, c.ranges));
	}

	// a function or named template - not a template rule, global variable etc., which only call others
	private static isCallable(item: vscode.CallHierarchyItem) {
		return item.kind === vscode.SymbolKind.Function;
	}

	private static async definition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location | undefined> {
		const result = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', uri, position) ?? [];
		const first = result[0];
		return !first ? undefined : first instanceof vscode.Location ? first : new vscode.Location(first.targetUri, first.targetSelectionRange ?? first.targetRange);
	}

	// the top-level declaration (a child of xsl:stylesheet) at a position, as an item
	private static async itemAt(uri: vscode.Uri, position: vscode.Position): Promise<vscode.CallHierarchyItem | undefined> {
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri) ?? [];
		const declaration = (symbols[0]?.children ?? []).find((s) => s.range.contains(position));
		if (!declaration) {
			return undefined;
		}
		const document = await vscode.workspace.openTextDocument(uri);
		const text = document.getText(new vscode.Range(declaration.range.start, document.positionAt(document.offsetAt(declaration.range.start) + 4000)));
		const startTag = text.substring(0, text.indexOf('>') + 1);
		const attribute = (attributeName: string) => new RegExp(`\\s${attributeName}\\s*=\\s*(["'])(.*?)\\1`, 's').exec(startTag)?.[2].replace(/\s+/g, ' ').trim();
		const separator = declaration.name.indexOf(' › ');
		const elementName = separator > 0 ? declaration.name.substring(0, separator) : declaration.name;
		const isTemplate = elementName === 'xsl:template';
		const isNamedTemplate = isTemplate && attribute('name') !== undefined;
		const kind = elementName === 'xsl:function' || isNamedTemplate ? vscode.SymbolKind.Function : isTemplate ? vscode.SymbolKind.Method : vscode.SymbolKind.Variable;
		// e.g. 'f:sum', with 'function' as the detail, or 'order' (the match pattern), with 'template rule' - and a mode
		const mode = isTemplate && !isNamedTemplate ? attribute('mode') : undefined;
		const name = isNamedTemplate ? attribute('name')! : isTemplate ? (attribute('match') ?? 'xsl:template') + (mode ? ` (mode ${mode})` : '') :
			separator > 0 ? declaration.name.substring(separator + 3) : declaration.name;
		const detail = isNamedTemplate ? 'named template' : elementName === 'xsl:template' ? 'template rule' : elementName === 'xsl:function' ? 'function' : elementName;
		// for a function or named template, its name in the name attribute - where its references are found from
		const nameValue = kind === vscode.SymbolKind.Function ? /\sname\s*=\s*(["'])\s*/.exec(startTag) : null;
		const selectionRange = nameValue ? new vscode.Range(document.positionAt(document.offsetAt(declaration.range.start) + nameValue.index + nameValue[0].length),
			document.positionAt(document.offsetAt(declaration.range.start) + nameValue.index + nameValue[0].length + name.length)) : declaration.selectionRange;
		return new vscode.CallHierarchyItem(kind, name, detail, uri, declaration.range, selectionRange);
	}

	// whether a call of a stylesheet function, or an xsl:call-template's name, is at a position
	private static callAt(document: vscode.TextDocument, position: vscode.Position) {
		return XsltCallHierarchyProvider.callRanges(document, document.lineAt(position.line).range).some((r) => r.contains(position));
	}

	// the calls within a range: stylesheet functions' names (in calls and named function references, e.g. f:sum#2),
	// and xsl:call-template's name attributes
	public static callRanges(document: vscode.TextDocument, within: vscode.Range): vscode.Range[] {
		const ranges: vscode.Range[] = [];
		const tokens = new XslLexer(XSLTConfiguration.configuration).analyse(document.getText());
		const xslStart = XslLexer.getXsltStartTokenNumber();
		for (const token of tokens) {
			if (token.tokenType >= xslStart || (token.tokenType !== TokenLevelState.function && token.tokenType !== TokenLevelState.functionNameTest)) {
				continue;
			}
			const name = token.value.replace(/#\d+$/, '');
			if (!name.includes(':') || builtInPrefixes.has(name.split(':')[0])) {
				continue;
			}
			const range = new vscode.Range(token.line, token.startCharacter, token.line, token.startCharacter + name.length);
			if (within.contains(range)) {
				ranges.push(range);
			}
		}
		const text = document.getText(within);
		const callTemplate = XsltTokenDiagnostics.xsltPatternOf(/<xsl:call-template\s[^>]*?\bname\s*=\s*(["'])([^"']+)\1/g, document);
		for (let m = callTemplate.exec(text); m; m = callTemplate.exec(text)) {
			const start = document.offsetAt(within.start) + m.index + m[0].length - 1 - m[2].length;
			ranges.push(new vscode.Range(document.positionAt(start), document.positionAt(start + m[2].length)));
		}
		return ranges.sort((a, b) => a.start.compareTo(b.start));
	}
}
