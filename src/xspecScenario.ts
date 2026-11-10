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
import { HrefPaths } from './hrefPaths';
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
export type XSpecPackageForm = 'external' | 'helper';

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
	private static readonly xsNamespace = 'http://www.w3.org/2001/XMLSchema';
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
			// with xs, as test values are often typed
			fs.writeFileSync(beside.fsPath, `<?xml version="1.0" encoding="UTF-8"?>\n<x:description xmlns:x="${XSpecTests.namespace}"\n               xmlns:xs="${XSpecScenario.xsNamespace}"\n               stylesheet="${path.basename(stylesheetPath)}">\n</x:description>\n`);
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

	// the declarations a test file has scenarios for: of a stylesheet, or those a package's users can call or apply
	public static declarationsOf(text: string, modulePath: string): XSpecDeclaration[] {
		const packageDeclaration = ImportIndex.packageDeclaration(text);
		return packageDeclaration ? XSpecScenario.packageDeclarations(text, packageDeclaration.name, packageDeclaration.version, modulePath) : XSpecScenario.declarations(text);
	}

	// the module an XSpec file tests: the package of its x:helper, if it has one - else its stylesheet
	public static testedModule(xspecText: string, xspecPath: string): string | undefined {
		const helper = /<(?:[\w.-]+:)?helper\b[^>]*>/.exec(xspecText)?.[0];
		const packageName = helper ? /\spackage-name\s*=\s*(["'])(.*?)\1/.exec(helper)?.[2] : undefined;
		if (packageName) {
			const version = /\spackage-version\s*=\s*(["'])(.*?)\1/.exec(helper!)?.[2];
			const found = XsltPackages.find(XsltPackages.all(), packageName, version);
			const packagePath = found ? HrefPaths.settingsPath(found.path, PackageScope.workspaceFolder() ?? path.dirname(xspecPath)) : undefined;
			if (packagePath) {
				return packagePath;
			}
		}
		const root = /<(?:[\w.-]+:)?description\b[^>]*>/.exec(xspecText)?.[0];
		const href = root ? /\sstylesheet\s*=\s*(["'])(.*?)\1/.exec(root)?.[2] : undefined;
		return href !== undefined ? HrefPaths.toPath(href, xspecPath) : undefined;
	}

	// the declarations of the module an XSpec file tests that it has no scenario for
	public static untested(xspecText: string, xspecPath: string): { modulePath: string, moduleText: string, declarations: XSpecDeclaration[] } | undefined {
		const modulePath = XSpecScenario.testedModule(xspecText, xspecPath);
		if (!modulePath || !fs.existsSync(modulePath)) {
			return undefined;
		}
		const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === 'file' && XSpecSourceMap.samePath(document.uri.fsPath, modulePath));
		const moduleText = open ? open.getText() : fs.readFileSync(modulePath, 'utf8');
		return { modulePath, moduleText, declarations: XSpecScenario.declarationsOf(moduleText, modulePath).filter((declaration) => !XSpecScenario.isTested(xspecText, declaration)) };
	}

	// in an XSpec file, after '<' where a scenario may be - in x:description or x:scenario - a completion for each
	// declaration of the module tested that has no scenario yet: the scenario's snippet, with the prefix x (see
	// XsltDefinitionProvider), and the namespaces it uses added to x:description
	public static scenarioCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const nameStart = /<([\w.:-]*)$/.exec(text.substring(Math.max(0, offset - 100), offset));
		const root = nameStart ? parseXml(text) : undefined;
		if (!nameStart || !root || document.uri.scheme !== 'file') {
			return undefined;
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		const tagStart = offset - nameStart[0].length;
		const parent = RecordTypes.openElements(RecordTypes.blankMarkup(text), tagStart).pop();
		if (parent?.name !== prefix + 'description' && parent?.name !== prefix + 'scenario') {
			return undefined;
		}
		const untested = XSpecScenario.untested(text, document.fileName);
		if (!untested || untested.declarations.length === 0) {
			return [];
		}
		const declared = new Map([...root.attributes].filter(([name]) => name.startsWith('xmlns:')).map(([name, uri]) => [name.substring(6), uri]));
		const moduleBindings = XslLexerLight.prefixBindingsOf(untested.moduleText);
		const rootTagEnd = text.lastIndexOf('>', root.contentStart - 1);
		const bindingsAt = document.positionAt(text.charAt(rootTagEnd - 1) === '/' ? rootTagEnd - 1 : rootTagEnd);
		const range = new vscode.Range(document.positionAt(tagStart + 1), position);
		return untested.declarations.map((declaration, index) => {
			const used = XSpecScenario.bindingsUsed(declaration, moduleBindings);
			const onScenario = new Map([...used].filter(([p, uri]) => declared.has(p) && declared.get(p) !== uri));
			const added = [...used].filter(([p]) => !declared.has(p));
			const item = new vscode.CompletionItem(`x:scenario for ${declaration.kind === 'rule' ? `template rule ${declaration.name}` : declaration.name}`, vscode.CompletionItemKind.Snippet);
			item.insertText = new vscode.SnippetString(XSpecScenario.snippet(declaration, 'x', onScenario).substring(1));
			item.range = range;
			item.detail = `no scenario yet - the ${declaration.kind === 'rule' ? 'template rule' : declaration.kind} in ${path.basename(untested.modulePath)}`;
			if (added.length > 0) {
				item.additionalTextEdits = [vscode.TextEdit.insert(bindingsAt, added.map(([p, uri]) => ` xmlns:${p}="${uri}"`).join(''))];
			}
			// before other element completions, in declaration order
			item.sortText = '!' + String(index).padStart(4, '0');
			return item;
		});
	}

	// in the start tag of x:description: the action adding a pending scenario for each declaration not tested yet
	public static codeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
		const text = document.getText();
		const root = document.uri.scheme === 'file' ? parseXml(text) : undefined;
		const offset = document.offsetAt(range.start);
		if (!root || offset <= root.start || offset >= root.contentStart) {
			return [];
		}
		const untested = XSpecScenario.untested(text, document.fileName);
		if (!untested || untested.declarations.length === 0) {
			return [];
		}
		const count = untested.declarations.length;
		const action = new vscode.CodeAction(`Add pending scenarios for ${count} ${count === 1 ? 'function or template' : 'functions and templates'} with no scenario yet`, vscode.CodeActionKind.Refactor);
		action.command = { command: XSpecScenario.fileCommand, title: action.title, arguments: [vscode.Uri.file(untested.modulePath), document.uri] };
		return [action];
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

	// the two ways XSpec tests a package - as it can't import one into the test runner: run as a separate transformation,
	// with run-as="external", and only its public components called with x:call - or used by the test runner, with
	// x:helper's package-name, as by a stylesheet using it, so its public functions can be called in XPath expressions
	// too, with a stylesheet that does nothing as the stylesheet XSpec requires
	public static readonly packageForms: { form: XSpecPackageForm, label: string, detail: string }[] = [
		{ form: 'external', label: 'Run the package as a separate transformation (run-as="external")', detail: 'Only its public functions and templates can be called, with x:call' },
		{ form: 'helper', label: 'Use the package in the test runner (x:helper package-name)', detail: 'As a stylesheet using it does - its public functions can be called in XPath expressions too' }
	];

	// the command: an XSpec file for the whole stylesheet or package - a pending scenario for each declaration it doesn't
	// test yet - in the XSpec file that tests it, or a new one beside it. For a package, in the form chosen, or asked
	public static async createFile(stylesheetUri: vscode.Uri, target?: vscode.Uri, packageForm?: XSpecPackageForm): Promise<vscode.TextEditor | undefined> {
		const stylesheet = await vscode.workspace.openTextDocument(stylesheetUri);
		const text = stylesheet.getText();
		const stylesheetPath = stylesheetUri.fsPath;
		const baseName = path.basename(stylesheetPath, path.extname(stylesheetPath));
		const packageDeclaration = ImportIndex.packageDeclaration(text);
		const declarations = XSpecScenario.declarationsOf(text, stylesheetPath);
		const testing = target ? [target] : await XSpecReferences.testFiles(stylesheetPath);
		let xspecUri = testing[0] ?? vscode.Uri.file(path.join(path.dirname(stylesheetPath), baseName + '.xspec'));
		const bindings = XslLexerLight.prefixBindingsOf(text);
		const used = new Map<string, string>();
		declarations.forEach((declaration) => XSpecScenario.bindingsUsed(declaration, bindings).forEach((uri, p) => used.set(p, uri)));
		if (!fs.existsSync(xspecUri.fsPath)) {
			if (packageDeclaration && !packageForm) {
				const picked = await vscode.window.showQuickPick(XSpecScenario.packageForms.map((f) => ({ label: f.label, detail: f.detail, form: f.form })), { placeHolder: 'How the XSpec file tests the package' });
				if (!picked) {
					return undefined;
				}
				packageForm = picked.form;
			}
			// with xs, as test values are often typed - first, unless the declarations use it already
			const withXs = used.has('xs') ? used : new Map([['xs', XSpecScenario.xsNamespace], ...used]);
			const xmlns = [...withXs].map(([p, uri]) => `\n               xmlns:${p}="${uri}"`).join('');
			const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
			let content: string;
			if (packageDeclaration && packageForm === 'helper') {
				// the stylesheet XSpec requires, which does nothing - the package is used as x:helper's
				const harness = path.join(path.dirname(stylesheetPath), `${baseName}-xspec-harness.xsl`);
				if (!fs.existsSync(harness)) {
					fs.writeFileSync(harness, `<?xml version="1.0" encoding="UTF-8"?>\n<!-- the stylesheet ${path.basename(xspecUri.fsPath)} names, as XSpec requires one: the package it tests is used by its x:helper -->\n<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>\n`);
				}
				content = `<x:description xmlns:x="${XSpecTests.namespace}"${xmlns}\n               stylesheet="${path.basename(harness)}">\n` +
					`   <x:helper package-name="${attribute(packageDeclaration.name)}" package-version="${attribute(packageDeclaration.version)}"/>\n</x:description>\n`;
			} else {
				// a package run externally, with fn:transform() - only its public components can be called
				const runAs = packageDeclaration ? '\n               run-as="external"' : '';
				content = `<x:description xmlns:x="${XSpecTests.namespace}"${xmlns}${runAs}\n               stylesheet="${path.basename(stylesheetPath)}">\n</x:description>\n`;
			}
			fs.writeFileSync(xspecUri.fsPath, `<?xml version="1.0" encoding="UTF-8"?>\n${content}`);
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

	// what an x:call calls - at the offset of its '<' - its own function or template, or else, as XSpec inherits it, that of
	// the x:call of the nearest enclosing scenario with one: from - the label of that scenario, when it's inherited - and
	// the offsets of the x:param elements passed, in it and those it inherits, as XSpec merges them
	public static callTarget(text: string, callOffset: number, prefix: string): { kind: 'function' | 'template', name: string, from?: string, params: number[] } | undefined {
		const x = prefix ? prefix + ':' : '';
		const markup = RecordTypes.blankMarkup(text);
		const params: number[] = [];
		const calls = [callOffset].concat(RecordTypes.openElements(markup, callOffset).reverse()
			.filter((ancestor) => ancestor.name === `${x}scenario`)
			.map((scenario) => RecordTypes.childElements(text, markup, scenario.offset, `${x}call`).find((call) => call !== callOffset))
			.filter((call): call is number => call !== undefined));
		for (const call of calls) {
			params.push(...RecordTypes.childElements(text, markup, call, `${x}param`));
			const fn = RecordTypes.attributeOfElementAt(text, call + 1, 'function')?.trim();
			const template = RecordTypes.attributeOfElementAt(text, call + 1, 'template')?.trim();
			if (fn || template) {
				const scenario = call === callOffset ? undefined : RecordTypes.openElements(markup, call).reverse().find((ancestor) => ancestor.name === `${x}scenario`);
				const from = scenario ? RecordTypes.attributeOfElementAt(text, scenario.offset + 1, 'label') ?? '' : undefined;
				return { kind: fn ? 'function' : 'template', name: (fn || template)!, from, params };
			}
		}
		return undefined;
	}

	// the name of an x:param, at the offset, of an x:call of a template it inherits from an enclosing scenario's x:call
	public static inheritedParamAt(text: string, offset: number, prefix: string): { template: string, param: string } | undefined {
		const param = XSpecScenario.templateParamAt(text, offset, prefix);
		return param?.inherited ? { template: param.template, param: param.param } : undefined;
	}

	// the name of an x:param, at the offset, of an x:call of a template - its own, or one it inherits from an enclosing
	// scenario's x:call - with the offset of the name
	public static templateParamAt(text: string, offset: number, prefix: string): { template: string, param: string, inherited: boolean, nameStart: number } | undefined {
		const x = prefix ? prefix + ':' : '';
		const tagStart = text.lastIndexOf('<', offset);
		if (tagStart < 0 || !text.startsWith(`<${x}param`, tagStart) || !/[\s/>]/.test(text.charAt(tagStart + x.length + 6))) {
			return undefined;
		}
		const nameStart = RecordTypes.attributeValueOffset(text, tagStart + 1, 'name');
		const name = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'name');
		if (nameStart === undefined || !name || offset < nameStart || offset > nameStart + name.length) {
			return undefined;
		}
		const parent = RecordTypes.openElements(RecordTypes.blankMarkup(text.substring(0, tagStart)), tagStart).pop();
		const target = parent?.name === `${x}call` ? XSpecScenario.callTarget(text, parent.offset, prefix) : undefined;
		return target?.kind === 'template' ? { template: target.name, param: name.trim(), inherited: target.from !== undefined, nameStart: nameStart + name.indexOf(name.trim()) } : undefined;
	}

	// in an XSpec file with no outermost element yet, after '<': x:description, with the XSpec and XML Schema namespaces,
	// for a stylesheet - and a package, run as XSpec runs it, externally - or a Schematron: those beside it or, for one in
	// an xspec folder, in the folder above, the one with the XSpec file's name first - for each stylesheet, with a pending
	// scenario for each of its functions and templates
	public static rootCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const before = /^(?:\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*<([\w.:-]*)$/.exec(text.substring(0, offset));
		if (!before || text.substring(offset).trim() !== '') {
			return undefined;
		}
		const range = new vscode.Range(document.positionAt(offset - before[1].length), position);
		const xspecPath = document.uri.scheme === 'file' ? document.fileName : undefined;
		// the stylesheets - or Schematrons - beside the XSpec file and, for one in an xspec folder, in the folder above: the
		// one with its name first, then the others by name - not those a test run makes, or a package test's harness
		const candidates = (extensions: string[]) => {
			if (!xspecPath) {
				return [];
			}
			const name = path.basename(xspecPath, path.extname(xspecPath));
			const folders = [path.dirname(xspecPath)].concat(path.basename(path.dirname(xspecPath)) === 'xspec' ? [path.dirname(path.dirname(xspecPath))] : []);
			const found: { path: string, href: string, isNamed: boolean }[] = [];
			for (const folder of folders) {
				let files: string[] = [];
				try {
					files = fs.readdirSync(folder);
				} catch {
					continue;
				}
				for (const file of files.filter((f) => extensions.includes(path.extname(f)) && !/-(compiled|sch-preprocessed|xspec-harness)\.xslt?$/.test(f)).sort()) {
					const filePath = path.join(folder, file);
					found.push({ path: filePath, href: path.relative(path.dirname(xspecPath), filePath).split(path.sep).join('/'), isNamed: path.basename(file, path.extname(file)) === name });
				}
			}
			return found.filter((f) => f.isNamed).concat(found.filter((f) => !f.isNamed)).slice(0, 10);
		};
		const quote = (value: string) => value.replace(/[$}\\]/g, '\\$&').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
		const indent = ' '.repeat('<x:description '.length);
		// value: the attribute's snippet text, e.g. a tab stop with a default, or a choice
		const item = (label: string, attribute: string, value: string, extra: string, documentation: string, sortText: string) => {
			const completion = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
			completion.insertText = new vscode.SnippetString(`x:description xmlns:x="${XSpecTests.namespace}"\n${indent}xmlns:xs="http://www.w3.org/2001/XMLSchema"${extra}\n` +
				`${indent}${attribute}="${value}">\n\t$0\n</x:description>`);
			completion.range = range;
			completion.documentation = new vscode.MarkdownString(documentation);
			completion.sortText = sortText;
			return completion;
		};
		// a tab stop with the default, or a choice of the candidates
		const valueOf = (found: { href: string }[], placeholder: string) => found.length > 1 ?
			`\${1|${found.map((f) => quote(f.href).replace(/[,|]/g, '\\$&')).join(',')}|}` : `\${1:${quote(found[0]?.href ?? placeholder)}}`;
		const stylesheets = candidates(['.xsl', '.xslt']).map((f) => ({ ...f, isPackage: !!ImportIndex.packageDeclaration(fs.readFileSync(f.path, 'utf8')) }));
		const schematrons = candidates(['.sch']);
		const runAs = `\n${indent}run-as="external"`;
		const hint = '\n\nThen, in its start tag, the code action (⌘. or Ctrl+.) adds a pending scenario for each function and template of the stylesheet.';
		const single = stylesheets.length === 1 ? stylesheets[0] : undefined;
		const items = [
			item('x:description for a stylesheet', 'stylesheet', valueOf(stylesheets, 'stylesheet.xsl'), single?.isPackage ? runAs : '',
				`XSpec tests of a stylesheet${single?.isPackage ? ' - a package, run as XSpec runs it, externally' : ''}${single ? `: \`${single.href}\`` : stylesheets.length > 1 ? ' - one of those nearby' : ''}${hint}`, '1'),
			item('x:description for a Schematron', 'schematron', valueOf(schematrons, 'schema.sch'), '', `XSpec tests of a Schematron${schematrons.length === 1 ? `: \`${schematrons[0].href}\`` : ''}`, '2')
		];
		// first, for each stylesheet found: with its scenarios too - pending, to complete - as the code action adds them;
		// the one with the XSpec file's name preselected
		if (xspecPath) {
			stylesheets.forEach((stylesheet, index) => {
				const withScenarios = item(`x:description with pending scenarios for ${stylesheet.href}`, 'stylesheet', quote(stylesheet.href), stylesheet.isPackage ? runAs : '',
					`XSpec tests of \`${stylesheet.href}\`${stylesheet.isPackage ? ', a package, run as XSpec runs it, externally' : ''}: a pending scenario for each ${stylesheet.isPackage ? 'public ' : ''}function and template, to complete - give each its values and expected result, then remove its pending attribute`, `0${String(index).padStart(2, '0')}`);
				withScenarios.preselect = index === 0 && stylesheet.isNamed;
				withScenarios.command = { command: XSpecScenario.fileCommand, title: withScenarios.label as string, arguments: [vscode.Uri.file(stylesheet.path), document.uri, stylesheet.isPackage ? 'external' : undefined] };
				items.splice(index, 0, withScenarios);
			});
		}
		return items;
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
