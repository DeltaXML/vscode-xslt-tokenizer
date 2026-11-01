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
import { RecordTypes } from './recordTypes';
import { XdocNotes } from './xdocNote';
import { XslLexerLight } from './xslLexerLight';
import { XSpecReferences } from './xspecReferences';
import { parseXml } from './xspecXml';
import { XSpecTests } from './xspecTests';
import { XSpecSourceMap } from './xspecSourceMap';
import { ImportIndex } from './importIndex';
import { ModulePrefixes } from './modulePrefixes';
import { XsltPackages } from './xsltPackages';
import { PackageScope } from './packageScope';
import { GlobalInstructionData, GlobalInstructionType } from './xslLexer';

// A new XSpec scenario for a stylesheet's function, named template or template rule - in an XSpec file that tests the
// stylesheet, or a new one beside it, <name>.xspec - inserted as a snippet, to complete the parameters' values and the
// expected result: x:call with an x:param for each of the function's parameters, in order and with their types, or of
// the template's (not tunnel parameters), or for a template rule, x:context with its mode and an element it matches
export interface XSpecDeclaration {
	kind: 'function' | 'template' | 'rule';
	// the function's or template's name, or the template rule's match pattern
	name: string;
	mode?: string;
	// a named template's or function's 'as'
	as?: string;
	params: { name: string, as?: string }[];
}

export class XSpecScenario {
	public static readonly command = 'xslt-xpath.createXSpecScenario';
	public static readonly fileCommand = 'xslt-xpath.createXSpecFile';

	// the cursor is in the start tag of the stylesheet's or package's outermost element
	public static isInRootTag(text: string, offset: number) {
		const markup = RecordTypes.blankMarkup(text);
		const rootStart = markup.search(/<(?![?!])/);
		const tagEnd = rootStart > -1 ? markup.indexOf('>', rootStart) : -1;
		return rootStart > -1 && offset > rootStart && offset <= tagEnd &&
			RecordTypes.xsltPattern(/^<xsl:(stylesheet|transform|package)[\s>]/, text).test(text.substring(rootStart, rootStart + 40));
	}

	// the declaration whose start tag the offset is in: a top-level xsl:function, or xsl:template with a name or match
	public static declarationAt(text: string, offset: number): XSpecDeclaration | undefined {
		const tagStart = offset > 0 ? text.lastIndexOf('<', offset - 1) : -1;
		const writtenName = tagStart > -1 ? RecordTypes.xsltPattern(/^<(xsl:function|xsl:template)[\s/>]/, text).exec(text.substring(tagStart, tagStart + 40))?.[1] : undefined;
		const elementName = writtenName ? RecordTypes.xsltName(writtenName, RecordTypes.xsltPrefix(text)) : undefined;
		const markup = RecordTypes.blankMarkup(text);
		if (!elementName || !XdocNotes.isGlobal(markup, tagStart)) {
			return undefined;
		}
		const startTag = new RegExp(RecordTypes.tagPattern, 'y');
		startTag.lastIndex = tagStart;
		const tag = startTag.exec(markup);
		if (!tag || offset >= tagStart + tag[0].length) {
			return undefined;
		}
		const attribute = (name: string, at = tagStart) => RecordTypes.attributeOfElementAt(text, at + 1, name)?.trim();
		const params = RecordTypes.childElements(text, markup, tagStart, 'xsl:param')
			.filter((param) => !/^(yes|true|1)$/.test(attribute('tunnel', param) ?? ''))
			.map((param) => ({ name: attribute('name', param) ?? '', as: attribute('as', param) }))
			.filter((param) => param.name !== '');
		const name = attribute('name');
		if (elementName === 'xsl:function') {
			return name ? { kind: 'function', name, as: attribute('as'), params } : undefined;
		}
		if (name) {
			return { kind: 'template', name, as: attribute('as'), params };
		}
		const match = attribute('match');
		const mode = attribute('mode')?.split(/\s+/).find((token) => token !== '' && !token.startsWith('#'));
		return match ? { kind: 'rule', name: match, mode, params } : undefined;
	}

	public static title(declaration: XSpecDeclaration) {
		return declaration.kind === 'rule' ? `Create XSpec scenario for template rule match="${declaration.name}"` :
			`Create XSpec scenario for ${declaration.kind} ${declaration.name}`;
	}

