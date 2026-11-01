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

// The uses of a stylesheet's function or named template in the XSpec files that test it - for Find All References and
// Rename (see XSLTReferenceProvider): x:call's function or template, and function calls in XPath expressions, e.g. a
// test="f:double(2) = 4". Names are compared with their namespaces, as an XSpec file may use another prefix
export class XSpecReferences {

	// the locations of the names, in the XSpec files whose stylesheet - or helper - is one of the modules, e.g. the module
	// declaring it, or a stylesheet that imports it
	public static async find(kind: 'function' | 'template', expandedName: string, modules: string[]): Promise<vscode.Location[]> {
		const locations: vscode.Location[] = [];
		// the workspace's XSpec files, and any open in an editor
		const uris = await vscode.workspace.findFiles('**/*.xspec', '**/node_modules/**');
		vscode.workspace.textDocuments.filter((document) => document.languageId === 'xspec' && document.uri.scheme === 'file' && !uris.some((uri) => uri.toString() === document.uri.toString()))
			.forEach((document) => uris.push(document.uri));
		for (const uri of uris) {
			try {
				const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
				const text = open ? open.getText() : fs.readFileSync(uri.fsPath, 'utf8');
				if (XSpecReferences.testsAny(text, uri.fsPath, modules)) {
					locations.push(...XSpecReferences.inXSpec(text, uri, kind, expandedName));
				}
			} catch {
				// a file that can't be read
			}
		}
		return locations;
	}

	// whether the XSpec file's stylesheet, or a helper's, is one of the modules
	private static testsAny(text: string, xspecPath: string, modules: string[]) {
		const hrefs = [...text.matchAll(/<(?:[\w.-]+:)?(?:description|helper)\b[^>]*?\sstylesheet\s*=\s*(["'])(.*?)\1/g)].map((match) => match[2]);
		return hrefs.some((href) => {
			const stylesheet = HrefPaths.toPath(href, xspecPath);
			return stylesheet !== undefined && modules.some((module) => XSpecSourceMap.samePath(module, stylesheet));
		});
	}

	private static inXSpec(text: string, uri: vscode.Uri, kind: 'function' | 'template', expandedName: string): vscode.Location[] {
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
		// x:call function="…" or template="…"
		const callPattern = new RegExp(`<${prefix ? prefix + ':' : ''}call\\b[^>]*>`, 'g');
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
