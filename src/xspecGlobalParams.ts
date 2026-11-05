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
import { GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { RecordTypes } from './recordTypes';
import { XdocNotes } from './xdocNote';

// An XSpec file's global parameters - the x:param elements of x:description, and with run-as="external", of an
// x:scenario, for its tests - and the global xsl:param elements of the stylesheet under test they set: completion of
// those not set yet, the one an x:param's name is of, for its hover and definition, and those with required="yes" that
// aren't set, which fail every test with XTDE0050
export class XSpecGlobalParams {

	// the global xsl:param elements of the stylesheet under test and the modules it uses - not an XSpec file's x:param
	public static stylesheetParams(globals: GlobalInstructionData[]): GlobalInstructionData[] {
		const seen = new Set<string>();
		return globals.filter((g) => g.type === GlobalInstructionType.Parameter && !!g.href && !/\.xspec$/i.test(g.href) && !seen.has(g.name) && !!seen.add(g.name));
	}

	// the start tag offset of a global xsl:param, in the text of the module declaring it
	public static declaration(param: GlobalInstructionData): { text: string, tagStart: number } | undefined {
		let text: string;
		try {
			const open = vscode.workspace.textDocuments.find((d) => d.fileName === param.href);
			text = open ? open.getText() : fs.readFileSync(param.href!, 'utf8');
		} catch {
			return undefined;
		}
		const tagStart = text.lastIndexOf('<', XdocNotes.offsetAt(text, param.token.line, param.token.startCharacter));
		return tagStart > -1 ? { text, tagStart } : undefined;
	}

	public static isRequired(param: GlobalInstructionData) {
		const declaration = XSpecGlobalParams.declaration(param);
		const required = declaration ? RecordTypes.attributeOfElementAt(declaration.text, declaration.tagStart + 1, 'required')?.trim() : undefined;
		return required === 'yes' || required === 'true' || required === '1';
	}

	// the names set by the x:param children of the element - x:description, or an x:scenario
	private static setNames(text: string, markup: string, prefix: string, elementOffset?: number): string[] {
		const offset = elementOffset ?? /<([\w.-]+:)?description\b/.exec(markup)?.index;
		if (offset === undefined) {
			return [];
		}
		return RecordTypes.childElements(text, markup, offset, `${prefix ? prefix + ':' : ''}param`)
			.map((child) => RecordTypes.attributeOfElementAt(text, child + 1, 'name')?.trim() ?? '');
	}

	// with run-as="external", which runs the stylesheet tested separately - so a scenario's x:param sets its parameters
	private static isExternal(text: string) {
		return /<(?:[\w.-]+:)?description\b[^>]*\srun-as\s*=\s*(["'])\s*external\s*\1/.test(text);
	}

	// x:description - or with run-as="external", an x:scenario - whose x:param children set global parameters
	private static setsGlobals(text: string, element: { name: string } | undefined, prefix: string) {
		const x = prefix ? prefix + ':' : '';
		return element?.name === `${x}description` || (element?.name === `${x}scenario` && XSpecGlobalParams.isExternal(text));
	}

	// after '<' in x:description: an x:param for each global parameter of the stylesheet under test not set yet - those
	// required first
	public static completions(document: vscode.TextDocument, position: vscode.Position, prefix: string, globals: GlobalInstructionData[]): vscode.CompletionItem[] | undefined {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const nameStart = /<([\w.:-]*)$/.exec(text.substring(Math.max(0, offset - 100), offset));
		if (!nameStart) {
			return undefined;
		}
		const tagStart = offset - nameStart[0].length;
		const markup = RecordTypes.blankMarkup(text);
		const parent = RecordTypes.openElements(markup, tagStart).pop();
		if (!XSpecGlobalParams.setsGlobals(text, parent, prefix)) {
			return undefined;
		}
		const set = XSpecGlobalParams.setNames(text, markup, prefix, parent!.offset);
		const range = new vscode.Range(document.positionAt(tagStart + 1), position);
		const x = prefix ? prefix + ':' : '';
		return XSpecGlobalParams.stylesheetParams(globals).filter((param) => !set.includes(param.name)).map((param) => {
			const required = XSpecGlobalParams.isRequired(param);
			const as = param.declaredType ? ` as="${param.declaredType}"` : '';
			const item = new vscode.CompletionItem(`${x}param ${param.name}`, vscode.CompletionItemKind.Variable);
			item.insertText = new vscode.SnippetString(`${x}param name="${param.name}"${as} select="$1"/>$0`);
			item.range = range;
			item.detail = `${param.declaredType ?? 'item()*'}${required ? ' (required)' : ''}`;
			item.sortText = `${required ? '0' : '1'}${param.name}`;
			const declaration = XSpecGlobalParams.declaration(param);
			const note = declaration ? XdocNotes.forGlobal(param, declaration.text) : undefined;
			item.documentation = new vscode.MarkdownString(`${required ? 'Required global' : 'Global'} parameter of the stylesheet under test${parent!.name.endsWith('scenario') ? ', for the scenario\'s tests' : ''}` + (note ? `\n\n${XdocNotes.toMarkdown(note)}` : ''));
			return item;
		});
	}

	// the global xsl:param of the stylesheet under test whose name is at the offset, in the name of an x:param of
	// x:description
	public static paramAt(text: string, offset: number, prefix: string, globals: GlobalInstructionData[]): GlobalInstructionData | undefined {
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
		return XSpecGlobalParams.setsGlobals(text, parent, prefix) ? XSpecGlobalParams.stylesheetParams(globals).find((param) => param.name === name.trim()) : undefined;
	}

	// a warning on x:description for each required global parameter of the stylesheet under test that isn't set
	public static problems(document: vscode.TextDocument, prefix: string, globals: GlobalInstructionData[]): vscode.Diagnostic[] {
		const text = document.getText();
		const markup = RecordTypes.blankMarkup(text);
		const root = /<(?:[\w.-]+:)?description\b/.exec(markup);
		if (!root) {
			return [];
		}
		// those x:description sets - and with run-as="external", any scenario
		const x = prefix ? prefix + ':' : '';
		const scenarios = XSpecGlobalParams.isExternal(text) ? [...markup.matchAll(new RegExp(`<${x.replace(/[.-]/g, '\\$&')}scenario[\\s>]`, 'g'))].map((m) => m.index!) : [];
		const set = XSpecGlobalParams.setNames(text, markup, prefix).concat(scenarios.flatMap((offset) => XSpecGlobalParams.setNames(text, markup, prefix, offset)));
		const range = new vscode.Range(document.positionAt(root.index + 1), document.positionAt(root.index + root[0].length));
		return XSpecGlobalParams.stylesheetParams(globals).filter((param) => !set.includes(param.name) && XSpecGlobalParams.isRequired(param)).map((param) =>
			new vscode.Diagnostic(range, `XSpec: the stylesheet's required parameter $${param.name} isn't set - add an x:param for it to x:description, or each test fails with XTDE0050`, vscode.DiagnosticSeverity.Warning));
	}
}
