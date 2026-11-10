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
import { XslLexer } from './xslLexer';
import { TokenLevelState } from './xpLexer';
import { XSpecConfiguration } from './languageConfigurations';
import { ModulePrefixes } from './modulePrefixes';
import { HrefPaths } from './hrefPaths';
import { XSpecSourceMap } from './xspecSourceMap';
import { XSpecPackages } from './xspecPackages';
import { XmlElement, parseXml, descendants } from './xspecXml';

// The uses of a stylesheet's function, named template or mode in the XSpec files that test it - for Find All References and
// Rename (see XSLTReferenceProvider): x:call's function or template, x:context's mode, and function calls in XPath expressions, e.g. a
// test="f:double(2) = 4". Names are compared with their namespaces, as an XSpec file may use another prefix
export class XSpecReferences {

	// the locations of the names, in the XSpec files whose stylesheet - or helper - is one of the modules, e.g. the module
	// declaring it, or a stylesheet that imports it
	public static async find(kind: 'function' | 'template' | 'mode', expandedName: string, modules: string[]): Promise<vscode.Location[]> {
		return XSpecReferences.inTestFiles(modules, (text, uri) => XSpecReferences.inXSpec(text, uri, kind, expandedName));
	}

	// the names of the x:param elements that pass a named template's parameter, in the XSpec files whose stylesheet - or
	// helper - is one of the modules: x:call template="…" - or, in an inner scenario, an x:call without a template
	// attribute, which calls the template of an outer scenario's x:call, as XSpec merges them
	public static async findTemplateParams(templateName: string, paramName: string, modules: string[]): Promise<vscode.Location[]> {
		return XSpecReferences.inTestFiles(modules, (text, uri) => XSpecReferences.templateParamsInXSpec(text, uri, templateName, paramName));
	}

	// the locations found in each XSpec file - in the workspace, or open in an editor - that tests one of the modules
	private static async inTestFiles(modules: string[], inFile: (text: string, uri: vscode.Uri) => vscode.Location[]): Promise<vscode.Location[]> {
		const locations: vscode.Location[] = [];
		const uris = await vscode.workspace.findFiles('**/*.xspec', '**/node_modules/**');
		vscode.workspace.textDocuments.filter((document) => document.languageId === 'xspec' && document.uri.scheme === 'file' && !uris.some((uri) => uri.toString() === document.uri.toString()))
			.forEach((document) => uris.push(document.uri));
		for (const uri of uris) {
			try {
				const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
				const text = open ? open.getText() : fs.readFileSync(uri.fsPath, 'utf8');
				if (XSpecReferences.testsAny(text, uri.fsPath, modules)) {
					locations.push(...inFile(text, uri));
				}
			} catch {
				// a file that can't be read
			}
		}
		return locations;
	}

