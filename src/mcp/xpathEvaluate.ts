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
import { XPathQuery, XPathQueryResult } from '../xpathQuery';
import { XsltSymbolProvider } from '../xsltSymbolProvider';
import { XMLConfiguration } from '../languageConfigurations';
import { XPathQueryServer } from '../xpathQueryServer';
import { XsltDebug } from '../xsltDebug';
import { unquotedPath } from '../settingPaths';
import { SaxonTaskProvider } from '../saxonTaskProvider';
import { XPathVersionNumber } from '../xpathVersion';

export type XPathToolResult = { content: { type: 'text', text: string }[], isError: boolean };

// The MCP tool evaluate_xpath: an XPath expression evaluated by Saxon on an XML file - the program behind 'Find Nodes with
// XPath', in a Java process of its own, so that a query in the editor can't stop an assistant's, or the reverse
export class XPathEvaluate {
	private readonly server = new XPathQueryServer();

	public constructor(private readonly extensionUri: vscode.Uri) {
	}

	public dispose() {
		this.server.dispose();
	}

	private static text(text: string, isError = false): XPathToolResult {
		return { content: [{ type: 'text', text }], isError };
	}

	// xpathVersion: 4.0 by default - or 3.1, with Saxon-HE, which can't evaluate 4.0 (the result says so)
	// xpathDefaultNamespace: as a stylesheet's xpath-default-namespace, for unprefixed element names - not the document's
	public async evaluate(xpath: string, xmlPath: string, xpathVersion?: XPathVersionNumber, xpathDefaultNamespace?: string): Promise<XPathToolResult> {
		const saxonJar = unquotedPath(vscode.workspace.getConfiguration('XSLT.tasks').get<string>('saxonJar'));
		if (!saxonJar) {
			return XPathEvaluate.text('The XSLT.tasks.saxonJar setting - the path of a Saxon jar - isn\'t set, so XPath can\'t be evaluated', true);
		}
		const folder = McpRoot.current();
		const resolved = path.isAbsolute(xmlPath) || !folder ? path.resolve(xmlPath) : path.resolve(folder, xmlPath);
		if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
			return XPathEvaluate.text(`File not found: ${resolved}`, true);
		}
		const uri = vscode.Uri.file(resolved);
		const xmlDocument = await DiskTextDocument.current(uri);
		const xml = xmlDocument.getText();
		// a prolog declaring prefixes - declare namespace p = 'uri'; - as in a query file
		const { xpath: expression, namespaces } = XPathQuery.withoutProlog(xpath);
		const version = xpathVersion ?? (SaxonTaskProvider.isSaxonHE(saxonJar) ? '3.1' : '4.0');
		const { args, folder: javaFolder } = XPathQuery.javaArguments(this.extensionUri, saxonJar);
		let result: XPathQueryResult;
		try {
			result = await this.server.request(XsltDebug.javaCommand, args, javaFolder,
				{ xpath: expression, xml, systemId: uri.toString(), namespaces, xpathVersion: version, xpathDefaultNamespace,
					// an assistant's expression, as it's for a stylesheet: no extension functions (Java, EXPath), no collection(), and
					// only files in the workspace folders - and the XML file's folder - for doc() and unparsed-text()
					sandbox: true, roots: [...new Set([...McpRoot.allowed(), ...(folder ? [folder] : []), path.dirname(resolved)])] });
		} catch (e: any) {
			return XPathEvaluate.text(`Saxon couldn't be run: ${e?.message ?? e}`, true);
		}
		const note = result.xpathVersion && result.xpathVersion !== version ?
			`\n(Evaluated as XPath ${result.xpathVersion}: XPath ${version} needs Saxon-PE or Saxon-EE)` : '';
		if (result.error) {
			const where = result.error.line ? ` at ${result.error.line}:${result.error.column ?? 1}` : '';
			// e.g. saxon:parse(): the extension functions of the saxon: namespace are in Saxon-PE and Saxon-EE only
			const saxonHE = /saxon[:}]|saxon\.sf\.net/i.test(result.error.message) && SaxonTaskProvider.isSaxonHE(saxonJar) ?
				'\n(The saxon: extension functions need Saxon-PE or Saxon-EE: the XSLT.tasks.saxonJar setting is Saxon-HE)' : '';
			return XPathEvaluate.text(`Error${result.error.code ? ' ' + result.error.code : ''}${where}: ${result.error.message}${note}${saxonHE}`, true);
		}
		const count = result.count ?? result.items?.length ?? 0;
		const heading = `${count} ${count === 1 ? 'item' : 'items'} for XPath ${result.xpathVersion ?? version} on ${path.basename(resolved)}`;
		const shown = result.items?.length ?? 0;
		let body: string;
		if (result.text !== undefined) {
			// as xdm:debug() writes it
			body = result.text + (count > XPathQuery.maxTextItems ? `\n… the first ${XPathQuery.maxTextItems} of ${count} items shown` : '');
		} else {
			body = (result.items ?? []).map((item) => item.kind === 'node' ? `${item.path}${item.value !== undefined ? '  ' + JSON.stringify(item.value) : ''}` :
				item.type ? `${item.value} (xs:${item.type})` : `${item.value}`).join('\n') + (count > shown ? `\n… the first ${shown} of ${count} items shown` : '');
		}
		const hint = result.hint ? `\n(${result.hint})` : '';
		// where the nodes are in the XML file: from the extension's own outline of it - where each node starts, as in the editor
		// (Find Nodes goes there) - not Saxon's, which are where an element's start tag ends, or where text ends
		const nodes = (result.items ?? []).filter((item) => item.kind === 'node').slice(0, XPathQuery.maxTextItems);
		const symbols = nodes.some((item) => !item.otherDocument) ? await new XsltSymbolProvider(XMLConfiguration.configuration, null)
			.getDocumentSymbols(xmlDocument, false).catch(() => undefined) ?? [] : [];
		const places = nodes.map((item) => {
			const range = item.otherDocument ? undefined : XPathQuery.rangeOf(item, symbols, xmlDocument);
			const place = range ? `${range.start.line + 1}:${range.start.character + 1}` : item.line ? `${item.line}${item.column ? ':' + item.column : ''} (as Saxon records it)` : undefined;
			return place ? `  ${item.path}  ${place}${item.otherDocument ? ` in ${item.otherDocument}` : ''}` : undefined;
		}).filter((line): line is string => !!line);
		const totalNodes = (result.items ?? []).filter((item) => item.kind === 'node').length;
		const lines = places.length > 0 ? `\n\nLine:column in ${path.basename(resolved)} of where each node starts - an element at its name, an attribute at its name, text at its first character:\n` +
			places.join('\n') + (totalNodes > nodes.length ? `\n  … the first ${nodes.length} of ${totalNodes} nodes` : '') : '';
		return XPathEvaluate.text(`${heading}${note}\n${body}${lines}${hint}`.trimEnd());
	}
}
