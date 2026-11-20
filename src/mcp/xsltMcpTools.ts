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
import * as fs from 'fs';
import * as path from 'path';
import { McpRoot } from './mcpRoot';
import { DiskTextDocument } from './diskTextDocument';
import { ImportNode, ImportTreeProvider } from '../importTreeProvider';
import { ImportIndex } from '../importIndex';
import { GlobalInstructionData, GlobalInstructionType, XslLexer } from '../xslLexer';
import { XsltTokenDefinitions } from '../xsltTokenDefintions';
import { RecordTypes } from '../recordTypes';
import { XPathFunctionDetails } from '../xpathFunctionDetails';
import { XdocNote, XdocNotes } from '../xdocNote';
import { XSpecTestNode, XSpecTests } from '../xspecTests';

// what the tools need from the extension: the problems and the declarations of an XSLT module or XSpec file, as the
// linter finds them - undefined for a document in another language
// a module's problems and declarations, checked as in the editor: with the top-level stylesheet that imports or includes
// it - the one given, or else the one found for it (see XsltSymbolProvider.processTopLevelImports)
export interface XsltModules {
	problems(document: vscode.TextDocument, topLevel?: string): Promise<vscode.Diagnostic[]> | undefined;
	declarations(document: vscode.TextDocument, topLevel?: string): Promise<{ own: GlobalInstructionData[], imported: GlobalInstructionData[] }> | undefined;
}

export type ToolResult = { content: { type: 'text', text: string }[], isError: boolean };

export type Severity = 'error' | 'warning' | 'info' | 'hint';

// the kinds of declaration, by the name a tool is given - with the instructions that declare them
const declarationKinds: { [kind: string]: GlobalInstructionType[] } = {
	'function': [GlobalInstructionType.Function],
	'template': [GlobalInstructionType.Template],
	'variable': [GlobalInstructionType.Variable, GlobalInstructionType.Parameter],
	'mode': [GlobalInstructionType.Mode],
	'attribute-set': [GlobalInstructionType.AttributeSet],
	'key': [GlobalInstructionType.Key],
	'accumulator': [GlobalInstructionType.Accumulator],
	'item-type': [GlobalInstructionType.ItemType],
	'character-map': [GlobalInstructionType.CharacterMap]
};
export const declarationKindNames = Object.keys(declarationKinds) as [string, ...string[]];

const elementNames = new Map<GlobalInstructionType, string>([
	[GlobalInstructionType.Function, 'xsl:function'], [GlobalInstructionType.Template, 'xsl:template'], [GlobalInstructionType.Variable, 'xsl:variable'],
	[GlobalInstructionType.Parameter, 'xsl:param'], [GlobalInstructionType.Mode, 'xsl:mode'], [GlobalInstructionType.AttributeSet, 'xsl:attribute-set'],
	[GlobalInstructionType.Key, 'xsl:key'], [GlobalInstructionType.Accumulator, 'xsl:accumulator'], [GlobalInstructionType.ItemType, 'xsl:item-type'],
	[GlobalInstructionType.CharacterMap, 'xsl:character-map']
]);

// The MCP server's tools (see XsltMcpServer): each returns text for the assistant - with isError for a request that
// can't be answered, e.g. a file that isn't found, not for problems found
export class XsltMcpTools {
	private static readonly severities: Severity[] = ['error', 'warning', 'info', 'hint'];
	private static readonly maxFiles = 1000;
	private static readonly maxReferences = 200;
	private static readonly maxDeclarations = 500;

	public constructor(private readonly modules: XsltModules) {
	}

	private static text(text: string, isError = false): ToolResult {
		return { content: [{ type: 'text', text }], isError };
	}

	private static resolve(filePath: string): string {
		const folder = McpRoot.current();
		return path.isAbsolute(filePath) || !folder ? path.resolve(filePath) : path.resolve(folder, filePath);
	}

	// a path as shown: relative to the project's folder, if it's in it
	private static shown(file: string) {
		const folder = McpRoot.current();
		return folder && file.startsWith(folder + path.sep) ? path.relative(folder, file) : file;
	}