	// the scenario, as a snippet with a tab stop for each value to give - with the prefix x for XSpec, and the bindings
	// to declare on it for the names it uses, e.g. for the function's prefix
	public static snippet(declaration: XSpecDeclaration, prefix: string, bindings: Map<string, string>, pending?: string): string {
		const x = (name: string) => `${prefix ? prefix + ':' : ''}${name}`;
		const escape = (value: string) => value.replace(/[$}\\]/g, '\\$&');
		const quote = (value: string) => escape(value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'));
		let stop = 1;
		const xmlns = [...bindings].map(([p, uri]) => ` xmlns:${p}="${quote(uri)}"`).join('');
		const label = declaration.kind === 'rule' ? `template rule ${declaration.name}` : declaration.name;
		const lines = [`<${x('scenario')} label="\${${stop++}:${quote(label)}}"${pending ? ` pending="${quote(pending)}"` : ''}${xmlns}>`];
		const param = (p: { name: string, as?: string }, named: boolean) =>
			`\t\t<${x('param')}${named ? ` name="${quote(p.name)}"` : ''}${p.as ? ` as="${quote(p.as)}"` : ''} select="\${${stop++}:${escape(XSpecScenario.exampleValue(p.as))}}"/>` +
			(named ? '' : `<!-- ${escape(p.name.startsWith('$') ? p.name : '$' + p.name)} -->`);
		if (declaration.kind === 'rule') {
			lines.push(`\t<${x('context')}${declaration.mode ? ` mode="${quote(declaration.mode)}"` : ''}>`);
			declaration.params.forEach((p) => lines.push(param(p, true)));
			lines.push(`\t\t<\${${stop++}:${escape(XSpecScenario.matchedElement(declaration.name))}}/>`, `\t</${x('context')}>`);
		} else {
			const calls = declaration.params.length === 0 ? '/>' : '>';
			lines.push(`\t<${x('call')} ${declaration.kind}="${quote(declaration.name)}"${calls}`);
			if (declaration.params.length > 0) {
				declaration.params.forEach((p) => lines.push(param(p, declaration.kind === 'template')));
				lines.push(`\t</${x('call')}>`);
			}
		}
		const expectLabel = `\${${stop++}:the result}`;
		// a result that's a sequence of atomic values, e.g. from a function, is compared with select - other results,
		// e.g. a template's elements, with the expected content
		const isAtomic = declaration.kind === 'function' || (declaration.as !== undefined && /^xs:/.test(declaration.as));
		lines.push(isAtomic ? `\t<${x('expect')} label="${expectLabel}" select="\${${stop++}:()}"/>` :
			`\t<${x('expect')} label="${expectLabel}">\n\t\t\${${stop++}}\n\t</${x('expect')}>`);
		lines.push(`</${x('scenario')}>`);
		return lines.join('\n');
	}

	// a value for a parameter of the type, to start from
	private static exampleValue(as: string | undefined) {
		if (!as) {
			return '()';
		}
		if (/^xs:(integer|int|long|short|byte|decimal|double|float|nonNegativeInteger|positiveInteger|nonPositiveInteger|negativeInteger|unsigned\w+)\b/.test(as)) {
			return '1';
		}
		if (/^xs:(string|token|normalizedString|NCName|Name|anyURI|untypedAtomic|anyAtomicType)\b/.test(as)) {
			return '\'text\'';
		}
		return /^xs:boolean\b/.test(as) ? 'true()' : '()';
	}

