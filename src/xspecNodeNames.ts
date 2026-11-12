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
import { HrefPaths } from './hrefPaths';
import { XSpecHrefs } from './xspecHrefs';
import { XmlElement, parseXml } from './xspecXml';

// The element and attribute names for auto-completion in an XSpec file's XPath, e.g. in x:expect's test: those of its
// test data - the content of x:context, x:expect, x:param and x:variable, not XSpec's own elements and attributes,
// which aren't in the context or the result - and of the documents their href attributes refer to, resolved as XSpec
// resolves them (see XSpecHrefs). Not scoped to the x:context in effect for the scenario: XSpec files are small, and
// their names consistent.
//
// The names are given as the symbols of one document, as for the XML context file of a stylesheet (see
// XsltSymbolProvider.getExpectedForXPathLocation): a root that stands for the test data, with each element of test
// data, and each document's root element, as its children
export class XSpecNodeNames {
	// the detail of the root symbol: it isn't an element, so its own name is never offered
	public static readonly rootDetail = '\u0000xspec-test-data';
	// the XSpec elements whose href is a document of test data
	private static readonly hrefElements = new Set(['context', 'expect', 'param', 'variable']);

	public static isRoot(symbol: vscode.DocumentSymbol | undefined) {
		return symbol?.detail === XSpecNodeNames.rootDetail;
	}

	// load: the symbols of an XML file, e.g. XsltDefinitionProvider.contextFileSymbols
	public static async symbols(document: vscode.TextDocument, load: (uri: vscode.Uri) => Promise<vscode.DocumentSymbol[] | undefined>): Promise<vscode.DocumentSymbol[]> {
		const text = document.getText();
		const root = parseXml(text);
		if (!root) {
			return [];
		}
		// XSpec's elements: those with the root's prefix, as XSpec files are checked (see XSpecHrefs.find)
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const isXSpec = (element: XmlElement) => prefix ? element.name.startsWith(prefix) : !element.name.includes(':');
		const container = XSpecNodeNames.symbol(root.name, []);
		container.detail = XSpecNodeNames.rootDetail;
		container.children = XSpecNodeNames.testData(root, isXSpec);
		if (document.uri.scheme === 'file') {
			const paths = new Set<string>();
			for (const href of XSpecHrefs.find(text, document.fileName)) {
				const filePath = XSpecNodeNames.hrefElements.has(href.element) ? HrefPaths.toPath(href.value, href.basePath) : undefined;
				if (filePath && !paths.has(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
					paths.add(filePath);
				}
			}
			for (const filePath of paths) {
				const symbols = await load(vscode.Uri.file(filePath));
				container.children.push(...(symbols ?? []).filter((symbol) => symbol.kind !== vscode.SymbolKind.Array));
			}
		}
		return [container];
	}

	// the test data within an element: its elements that aren't XSpec's, and those within its XSpec elements
	private static testData(element: XmlElement, isXSpec: (element: XmlElement) => boolean): vscode.DocumentSymbol[] {
		return element.children.flatMap((child) => isXSpec(child) ? XSpecNodeNames.testData(child, isXSpec) : [XSpecNodeNames.element(child)]);
	}

	// an element of test data, as the symbol of an XML file is: its attributes - not namespace declarations - then its
	// child elements
	private static element(element: XmlElement): vscode.DocumentSymbol {
		const attributes = [...element.attributes.keys()].filter((name) => name !== 'xmlns' && !name.startsWith('xmlns:'))
			.map((name) => XSpecNodeNames.symbol(name, [], vscode.SymbolKind.Field));
		const children = element.children.map((child) => XSpecNodeNames.element(child));
		return XSpecNodeNames.symbol(element.name, attributes.length > 0 ? [XSpecNodeNames.symbol('attributes', attributes, vscode.SymbolKind.Array), ...children] : children);
	}

	private static symbol(name: string, children: vscode.DocumentSymbol[], kind = vscode.SymbolKind.Object) {
		const range = new vscode.Range(0, 0, 0, 0);
		const symbol = new vscode.DocumentSymbol(name, '', kind, range, range);
		symbol.children = children;
		return symbol;
	}
}