	private static async open(filePath: string, withXSpec: boolean): Promise<vscode.TextDocument | string> {
		const resolved = XsltMcpTools.resolve(filePath);
		if (!(withXSpec ? /\.(xslt?|xspec)$/i : /\.xslt?$/i).test(resolved)) {
			return `Not an XSLT${withXSpec ? ' or XSpec' : ''} file: ${resolved}`;
		}
		if (!fs.existsSync(resolved)) {
			return `File not found: ${resolved}`;
		}
		return DiskTextDocument.current(vscode.Uri.file(resolved));
	}

	// the index of the workspace's modules, built: a module's top-level stylesheet is found from it. The editor builds it in
	// the background the first time it's needed, and checks the open modules again once it's built - a tool's answer
	// can't be updated, so it waits, or a module would be checked without the declarations of the modules that include it
	private static async indexBuilt() {
		if (ImportIndex.isEnabled()) {
			await ImportIndex.instance.whenBuilt();
		}
	}

	// a module's declarations: its own and those of the modules it uses - with the top-level stylesheet given, or else the
	// one found for it from the index
	private async declarationsOf(document: vscode.TextDocument, topLevel?: string) {
		if (!topLevel) {
			await XsltMcpTools.indexBuilt();
		}
		return this.modules.declarations(document, topLevel);
	}

	// a tool's topLevelStylesheet argument, for the module: the stylesheet's path - undefined, when not given - or the
	// error to return
	private static topLevelArgument(document: vscode.TextDocument, topLevelStylesheet?: string): { topLevel?: string, error?: ToolResult } {
		if (!topLevelStylesheet) {
			return {};
		}
		if (document.languageId !== 'xslt') {
			return { error: XsltMcpTools.text(`A top-level stylesheet is only for an XSLT module, not an XSpec file: ${document.fileName}`, true) };
		}
		const found = XsltMcpTools.topLevelFor(document.fileName, topLevelStylesheet);
		return 'problem' in found ? { error: XsltMcpTools.text(found.problem, true) } : { topLevel: found.path };
	}

	// the text that says which top-level stylesheet a module was checked with, when one was given
	private static withTopLevel(topLevel?: string) {
		return topLevel ? ` - checked with the top-level stylesheet ${XsltMcpTools.shown(topLevel)}` : '';
	}

	// the top-level stylesheet given for a module: an XSLT file that imports or includes it, directly or indirectly - or
	// the reason it can't be used
	private static topLevelFor(module: string, topLevel: string): { path: string } | { problem: string } {
		const resolved = XsltMcpTools.resolve(topLevel);
		if (!/\.xslt?$/i.test(resolved)) {
			return { problem: `The top-level stylesheet isn't an XSLT file: ${resolved}` };
		}
		if (!fs.existsSync(resolved)) {
			return { problem: `The top-level stylesheet isn't found: ${resolved}` };
		}
		if (resolved === module) {
			return { problem: `The top-level stylesheet is the module itself: ${resolved} - leave topLevelStylesheet out to check it on its own` };
		}
		// its xsl:import and xsl:include hrefs, followed down the tree
		const seen = new Set<string>([resolved]);
		const pending = [resolved];
		while (pending.length > 0) {
			const file = pending.shift()!;
			let text: string;
			try {
				text = fs.readFileSync(file, 'utf8');
			} catch {
				continue;
			}
			for (const reference of ImportIndex.moduleReferences(text, file)) {
				if (reference.path === module) {
					return { path: resolved };
				}
				if (!seen.has(reference.path)) {
					seen.add(reference.path);
					pending.push(reference.path);
				}
			}
		}
		return { problem: `${XsltMcpTools.shown(resolved)} doesn't import or include ${XsltMcpTools.shown(module)}, directly or indirectly` };
	}

	// ---------------------------------------------------------------- problems