	// the name of an element the pattern matches, for the context - e.g. item for match="list/item[@id]"
	private static matchedElement(match: string) {
		const lastStep = match.split('|')[0].trim().replace(/\[.*$/, '').split('/').pop() ?? '';
		return /^[\w.-]+(:[\w.-]+)?$/.test(lastStep) && !lastStep.includes('::') ? lastStep : 'element';
	}

	// the prefixes a declaration's names use, e.g. f in f:double or xs in xs:integer - with the stylesheet's bindings
	private static bindingsUsed(declaration: XSpecDeclaration, stylesheetBindings: Map<string, string> | undefined): Map<string, string> {
		const texts = [declaration.name, declaration.mode ?? '', ...declaration.params.flatMap((p) => [p.name, p.as ?? ''])];
		if (declaration.kind === 'rule') {
			texts.push(XSpecScenario.matchedElement(declaration.name));
		}
		const used = new Map<string, string>();
		for (const text of texts) {
			for (const match of text.matchAll(/(?<![\w.:{}-])([A-Za-z_][\w.-]*):[A-Za-z_*]/g)) {
				const uri = match[1] === 'xs' ? stylesheetBindings?.get('xs') ?? 'http://www.w3.org/2001/XMLSchema' : stylesheetBindings?.get(match[1]);
				if (uri !== undefined && match[1] !== 'xml') {
					used.set(match[1], uri);
				}
			}
		}
		return used;
	}

	// the XSpec file for the stylesheet: one that tests it, else <name>.xspec beside it - created if it's not there
	private static async xspecFor(stylesheetPath: string): Promise<vscode.Uri> {
		const testing = await XSpecReferences.testFiles(stylesheetPath);
		if (testing.length > 0) {
			return testing[0];
		}
		const beside = vscode.Uri.file(path.join(path.dirname(stylesheetPath), path.basename(stylesheetPath, path.extname(stylesheetPath)) + '.xspec'));
		if (!fs.existsSync(beside.fsPath)) {
			fs.writeFileSync(beside.fsPath, `<?xml version="1.0" encoding="UTF-8"?>\n<x:description xmlns:x="${XSpecTests.namespace}"\n               stylesheet="${path.basename(stylesheetPath)}">\n</x:description>\n`);
		}
		return beside;
	}

	// the top-level functions, named templates and template rules of a stylesheet, in order
	public static declarations(text: string): XSpecDeclaration[] {
		const markup = RecordTypes.blankMarkup(text);
		const declarations: XSpecDeclaration[] = [];
		for (const match of markup.matchAll(RecordTypes.xsltPattern(/<xsl:(function|template)[\s/>]/g, markup))) {
			const declaration = XSpecScenario.declarationAt(text, match.index! + 1);
			if (declaration) {
				declarations.push(declaration);
			}
		}
		return declarations;
	}

	// the declarations of a package that a stylesheet using it can call or apply: its public functions and named
	// templates, and its template rules in public modes - by PackageScope's rules
	private static packageDeclarations(text: string, name: string, version: string, packagePath: string): XSpecDeclaration[] {
		const usePackage: GlobalInstructionData = { type: GlobalInstructionType.UsePackage, name, version, token: { line: 0, startCharacter: 0, length: 0, value: name, tokenType: 0 }, idNumber: 0 };
		const available = PackageScope.components([usePackage], XsltPackages.all(), PackageScope.workspaceFolder())
			.filter((component) => !component.href || XSpecSourceMap.samePath(component.href, packagePath));
		const bindings = XslLexerLight.prefixBindingsOf(text);
		const expanded = (qname: string, componentBindings?: Map<string, string>) => ModulePrefixes.expandedName(qname, componentBindings ?? bindings);
		const has = (types: GlobalInstructionType[], qname: string) => available.some((component) => types.includes(component.type) && expanded(component.name, component.prefixBindings) === expanded(qname));
		return XSpecScenario.declarations(text).filter((declaration) => declaration.kind === 'function' ? has([GlobalInstructionType.Function], declaration.name) :
			declaration.kind === 'template' ? has([GlobalInstructionType.Template], declaration.name) :
				declaration.mode !== undefined && has([GlobalInstructionType.ModeInstruction, GlobalInstructionType.ModeTemplate], declaration.mode));
	}

	// whether an XSpec file already has a scenario for the declaration: an x:call of it, or one with its label
	private static isTested(xspecText: string, declaration: XSpecDeclaration) {
		const quoted = declaration.name.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return declaration.kind === 'rule' ? new RegExp(`label\\s*=\\s*"template rule ${quoted}"`).test(xspecText) :
			new RegExp(`\\s${declaration.kind}\\s*=\\s*["']\\s*${quoted}\\s*["']`).test(xspecText);
	}

	// a snippet's text, with each tab stop's default value
	private static snippetText(snippet: string) {
		return snippet.replace(/\$\{\d+:((?:\\.|[^}\\])*)\}/g, '$1').replace(/\$\{\d+\}|\$\d+/g, '').replace(/\\([$}\\])/g, '$1');
	}

	// the command: an XSpec file for the whole stylesheet or package - a pending scenario for each declaration it doesn't
	// test yet - in the XSpec file that tests it, or a new one beside it. For a package, which XSpec can't import as the
	// stylesheet under test, the XSpec file uses it with x:helper, and tests an empty stylesheet beside it
	public static async createFile(stylesheetUri: vscode.Uri): Promise<vscode.TextEditor | undefined> {
		const stylesheet = await vscode.workspace.openTextDocument(stylesheetUri);
		const text = stylesheet.getText();
		const stylesheetPath = stylesheetUri.fsPath;
		const baseName = path.basename(stylesheetPath, path.extname(stylesheetPath));
		const packageDeclaration = ImportIndex.packageDeclaration(text);
		const declarations = packageDeclaration ? XSpecScenario.packageDeclarations(text, packageDeclaration.name, packageDeclaration.version, stylesheetPath) : XSpecScenario.declarations(text);
		const testing = await XSpecReferences.testFiles(stylesheetPath);
		let xspecUri = testing[0] ?? vscode.Uri.file(path.join(path.dirname(stylesheetPath), baseName + '.xspec'));
		const bindings = XslLexerLight.prefixBindingsOf(text);
		const used = new Map<string, string>();
		declarations.forEach((declaration) => XSpecScenario.bindingsUsed(declaration, bindings).forEach((uri, p) => used.set(p, uri)));
		if (!fs.existsSync(xspecUri.fsPath)) {
			let tested = path.basename(stylesheetPath);
			let helper = '';
			if (packageDeclaration) {
				tested = `${baseName}-xspec-harness.xsl`;
				const harness = path.join(path.dirname(stylesheetPath), tested);
				if (!fs.existsSync(harness)) {
					fs.writeFileSync(harness, `<?xml version="1.0" encoding="UTF-8"?>\n<!-- the stylesheet tested by ${baseName}.xspec: XSpec imports the stylesheet it tests, which a package can't be, so the\n     package is used with x:helper there -->\n<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>\n`);
				}
				const version = packageDeclaration.version ? ` package-version="${packageDeclaration.version}"` : '';
				helper = `\n   <x:helper package-name="${packageDeclaration.name}"${version}/>`;
			}
			const xmlns = [...used].map(([p, uri]) => `\n               xmlns:${p}="${uri}"`).join('');
			fs.writeFileSync(xspecUri.fsPath, `<?xml version="1.0" encoding="UTF-8"?>\n<x:description xmlns:x="${XSpecTests.namespace}"${xmlns}\n               stylesheet="${tested}">${helper}\n</x:description>\n`);
			xspecUri = vscode.Uri.file(xspecUri.fsPath);
		}
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(xspecUri));
		const xspecText = editor.document.getText();
		const untested = declarations.filter((declaration) => !XSpecScenario.isTested(xspecText, declaration));
		if (untested.length === 0) {
			vscode.window.showInformationMessage(`XSpec: ${path.basename(xspecUri.fsPath)} has a scenario for each ${packageDeclaration ? 'public function and template of the package' : 'function and template of the stylesheet'} already.`);
			return editor;
		}
		const root = parseXml(xspecText);
		const prefix = root?.name.includes(':') ? root.name.substring(0, root.name.indexOf(':')) : '';
		const declared = new Map([...(root?.attributes ?? new Map<string, string>())].filter(([name]) => name.startsWith('xmlns:')).map(([name, uri]) => [name.substring(6), uri]));
		const added = [...used].filter(([p]) => !declared.has(p));
		const onScenario = new Map([...used].filter(([p, uri]) => declared.has(p) && declared.get(p) !== uri));
		const step = ' '.repeat(Number(vscode.workspace.getConfiguration('editor', { languageId: 'xspec' }).get('tabSize')) || 3);
		const scenarios = untested.map((declaration) => XSpecScenario.snippetText(XSpecScenario.snippet(declaration, prefix, onScenario, 'to do'))
			.split('\n').map((line) => step + line.replace(/\t/g, step)).join('\n')).join('\n');
		const note = `${step}<!-- a pending scenario for each ${packageDeclaration ? 'public function and template of the package' : 'function and template of the stylesheet'}: give it its parameters'\n${step}     values and expected result, then remove its pending attribute -->`;
		const closing = xspecText.lastIndexOf(`</${prefix ? prefix + ':' : ''}description`);
		await editor.edit((edit) => {
			if (root && added.length > 0) {
				const tagEnd = xspecText.lastIndexOf('>', root.contentStart - 1);
				edit.insert(editor.document.positionAt(xspecText.charAt(tagEnd - 1) === '/' ? tagEnd - 1 : tagEnd), added.map(([p, uri]) => ` xmlns:${p}="${uri}"`).join(''));
			}
			const at = editor.document.positionAt(closing > -1 ? closing : xspecText.length);
			const lineStart = new vscode.Position(at.line, 0);
			const onOwnLine = /^\s*$/.test(editor.document.getText(new vscode.Range(lineStart, at)));
			edit.insert(onOwnLine ? lineStart : at, (onOwnLine ? '' : '\n') + note + '\n' + scenarios + '\n');
		});
		return editor;
	}

	// the command: the scenario for the declaration at the offset of the stylesheet, inserted at the end of the XSpec file
	public static async create(stylesheetUri: vscode.Uri, offset: number): Promise<vscode.TextEditor | undefined> {
		const stylesheet = await vscode.workspace.openTextDocument(stylesheetUri);
		const declaration = XSpecScenario.declarationAt(stylesheet.getText(), offset);
		if (!declaration) {
			return undefined;
		}
		const xspecUri = await XSpecScenario.xspecFor(stylesheetUri.fsPath);
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(xspecUri));
		const text = editor.document.getText();
		const root = parseXml(text);
		const prefix = root?.name.includes(':') ? root.name.substring(0, root.name.indexOf(':')) : '';
		// the bindings the scenario declares: those the XSpec file's outermost element doesn't have already
		const used = XSpecScenario.bindingsUsed(declaration, XslLexerLight.prefixBindingsOf(stylesheet.getText()));
		const declared = new Map([...(root?.attributes ?? new Map<string, string>())].filter(([name]) => name.startsWith('xmlns:')).map(([name, uri]) => [name.substring(6), uri]));
		// those it doesn't declare are added to it, as XSpec files usually have them - a prefix it has for another
		// namespace is declared on the scenario
		const added = [...used].filter(([p]) => !declared.has(p));
		const onScenario = new Map([...used].filter(([p, uri]) => declared.has(p) && declared.get(p) !== uri));
		if (root && added.length > 0) {
			const tagEnd = text.lastIndexOf('>', root.contentStart - 1);
			const insertAt = text.charAt(tagEnd - 1) === '/' ? tagEnd - 1 : tagEnd;
			await editor.edit((edit) => edit.insert(editor.document.positionAt(insertAt), added.map(([p, uri]) => ` xmlns:${p}="${uri.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')),
				{ undoStopBefore: true, undoStopAfter: false });
		}
		const updated = editor.document.getText();
		const closing = updated.lastIndexOf(`</${prefix ? prefix + ':' : ''}description`);
		const at = closing > -1 ? editor.document.positionAt(closing) : editor.document.positionAt(updated.length);
		// on a line of its own, indented one step within x:description
		const lineStart = new vscode.Position(at.line, 0);
		const before = editor.document.getText(new vscode.Range(lineStart, at));
		const indent = /^\s*$/.test(before) ? before : '';
		const step = editor.options.insertSpaces === false ? '\t' : ' '.repeat(Number(editor.options.tabSize) || 3);
		const body = XSpecScenario.snippet(declaration, prefix, onScenario).split('\n').map((line) => indent + step + line.replace(/\t/g, step)).join('\n');
		const insertAt = /^\s*$/.test(before) ? lineStart : at;
		await editor.insertSnippet(new vscode.SnippetString((/^\s*$/.test(before) ? '' : '\n') + body + '\n' + (/^\s*$/.test(before) ? '' : indent)), insertAt, { undoStopBefore: true, undoStopAfter: true, keepWhitespace: true });
		return editor;
	}
}
