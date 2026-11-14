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
import { XmlElement, parseXml, descendants, decodeReferences } from './xspecXml';
import { HrefPaths } from './hrefPaths';
import { SchIncludes } from './schIncludes';
import { SchematronContext } from './schematronContext';
import { SchematronValidation, SchematronResult } from './schematronValidation';
import { XSpecTests } from './xspecTests';

// an assertion or report of a rule
interface SchAssertion {
	kind: 'assert' | 'report';
	id?: string;
	test: string;
	// its message, as written - each sch:value-of, sch:name and so on as '…'
	message: string;
	file: string;
	element: XmlElement;
}

// a rule of the schema, as SchXslt2 assembles it - with the id it has there (see xslt-resources/schematron/xspec-data.xsl)
interface SchRule {
	id: string;
	context: string;
	// the id of its pattern or group, if it has one - which tells rules with the same context apart
	pattern?: string;
	isAbstract: boolean;
	file: string;
	element: XmlElement;
	// its own assertions and reports, and those of the abstract rules it extends
	assertions: SchAssertion[];
}

// what a scenario is for: a rule - each of its assertions and reports - or one assertion, for a node where it fails
// (reports: is reported) or passes (isn't reported)
interface Target {
	rule: SchRule;
	assertion?: SchAssertion;
	outcome?: 'fails' | 'passes';
	// the node, in the XML context file - its SVRL location
	location: string;
}

// a fragment of the XML context file, for a scenario: the node, with its ancestors - or its siblings, or the whole
// document - and where the node is in it
interface Fragment {
	text: string;
	nodeOffset: number;
	level: 0 | 1 | 2;
}

// Schematron: XSpec tests generated for a schema, from its XML context file (see SchematronContext): for a rule, an
// assertion or report, or each rule of the schema. Each scenario's x:context is a node the rule fires for, with its
// ancestors, and its expectations are the schema's results for that data - found by running the schema on it, so the
// tests pass when they're made, describing what the schema does: to be reviewed. For an assertion, a node where it fails
// and one where it passes - with more of the document when the node with its ancestors alone doesn't, e.g. for an id
// that must be unique. With no data the rule fires for - or no Saxon - a pending scenario, to be completed
export class SchematronTests {
	public static readonly command = 'xslt-xpath.createSchematronXSpec';
	private static readonly levels = ['with its ancestors', 'with its siblings and ancestors', 'the whole document'];