	// a document's problems, of the severity given or worse, as lines of 'line:column severity message' - an empty file
	// is one: the linter doesn't report it, so that a new file isn't shown with an error, but Saxon can't compile it
	private async problemLines(document: vscode.TextDocument, minSeverity: Severity, topLevel?: string): Promise<string[] | undefined> {
		// with a top-level stylesheet given, the index isn't used
		if (!topLevel) {
			await XsltMcpTools.indexBuilt();
		}
		const diagnostics = await this.modules.problems(document, topLevel);
		if (!diagnostics) {
			return undefined;
		}
		if (document.getText().trim() === '') {
			return ['1:1 error The file is empty: it isn\'t a well-formed XML document, so it can\'t be compiled'];
		}
		const worst = XsltMcpTools.severities.indexOf(minSeverity);
		return [...diagnostics].filter((d) => d.severity <= worst).sort((a, b) => a.range.start.compareTo(b.range.start))
			.map((d) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${XsltMcpTools.severities[d.severity]} ${d.message}`);
	}

	// topLevelStylesheet: one to check an XSLT module with, instead of the one found for it - e.g. one outside the
	// workspace, or another of those that include it
	public async lintFile(filePath: string, minSeverity: Severity = 'hint', topLevelStylesheet?: string): Promise<ToolResult> {
		const document = await XsltMcpTools.open(filePath, true);
		if (typeof document === 'string') {
			return XsltMcpTools.text(document, true);
		}
		const { topLevel, error } = XsltMcpTools.topLevelArgument(document, topLevelStylesheet);
		if (error) {
			return error;
		}
		const lines = await this.problemLines(document, minSeverity, topLevel);
		if (!lines) {
			return XsltMcpTools.text(`Not checked - the file's language is '${document.languageId}', not XSLT or XSpec: ${document.fileName}`, true);
		}
		const withTopLevel = XsltMcpTools.withTopLevel(topLevel);
		return XsltMcpTools.text(lines.length === 0 ? `No problems: ${document.fileName}${withTopLevel}` :
			`${lines.length} problem${lines.length === 1 ? '' : 's'} in ${document.fileName}${withTopLevel}:\n${lines.join('\n')}`);
	}

	// the folders and files lint_files leaves out, within the folder: node_modules, XSpec's generated test runners, hidden
	// folders such as .git or .vscode-test - unless the pattern names one - and the files.exclude setting's patterns
	// (findFiles doesn't apply files.exclude when given an exclude pattern)
	public static lintExcludes(base: string, pattern: string) {
		const excludes = ['**/node_modules/**', '**/xspec/*-compiled.xsl'];
		if (!/(^|\/)\./.test(pattern)) {
			excludes.push('**/.*/**');
		}
		const filesExclude = vscode.workspace.getConfiguration('files', vscode.Uri.file(base)).get<Record<string, unknown>>('exclude') ?? {};
		for (const [glob, on] of Object.entries(filesExclude)) {
			// true only - not a 'when' clause; nested braces aren't allowed in a glob pattern
			if (on === true && !glob.includes('{')) {
				excludes.push(glob, glob.replace(/\/$/, '') + '/**');
			}
		}
		return new vscode.RelativePattern(base, `{${excludes.join(',')}}`);
	}

