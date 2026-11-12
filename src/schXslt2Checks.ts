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
import { XmlElement, parseXml, descendants } from './xspecXml';
import { XslLexer } from './xslLexer';
import { HrefPaths } from './hrefPaths';
import { SCHXSLT2_XSLT_DECLARATIONS } from './schSchema';
import { DiagnosticCode } from './xsltTokenDiagnostics';

// Schematron: the XSLT in a schema that SchXslt2 - the Schematron processor bundled with XSpec - doesn't use as it's
// written (see xslt-resources/xspec/lib/schxslt2/transpile.xsl):
// - it copies only some top-level XSLT declarations into its validation stylesheet (SCHXSLT2_XSLT_DECLARATIONS): any
//   other, e.g. xsl:param or xsl:template, is ignored - as is an XSLT element in a rule, e.g. xsl:variable
// - an XSLT element in a message, e.g. xsl:value-of in sch:assert, or in the content of sch:let, isn't run: it's copied
//   into the report, or the variable's value, as it is
// - it declares the unnamed mode, with the schema's own accumulators: an included module that declares it too, with
//   use-accumulators, is reported by Saxon (XTSE0545), and the accumulators of an included module don't apply
// With quick fixes: xsl:variable to sch:let, a top-level xsl:param to sch:param, xsl:value-of to sch:value-of - and for a
// prefix not declared with sch:ns (DiagnosticCode.schNsPrefix), the sch:ns
export class SchXslt2Checks {
	public static readonly ignoredCode = 'schxslt2-ignored';
	public static readonly notRunCode = 'schxslt2-not-run';
	public static readonly includeCode = 'schxslt2-include';
	private static readonly xsltNamespace = 'http://www.w3.org/1999/XSL/Transform';
	// the Schematron elements whose content is a message, copied into the report
	private static readonly messages = ['assert', 'report', 'diagnostic', 'property', 'name', 'emph', 'dir', 'span', 'p', 'title', 'active'];
	// the namespaces of the prefixes commonly used without being declared - for the quick fix adding an sch:ns
	private static readonly knownNamespaces: { [prefix: string]: string } = {
		xs: 'http://www.w3.org/2001/XMLSchema', fn: 'http://www.w3.org/2005/xpath-functions', map: 'http://www.w3.org/2005/xpath-functions/map',
		array: 'http://www.w3.org/2005/xpath-functions/array', math: 'http://www.w3.org/2005/xpath-functions/math', xsl: SchXslt2Checks.xsltNamespace,
		saxon: 'http://saxon.sf.net/'
	};

	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		const schema = SchXslt2Checks.schema(document.getText());
		if (!schema) {
			return [];
		}
		const diagnostics: vscode.Diagnostic[] = [];
		const nameRange = (element: XmlElement) => new vscode.Range(document.positionAt(element.start + 1), document.positionAt(element.start + 1 + element.name.length));
		const add = (element: XmlElement, message: string, code: string, severity = vscode.DiagnosticSeverity.Warning) => {
			const diagnostic = new vscode.Diagnostic(nameRange(element), message, severity);
			diagnostic.code = code;
			diagnostics.push(diagnostic);
		};
		for (const element of descendants(schema.root)) {
			const local = schema.xsltLocal(element);
			const parent = element.parent!;
			const parentLocal = schema.schLocal(parent);
			if (local === undefined || schema.xsltLocal(parent) !== undefined || (parentLocal === 'property' && local === 'copy-of')) {
				// not XSLT - or within an XSLT element, e.g. xsl:function, copied with it - or a property's xsl:copy-of, which is run
				continue;
			}
			const xsltName = 'xsl:' + local;
			if (parent === schema.root) {
				if (!SCHXSLT2_XSLT_DECLARATIONS.includes(xsltName)) {
					const instead = local === 'variable' ? ' - use sch:let' : local === 'param' ? ' - use sch:param' : '';
					add(element, `SchXslt2: ${xsltName} is ignored - only ${SCHXSLT2_XSLT_DECLARATIONS.join(', ')} are copied into its validation stylesheet${instead}`, SchXslt2Checks.ignoredCode);
				} else if (local === 'include' || local === 'import') {
					SchXslt2Checks.includeProblems(document, element).forEach((message) => add(element, message, SchXslt2Checks.includeCode,
						message.includes('XTSE0545') ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
				}
			} else if (parentLocal !== undefined && SchXslt2Checks.messages.includes(parentLocal)) {
				const instead = local === 'value-of' ? ' - use sch:value-of' : '';
				add(element, `SchXslt2: ${xsltName} isn't run in a message - it's copied into the report as it is${instead}`, SchXslt2Checks.notRunCode);
			} else if (parentLocal === 'let' || parentLocal === 'param') {
				add(element, `SchXslt2: ${xsltName} isn't run in the content of sch:${parentLocal} - it's copied into the value as it is: use the value attribute for an expression`, SchXslt2Checks.notRunCode);
			} else if (parentLocal !== undefined) {
				const instead = local === 'variable' ? ' - use sch:let' : '';
				add(element, `SchXslt2: ${xsltName} is ignored in sch:${parentLocal}${instead}`, SchXslt2Checks.ignoredCode);
			}
		}
		return diagnostics;
	}

	public static codeActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
		const text = document.getText();
		const schema = SchXslt2Checks.schema(text);
		if (!schema) {
			return [];
		}
		const elementAt = (diagnostic: vscode.Diagnostic) => {
			const offset = document.offsetAt(diagnostic.range.start) - 1;
			return descendants(schema.root).find((element) => element.start === offset);
		};
		const sch = (local: string) => schema.prefix + local;
		return diagnostics.flatMap((diagnostic): vscode.CodeAction[] => {
			if (diagnostic.code === SchXslt2Checks.ignoredCode || diagnostic.code === SchXslt2Checks.notRunCode) {
				const element = elementAt(diagnostic);
				const local = element ? schema.xsltLocal(element) : undefined;
				if (!element || !local) {
					return [];
				}
				const isEmpty = element.children.length === 0 && element.text.trim() === '';
				const select = element.attributes.get('select');
				const name = element.attributes.get('name');
				const as = element.attributes.get('as');
				const others = [...element.attributes.keys()].filter((attribute) => !['select', 'name', 'as'].includes(attribute) && !attribute.startsWith('xmlns'));
				let replacement: string | undefined;
				if (local === 'variable' && name && select !== undefined && isEmpty && others.length === 0) {
					replacement = `<${sch('let')} name="${name}" value="${SchXslt2Checks.attributeValue(select)}"${as ? ` as="${as}"` : ''}/>`;
				} else if (local === 'param' && element.parent === schema.root && name && select !== undefined && isEmpty && others.length === 0) {
					replacement = `<${sch('param')} name="${name}" value="${SchXslt2Checks.attributeValue(select)}"${as ? ` as="${as}"` : ''}/>`;
				} else if (local === 'value-of' && select !== undefined && isEmpty && others.length === 0 && as === undefined && name === undefined) {
					replacement = `<${sch('value-of')} select="${SchXslt2Checks.attributeValue(select)}"/>`;
				}
				if (!replacement) {
					return [];
				}
				const action = new vscode.CodeAction(`Replace with ${replacement.substring(1, replacement.indexOf(' '))}`, vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				action.edit = new vscode.WorkspaceEdit();
				action.edit.replace(document.uri, new vscode.Range(document.positionAt(element.start), document.positionAt(element.end)), replacement);
				return [action];
			} else if (diagnostic.code === DiagnosticCode.schNsPrefix) {
				const prefix = /'([^']+)'/.exec(diagnostic.message)?.[1];
				const uri = prefix ? new RegExp(`\\sxmlns:${prefix.replace(/[.-]/g, '\\$&')}\\s*=\\s*["']([^"']*)["']`).exec(text)?.[1] ?? SchXslt2Checks.knownNamespaces[prefix] : undefined;
				if (!prefix || uri === undefined) {
					return [];
				}
				// after the last sch:ns - or else at the start of the schema
				const lastNs = descendants(schema.root).filter((element) => element.parent === schema.root && schema.schLocal(element) === 'ns').pop();
				const offset = lastNs ? lastNs.end : schema.root.contentStart;
				const lineStart = text.lastIndexOf('\n', (lastNs ?? schema.root.children[0])?.start ?? offset) + 1;
				const indent = /^[ \t]*/.exec(text.substring(lineStart))?.[0] ?? '';
				const action = new vscode.CodeAction(`Add <${sch('ns')} prefix="${prefix}" uri="${uri}"/>`, vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				action.edit = new vscode.WorkspaceEdit();
				action.edit.insert(document.uri, document.positionAt(offset), `\n${indent}<${sch('ns')} prefix="${prefix}" uri="${uri}"/>`);
				return [action];
			}
			return [];
		});
	}

