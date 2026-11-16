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
import { SchExpandText } from './schExpandText';
import { HrefPaths } from './hrefPaths';
import { SCHXSLT2_XSLT_DECLARATIONS } from './schSchema';
import { DiagnosticCode } from './xsltTokenDiagnostics';
import { XSpecRunner } from './xspecRunner';
import { SaxonTaskProvider } from './saxonTaskProvider';
import * as path from 'path';

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
	public static readonly namespaceCode = 'schxslt2-namespace';
	public static readonly noteCode = 'schxslt2-note';
	public static readonly attributeCode = 'schxslt2-ignored-attribute';
	public static readonly subjectCode = 'schxslt2-subject';
	public static readonly skeletonCode = 'schxslt2-skeleton';
	// the modes of the templates the ISO Schematron skeleton generates, e.g. for a diagnostic's location
	private static readonly skeletonModes = ['schematron-get-full-path', 'schematron-get-full-path-2', 'schematron-get-full-path-3', 'schematron-select-full-path',
		'generate-id-from-path', 'generate-id-2'];
	private static readonly isoNamespace = 'http://purl.oclc.org/dsdl/schematron';
	private static readonly xsltNamespace = 'http://www.w3.org/1999/XSL/Transform';
	// the Schematron elements whose content is a message, copied into the report
	public static readonly messages = ['assert', 'report', 'diagnostic', 'property', 'name', 'emph', 'dir', 'span', 'p', 'title', 'active'];
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
		const rootPrefix = schema.prefix ? schema.prefix.slice(0, -1) : '';
		const rootNamespace = schema.root.attributes.get(rootPrefix ? `xmlns:${rootPrefix}` : 'xmlns');
		if (rootNamespace !== undefined && rootNamespace !== SchXslt2Checks.isoNamespace && /schematron/i.test(rootNamespace)) {
			// e.g. Schematron 1.5's http://www.ascc.net/xml/schematron
			add(schema.root, `SchXslt2: this isn't ISO Schematron, whose namespace is ${SchXslt2Checks.isoNamespace} - SchXslt2 doesn't validate with it`, SchXslt2Checks.namespaceCode);
		}
		const text = document.getText();
		// the signs of a schema written for the ISO Schematron skeleton (see skeletonCode)
		const skeletonSigns = new Map<string, string>();
		const sign = (kind: string, description: string) => skeletonSigns.has(kind) || skeletonSigns.set(kind, description);
		for (const element of [schema.root, ...descendants(schema.root)]) {
			// an XSLT attribute of a Schematron element, e.g. xsl:expand-text on sch:pattern: allowed, as a foreign attribute,
			// but SchXslt2 doesn't use it
			const schElementLocal = schema.schLocal(element);
			if (schElementLocal !== undefined) {
				const startTag = text.substring(element.start, element.contentStart);
				for (const match of startTag.matchAll(/\s([\w.-]+:[\w.-]+)\s*=/g)) {
					if (!match[1].startsWith(schema.xsltPrefix)) {
						continue;
					}
					const start = element.start + match.index! + 1;
					const name = 'xsl:' + match[1].substring(schema.xsltPrefix.length);
					if (name === 'xsl:expand-text' && XslLexer.schAllowExpandText) {
						// text value templates in messages: the non-standard extension, allowed
						continue;
					}
					const instead = name === 'xsl:expand-text' ? ' - text value templates with it are a non-standard extension, allowed by the setting XSLT.schematron.allowExpandText: see the quick fixes' : '';
					const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(start), document.positionAt(start + match[1].length)),
						`SchXslt2: the attribute ${name} is ignored on sch:${schElementLocal}${instead}`, vscode.DiagnosticSeverity.Warning);
					diagnostic.code = SchXslt2Checks.attributeCode;
					diagnostics.push(diagnostic);
				}
			}
			if (element === schema.root) {
				continue;
			}
			const mode = element.attributes.get('mode');
			if (mode !== undefined && mode.trim().split(/\s+/).some((m) => SchXslt2Checks.skeletonModes.includes(m))) {
				sign('mode', `a mode the skeleton generates, e.g. ${mode.trim()}`);
			}
			const local = schema.xsltLocal(element);
			const parent = element.parent!;
			if (local === undefined || SchXslt2Checks.isWithinXslt(schema, element)) {
				// not XSLT - or within an XSLT element, e.g. xsl:function, copied with it
				continue;
			}
			// the Schematron element it's in: its parent - or, within other elements, e.g. a diagnostic's <out:details>, the
			// Schematron element they're in, whose content is copied with them
			let container: XmlElement | undefined = parent;
			while (container && schema.schLocal(container) === undefined) {
				container = container.parent;
			}
			const parentLocal = container ? schema.schLocal(container) : undefined;
			const isWithinOther = container !== parent;
			if (parentLocal === undefined || (isWithinOther && !SchXslt2Checks.messages.includes(parentLocal) && parentLocal !== 'let' && parentLocal !== 'param')) {
				continue;
			}
			if (local === 'copy-of' && SchXslt2Checks.isWithinProperty(schema, container!)) {
				// a property's xsl:copy-of, which is run
				continue;
			}
			const xsltName = 'xsl:' + local;
			if (parent === schema.root) {
				if (!SCHXSLT2_XSLT_DECLARATIONS.includes(xsltName)) {
					const instead = local === 'variable' ? ' - use sch:let, or move it to an included XSLT module' : local === 'param' ? ' - use sch:param, or move it to an included XSLT module' : ' - move it to an included XSLT module';
					add(element, `SchXslt2: ${xsltName} is ignored - only ${SCHXSLT2_XSLT_DECLARATIONS.join(', ')} are copied into its validation stylesheet${instead}`, SchXslt2Checks.ignoredCode);
					sign('declaration', `a top-level ${xsltName}`);
				} else if (local === 'include' || local === 'import') {
					SchXslt2Checks.includeProblems(document, element).forEach((message) => add(element, message, SchXslt2Checks.includeCode,
						message.includes('XTSE0545') ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
				}
			} else if (SchXslt2Checks.messages.includes(parentLocal)) {
				const instead = local === 'value-of' ? ' - use sch:value-of' : '';
				const within = isWithinOther ? `, as is the ${parent.name} element it's in` : '';
				add(element, `SchXslt2: ${xsltName} isn't run in a message - it's copied into the report as it is${within}${instead}`, SchXslt2Checks.notRunCode);
				if (isWithinOther) {
					// e.g. a diagnostic with XML output, run by the skeleton with allow-foreign - not just xsl:value-of for
					// sch:value-of, a common mistake
					sign('message', `XSLT run in a message, within other elements, e.g. ${xsltName} in ${parent.name}`);
				}
			} else if (parentLocal === 'let' || parentLocal === 'param') {
				add(element, `SchXslt2: ${xsltName} isn't run in the content of sch:${parentLocal} - it's copied into the value as it is: use the value attribute for an expression`, SchXslt2Checks.notRunCode);
			} else {
				const instead = local === 'variable' ? ' - use sch:let' : '';
				add(element, `SchXslt2: ${xsltName} is ignored in sch:${parentLocal}${instead}`, SchXslt2Checks.ignoredCode);
			}
		}
		// a subject - of an assertion, or of the rule, for its assertions without one - is the argument of the function
		// SchXslt2 reports the location with: path() by default, so a sequence, e.g. "., ../b", is a call with 2 arguments
		for (const element of descendants(schema.root)) {
			const local = schema.schLocal(element);
			const subject = element.attributes.get('subject');
			if (subject === undefined || (local !== 'assert' && local !== 'report' && local !== 'rule')) {
				continue;
			}
			const commas = SchXslt2Checks.topLevelCommas(subject);
			if (commas === 0) {
				continue;
			}
			const startTag = text.substring(element.start, element.contentStart);
			const attribute = /\ssubject\s*=\s*(["'])/.exec(startTag);
			const valueStart = element.start + attribute!.index + attribute![0].length;
			const valueEnd = text.indexOf(attribute![1], valueStart);
			const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(valueStart), document.positionAt(valueEnd)),
				`SchXslt2: the subject is a sequence - SchXslt2 reports the location with path(${subject.trim()}), a call with ${commas + 1} arguments that fails (XPST0017): use one node`, vscode.DiagnosticSeverity.Error);
			diagnostic.code = SchXslt2Checks.subjectCode;
			diagnostics.push(diagnostic);
		}
		// more than one sign of a schema written for the ISO Schematron skeleton, with its allow-foreign parameter true: once,
		// on the schema, as the reason for the problems
		if (skeletonSigns.size > 1) {
			add(schema.root, `SchXslt2: the schema seems to be written for the ISO Schematron skeleton (iso_schematron_skeleton_for_saxon.xsl) with allow-foreign="true", which SchXslt2 doesn't emulate - it has ${[...skeletonSigns.values()].join('; ')}`,
				SchXslt2Checks.skeletonCode, vscode.DiagnosticSeverity.Information);
		}
		// xsl:note, which SchXslt2 copies into its stylesheet with the declaration it's in - for which XSpec turns Saxon's
		// syntax extensions on - when the Saxon that runs the tests can't
		const notes = SchXslt2Checks.notesNeedingExtensions(document.getText());
		const reason = notes.length > 0 ? SchXslt2Checks.noteProblem(document.uri) : undefined;
		if (reason) {
			notes.forEach((note) => add(note, `SchXslt2: xsl:note in its stylesheet needs Saxon's syntax extensions, which ${reason} - Saxon reports XTSE0010. Remove it, or add use-when="false()"`,
				SchXslt2Checks.noteCode, vscode.DiagnosticSeverity.Error));
		}
		return diagnostics;
	}

	// the xsl:note elements that SchXslt2 copies into its stylesheet, with an XSLT declaration it copies, e.g. xsl:function
	// - not one with use-when="false()", or within an element with it, which Saxon leaves out without its syntax extensions
	public static notesNeedingExtensions(text: string): XmlElement[] {
		const schema = SchXslt2Checks.schema(text);
		if (!schema) {
			return [];
		}
		const excluded = (element: XmlElement) => ['use-when', '_use-when'].some((name) => element.attributes.get(name)?.replace(/\s/g, '') === 'false()');
		return descendants(schema.root).filter((element) => {
			if (schema.xsltLocal(element) !== 'note' || excluded(element)) {
				return false;
			}
			let topLevel = element;
			for (let ancestor = element.parent; ancestor && ancestor !== schema.root; ancestor = ancestor.parent) {
				if (excluded(ancestor)) {
					return false;
				}
				topLevel = ancestor;
			}
			const declaration = schema.xsltLocal(topLevel);
			return topLevel !== element && declaration !== undefined && SCHXSLT2_XSLT_DECLARATIONS.includes('xsl:' + declaration);
		});
	}

	// why the Saxon that runs XSpec's tests can't run xsl:note - undefined if it can, or isn't known
	private static noteProblem(uri: vscode.Uri): string | undefined {
		if (vscode.workspace.getConfiguration('XSLT.xspec', uri).get<string>('allowSyntaxExtensions') === 'off') {
			return 'the XSLT.xspec.allowSyntaxExtensions setting turns off';
		}
		const jar = XSpecRunner.saxonJar(uri);
		if (!jar) {
			return undefined;
		}
		if (SaxonTaskProvider.isSaxonHE(jar)) {
			return 'Saxon-HE doesn\'t have';
		}
		const major = /saxon[\w-]*?(?:pe|ee)[-_]?(\d+)[.-]\d+/i.exec(path.basename(jar))?.[1] ?? /saxon[\w-]*?(?:pe|ee)(\d+)-\d+/i.exec(jar)?.[1];
		return major !== undefined && Number(major) < 13 ? `Saxon ${major} doesn't have for it - Saxon 13 or later is needed` : undefined;
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
		// ISO Schematron's patterns with Schematron 1.5's name, e.g. after its namespace is changed
		const namedPatterns = [schema.root, ...descendants(schema.root)].filter((e) => schema.schLocal(e) === 'pattern' && e.attributes.has('name'));
		return diagnostics.flatMap((diagnostic): vscode.CodeAction[] => {
			if (/^XSLT: Invalid attribute on element '(?:[\w.-]+:)?pattern': 'name'$/.test(diagnostic.message)) {
				const offset = document.offsetAt(diagnostic.range.start);
				const pattern = namedPatterns.find((p) => p.start < offset && offset < p.contentStart);
				if (!pattern) {
					return [];
				}
				const one = new vscode.CodeAction('Replace name with a title - Schematron 1.5\'s name', vscode.CodeActionKind.QuickFix);
				one.diagnostics = [diagnostic];
				one.isPreferred = true;
				one.edit = new vscode.WorkspaceEdit();
				SchXslt2Checks.nameToTitle(one.edit, document, text, schema, pattern);
				if (namedPatterns.length < 2) {
					return [one];
				}
				const each = new vscode.CodeAction(`Replace each pattern's name with a title (${namedPatterns.length})`, vscode.CodeActionKind.QuickFix);
				each.diagnostics = [diagnostic];
				each.edit = new vscode.WorkspaceEdit();
				namedPatterns.forEach((p) => SchXslt2Checks.nameToTitle(each.edit!, document, text, schema, p));
				return [one, each];
			} else if (diagnostic.code === SchXslt2Checks.ignoredCode || diagnostic.code === SchXslt2Checks.notRunCode) {
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
				const isIgnored = diagnostic.code === SchXslt2Checks.ignoredCode;
				// not sch:let for a variable in a message, where it isn't allowed
				if (isIgnored && local === 'variable' && name && select !== undefined && isEmpty && others.length === 0) {
					replacement = `<${sch('let')} name="${name}" value="${SchXslt2Checks.attributeValue(select)}"${as ? ` as="${as}"` : ''}/>`;
				} else if (local === 'param' && element.parent === schema.root && name && select !== undefined && isEmpty && others.length === 0) {
					replacement = `<${sch('param')} name="${name}" value="${SchXslt2Checks.attributeValue(select)}"${as ? ` as="${as}"` : ''}/>`;
				} else if (local === 'value-of' && select !== undefined && isEmpty && others.length === 0 && as === undefined && name === undefined) {
					replacement = `<${sch('value-of')} select="${SchXslt2Checks.attributeValue(select)}"/>`;
				} else if (isIgnored && local === 'variable' && name && select === undefined && as !== undefined && !isEmpty && others.length === 0 && SchXslt2Checks.isLiteralContent(schema, element)) {
					// content, with as: the same value as sch:let's content, which SchXslt2 copies - without as, the variable's
					// value is a document node, but sch:let's is the elements, with no document node
					replacement = `<${sch('let')} name="${name}" as="${SchXslt2Checks.attributeValue(as)}">${text.substring(element.contentStart, element.contentEnd)}</${sch('let')}>`;
				}
				const actions: vscode.CodeAction[] = [];
				if (replacement) {
					const action = new vscode.CodeAction(`Replace with ${replacement.substring(1, replacement.indexOf(' '))}`, vscode.CodeActionKind.QuickFix);
					action.diagnostics = [diagnostic];
					action.isPreferred = true;
					action.edit = new vscode.WorkspaceEdit();
					action.edit.replace(document.uri, new vscode.Range(document.positionAt(element.start), document.positionAt(element.end)), replacement);
					actions.push(action);
				}
				if (element.parent === schema.root && diagnostic.code === SchXslt2Checks.ignoredCode) {
					// a top-level declaration SchXslt2 ignores: in a module the schema includes, which it copies, as it is
					const module = SchXslt2Checks.declarationsModule(document);
					const move = SchXslt2Checks.moveToModule(document, text, schema, [element]);
					if (move) {
						const action = new vscode.CodeAction(`Move to an included XSLT module, ${module.href}`, vscode.CodeActionKind.QuickFix);
						action.diagnostics = [diagnostic];
						action.isPreferred = actions.length === 0;
						action.edit = move;
						actions.push(action);
					}
					const ignored = schema.root.children.filter((child) => {
						const childLocal = schema.xsltLocal(child);
						return childLocal !== undefined && !SCHXSLT2_XSLT_DECLARATIONS.includes('xsl:' + childLocal);
					});
					const moveAll = ignored.length > 1 ? SchXslt2Checks.moveToModule(document, text, schema, ignored) : undefined;
					if (moveAll) {
						const action = new vscode.CodeAction(`Move each ignored top-level XSLT declaration to an included XSLT module, ${module.href} (${ignored.length})`, vscode.CodeActionKind.QuickFix);
						action.diagnostics = [diagnostic];
						action.edit = moveAll;
						actions.push(action);
					}
				}
				return actions;
			} else if (diagnostic.code === SchXslt2Checks.namespaceCode) {
				const edit = SchXslt2Checks.toIso(document, text, schema);
				if (!edit) {
					return [];
				}
				const action = new vscode.CodeAction('Convert to ISO Schematron', vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				action.edit = edit;
				return [action];
			} else if (diagnostic.code === SchXslt2Checks.attributeCode) {
				// the attribute, with the whitespace before it
				const start = document.offsetAt(diagnostic.range.start);
				const attribute = /^[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*')/.exec(text.substring(start));
				if (!attribute) {
					return [];
				}
				const before = /\s+$/.exec(text.substring(0, start))?.[0].length ?? 0;
				const action = new vscode.CodeAction(`Remove ${text.substring(start, document.offsetAt(diagnostic.range.end))}`, vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				action.edit = new vscode.WorkspaceEdit();
				action.edit.delete(document.uri, new vscode.Range(document.positionAt(start - before), document.positionAt(start + attribute[0].length)));
				if (!/:expand-text$/.test(text.substring(start, document.offsetAt(diagnostic.range.end)))) {
					return [action];
				}
				// xsl:expand-text: or the setting that allows it - opened, not changed, as it's for every Schematron file
				const setting = new vscode.CodeAction(`Open the setting ${SchExpandText.section}.${SchExpandText.setting} - for every Schematron file`, vscode.CodeActionKind.QuickFix);
				setting.diagnostics = [diagnostic];
				setting.command = { command: SchExpandText.openSettingCommand, title: setting.title };
				return [action, setting];
			} else if (diagnostic.code === SchXslt2Checks.noteCode) {
				const element = elementAt(diagnostic);
				if (!element) {
					return [];
				}
				const action = new vscode.CodeAction('Add use-when="false()" - Saxon leaves the note out', vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				action.edit = new vscode.WorkspaceEdit();
				action.edit.insert(document.uri, document.positionAt(element.start + 1 + element.name.length), ' use-when="false()"');
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

	// the content of an XSLT element is literal: no XSLT elements, and no attribute value templates - as the content of
	// sch:let, which SchXslt2 copies as it is
	private static isLiteralContent(schema: Schema, element: XmlElement) {
		return descendants(element).every((e) => schema.xsltLocal(e) === undefined && [...e.attributes.values()].every((value) => !value.includes('{')));
	}

	// the XSLT module for a schema's top-level declarations that SchXslt2 ignores, e.g. rules.sch's: rules-declarations.xsl,
	// beside it
	public static declarationsModule(document: vscode.TextDocument) {
		const base = path.basename(document.fileName).replace(/\.[^.]*$/, '');
		const href = `${base}-declarations.xsl`;
		return { href, path: path.join(path.dirname(document.fileName), href) };
	}

	// the edit moving top-level XSLT declarations that SchXslt2 ignores, e.g. xsl:variable, into the module for them, which
	// the schema includes - SchXslt2 copies xsl:include. The module, if it's new, declares the schema's namespaces: those of
	// its outermost element and of its sch:ns. undefined if the module can't be written, e.g. for an unsaved schema
	private static moveToModule(document: vscode.TextDocument, text: string, schema: Schema, elements: XmlElement[]): vscode.WorkspaceEdit | undefined {
		if (document.uri.scheme !== 'file' || elements.length === 0) {
			return undefined;
		}
		const module = SchXslt2Checks.declarationsModule(document);
		const moduleUri = vscode.Uri.file(module.path);
		const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === moduleUri.fsPath);
		let existing: string | undefined;
		try {
			existing = open ? open.getText() : fs.existsSync(module.path) ? fs.readFileSync(module.path, 'utf8') : undefined;
		} catch {
			return undefined;
		}
		const xsl = schema.xsltPrefix;
		const step = '  ';
		const moved = elements.map((element) => SchXslt2Checks.reindented(text, element, step)).join('\n');
		const edit = new vscode.WorkspaceEdit();
		if (existing === undefined) {
			const bindings = new Map<string, string>([[xsl.slice(0, -1), SchXslt2Checks.xsltNamespace]]);
			for (const [attribute, uri] of schema.root.attributes) {
				if (attribute.startsWith('xmlns:') && uri !== SchXslt2Checks.isoNamespace && !bindings.has(attribute.substring(6))) {
					bindings.set(attribute.substring(6), uri);
				}
			}
			for (const ns of descendants(schema.root).filter((e) => schema.schLocal(e) === 'ns')) {
				const prefix = ns.attributes.get('prefix');
				const uri = ns.attributes.get('uri');
				if (prefix && uri !== undefined && !bindings.has(prefix)) {
					bindings.set(prefix, uri);
				}
			}
			const declarations = [...bindings].map(([prefix, uri]) => ` xmlns:${prefix}="${SchXslt2Checks.attributeValue(uri)}"`).join('');
			const version = { xslt2: '2.0', xslt3: '3.0', xslt4: '4.0' }[(schema.root.attributes.get('queryBinding') ?? '').toLowerCase()] ?? '3.0';
			const content = `<?xml version="1.0" encoding="UTF-8"?>\n<${xsl}stylesheet${declarations} exclude-result-prefixes="#all" version="${version}">\n` +
				`${step}<!-- declarations moved from ${path.basename(document.fileName)}: SchXslt2 only copies some XSLT declarations of a schema into its validation stylesheet, xsl:include among them -->\n` +
				`${moved}\n</${xsl}stylesheet>\n`;
			edit.createFile(moduleUri, { ignoreIfExists: false });
			edit.insert(moduleUri, new vscode.Position(0, 0), content);
		} else {
			// after the existing declarations of a stylesheet module with the same prefix for XSLT
			const moduleRoot = parseXml(existing);
			if (!moduleRoot || moduleRoot.contentStart === moduleRoot.end || !new RegExp(`^${xsl.replace(/[.-]/g, '\\$&')}(?:stylesheet|transform|package)$`).test(moduleRoot.name)) {
				return undefined;
			}
			const before = existing.substring(0, moduleRoot.contentEnd);
			const lines = before.split('\n');
			const lineText = lines[lines.length - 1];
			// on a line of its own: at the start of the end tag's line, if only whitespace is before it
			const atLineStart = lineText.trim() === '';
			const position = new vscode.Position(lines.length - 1, atLineStart ? 0 : lineText.length);
			edit.insert(moduleUri, position, atLineStart ? `${moved}\n` : `\n${moved}\n`);
		}
		const included = schema.root.children.some((child) => schema.xsltLocal(child) === 'include' && child.attributes.get('href') === module.href);
		elements.forEach((element, i) => {
			if (i === 0 && !included) {
				edit.replace(document.uri, new vscode.Range(document.positionAt(element.start), document.positionAt(element.end)), `<${xsl}include href="${module.href}"/>`);
			} else {
				// with its line, if it's alone on it
				const lineStart = text.lastIndexOf('\n', element.start - 1) + 1;
				const lineEnd = text.indexOf('\n', element.end);
				const alone = text.substring(lineStart, element.start).trim() === '' && text.substring(element.end, lineEnd < 0 ? text.length : lineEnd).trim() === '';
				const start = alone ? lineStart : element.start;
				const end = alone ? (lineEnd < 0 ? text.length : lineEnd + 1) : element.end;
				edit.delete(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)));
			}
		});
		return edit;
	}

	// an element's text, indented with the indent instead of its own: its lines after the first keep their indentation
	// relative to its start tag's - unless that would change a value, e.g. text over more than one line, when they're as
	// they are
	private static reindented(text: string, element: XmlElement, indent: string) {
		const lineStart = text.lastIndexOf('\n', element.start - 1) + 1;
		const own = /^[ \t]*/.exec(text.substring(lineStart, element.start))![0];
		const ownIndent = text.substring(lineStart, element.start) === own ? own : '';
		const isSignificant = (e: XmlElement) => e.attributes.has('xml:space') || e.name.endsWith(':text') || (e.text.includes('\n') && e.text.trim() !== '');
		if ([element, ...descendants(element)].some(isSignificant)) {
			return indent + text.substring(element.start, element.end);
		}
		return text.substring(element.start, element.end).split('\n')
			.map((line, i) => i === 0 ? indent + line : line.trim() === '' ? '' : indent + (ownIndent && line.startsWith(ownIndent) ? line.substring(ownIndent.length) : line)).join('\n');
	}

	// whether an element is within an XSLT element, e.g. xsl:function - or a literal result element within one, e.g. the
	// <a> of <xsl:variable><a>, even with no prefix in a schema with the Schematron namespace as the default
	private static isWithinXslt(schema: Schema, element: XmlElement) {
		for (let e = element.parent; e && e !== schema.root; e = e.parent) {
			if (schema.xsltLocal(e) !== undefined) {
				return true;
			}
		}
		return false;
	}

	// whether a Schematron element is a property, or within one - where SchXslt2 runs an xsl:copy-of
	private static isWithinProperty(schema: Schema, element: XmlElement) {
		for (let e: XmlElement | undefined = element; e; e = e.parent) {
			if (schema.schLocal(e) === 'property') {
				return true;
			}
		}
		return false;
	}

	// the number of commas separating the items of an expression's outermost sequence, e.g. 1 for "., ../b" - not those in
	// brackets, string literals or comments
	public static topLevelCommas(expression: string) {
		let commas = 0;
		let depth = 0;
		let commentDepth = 0;
		let quote = '';
		for (let i = 0; i < expression.length; i++) {
			const c = expression[i];
			const next = expression[i + 1];
			if (commentDepth > 0) {
				if (c === '(' && next === ':') {
					commentDepth++;
					i++;
				} else if (c === ':' && next === ')') {
					commentDepth--;
					i++;
				}
			} else if (quote) {
				if (c === quote) {
					// a doubled quote is the quote itself, e.g. 'it''s'
					if (next === quote) {
						i++;
					} else {
						quote = '';
					}
				}
			} else if (c === '"' || c === '\'') {
				quote = c;
			} else if (c === '(' && next === ':') {
				commentDepth++;
				i++;
			} else if (c === '(' || c === '[' || c === '{') {
				depth++;
			} else if (c === ')' || c === ']' || c === '}') {
				depth--;
			} else if (c === ',' && depth === 0) {
				commas++;
			}
		}
		return commas;
	}

	// a value for an attribute delimited by double quotes
	private static attributeValue(value: string) {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
	}

	// the schema: its outermost element, its prefix for Schematron (with the ':'), and the local names of its Schematron
	// and XSLT elements
	// a schema in another Schematron namespace - e.g. Schematron 1.5's - as ISO Schematron: the ISO namespace, a pattern's
	// name as its title, which SchXslt2 reports, and Schematron 1.5's sch:key as the xsl:key ISO Schematron has instead
	private static toIso(document: vscode.TextDocument, text: string, schema: Schema): vscode.WorkspaceEdit | undefined {
		const rootPrefix = schema.prefix ? schema.prefix.slice(0, -1) : '';
		const oldNamespace = schema.root.attributes.get(rootPrefix ? `xmlns:${rootPrefix}` : 'xmlns');
		if (!oldNamespace) {
			return undefined;
		}
		const edit = new vscode.WorkspaceEdit();
		const range = (start: number, end: number) => new vscode.Range(document.positionAt(start), document.positionAt(end));
		// the namespace, wherever it's declared
		const escaped = oldNamespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		for (const match of text.matchAll(new RegExp(`(\\sxmlns(?::[\\w.-]+)?\\s*=\\s*["'])${escaped}["']`, 'g'))) {
			const start = match.index! + match[1].length;
			edit.replace(document.uri, range(start, start + oldNamespace.length), SchXslt2Checks.isoNamespace);
		}
		const all = [schema.root, ...descendants(schema.root)];
		// a pattern's name: its title
		all.filter((e) => schema.schLocal(e) === 'pattern' && e.attributes.has('name')).forEach((pattern) => SchXslt2Checks.nameToTitle(edit, document, text, schema, pattern));
		// Schematron 1.5's key: xsl:key, with path as use
		const keys = schema.root.children.filter((e) => schema.schLocal(e) === 'key');
		if (keys.length > 0) {
			const declared = [...schema.root.attributes].find(([attribute, uri]) => attribute.startsWith('xmlns:') && uri === SchXslt2Checks.xsltNamespace);
			const xsl = declared ? declared[0].substring('xmlns:'.length) : 'xsl';
			if (!declared) {
				edit.insert(document.uri, document.positionAt(schema.root.start + 1 + schema.root.name.length), ` xmlns:${xsl}="${SchXslt2Checks.xsltNamespace}"`);
			}
			for (const key of keys) {
				// an attribute's value as written, with its references - in double quotes
				const startTag = text.substring(key.start, key.contentStart);
				const value = (attribute: string) => {
					const match = new RegExp(`\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(startTag);
					return match ? (match[1] ?? match[2].replace(/"/g, '&quot;')) : undefined;
				};
				const attributes = [['name', value('name')], ['match', value('match')], ['use', value('path') ?? value('use')]]
					.filter(([, v]) => v !== undefined).map(([n, v]) => ` ${n}="${v}"`).join('');
				edit.replace(document.uri, range(key.start, key.end), `<${xsl}:key${attributes}/>`);
			}
		}
		return edit;
	}

	// Schematron 1.5's name of a pattern - not allowed in ISO Schematron - as its title, which SchXslt2 reports: the attribute
	// as written, with its references, is the title's text. With a title, it's removed
	private static nameToTitle(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, text: string, schema: Schema, pattern: XmlElement) {
		const range = (start: number, end: number) => new vscode.Range(document.positionAt(start), document.positionAt(end));
		const startTag = text.substring(pattern.start, pattern.contentStart);
		const name = /\sname\s*=\s*(["'])([\s\S]*?)\1/.exec(startTag);
		if (!name) {
			return;
		}
		edit.delete(document.uri, range(pattern.start + name.index, pattern.start + name.index + name[0].length));
		if (pattern.children.some((c) => schema.schLocal(c) === 'title')) {
			return;
		}
		const title = `<${schema.prefix}title>${name[2]}</${schema.prefix}title>`;
		if (pattern.contentStart === pattern.end) {
			// <pattern name="..."/>
			edit.replace(document.uri, range(pattern.end - 2, pattern.end), `>${title}</${pattern.name}>`);
		} else {
			// before its content, indented as its first child is
			const indent = /^\s*/.exec(text.substring(pattern.contentStart, pattern.children[0]?.start ?? pattern.contentStart))![0];
			edit.insert(document.uri, document.positionAt(pattern.contentStart), indent + title);
		}
	}

	private static schema(text: string): Schema | undefined {
		const root = parseXml(text);
		if (!root) {
			return undefined;
		}
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		// a schema, or a library - or a file sch:include brings in, e.g. a pattern: an element of a Schematron namespace
		const namespace = root.attributes.get(prefix ? `xmlns:${prefix.slice(0, -1)}` : 'xmlns');
		if (!/^(?:schema|library)$/.test(root.name.substring(prefix.length)) && !(namespace && /schematron/i.test(namespace))) {
			return undefined;
		}
		const xsltPrefix = XslLexer.schXsltPrefix(text) + ':';
		return {
			root, prefix, xsltPrefix,
			schLocal: (element: XmlElement) => (prefix ? element.name.startsWith(prefix) : !element.name.includes(':')) ? element.name.substring(prefix.length) : undefined,
			xsltLocal: (element: XmlElement) => element.name.startsWith(xsltPrefix) ? element.name.substring(xsltPrefix.length) : undefined
		};
	}
}

// a schema: its outermost element, its prefix for Schematron and for XSLT (each with the ':', or '' for none), and the
// local names of its Schematron and XSLT elements (see SchXslt2Checks.schema)
interface Schema {
	root: XmlElement;
	prefix: string;
	xsltPrefix: string;
	schLocal: (element: XmlElement) => string | undefined;
	xsltLocal: (element: XmlElement) => string | undefined;
}