	public static codeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
		if (document.uri.scheme !== 'file') {
			return [];
		}
		const text = document.getText();
		const root = parseXml(text);
		const offset = document.offsetAt(range.start);
		const element = root ? [root, ...descendants(root)].filter((e) => e.start < offset && offset < e.contentStart).pop() : undefined;
		if (!root || !element) {
			return [];
		}
		const local = SchematronTests.localOf(root);
		const name = local(element);
		let title: string | undefined;
		if (element === root && (name === 'schema' || name === 'library' || name === 'pattern')) {
			title = 'Create XSpec tests: a scenario for each rule, from the XML context file';
		} else if (name === 'rule' && element.attributes.get('abstract')?.trim() !== 'true' && element.attributes.has('context')) {
			title = `Create XSpec scenario for the rule ${element.attributes.get('context')!.trim()}, from the XML context file`;
		} else if ((name === 'assert' || name === 'report') && element.attributes.has('test')) {
			const id = element.attributes.get('id')?.trim();
			title = `Create XSpec scenarios for the ${name === 'assert' ? 'assertion' : 'report'}${id ? ` ${id}` : ''}: where it ${name === 'assert' ? 'fails and passes' : 'is reported and isn\'t'}`;
		}
		if (!title) {
			return [];
		}
		const action = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
		action.command = { command: SchematronTests.command, title, arguments: [document.uri, element === root ? undefined : element.start] };
		return [action];
	}

	// the command: the scenarios for the element at the offset - each rule, without one - added to the schema's XSpec file
	public static async create(uri: vscode.Uri, offset?: number): Promise<vscode.TextEditor | undefined> {
		const schema = SchematronContext.schemaOf(uri);
		if (!schema) {
			return undefined;
		}
		const rules = SchematronTests.rulesOf(schema);
		const elementStart = offset;
		const targetRule = elementStart === undefined ? undefined : rules.find((r) => r.file === uri.fsPath && r.element.start === elementStart);
		const targetAssertion = elementStart === undefined || targetRule ? undefined :
			rules.flatMap((r) => r.assertions).find((a) => a.file === uri.fsPath && a.element.start === elementStart);
		if (elementStart !== undefined && !targetRule && !targetAssertion) {
			return undefined;
		}
		// Saxon reads the files: those with unsaved changes are saved
		for (const document of vscode.workspace.textDocuments.filter((d) => d.isDirty && d.languageId === 'sch')) {
			await document.save();
		}
		const xspecUri = await SchematronTests.xspecFor(schema);
		const existing = fs.existsSync(xspecUri.fsPath) ? fs.readFileSync(xspecUri.fsPath, 'utf8') : '';
		const contextFile = SchematronContext.contextFor(schema)?.file;
		const scenarios = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Schematron: creating XSpec scenarios' },
			() => SchematronTests.scenarios(schema, rules, targetRule, targetAssertion, contextFile, existing));
		if (scenarios.length === 0) {
			vscode.window.showInformationMessage(`XSpec: ${path.basename(xspecUri.fsPath)} has a scenario for each rule of the schema already.`);
		}
		return SchematronTests.addScenarios(xspecUri, schema, scenarios);
	}

	// the scenarios' XSpec text - with their data and expectations from running the schema, with Saxon, else pending
	public static async scenarios(schema: string, rules: SchRule[], targetRule: SchRule | undefined, targetAssertion: SchAssertion | undefined, contextFile: string | undefined,
		existing: string): Promise<string[]> {
		const forRules = targetRule ? [targetRule] : targetAssertion ? SchematronTests.rulesWith(rules, targetAssertion) :
			rules.filter((r) => !r.isAbstract && !new RegExp(`label\\s*=\\s*["']${SchematronTests.regExpEscape(SchematronTests.attribute(SchematronTests.ruleLabel(r)))}[:"']`).test(existing));
		const contextText = contextFile ? SchIncludes.textOf(contextFile) : undefined;
		const run = contextFile && contextText !== undefined ? await SchematronValidation.schemaResults(schema, [{ file: contextFile }]) : undefined;
		const report = run?.reports?.[0];
		if (!contextFile || contextText === undefined || !report) {
			const why = !contextFile ? 'the schema has no XML context file' : run?.problem ?? 'the XML context file can\'t be read';
			return forRules.map((rule) => SchematronTests.pending(rule, targetAssertion, why));
		}
		const results = SchematronValidation.results(report);
		const fired = SchematronTests.firedIn(results);
		// a rule's context as SchXslt2 has it - e.g. with an abstract pattern's parameters replaced
		const firedContexts = new Map((parseXml(report)?.children ?? []).filter((e) => e.name.replace(/^.*:/, '') === 'fired-rule' && e.attributes.has('id'))
			.map((e) => [e.attributes.get('id')!, e.attributes.get('context') ?? ''] as [string, string]));
		// the targets: a node the rule fires for - for an assertion, where it fails and where it passes
		const targets: Target[] = [];
		const pendingRules: SchRule[] = [];
		for (const rule of forRules) {
			const locations = fired.get(rule.id) ?? [];
			if (locations.length === 0) {
				pendingRules.push(rule);
			} else if (!targetAssertion) {
				targets.push({ rule, location: locations[0] });
			} else {
				const at = locations.filter((location) => SchematronTests.has(results, targetAssertion, location));
				const notAt = locations.filter((location) => !SchematronTests.has(results, targetAssertion, location));
				if (at.length > 0) {
					targets.push({ rule, assertion: targetAssertion, outcome: 'fails', location: at[0] });
				}
				if (notAt.length > 0) {
					targets.push({ rule, assertion: targetAssertion, outcome: 'passes', location: notAt[0] });
				}
			}
		}
		if (targetAssertion && targets.length > 1) {
			// one of each outcome
			const seen = new Set<string>();
			targets.splice(0, targets.length, ...targets.filter((t) => !seen.has(t.outcome!) && seen.add(t.outcome!)));
		}
		// each target's fragment, widened until it has the outcome it's for: validated all together, at each level
		const done = new Map<Target, { fragment: Fragment, results: SchematronResult[] }>();
		for (const level of [0, 1, 2] as const) {
			const remaining = targets.filter((t) => !done.has(t));
			if (remaining.length === 0) {
				break;
			}
			const fragments = remaining.map((t) => SchematronTests.fragment(contextText, t.location, level));
			const checked = await SchematronValidation.schemaResults(schema, fragments.map((f) => ({ text: f?.text ?? '<empty/>' })));
			remaining.forEach((target, i) => {
				const fragment = fragments[i];
				const fragmentResults = checked.reports?.[i] ? SchematronValidation.results(checked.reports[i]) : undefined;
				if (fragment && fragmentResults && (SchematronTests.reproduces(target, fragment, fragmentResults) || level === 2)) {
					done.set(target, { fragment, results: fragmentResults });
				}
			});
		}
		const scenarios = targets.filter((t) => done.has(t)).map((t) => SchematronTests.scenario(t, done.get(t)!.fragment, done.get(t)!.results, contextFile, firedContexts.get(t.rule.id)));
		return scenarios.concat(pendingRules.map((rule) => SchematronTests.pending(rule, targetAssertion, `no node in ${path.basename(contextFile)} fires it`)));
	}

	// the elements of the schema, in the order SchXslt2 has them: with the files sch:include brings in included, in place of
	// each sch:include - each with its file, and the function for the local names of the Schematron elements in it
	public static assembled(schema: string): { file: string, element: XmlElement, local: (e: XmlElement) => string | undefined }[] {
		const elements: { file: string, element: XmlElement, local: (e: XmlElement) => string | undefined }[] = [];
		const visit = (file: string, element: XmlElement, local: (e: XmlElement) => string | undefined, seen: Set<string>) => {
			const name = local(element);
			if (name === 'include' && element.attributes.has('href')) {
				const included = HrefPaths.toPath(element.attributes.get('href')!.trim(), file);
				const text = included && !seen.has(included) ? SchIncludes.textOf(included) : undefined;
				const root = text !== undefined ? parseXml(text) : undefined;
				if (root) {
					visit(included!, root, SchematronTests.localOf(root), new Set([...seen, included!]));
				}
				return;
			}
			elements.push({ file, element, local });
			element.children.forEach((child) => visit(file, child, local, seen));
		};
		const text = SchIncludes.textOf(schema);
		const root = text !== undefined ? parseXml(text) : undefined;
		if (root) {
			visit(schema, root, SchematronTests.localOf(root), new Set([schema]));
		}
		return elements;
	}

	// the rules of the schema, in the order SchXslt2 has them, with the files sch:include brings in included - and the ids
	// xspec-data.xsl gives those without one
	public static rulesOf(schema: string): SchRule[] {
		const elements = SchematronTests.assembled(schema);
		if (elements.length === 0) {
			return [];
		}
		const ruleElements = elements.filter((e) => e.local(e.element) === 'rule');
		const assertionsOf = (entry: typeof elements[number]) => entry.element.children.filter((c) => entry.local(c) === 'assert' || entry.local(c) === 'report').map((c): SchAssertion => ({
			kind: entry.local(c) as 'assert' | 'report', id: c.attributes.get('id')?.trim() || undefined, test: c.attributes.get('test') ?? '',
			message: SchematronTests.messageOf(SchIncludes.textOf(entry.file) ?? '', c), file: entry.file, element: c
		}));
		const rules = ruleElements.map((entry, i): SchRule => ({
			id: entry.element.attributes.get('id')?.trim() || `vscode-rule-${i + 1}`,
			context: entry.element.attributes.get('context')?.trim() ?? '',
			pattern: entry.element.parent?.attributes.get('id')?.trim() || undefined,
			isAbstract: entry.element.attributes.get('abstract')?.trim() === 'true',
			file: entry.file, element: entry.element, assertions: assertionsOf(entry)
		}));
		// and the assertions of the abstract rules each extends, as SchXslt2 copies them into it
		ruleElements.forEach((entry, i) => entry.element.children.filter((c) => entry.local(c) === 'extends' && c.attributes.has('rule')).forEach((extend) => {
			const extended = rules.find((r) => r.isAbstract && r.id === extend.attributes.get('rule')!.trim());
			if (extended) {
				rules[i].assertions.push(...extended.assertions);
			}
		}));
		return rules;
	}

	// the rules an assertion is used in: its own - or for one of an abstract rule, those that extend it
	private static rulesWith(rules: SchRule[], assertion: SchAssertion): SchRule[] {
		return rules.filter((r) => !r.isAbstract && r.assertions.includes(assertion));
	}

	// for each rule's id, the nodes it fires for - from the report xspec-data.xsl adds to it
	private static firedIn(results: SchematronResult[]): Map<string, string[]> {
		const fired = new Map<string, string[]>();
		results.filter((r) => r.kind === 'report' && r.id?.startsWith('vscode-fired:')).forEach((r) => {
			const id = r.id!.substring('vscode-fired:'.length);
			fired.set(id, [...(fired.get(id) ?? []), r.location]);
		});
		return fired;
	}

	// whether the assertion failed - or the report was reported - at the location: by its id, else its test
	private static has(results: SchematronResult[], assertion: SchAssertion, location: string): boolean {
		return results.some((r) => r.kind === assertion.kind && r.location === location && !r.id?.startsWith('vscode-fired:') &&
			(assertion.id ? r.id === assertion.id : !r.id && r.test?.replace(/\s+/g, ' ').trim() === assertion.test.replace(/\s+/g, ' ').trim()));
	}

	// the node, in the context file's text, at the SVRL location - an attribute's, or a text node's, is its element
	private static elementAt(text: string, location: string): XmlElement | undefined {
		const found = SchematronValidation.locate(text, location);
		const root = parseXml(text);
		return found && root ? [root, ...descendants(root)].filter((e) => e.start < found.start && found.start < e.contentStart).pop() : undefined;
	}

	// the node at the location, with its ancestors - or with the siblings at its level too, or the whole document
	public static fragment(text: string, location: string, level: 0 | 1 | 2): Fragment | undefined {
		const element = SchematronTests.elementAt(text, location);
		if (!element) {
			return undefined;
		}
		const ancestors: XmlElement[] = [];
		for (let e = element.parent; e; e = e.parent) {
			ancestors.unshift(e);
		}
		// the elements whose start tags are written - with the element written whole, as it is, within them
		const whole = level === 0 || ancestors.length === 0 ? element : level === 1 ? ancestors[ancestors.length - 1] : ancestors[0];
		const opened = ancestors.slice(0, ancestors.indexOf(whole) === -1 ? ancestors.length : ancestors.indexOf(whole));
		const step = '  ';
		let result = '';
		opened.forEach((a, i) => result += (i > 0 ? '\n' : '') + step.repeat(i) + text.substring(a.start, a.contentStart));
		const indent = step.repeat(opened.length);
		const wholeOffset = result.length + (opened.length > 0 ? 1 + indent.length : 0);
		result += (opened.length > 0 ? '\n' + indent : '') + SchematronTests.reindented(text, whole, indent);
		[...opened].reverse().forEach((a, i) => result += '\n' + step.repeat(opened.length - 1 - i) + `</${a.name}>`);
		// the node's offset: within the element written whole, as reindented
		const nodeOffset = wholeOffset + SchematronTests.reindented(text, whole, indent, element.start).length;
		return { text: result, nodeOffset, level };
	}

	// the element's text, as written, with the lines after its first indented by the indent instead of its own - up to
	// the offset, if one is given
	private static reindented(text: string, element: XmlElement, indent: string, upTo?: number): string {
		const lineStart = text.lastIndexOf('\n', element.start - 1) + 1;
		const own = /^[ \t]*/.exec(text.substring(lineStart, element.start))![0];
		const written = text.substring(element.start, upTo ?? element.end);
		return written.split('\n').map((line, i) => i === 0 ? line : indent + (line.startsWith(own) ? line.substring(own.length) : line.trimStart())).join('\n');
	}

	// whether the fragment has the outcome the target is for, at its node
	private static reproduces(target: Target, fragment: Fragment, results: SchematronResult[]): boolean {
		const at = SchematronTests.locationsOfNode(fragment, results);
		const fired = results.some((r) => r.id === `vscode-fired:${target.rule.id}` && at.has(r.location));
		if (!target.assertion) {
			return fired;
		}
		const has = [...at].some((location) => SchematronTests.has(results, target.assertion!, location));
		return target.outcome === 'fails' ? has : fired && !has;
	}

	// the SVRL locations, in the fragment's results, that are its node
	private static locationsOfNode(fragment: Fragment, results: SchematronResult[]): Set<string> {
		return new Set(results.map((r) => r.location).filter((location) => SchematronTests.elementAt(fragment.text, location)?.start === fragment.nodeOffset));
	}

	// a scenario for the target: its data, and its expectations - the schema's results for it
	private static scenario(target: Target, fragment: Fragment, results: SchematronResult[], contextFile: string, firedContext: string | undefined): string {
		const at = SchematronTests.locationsOfNode(fragment, results);
		const nodeLocation = [...at][0];
		const where = `${path.basename(contextFile)} ${SchematronTests.readablePath(target.location)}`;
		const label = target.assertion ? `${target.assertion.id ?? target.assertion.kind} ${target.assertion.kind === 'assert' ? target.outcome : target.outcome === 'fails' ? 'is reported' : 'isn\'t reported'}: ${where}` :
			`${SchematronTests.ruleLabel(target.rule, firedContext)}: ${where}`;
		// with more of the document, the expectations are for its node
		const location = fragment.level > 0 && nodeLocation && !/Q\{[^}]/.test(nodeLocation) ? nodeLocation.replace(/Q\{\}/g, '') : undefined;
		const assertions = target.assertion ? [target.assertion] : target.rule.assertions;
		const expectations = assertions.map((a) => {
			const reported = [...at].map((l) => results.find((r) => r.kind === a.kind && r.location === l && !r.id?.startsWith('vscode-fired:') &&
				(a.id ? r.id === a.id : !r.id && r.test?.replace(/\s+/g, ' ').trim() === a.test.replace(/\s+/g, ' ').trim()))).find((r) => r);
			const expect = `expect-${reported ? '' : 'not-'}${a.kind}`;
			const labelAttribute = ` label="${SchematronTests.attribute(SchematronTests.shortened(a.message))}"`;
			const locationAttribute = location ? ` location="${SchematronTests.attribute(location)}"` : '';
			if (a.id) {
				return `<x:${expect} id="${SchematronTests.attribute(a.id)}"${locationAttribute}${labelAttribute}/>`;
			}
			// with no id: by its message, when it's reported - else there's nothing to tell it from the others
			return reported ? `<x:${expect}${locationAttribute}${labelAttribute}>${SchematronTests.text(reported.text)}</x:${expect}>` :
				`<!-- not reported: ${SchematronTests.comment(a.kind)} ${SchematronTests.comment(SchematronTests.shortened(a.message))} - with no id, an expectation can't tell it from another -->`;
		});
		const step = '   ';
		const data = SchematronTests.forXSpec(fragment.text).split('\n').map((line) => step.repeat(2) + line).join('\n');
		return [`<x:scenario label="${SchematronTests.attribute(label)}">`,
			`${step}<!-- generated from ${SchematronTests.comment(where)}, ${SchematronTests.levels[fragment.level]}: the expectations are the schema's results for it -->`,
			`${step}<x:context>`, data, `${step}</x:context>`,
			...expectations.map((e) => step + e),
			'</x:scenario>'].join('\n');
	}

	// a pending scenario for the rule - an element its context names, if it's a name - to be completed
	private static pending(rule: SchRule, assertion: SchAssertion | undefined, why: string): string {
		const step = '   ';
		const name = /^[\w.-]+(?::[\w.-]+)?$/.test(rule.context) ? rule.context : undefined;
		const assertions = assertion ? [assertion] : rule.assertions;
		return [`<x:scenario label="${SchematronTests.attribute(SchematronTests.ruleLabel(rule))}" pending="${SchematronTests.attribute(why)}">`,
			`${step}<x:context>`, `${step.repeat(2)}${name ? `<${name}/>` : `<!-- a node the rule ${SchematronTests.comment(rule.context)} fires for -->`}`, `${step}</x:context>`,
			...assertions.map((a) => a.id ? `${step}<x:expect-not-${a.kind} id="${SchematronTests.attribute(a.id)}" label="${SchematronTests.attribute(SchematronTests.shortened(a.message))}"/>` :
				`${step}<!-- ${SchematronTests.comment(a.kind)} ${SchematronTests.comment(SchematronTests.shortened(a.message))} -->`),
			'</x:scenario>'].join('\n');
	}

	// a rule as a scenario's label: its context - as SchXslt2 has it, when it's known - and its pattern's id
	private static ruleLabel(rule: SchRule, firedContext?: string): string {
		return `rule ${firedContext || rule.context}${rule.pattern ? ` in ${rule.pattern}` : ''}`;
	}

	// the XSpec file whose schematron attribute names the schema - else a new one beside it
	public static async xspecFor(schema: string): Promise<vscode.Uri> {
		const uris = await vscode.workspace.findFiles('**/*.xspec', '**/node_modules/**');
		vscode.workspace.textDocuments.filter((d) => d.languageId === 'xspec' && d.uri.scheme === 'file' && !uris.some((u) => u.fsPath === d.fileName)).forEach((d) => uris.push(d.uri));
		for (const uri of uris) {
			const text = SchIncludes.textOf(uri.fsPath);
			const href = text !== undefined ? /<(?:[\w.-]+:)?description\b[^>]*?\sschematron\s*=\s*(["'])(.*?)\1/.exec(text)?.[2] : undefined;
			if (href && HrefPaths.toPath(href, uri.fsPath) === schema) {
				return uri;
			}
		}
		const base = path.join(path.dirname(schema), path.basename(schema, path.extname(schema)));
		return vscode.Uri.file(fs.existsSync(base + '.xspec') ? base + '-schematron.xspec' : base + '.xspec');
	}

	// the scenarios added to the XSpec file - a new one, if it isn't there - before its closing tag
	private static async addScenarios(xspecUri: vscode.Uri, schema: string, scenarios: string[]): Promise<vscode.TextEditor> {
		if (!fs.existsSync(xspecUri.fsPath)) {
			const href = path.relative(path.dirname(xspecUri.fsPath), schema).split(path.sep).join('/');
			fs.writeFileSync(xspecUri.fsPath, `<?xml version="1.0" encoding="UTF-8"?>\n<x:description xmlns:x="${XSpecTests.namespace}"\n               schematron="${SchematronTests.attribute(href)}">\n</x:description>\n`);
		}
		const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(xspecUri));
		if (scenarios.length === 0) {
			return editor;
		}
		const text = editor.document.getText();
		const root = parseXml(text);
		const prefix = root?.name.includes(':') ? root.name.substring(0, root.name.indexOf(':')) : '';
		const step = '   ';
		const written = scenarios.map((s) => s.replace(/<(\/?)x:/g, `<$1${prefix ? prefix + ':' : ''}`).split('\n').map((line) => step + line).join('\n'));
		const closing = text.lastIndexOf(`</${prefix ? prefix + ':' : ''}description`);
		const at = editor.document.positionAt(closing > -1 ? closing : text.length);
		const lineStart = new vscode.Position(at.line, 0);
		const onOwnLine = /^\s*$/.test(editor.document.getText(new vscode.Range(lineStart, at)));
		await editor.edit((edit) => edit.insert(onOwnLine ? lineStart : at, (onOwnLine ? '' : '\n') + '\n' + written.join('\n\n') + '\n'));
		return editor;
	}

	// SVRL's location, as it reads: /orders/order[2] for /Q{}orders[1]/Q{}order[2]
	private static readablePath(location: string): string {
		return location.replace(/Q\{[^}]*\}/g, '').replace(/\[1\]/g, '');
	}

	// a message, as written: the text, with each element in it - sch:value-of, sch:name and so on - as '…'
	private static messageOf(text: string, element: XmlElement): string {
		const content = text.substring(element.contentStart, element.contentEnd);
		return decodeReferences(content.replace(/<!--[\s\S]*?-->/g, '').replace(/<([\w.:-]+)\b[^>]*\/>|<([\w.:-]+)\b[^>]*>[\s\S]*?<\/\2>/g, '…')).replace(/\s+/g, ' ').trim();
	}

	private static shortened(message: string): string {
		return message.length > 70 ? message.substring(0, 69).trimEnd() + '…' : message;
	}

	// the fragment for x:context - whose attributes XSpec has as attribute value templates: their braces doubled
	private static forXSpec(fragment: string): string {
		return fragment.replace(/<[^!?/][^>]*>/g, (tag) => tag.replace(/(=\s*)(["'])([\s\S]*?)\2/g, (_m, eq: string, quote: string, value: string) => eq + quote + value.replace(/[{}]/g, (c) => c + c) + quote));
	}

	public static localOf(root: XmlElement): (e: XmlElement) => string | undefined {
		const colon = root.name.indexOf(':');
		const prefix = colon > 0 ? root.name.substring(0, colon + 1) : '';
		return (e) => (prefix ? e.name.startsWith(prefix) : !e.name.includes(':')) ? e.name.substring(prefix.length) : undefined;
	}

	private static attribute(value: string): string {
		return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
	}

	private static text(value: string): string {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
	}

	private static comment(value: string): string {
		return value.replace(/--/g, '- -');
	}

	private static regExpEscape(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