	private static templateParamsInXSpec(text: string, uri: vscode.Uri, templateName: string, paramName: string): vscode.Location[] {
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		const lexer = new XslLexer(XSpecConfiguration.configuration);
		lexer.analyse(text);
		const bindings = lexer.prefixBindings;
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		const isXSpec = (element: XmlElement, name: string) => element.name === prefix + name;
		// the template an x:call calls: its own, or that of the nearest outer scenario's x:call with one
		const calledTemplate = (call: XmlElement): string | undefined => {
			const own = call.attributes.get('template');
			if (own !== undefined) {
				return own.trim();
			}
			for (let scenario = call.parent?.parent; scenario; scenario = scenario.parent) {
				const outer = scenario.children.find((child) => isXSpec(child, 'call'));
				if (outer?.attributes.has('function')) {
					return undefined;
				}
				if (outer?.attributes.has('template')) {
					return outer.attributes.get('template')!.trim();
				}
			}
			return undefined;
		};
		const toPosition = (offset: number) => {
			const before = text.substring(0, offset);
			const line = before.split('\n').length - 1;
			return new vscode.Position(line, offset - (before.lastIndexOf('\n') + 1));
		};
		const locations: vscode.Location[] = [];
		for (const call of descendants(root).filter((element) => isXSpec(element, 'call') && !element.attributes.has('function'))) {
			const template = calledTemplate(call);
			if (template === undefined || ModulePrefixes.expandedName(template, bindings) !== templateName) {
				continue;
			}
			for (const param of call.children.filter((child) => isXSpec(child, 'param'))) {
				const name = param.attributes.get('name');
				if (name === undefined || ModulePrefixes.expandedName(name.trim(), bindings) !== paramName) {
					continue;
				}
				// the name's offset, in the param's start tag
				const attribute = /\sname\s*=\s*(["'])(\s*)/.exec(text.substring(param.start, param.contentStart));
				if (attribute) {
					const start = param.start + attribute.index + attribute[0].length;
					locations.push(new vscode.Location(uri, new vscode.Range(toPosition(start), toPosition(start + name.trim().length))));
				}
			}
		}
		return locations;
	}

	// the XSpec files - in the workspace, or open in an editor - whose x:description is for the stylesheet
	public static async testFiles(stylesheetPath: string): Promise<vscode.Uri[]> {
		const uris = await vscode.workspace.findFiles('**/*.xspec', '**/node_modules/**');
		vscode.workspace.textDocuments.filter((document) => document.languageId === 'xspec' && document.uri.scheme === 'file' && !uris.some((uri) => uri.toString() === document.uri.toString()))
			.forEach((document) => uris.push(document.uri));
		return uris.filter((uri) => {
			try {
				const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
				const text = open ? open.getText() : fs.readFileSync(uri.fsPath, 'utf8');
				const href = /<(?:[\w.-]+:)?description\b[^>]*?\sstylesheet\s*=\s*(["'])(.*?)\1/.exec(text)?.[2];
				const stylesheet = href !== undefined ? HrefPaths.toPath(href, uri.fsPath) : undefined;
				return stylesheet !== undefined && XSpecSourceMap.samePath(stylesheet, stylesheetPath);
			} catch {
				return false;
			}
		});
	}

	// whether the XSpec file's stylesheet, or a helper's - a stylesheet, or a package, by its package-name - is one of the
	// modules
	private static testsAny(text: string, xspecPath: string, modules: string[]) {
		const hrefs = [...text.matchAll(/<(?:[\w.-]+:)?(?:description|helper)\b[^>]*?\sstylesheet\s*=\s*(["'])(.*?)\1/g)].map((match) => match[2]);
		const stylesheets = hrefs.map((href) => HrefPaths.toPath(href, xspecPath)).filter((p): p is string => p !== undefined);
		const packages = /<(?:[\w.-]+:)?helper\b[^>]*\spackage-name\s*=/.test(text) ? XSpecPackages.helperPackagePaths(text) : [];
		return [...stylesheets, ...packages].some((file) => modules.some((module) => XSpecSourceMap.samePath(module, file)));
	}

	private static inXSpec(text: string, uri: vscode.Uri, kind: 'function' | 'template' | 'mode', expandedName: string): vscode.Location[] {
		const lexer = new XslLexer(XSpecConfiguration.configuration);
		const tokens = lexer.analyse(text);
		const bindings = lexer.prefixBindings;
		const prefix = lexer.nativePrefix;
		const lineStarts = [0];
		for (let i = text.indexOf('\n'); i > -1; i = text.indexOf('\n', i + 1)) {
			lineStarts.push(i + 1);
		}
		const position = (offset: number) => {
			let line = lineStarts.length - 1;
			while (line > 0 && lineStarts[line] > offset) {
				line--;
			}
			return new vscode.Position(line, offset - lineStarts[line]);
		};
		const locations: vscode.Location[] = [];
		// x:call function="…" or template="…" - or x:context mode="…"
		const callPattern = new RegExp(`<${prefix ? prefix + ':' : ''}${kind === 'mode' ? 'context' : 'call'}\\b[^>]*>`, 'g');
		for (const call of text.matchAll(callPattern)) {
			const attribute = new RegExp(`\\s${kind}\\s*=\\s*(["'])(\\s*)([^"']*?)\\s*\\1`).exec(call[0]);
			if (attribute && ModulePrefixes.expandedName(attribute[3], bindings) === expandedName) {
				const start = call.index! + attribute.index + attribute[0].indexOf(attribute[1]) + 1 + attribute[2].length;
				locations.push(new vscode.Location(uri, new vscode.Range(position(start), position(start + attribute[3].length))));
			}
		}
		// a function call in an XPath expression
		if (kind === 'function') {
			tokens.filter((token) => token.tokenType === TokenLevelState.function && ModulePrefixes.expandedName(token.value, bindings) === expandedName)
				.forEach((token) => locations.push(new vscode.Location(uri, new vscode.Range(token.line, token.startCharacter, token.line, token.startCharacter + token.length))));
		}
		return locations;
	}

	public static modulesOf(file: string, trees: string[][]): string[] {
		const modules = new Set<string>([file]);
		trees.filter((tree) => tree.some((module) => path.normalize(module) === path.normalize(file))).forEach((tree) => tree.forEach((module) => modules.add(module)));
		return [...modules];
	}
}