	// an included or imported module that declares the unnamed mode with use-accumulators, or accumulators
	private static includeProblems(document: vscode.TextDocument, element: XmlElement): string[] {
		const href = element.attributes.get('href');
		const filePath = href && document.uri.scheme === 'file' ? HrefPaths.toPath(href, document.fileName) : undefined;
		let module: XmlElement | undefined;
		try {
			module = filePath && fs.existsSync(filePath) ? parseXml(fs.readFileSync(filePath, 'utf8')) : undefined;
		} catch {
			module = undefined;
		}
		if (!module) {
			return [];
		}
		const colon = module.name.indexOf(':');
		const prefix = colon > 0 ? module.name.substring(0, colon + 1) : '';
		const declarations = module.children.filter((child) => child.name.startsWith(prefix));
		const problems: string[] = [];
		if (declarations.some((child) => child.name === prefix + 'mode' && !child.attributes.has('name') && child.attributes.has('use-accumulators'))) {
			problems.push('SchXslt2: the module declares the unnamed mode with use-accumulators, as SchXslt2 does with the schema\'s own accumulators - Saxon reports XTSE0545 for the two: declare the accumulators in the schema, and remove the module\'s xsl:mode');
		}
		const accumulators = declarations.filter((child) => child.name === prefix + 'accumulator').map((child) => child.attributes.get('name'));
		if (accumulators.length > 0) {
			problems.push(`SchXslt2: the module declares the accumulator${accumulators.length > 1 ? 's' : ''} ${accumulators.join(', ')} - SchXslt2's modes use only the schema's own accumulators, so accumulator-before() and accumulator-after() fail for ${accumulators.length > 1 ? 'them' : 'it'}: declare ${accumulators.length > 1 ? 'them' : 'it'} in the schema`);
		}
		return problems;
	}

	// a value for an attribute delimited by double quotes
	private static attributeValue(value: string) {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
	}

	// the schema: its outermost element, its prefix for Schematron (with the ':'), and the local names of its Schematron
	// and XSLT elements
	private static schema(text: string) {
		const root = parseXml(text);
		if (!root || !/^(?:[\w.-]+:)?(?:schema|library)$/.test(root.name)) {
			return undefined;
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		const xsltPrefix = XslLexer.schXsltPrefix(text) + ':';
		return {
			root, prefix,
			schLocal: (element: XmlElement) => (prefix ? element.name.startsWith(prefix) : !element.name.includes(':')) ? element.name.substring(prefix.length) : undefined,
			xsltLocal: (element: XmlElement) => element.name.startsWith(xsltPrefix) ? element.name.substring(xsltPrefix.length) : undefined
		};
	}
}