	// the problems of the XSLT and XSpec files in a folder - not XSpec's generated test runners or hidden folders
	public async lintFiles(folder: string | undefined, pattern = '**/*.{xsl,xslt,xspec}', minSeverity: Severity = 'warning'): Promise<ToolResult> {
		const base = folder ? XsltMcpTools.resolve(folder) : McpRoot.current();
		if (!base || !fs.existsSync(base) || !fs.statSync(base).isDirectory()) {
			return XsltMcpTools.text(base ? `Folder not found: ${base}` : 'No folder given, and no workspace folder is open', true);
		}
		const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(base, pattern), XsltMcpTools.lintExcludes(base, pattern), XsltMcpTools.maxFiles + 1);
		const files = uris.map((uri) => uri.fsPath).filter((file) => /\.(xslt?|xspec)$/i.test(file)).sort();
		const results: string[] = [];
		let checked = 0;
		let problems = 0;
		// one at a time: each is checked with the declarations of its own imports
		for (const file of files.slice(0, XsltMcpTools.maxFiles)) {
			const lines = await this.problemLines(await DiskTextDocument.current(vscode.Uri.file(file)), minSeverity);
			if (!lines) {
				continue;
			}
			checked++;
			if (lines.length > 0) {
				problems += lines.length;
				results.push(`${XsltMcpTools.shown(file)} - ${lines.length} problem${lines.length === 1 ? '' : 's'}:\n${lines.map((line) => '  ' + line).join('\n')}`);
			}
		}
		const severity = minSeverity === 'hint' ? '' : minSeverity === 'error' ? ' (errors only)' : ` (${minSeverity}s or worse)`;
		const more = files.length > XsltMcpTools.maxFiles ? ` - only the first ${XsltMcpTools.maxFiles} files are checked` : '';
		const summary = `Checked ${checked} file${checked === 1 ? '' : 's'} in ${base}${more}: ${problems === 0 ? 'no problems' :
			`${problems} problem${problems === 1 ? '' : 's'} in ${results.length} file${results.length === 1 ? '' : 's'}`}${severity}`;
		return XsltMcpTools.text([summary].concat(results).join('\n\n'));
	}

	// ---------------------------------------------------------------- imports

	public async moduleImports(filePath: string): Promise<ToolResult> {
		const document = await XsltMcpTools.open(filePath, false);
		if (typeof document === 'string') {
			return XsltMcpTools.text(document, true);
		}
		if (ImportIndex.isEnabled()) {
			await ImportIndex.instance.whenBuilt();
		}
		const tree = new ImportTreeProvider(() => document);
		const lines: string[] = [];
		const add = (node: ImportNode, depth: number) => {
			const indent = '  '.repeat(depth);
			if (node.package) {
				const { name, versionRange, version } = node.package;
				const asked = versionRange ? ` (package-version ${versionRange})` : '';
				lines.push(`${indent}uses package ${name}${asked}: ${version ? `version ${version}, ${XsltMcpTools.shown(node.path)}` : 'not found'}`);
				return;
			}
			const kind = depth === 0 ? 'top-level stylesheet' : node.isInclude ? 'includes' : 'imports';
			const cycle = node.ancestors.includes(node.path) ? ' - already above, not followed' : '';
			const marked = node.path === document.fileName ? '  <- this module' : '';
			lines.push(`${indent}${kind} ${XsltMcpTools.shown(node.path)}${marked}${cycle}${fs.existsSync(node.path) ? '' : ' - not found'}`);
			if (!cycle && depth < 30) {
				tree.getChildren(node).forEach((child) => add(child, depth + 1));
			}
		};
		tree.getChildren().forEach((root) => add(root, 0));
		return XsltMcpTools.text(lines.join('\n'));
	}

	// ---------------------------------------------------------------- declarations

	// the declarations with the name, of a kind - as seen from the module: its own, then those it imports or includes,
	// highest import precedence first. A name may be '$name' for a variable, or 'name#2' for a function of arity 2
	private async findDeclarations(document: vscode.TextDocument, name: string, kind?: string, topLevel?: string) {
		const declared = await this.declarationsOf(document, topLevel);
		const arityMatch = /^(.*)#(\d+)$/.exec(name.trim());
		const bareName = (arityMatch ? arityMatch[1] : name.trim()).replace(/^\$/, '');
		const arity = arityMatch ? Number(arityMatch[2]) : undefined;
		const types = kind ? declarationKinds[kind] : Object.values(declarationKinds).flat();
		const all = (declared?.own ?? []).concat(declared?.imported ?? []);
		return all.filter((global) => types.includes(global.type) && global.name === bareName &&
			(arity === undefined || global.type !== GlobalInstructionType.Function || XslLexer.functionArityMatches(global, arity)));
	}

	private static describe(global: GlobalInstructionData, document: vscode.TextDocument): string {
		const location = XsltTokenDefinitions.createLocationFromInstruction(global, document)!;
		const where = `${XsltMcpTools.shown(location.uri.fsPath)}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
		const element = elementNames.get(global.type) ?? 'declaration';
		const params = (global.memberNames ?? []).map((param, index) => `$${param}${global.memberOptional?.[index] ? '?' : ''}${global.memberTypes?.[index] ? ' as ' + global.memberTypes[index] : ''}`);
		switch (global.type) {
			case GlobalInstructionType.Function:
				return `${element} ${global.name}#${global.idNumber}(${params.join(', ')})${global.returnType ? ' as ' + global.returnType : ''} - ${where}`;
			case GlobalInstructionType.Template:
				return `${element} name="${global.name}"${params.length > 0 ? ' with parameters ' + params.join(', ') : ''} - ${where}`;
			case GlobalInstructionType.Variable:
			case GlobalInstructionType.Parameter:
			case GlobalInstructionType.ItemType:
				return `${element} ${global.type === GlobalInstructionType.ItemType ? '' : '$'}${global.name}${global.declaredType ? ' as ' + global.declaredType : ''}${global.defaultSelect ? ` select="${global.defaultSelect}"` : ''} - ${where}`;
			default:
				return `${element} ${global.name} - ${where}`;
		}
	}

	// a declaration's documentation: its note (xsl:note format="xdoc-md"), as a hover shows it - or else an XML comment
	// that ends on the line above its start tag, as is usual before XSLT 4.0, e.g. <!-- the total of a line -->
	private static documentation(global: GlobalInstructionData, document: vscode.TextDocument): { note?: XdocNote, text?: string } {
		const declaration = global.href === document.fileName ? { ...global, href: undefined } : global;
		const note = XdocNotes.forGlobal(declaration, document.getText());
		if (note) {
			return { note, text: XdocNotes.toMarkdown(note) };
		}
		let text: string;
		try {
			text = declaration.href ? fs.readFileSync(declaration.href, 'utf8') : document.getText();
		} catch {
			return {};
		}
		const lines = text.split(/\r?\n/);
		const lineStart = lines.slice(0, global.token.line).reduce((offset, line) => offset + line.length + 1, 0);
		const tagStart = text.lastIndexOf('<', lineStart + global.token.startCharacter);
		const before = text.substring(0, tagStart);
		const comment = /<!--((?:(?!-->)[\s\S])*)-->[ \t]*\r?\n[ \t]*$/.exec(before);
		return comment ? { text: comment[1].trim().split(/\r?\n/).map((line) => line.trim()).join('\n') } : {};
	}

	// the declaration, with its documentation below it, indented
	private static describeWithDocumentation(global: GlobalInstructionData, document: vscode.TextDocument) {
		const { text } = XsltMcpTools.documentation(global, document);
		return XsltMcpTools.describe(global, document) + (text ? '\n' + text.split('\n').map((line) => '    ' + line).join('\n') : '');
	}

	// a declaration's identity for import precedence: the same name, kind and (for a function) arity - the first has the
	// highest import precedence and is used
	private static precedenceKey(global: GlobalInstructionData) {
		return `${global.type === GlobalInstructionType.Parameter ? GlobalInstructionType.Variable : global.type} ${global.name}#${global.type === GlobalInstructionType.Function ? global.idNumber : ''}`;
	}

	// every component the module can use: its own declarations, then those of the modules it imports or includes and the
	// packages it uses - each with its parameters and types, and the first line of its documentation - to see what can be
	// reused before writing a new one
	// topLevelStylesheet: as for lintFile - the declarations as seen with it
	public async listDeclarations(filePath: string, kind?: string, topLevelStylesheet?: string): Promise<ToolResult> {
		const document = await XsltMcpTools.open(filePath, true);
		if (typeof document === 'string') {
			return XsltMcpTools.text(document, true);
		}
		const { topLevel, error } = XsltMcpTools.topLevelArgument(document, topLevelStylesheet);
		if (error) {
			return error;
		}
		const declared = await this.declarationsOf(document, topLevel);
		if (!declared) {
			return XsltMcpTools.text(`Not an XSLT or XSpec file: ${document.fileName}`, true);
		}
		const types = kind ? declarationKinds[kind] : Object.values(declarationKinds).flat();
		const wanted = (global: GlobalInstructionData) => types.includes(global.type) && !!global.name;
		const seen = new Set<string>();
		let shown = 0;
		const line = (global: GlobalInstructionData) => {
			const key = XsltMcpTools.precedenceKey(global);
			const overridden = seen.has(key);
			seen.add(key);
			const first = overridden ? undefined : XsltMcpTools.documentation(global, document).text?.split('\n').map((l) => l.trim()).find((l) => l !== '');
			const brief = first ? ' - ' + (first.length > 100 ? first.substring(0, 100) + '…' : first) : '';
			return '  ' + XsltMcpTools.describe(global, document) + (overridden ? ' - not used: overridden by one with a higher import precedence' : brief);
		};
		const sections: string[] = [];
		let total = 0;
		for (const [title, globals] of [['Declared in this module', declared.own], ['Declared in the modules and packages it uses', declared.imported]] as const) {
			const wantedGlobals = globals.filter(wanted);
			total += wantedGlobals.length;
			const lines: string[] = [];
			for (const global of wantedGlobals) {
				if (shown >= XsltMcpTools.maxDeclarations) {
					break;
				}
				shown++;
				lines.push(line(global));
			}
			if (wantedGlobals.length > 0) {
				sections.push(`${title} (${wantedGlobals.length}):\n${lines.join('\n')}`);
			}
		}
		const what = kind ? `${kind} declarations` : 'declarations';
		if (total === 0) {
			return XsltMcpTools.text(`No ${what} in ${XsltMcpTools.shown(document.fileName)} or the modules and packages it uses${XsltMcpTools.withTopLevel(topLevel)}`);
		}
		const more = total > shown ? ` - the first ${shown} are listed: give a kind to narrow it` : '';
		return XsltMcpTools.text(`${total} ${what} usable from ${XsltMcpTools.shown(document.fileName)}${XsltMcpTools.withTopLevel(topLevel)}${more}\n\n${sections.join('\n\n')}\n\n` +
			'Use find_declaration for a declaration\'s full documentation, and find_references for where it is used.');
	}

	// topLevelStylesheet: as for lintFile - the declarations as seen with it
	public async findDeclaration(filePath: string, name: string, kind?: string, topLevelStylesheet?: string): Promise<ToolResult> {
		const document = await XsltMcpTools.open(filePath, true);
		if (typeof document === 'string') {
			return XsltMcpTools.text(document, true);
		}
		const { topLevel, error } = XsltMcpTools.topLevelArgument(document, topLevelStylesheet);
		if (error) {
			return error;
		}
		const found = await this.findDeclarations(document, name, kind, topLevel);
		if (found.length === 0) {
			const builtIn = (!kind || kind === 'function') && XsltMcpTools.builtInFunctions(name.replace(/#\d+$/, ''), true).length > 0;
			return XsltMcpTools.text(`No ${kind ?? 'declaration'} named ${name} is declared in ${XsltMcpTools.shown(document.fileName)} or the modules and packages it uses${XsltMcpTools.withTopLevel(topLevel)}` +
				(builtIn ? ` - ${name.replace(/#\d+$/, '')} is a built-in function: see the xpath_function tool` : ''));
		}
		// for the same name, kind and arity in more than one module, the first - with the highest import precedence - is used
		const key = XsltMcpTools.precedenceKey;
		const seen = new Set<string>();
		const lines = found.map((global) => {
			const isUsed = !seen.has(key(global));
			seen.add(key(global));
			return isUsed ? XsltMcpTools.describeWithDocumentation(global, document) : XsltMcpTools.describe(global, document) + ' - not used: overridden by the one above, with a higher import precedence';
		});
		return XsltMcpTools.text(lines.join('\n') + (topLevel ? `\n\nAs seen from ${XsltMcpTools.shown(document.fileName)}${XsltMcpTools.withTopLevel(topLevel)}` : ''));
	}

	public async findReferences(filePath: string, name: string, kind?: string): Promise<ToolResult> {
		const document = await XsltMcpTools.open(filePath, true);
		if (typeof document === 'string') {
			return XsltMcpTools.text(document, true);
		}
		const [declaration] = await this.findDeclarations(document, name, kind);
		if (!declaration) {
			return XsltMcpTools.text(`No ${kind ?? 'declaration'} named ${name} is declared in ${XsltMcpTools.shown(document.fileName)} or the modules and packages it uses`, true);
		}
		// as Find All References finds them, from the declaration: in its module, the modules that use it, and XSpec files
		const location = XsltTokenDefinitions.createLocationFromInstruction(declaration, document)!;
		await vscode.workspace.openTextDocument(location.uri);
		const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', location.uri, location.range.start) ?? [];
		// and, for a declaration in another module, from a use of it in this one - with this module's imports, which the
		// declaration's module may not know of, e.g. when this one isn't in the workspace's index of modules
		const use = location.uri.toString() === document.uri.toString() ? undefined : await XsltMcpTools.useOf(document, declaration.name, location);
		if (use) {
			references.push(...await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, use) ?? []);
		}
		const unique = references.filter((reference, index) => references.findIndex((other) => other.uri.toString() === reference.uri.toString() && other.range.isEqual(reference.range)) === index)
			.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath) || a.range.start.compareTo(b.range.start));
		const byFile = new Map<string, vscode.Location[]>();
		unique.slice(0, XsltMcpTools.maxReferences).forEach((reference) => byFile.set(reference.uri.fsPath, [...(byFile.get(reference.uri.fsPath) ?? []), reference]));
		const sections: string[] = [];
		const tests: string[] = [];
		for (const [file, locations] of byFile) {
			const fileText = fs.readFileSync(file, 'utf8');
			const lines = fileText.split(/\r?\n/);
			const isXSpec = /\.xspec$/i.test(file);
			const scenarios = isXSpec ? XSpecTests.testTree(fileText) : [];
			const section = XsltMcpTools.shown(file) + ':\n' + locations.map((reference) => {
				const line = reference.range.start.line;
				const isDeclaration = file === location.uri.fsPath && line === location.range.start.line;
				const scenario = isXSpec ? XsltMcpTools.scenarioAt(scenarios, XsltMcpTools.offsetOf(fileText, reference.range.start)) : undefined;
				const inScenario = scenario ? ` (scenario: ${scenario.labelPath.join(' > ')}${scenario.pending ? ' - pending' : ''})` : '';
				return `  ${line + 1}:${reference.range.start.character + 1}${isDeclaration ? ' (declaration)' : ''}${inScenario} ${(lines[line] ?? '').trim()}`;
			}).join('\n');
			(isXSpec ? tests : sections).push(section);
		}
		// the uses in XSpec files after the others, as the tests of the declaration
		const tested = tests.length > 0 ? `\n\nTested in XSpec:\n\n${tests.join('\n\n')}` : '';
		const more = unique.length > XsltMcpTools.maxReferences ? ` - the first ${XsltMcpTools.maxReferences} are shown` : '';
		return XsltMcpTools.text(`${unique.length} reference${unique.length === 1 ? '' : 's'} to ${XsltMcpTools.describe(declaration, document)}${more}, including the declaration:\n\n${sections.join('\n\n')}${tested}`);
	}

	// the innermost scenario of an XSpec file that the offset is in
	private static scenarioAt(nodes: XSpecTestNode[], offset: number): XSpecTestNode | undefined {
		const node = nodes.find((node) => node.kind === 'scenario' && node.start <= offset && offset < node.end);
		return node ? XsltMcpTools.scenarioAt(node.children, offset) ?? node : undefined;
	}

	// the offset of a position in the text - with '\n' or '\r\n' line breaks
	private static offsetOf(text: string, position: vscode.Position): number {
		let offset = 0;
		for (let line = 0; line < position.line && offset >= 0; line++) {
			offset = text.indexOf('\n', offset) + 1;
		}
		return offset + position.character;
	}

	// the position of a use of the name in the document that Go to Definition finds the declaration at - the first of the
	// first 20 places the name is written
	private static async useOf(document: vscode.TextDocument, name: string, declaration: vscode.Location): Promise<vscode.Position | undefined> {
		const text = document.getText();
		const pattern = new RegExp(`(?<![\\w.:-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.:-])`, 'g');
		let match: RegExpExecArray | null;
		for (let tries = 0; tries < 20 && (match = pattern.exec(text)); tries++) {
			const position = document.positionAt(match.index + 1);
			const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', document.uri, position) ?? [];
			const isDeclaration = definitions.some((definition) => {
				const uri = 'targetUri' in definition ? definition.targetUri : definition.uri;
				const range = 'targetUri' in definition ? definition.targetRange : definition.range;
				return uri.toString() === declaration.uri.toString() && range.start.line === declaration.range.start.line;
			});
			if (isDeclaration) {
				return position;
			}
		}
		return undefined;
	}

	// ---------------------------------------------------------------- types

	// a named item type (xsl:item-type), or a record type: its fields - or an enumeration type's values
	// topLevelStylesheet: as for lintFile - the types declared with it
	public async describeType(filePath: string, name: string, topLevelStylesheet?: string): Promise<ToolResult> {
		const document = await XsltMcpTools.open(filePath, true);
		if (typeof document === 'string') {
			return XsltMcpTools.text(document, true);
		}
		const { topLevel, error } = XsltMcpTools.topLevelArgument(document, topLevelStylesheet);
		if (error) {
			return error;
		}
		const declared = await this.declarationsOf(document, topLevel);
		const all = (declared?.own ?? []).concat(declared?.imported ?? []);
		const itemTypes = new Map<string, string>();
		// the first with a name has the highest import precedence
		all.filter((global) => global.type === GlobalInstructionType.ItemType && global.declaredType).forEach((global) => {
			if (!itemTypes.has(global.name)) {
				itemTypes.set(global.name, global.declaredType!);
			}
		});
		const typeText = name.trim();
		const declaration = all.find((global) => global.type === GlobalInstructionType.ItemType && global.name === typeText);
		const lines = declaration ? [XsltMcpTools.describeWithDocumentation(declaration, document)] : [];
		const note = declaration ? XsltMcpTools.documentation(declaration, document).note : undefined;
		const record = RecordTypes.resolve(typeText, itemTypes);
		const values = record ? undefined : RecordTypes.resolveEnum(typeText, itemTypes);
		if (record) {
			lines.push(`a record type with ${record.fields.length} field${record.fields.length === 1 ? '' : 's'}:`);
			// with each field's @field text in the type's note
			record.fields.forEach((field) => {
				const fieldText = note ? XdocNotes.fieldText(note, field.name) : undefined;
				lines.push(`  ${field.name}${field.optional ? '?' : ''}${field.type ? ' as ' + field.type : ''}${fieldText ? ' - ' + fieldText.replace(/\s+/g, ' ') : ''}`);
			});
		} else if (values) {
			lines.push(`an enumeration type, with the values: ${values.map((value) => `'${value}'`).join(', ')}`);
		} else if (!declaration) {
			return XsltMcpTools.text(`No item type named ${typeText} is declared in ${XsltMcpTools.shown(document.fileName)} or the modules and packages it uses${XsltMcpTools.withTopLevel(topLevel)}` +
				(itemTypes.size > 0 ? ` - those declared are: ${[...itemTypes.keys()].join(', ')}` : ''));
		}
		return XsltMcpTools.text(lines.join('\n') + (topLevel ? `\n\nAs seen from ${XsltMcpTools.shown(document.fileName)}${XsltMcpTools.withTopLevel(topLevel)}` : ''));
	}

	// ---------------------------------------------------------------- built-in functions

	private static builtInFunctions(name: string, isVersion4: boolean) {
		const bare = name.trim().replace(/^fn:/, '');
		const data = isVersion4 ? XPathFunctionDetails.dataPlus40 : XPathFunctionDetails.data;
		return data.filter((item) => item.name === bare);
	}

	public xpathFunction(name: string, xpathVersion: '3.1' | '4.0' = '3.1'): ToolResult {
		const found = XsltMcpTools.builtInFunctions(name.replace(/#\d+$/, ''), xpathVersion === '4.0');
		if (found.length === 0) {
			const in40 = xpathVersion === '3.1' && XsltMcpTools.builtInFunctions(name.replace(/#\d+$/, ''), true).length > 0;
			return XsltMcpTools.text(`${name} isn't a built-in function in XPath ${xpathVersion} or XSLT ${xpathVersion === '3.1' ? '3.0' : '4.0'}` +
				(in40 ? ' - it is in XPath 4.0: use xpathVersion "4.0"' : ' - for a function declared in a stylesheet, see the find_declaration tool'));
		}
		return XsltMcpTools.text(found.map((item) => `${item.signature}\n\n${item.description}`).join('\n\n---\n\n'));
	}
}
