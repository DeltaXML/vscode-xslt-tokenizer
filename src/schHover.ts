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
import { XmlElement, parseXml, descendants } from './xspecXml';
import { SchReferences, Declared } from './schReferences';
import { SchSchema } from './schSchema';

// Schematron: hover help for reviewing and editing a schema - before the hovers it shares with stylesheets, e.g. a
// function's signature (see XSLTHoverProvider):
// - a reference: is-a, with the abstract pattern's parameters and its rules with this pattern's values in place - as
//   SchXslt2 instantiates it - extends' abstract rule, active's pattern, and an assertion's diagnostics and properties
// - a rule's name: its context and variables, and the earlier rules of its pattern - a node is handled only by the first
//   rule whose context matches it - and an assertion's or report's name: when it's reported, its severity and its
//   diagnostics
// - a variable reference: its sch:let or sch:param - or in an abstract pattern, the parameter and its values
// - another Schematron element's name: its description
export class SchHover {
	private static readonly maxLines = 12;
	private static schemaData = new SchSchema();

	public static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const text = document.getText();
		const root = parseXml(text);
		if (!root) {
			return undefined;
		}
		const context = SchHover.context(document, text, SchHover.prefixOf(root));
		const local = context.local;
		const offset = document.offsetAt(position);
		// the innermost element whose start tag the position is in
		const element = [root, ...descendants(root)].filter((e) => e.start < offset && offset < e.contentStart).pop();
		if (!element || local(element) === undefined) {
			return undefined;
		}
		const name = local(element)!;
		// on the element's name
		if (offset <= element.start + 1 + element.name.length) {
			const markdown = name === 'rule' ? SchHover.ruleHover(context, element) : name === 'assert' || name === 'report' ? SchHover.assertionHover(context, element) :
				SchHover.elementHover(name);
			return markdown ? new vscode.Hover(markdown) : undefined;
		}
		// on a reference
		const references: { [element: string]: string[] } = { active: ['pattern'], pattern: ['is-a'], group: ['is-a'], extends: ['rule'], assert: ['diagnostics', 'properties'], report: ['diagnostics', 'properties'] };
		for (const attribute of references[name] ?? []) {
			const value = SchReferences.attributeValue(text, element, attribute);
			if (!value || offset < value.start || offset > value.end) {
				continue;
			}
			const id = /\S+/.exec(value.value.substring(0, offset - value.start).replace(/^.*\s/, '') + value.value.substring(offset - value.start).replace(/\s.*$/, ''))?.[0];
			const declared = id ? SchReferences.schema(document)?.declared ?? [] : [];
			const markdown = attribute === 'is-a' ? SchHover.isaHover(context, element, id!, declared) : attribute === 'rule' ? SchHover.abstractRuleHover(context, id!, declared) :
				attribute === 'pattern' ? SchHover.patternHover(context, id!, declared) : SchHover.textHover(context, id!, declared, attribute === 'diagnostics' ? 'diagnostic' : 'property');
			return markdown ? new vscode.Hover(markdown) : undefined;
		}
		// on a variable reference, e.g. $max in an XPath attribute
		const variable = document.getWordRangeAtPosition(position, /\$[\w.-]+(?::[\w.-]+)?/);
		if (variable) {
			const markdown = SchHover.variableHover(context, element, document.getText(variable).substring(1));
			return markdown ? new vscode.Hover(markdown) : undefined;
		}
		return undefined;
	}

	// the description of a Schematron element, e.g. sch:pattern
	private static elementHover(name: string) {
		const detail = SchHover.schemaData.elements['sch:' + name]?.detail;
		return detail ? new vscode.MarkdownString().appendCodeblock(`sch:${name}`, 'xml').appendMarkdown(detail) : undefined;
	}

	// a rule: its context, variables and assertions - and the earlier rules of its pattern, which a node is handled by
	// instead, when one matches it first
	private static ruleHover(context: Context, rule: XmlElement) {
		const markdown = new vscode.MarkdownString();
		const ruleContext = rule.attributes.get('context');
		const isAbstract = rule.attributes.get('abstract')?.trim() === 'true';
		markdown.appendCodeblock(isAbstract ? `abstract rule ${rule.attributes.get('id') ?? ''}` : `rule ${ruleContext ?? ''}`, 'xml');
		const lets = SchHover.children(context, rule, 'let').map((l) => `\`$${l.attributes.get('name')}\``);
		const assertions = SchHover.children(context, rule, 'assert').length;
		const reports = SchHover.children(context, rule, 'report').length;
		const extended = SchHover.children(context, rule, 'extends').map((e) => e.attributes.get('rule')).filter((r) => r).map((r) => `\`${r}\``);
		const parts = [`${assertions} assertion${assertions === 1 ? '' : 's'}`, `${reports} report${reports === 1 ? '' : 's'}`];
		markdown.appendMarkdown(`${parts.join(', ')}${lets.length > 0 ? ` - variables ${lets.join(', ')}` : ''}${extended.length > 0 ? ` - extends ${extended.join(', ')}` : ''}`);
		const parent = rule.parent;
		if (isAbstract) {
			markdown.appendMarkdown('\n\nAn abstract rule: its content is copied into each rule that extends it');
		} else if (parent && context.local(parent) === 'pattern') {
			const earlier = SchHover.children(context, parent, 'rule').filter((r) => r.start < rule.start && r.attributes.get('abstract')?.trim() !== 'true');
			if (earlier.length > 0) {
				markdown.appendMarkdown(`\n\n---\nIn a pattern, a node is handled only by the first rule whose context matches it - a node is handled by this rule only if it doesn't match an earlier rule:\n`);
				SchHover.limited(earlier.map((r) => `- \`${SchHover.inline(r.attributes.get('context') ?? '')}\``)).forEach((line) => markdown.appendMarkdown(line + '\n'));
			}
		} else if (parent && context.local(parent) === 'group') {
			markdown.appendMarkdown('\n\nIn a group, every rule whose context matches a node is used');
		}
		return markdown;
	}

	// an assertion or report: when it's reported, its severity, role and flag, and the text of its diagnostics
	private static assertionHover(context: Context, element: XmlElement) {
		const isAssert = context.local(element) === 'assert';
		const markdown = new vscode.MarkdownString();
		markdown.appendCodeblock(`${isAssert ? 'assert' : 'report'} ${SchHover.inline(element.attributes.get('test') ?? '')}`, 'xml');
		markdown.appendMarkdown(isAssert ? 'Reported when the test is **false**' : 'Reported when the test is **true**');
		const severity = element.attributes.get('severity');
		const details = [`severity: ${severity ? `\`${severity}\`` : '`fatal` - SchXslt2\'s default'}`,
			...['role', 'flag', 'id'].filter((a) => element.attributes.has(a)).map((a) => `${a}: \`${element.attributes.get(a)}\``)];
		markdown.appendMarkdown(` - ${details.join(', ')}`);
		const message = SchHover.messageText(context, element);
		if (message) {
			markdown.appendMarkdown('\n\n').appendMarkdown(SchHover.escape(message));
		}
		const declared = (element.attributes.get('diagnostics') ?? '').trim() ? SchReferences.schema(context.document)?.declared ?? [] : [];
		for (const id of (element.attributes.get('diagnostics') ?? '').trim().split(/\s+/).filter((d) => d)) {
			const diagnostic = declared.find((d) => d.local === 'diagnostic' && d.element.attributes.get('id')?.trim() === id);
			markdown.appendMarkdown(`\n\n---\nDiagnostic \`${id}\`: `).appendMarkdown(SchHover.escape(diagnostic ? SchHover.messageText(SchHover.context(context.document, diagnostic.text, SchHover.prefixOf(diagnostic.element)), diagnostic.element) : 'not declared'));
		}
		return markdown;
	}

	// is-a: the abstract pattern's parameters, with the values this pattern gives - and its rules with them in place
	private static isaHover(context: Context, instance: XmlElement, id: string, declared: Declared[]) {
		const kind = context.local(instance)!;
		const template = declared.find((d) => d.local === kind && d.element.attributes.get('id')?.trim() === id && d.element.attributes.get('abstract')?.trim() === 'true');
		if (!template) {
			return undefined;
		}
		const templateContext = SchHover.context(context.document, template.text, SchHover.prefixOf(template.element));
		const supplied = new Map(SchHover.children(context, instance, 'param').map((p) => [p.attributes.get('name')?.trim() ?? '', p.attributes.get('value') ?? '']));
		const params = SchHover.children(templateContext, template.element, 'param');
		const values = new Map<string, string>(params.filter((p) => p.attributes.has('value')).map((p) => [p.attributes.get('name')?.trim() ?? '', p.attributes.get('value')!]));
		supplied.forEach((value, name) => values.set(name, value));
		const markdown = new vscode.MarkdownString();
		markdown.appendCodeblock(`abstract ${kind} ${id}`, 'xml');
		SchHover.documentation(templateContext, template.element, markdown);
		if (params.length > 0) {
			markdown.appendMarkdown('\n\nParameters:\n');
			params.forEach((p) => {
				const name = p.attributes.get('name')?.trim() ?? '';
				const given = supplied.has(name) ? `\`${SchHover.inline(supplied.get(name)!)}\`` : p.attributes.has('value') ? `\`${SchHover.inline(p.attributes.get('value')!)}\` - the default` : '**not supplied**';
				markdown.appendMarkdown(`- \`$${name}\`: ${given}\n`);
			});
		} else if (supplied.size > 0) {
			markdown.appendMarkdown('\n\nParameters:\n');
			supplied.forEach((value, name) => markdown.appendMarkdown(`- \`$${name}\`: \`${SchHover.inline(value)}\`\n`));
		}
		// its rules as SchXslt2 instantiates them: each parameter replaced by its value, as text
		const lines = SchHover.children(templateContext, template.element, 'rule').flatMap((rule) => [
			`- rule \`${SchHover.inline(SchHover.instantiate(rule.attributes.get('context') ?? '', values))}\``,
			...[...SchHover.children(templateContext, rule, 'assert'), ...SchHover.children(templateContext, rule, 'report')].map((a) =>
				`  - ${templateContext.local(a)} \`${SchHover.inline(SchHover.instantiate(a.attributes.get('test') ?? '', values))}\``)
		]);
		if (lines.length > 0) {
			markdown.appendMarkdown('\n---\nWith these values:\n');
			SchHover.limited(lines).forEach((line) => markdown.appendMarkdown(line + '\n'));
		}
		return markdown;
	}

	// extends: the abstract rule's variables and assertions, as they're copied into the rule
	private static abstractRuleHover(context: Context, id: string, declared: Declared[]) {
		const rule = declared.find((d) => d.local === 'rule' && d.element.attributes.get('id')?.trim() === id);
		if (!rule) {
			return undefined;
		}
		const ruleContext = SchHover.context(context.document, rule.text, SchHover.prefixOf(rule.element));
		const markdown = new vscode.MarkdownString();
		markdown.appendCodeblock(`abstract rule ${id}`, 'xml');
		markdown.appendMarkdown('Copied into this rule:\n');
		const lines = rule.element.children.map((child) => {
			const childName = ruleContext.local(child);
			return childName === 'let' ? `- let \`$${child.attributes.get('name')}\`${child.attributes.has('value') ? ` := \`${SchHover.inline(child.attributes.get('value')!)}\`` : ''}` :
				childName === 'assert' || childName === 'report' ? `- ${childName} \`${SchHover.inline(child.attributes.get('test') ?? '')}\`` :
					childName === 'extends' ? `- extends \`${child.attributes.get('rule') ?? child.attributes.get('href')}\`` : undefined;
		}).filter((line): line is string => !!line);
		SchHover.limited(lines).forEach((line) => markdown.appendMarkdown(line + '\n'));
		return markdown;
	}

	// active: the pattern's title and documentation, and its rules
	private static patternHover(context: Context, id: string, declared: Declared[]) {
		const pattern = declared.find((d) => (d.local === 'pattern' || d.local === 'group') && d.element.attributes.get('id')?.trim() === id);
		if (!pattern) {
			return undefined;
		}
		const patternContext = SchHover.context(context.document, pattern.text, SchHover.prefixOf(pattern.element));
		const markdown = new vscode.MarkdownString();
		markdown.appendCodeblock(`${pattern.element.attributes.get('abstract')?.trim() === 'true' ? 'abstract ' : ''}${pattern.local} ${id}`, 'xml');
		SchHover.documentation(patternContext, pattern.element, markdown);
		const isA = pattern.element.attributes.get('is-a');
		const rules = SchHover.children(patternContext, pattern.element, 'rule').map((r) => `- rule \`${SchHover.inline(r.attributes.get('context') ?? r.attributes.get('id') ?? '')}\``);
		if (isA) {
			markdown.appendMarkdown(`\n\nAn instance of the abstract pattern \`${isA}\``);
		} else if (rules.length > 0) {
			markdown.appendMarkdown('\n\nRules:\n');
			SchHover.limited(rules).forEach((line) => markdown.appendMarkdown(line + '\n'));
		}
		return markdown;
	}

	// a diagnostic's or property's text
	private static textHover(context: Context, id: string, declared: Declared[], kind: string) {
		const target = declared.find((d) => d.local === kind && d.element.attributes.get('id')?.trim() === id);
		if (!target) {
			return undefined;
		}
		return new vscode.MarkdownString().appendCodeblock(`${kind} ${id}`, 'xml')
			.appendMarkdown(SchHover.escape(SchHover.messageText(SchHover.context(context.document, target.text, SchHover.prefixOf(target.element)), target.element)));
	}

	// a variable reference: its sch:let or sch:param - in the element's rule, pattern or phase, the schema, or an abstract
	// rule the rule extends - or in an abstract pattern, its parameter, with the values each pattern with is-a gives it
	private static variableHover(context: Context, element: XmlElement, name: string) {
		const ancestors: XmlElement[] = [];
		for (let e: XmlElement | undefined = element; e; e = e.parent) {
			ancestors.push(e);
		}
		const markdown = new vscode.MarkdownString();
		const abstractPattern = ancestors.find((a) => (context.local(a) === 'pattern' || context.local(a) === 'group') && a.attributes.get('abstract')?.trim() === 'true');
		if (abstractPattern) {
			const id = abstractPattern.attributes.get('id')?.trim();
			const root = ancestors[ancestors.length - 1];
			const instances = [root, ...descendants(root)].filter((p) => p.attributes.get('is-a')?.trim() === id);
			markdown.appendCodeblock(`$${name}`, 'xml').appendMarkdown(`Parameter of the abstract ${context.local(abstractPattern)} \`${id}\` - replaced, as text, by each value:\n`);
			const lines = instances.map((instance) => {
				const value = SchHover.children(context, instance, 'param').find((p) => p.attributes.get('name')?.trim() === name)?.attributes.get('value');
				return `- \`${instance.attributes.get('id') ?? context.local(instance)}\`: ${value !== undefined ? `\`${SchHover.inline(value)}\`` : 'not supplied'}`;
			});
			SchHover.limited(lines.length > 0 ? lines : ['- no pattern has is-a for it']).forEach((line) => markdown.appendMarkdown(line + '\n'));
			return markdown;
		}
		// the nearest declaration: in the element's ancestors - or a phase's, which are global
		const candidates = ancestors.flatMap((a) => [...SchHover.children(context, a, 'let'), ...SchHover.children(context, a, 'param')].map((d) => ({ d, scope: a })));
		const root = ancestors[ancestors.length - 1];
		SchHover.children(context, root, 'phase').forEach((phase) => SchHover.children(context, phase, 'let').forEach((d) => candidates.push({ d, scope: phase })));
		let found = candidates.find(({ d }) => d.attributes.get('name')?.trim() === name);
		if (!found) {
			// an abstract rule the element's rule extends
			const rule = ancestors.find((a) => context.local(a) === 'rule');
			const extended = rule ? SchHover.children(context, rule, 'extends').map((e) => e.attributes.get('rule')?.trim()) : [];
			const abstractRule = [root, ...descendants(root)].find((r) => context.local(r) === 'rule' && extended.includes(r.attributes.get('id')?.trim()) &&
				SchHover.children(context, r, 'let').some((l) => l.attributes.get('name')?.trim() === name));
			const declaration = abstractRule ? SchHover.children(context, abstractRule, 'let').find((l) => l.attributes.get('name')?.trim() === name) : undefined;
			found = declaration && abstractRule ? { d: declaration, scope: abstractRule } : undefined;
		}
		if (!found) {
			return undefined;
		}
		const { d, scope } = found;
		const value = d.attributes.get('value');
		const as = d.attributes.get('as');
		markdown.appendCodeblock(`${context.local(d)} $${name}${as ? ` as ${as}` : ''}${value !== undefined ? ` := ${SchHover.inline(value)}` : ''}`, 'xml');
		const scopeName = context.local(scope);
		const where = scopeName === 'rule' ? `the rule \`${SchHover.inline(scope.attributes.get('context') ?? scope.attributes.get('id') ?? '')}\`` :
			scopeName === 'schema' || scopeName === 'library' ? 'the schema - global' : `the ${scopeName} \`${scope.attributes.get('id') ?? ''}\`${scopeName === 'phase' ? ' - global, when the phase is chosen' : ''}`;
		markdown.appendMarkdown(`${value === undefined ? 'Its value is its content - ' : ''}Declared in ${where}`);
		return markdown;
	}

	// the title and paragraphs of a pattern, phase or rule
	private static documentation(context: Context, element: XmlElement, markdown: vscode.MarkdownString) {
		const parts = [...SchHover.children(context, element, 'title'), ...SchHover.children(context, element, 'p')].map((e) => SchHover.messageText(context, e)).filter((t) => t);
		if (parts.length > 0) {
			markdown.appendMarkdown(SchHover.escape(parts.join('\n\n')));
		}
	}

	// a message's text - with sch:value-of as {select}, and sch:name as {name()}, or {name(path)}
	private static messageText(context: Context, element: XmlElement) {
		const content = context.text.substring(element.contentStart, element.contentEnd);
		const prefix = context.prefix.replace(/[.-]/g, '\\$&');
		return content
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(new RegExp(`<${prefix}value-of\\s[^>]*?select\\s*=\\s*(["'])([^"']*)\\1[^>]*>`, 'g'), '{$2}')
			.replace(new RegExp(`<${prefix}name\\s[^>]*?path\\s*=\\s*(["'])([^"']*)\\1[^>]*>`, 'g'), '{name($2)}')
			.replace(new RegExp(`<${prefix}name\\s*/>`, 'g'), '{name()}')
			.replace(/<[^>]*>/g, '')
			.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&')
			.replace(/\s+/g, ' ').trim();
	}

	// a value with each abstract pattern parameter, e.g. $ctx, replaced by its value - the longest names first, as SchXslt2 does
	private static instantiate(value: string, values: Map<string, string>) {
		return [...values.keys()].sort((a, b) => b.length - a.length).reduce((result, name) =>
			result.replace(new RegExp(`\\$${name.replace(/[.-]/g, '\\$&')}(?![\\w.-])`, 'g'), () => values.get(name)!), value);
	}

	private static children(context: Context, element: XmlElement, name: string) {
		return element.children.filter((child) => context.local(child) === name);
	}

	// the prefix for Schematron of the file an element is in - its outermost element's, with the ':' - '' for none
	private static prefixOf(element: XmlElement) {
		let root = element;
		while (root.parent) {
			root = root.parent;
		}
		const colon = root.name.indexOf(':');
		return colon > 0 ? root.name.substring(0, colon + 1) : '';
	}

	// a file's text, with its prefix for Schematron and the local names of its Schematron elements
	private static context(document: vscode.TextDocument, text: string, prefix: string): Context {
		const local = (element: XmlElement | undefined) => element && (prefix ? element.name.startsWith(prefix) : !element.name.includes(':')) ?
			element.name.substring(prefix.length) : undefined;
		return { document, text, prefix, local };
	}

	// text for Markdown, with its Markdown characters escaped - not appendText, which writes spaces as &nbsp;
	private static escape(text: string) {
		return text.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, '\\$&');
	}

	// an expression on one line
	private static inline(value: string) {
		return value.replace(/\s+/g, ' ').trim().replace(/`/g, '\'');
	}

	private static limited(lines: string[]) {
		return lines.length > SchHover.maxLines ? [...lines.slice(0, SchHover.maxLines), `- … and ${lines.length - SchHover.maxLines} more`] : lines;
	}
}

interface Context {
	document: vscode.TextDocument;
	text: string;
	prefix: string;
	local: (element: XmlElement | undefined) => string | undefined;
}
