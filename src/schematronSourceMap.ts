/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as fs from 'fs';
import { XmlElement, parseXml, descendants } from './xspecXml';
import { DebugSourceMap, lineOf } from './debugSourceMap';
import { SchematronTests } from './schematronTests';
import { SchIncludes } from './schIncludes';
import { XSpecSourceMap } from './xspecSourceMap';

// The lines of a Schematron schema - and the files sch:include brings in - and of the stylesheet SchXslt2 compiles it to
// for debugging (see xslt-resources/schematron/debug-compile.xsl), whose rules, assertions and reports have ids:
// - rule: its svrl:fired-rule, where the rule fires for a node - in its template, for each copy, e.g. for each pattern
//   with is-a for an abstract pattern
// - assert and report: the xsl:if that tests it, which reports it - for each copy, e.g. in each rule that extends an
//   abstract rule
// - let: its xsl:variable in the rule's template - or the schema's, its global parameter
// - value-of in a message: its xsl:value-of
// A source line can have more than one generated line - and a generated line in a step's element is shown at the step's
export class SchematronSourceMap implements DebugSourceMap {
	public readonly noStepMessage = 'Schematron: no step here - set a breakpoint on a rule, let, assert or report, or a value-of in a message';
	// for each source file, by its path: for each line, the generated lines
	private readonly lines = new Map<string, Map<number, number[]>>();
	// the generated lines of each step - the innermost containing a line is the step paused at
	private readonly ranges: { first: number, last: number, path: string, line: number }[] = [];
	private readonly stops = new Set<number>();
	// the names the schema - with the files it includes - declares with sch:let and sch:param
	private readonly declared = new Set<string>();
	// each rule's template, for each copy: its name - with an abstract pattern's instance - and the instance's parameters
	private readonly templates: { first: number, last: number, name: string, parameters?: { name: string, value: string }[] }[] = [];
	// the patterns - and groups - not active in the phase, with their lines in their files
	private readonly inactive: { path: string, first: number, last: number, id: string }[] = [];
	// the phase's id - the one the schema's defaultPhase names, for '#DEFAULT'
	private phaseId: string | undefined;
	// where each assertion fails, and each report succeeds - its xsl:sequence of the SVRL element - with the id
	private readonly failedAsserts = new Map<number, string>();
	private readonly successfulReports = new Map<number, string>();
	// what's said when paused at one: its message, and its severity - else role - as the validation's problem has it
	private static readonly outcomeMessage = (variable: string) => `normalize-space(string-join($${variable}/*[local-name() = 'text']))`;
	private static readonly outcomeRole = (variable: string) => `string(($${variable}/@severity, $${variable}/@role)[1])`;
	public readonly outcomes = [
		{
			filter: 'schematronFailedAssert', label: 'Failed Assertions', description: 'Pause at each Schematron assertion that fails - for those with the roles or severities in the condition (e.g. error fatal), if any',
			map: this.failedAsserts, variable: 'failed-assert'
		},
		{
			filter: 'schematronSuccessfulReport', label: 'Successful Reports', description: 'Pause at each Schematron report that succeeds - for those with the roles or severities in the condition (e.g. warning), if any',
			map: this.successfulReports, variable: 'successful-report'
		}
	].map((o) => ({
		filter: o.filter, label: o.label, description: o.description, message: SchematronSourceMap.outcomeMessage(o.variable), role: SchematronSourceMap.outcomeRole(o.variable),
		get lines() {
			return [...o.map.keys()];
		},
		id: (line: number) => o.map.get(line)
	}));

	// phase: the phase the schema is compiled with - its id, '#ALL' or '#DEFAULT'
	constructor(public readonly schemaPath: string, public readonly generatedPath: string, generatedText: string, private readonly phase = '#DEFAULT') {
		const generatedLine = lineOf(generatedText);
		const sourceLines = new Map<string, (offset: number) => number>();
		const sourceLine = (file: string, element: XmlElement) => {
			if (!sourceLines.has(file)) {
				sourceLines.set(file, lineOf(SchIncludes.textOf(file) ?? ''));
			}
			return sourceLines.get(file)!(element.start);
		};
		const add = (file: string, element: XmlElement, generated: XmlElement, range: XmlElement = generated) => {
			const line = sourceLine(file, element);
			const target = generatedLine(generated.start);
			const forFile = this.lines.get(file) ?? new Map<number, number[]>();
			forFile.set(line, [...new Set([...(forFile.get(line) ?? []), target])]);
			this.lines.set(file, forFile);
			this.ranges.push({ first: generatedLine(range.start), last: generatedLine(range.end), path: file, line });
			this.stops.add(target);
		};
		// the schema, as SchXslt2 has it: its rules', assertions' and reports' ids, as debug-compile.xsl gives them
		const entries = SchematronTests.assembled(schemaPath);
		entries.filter((entry) => entry.local(entry.element) === 'let' || entry.local(entry.element) === 'param').forEach((entry) => {
			const name = entry.element.attributes.get('name')?.trim();
			if (name) {
				this.declared.add(name);
			}
		});
		const rules = new Map<string, typeof entries[number]>();
		const assertions = new Map<string, typeof entries[number]>();
		let ruleCount = 0;
		let schemaRuleCount = 0;
		let assertionCount = 0;
		entries.forEach((entry) => {
			const name = entry.local(entry.element);
			if (name === 'rule') {
				ruleCount++;
				// numbered as validate.xsl numbers the schema's - and those of the files it includes, in all
				const inSchema = XSpecSourceMap.samePath(entry.file, schemaPath);
				schemaRuleCount += inSchema ? 1 : 0;
				const id = entry.element.attributes.get('id')?.trim() || (inSchema ? `vscode-rule-${schemaRuleCount}` : `vscode-irule-${ruleCount}`);
				if (!rules.has(id)) {
					rules.set(id, entry);
				}
			} else if (name === 'assert' || name === 'report') {
				assertionCount++;
				const id = entry.element.attributes.get('id')?.trim() || `vscode-assert-${assertionCount}`;
				if (!assertions.has(id)) {
					assertions.set(id, entry);
				}
			}
		});
		// the patterns and groups, by their ids - as validate.xsl gives them, for the schema's
		const patterns = new Map<string, typeof entries[number]>();
		let schemaPatternCount = 0;
		let schemaGroupCount = 0;
		entries.forEach((entry) => {
			const name = entry.local(entry.element);
			if (name === 'pattern' || name === 'group') {
				const inSchema = XSpecSourceMap.samePath(entry.file, schemaPath);
				const count = name === 'pattern' ? (schemaPatternCount += inSchema ? 1 : 0) : (schemaGroupCount += inSchema ? 1 : 0);
				const id = entry.element.attributes.get('id')?.trim() || (inSchema ? `vscode-${name}-${count}` : undefined);
				if (id && !patterns.has(id)) {
					patterns.set(id, entry);
				}
			}
		});
		// those not active in the phase: SchXslt2 has no templates for them
		const schemaRoot = entries[0]?.element;
		const phaseId = this.phaseId = this.phase === '#DEFAULT' ? schemaRoot?.attributes.get('defaultPhase')?.trim() : this.phase === '#ALL' ? undefined : this.phase;
		const phaseEntry = phaseId ? entries.find((entry) => entry.local(entry.element) === 'phase' && entry.element.attributes.get('id')?.trim() === phaseId) : undefined;
		if (phaseEntry) {
			const active = new Set(phaseEntry.element.children.filter((c) => phaseEntry.local(c) === 'active').map((c) => c.attributes.get('pattern')?.trim()));
			// an abstract pattern is active with an instance of it
			const instancesActive = (id: string) => [...patterns.values()].some((p) => p.element.attributes.get('is-a')?.trim() === id && active.has(p.element.attributes.get('id')?.trim()));
			patterns.forEach((entry, id) => {
				const isAbstract = entry.element.attributes.get('abstract')?.trim() === 'true';
				if (isAbstract ? !instancesActive(id) : !active.has(id)) {
					const text = SchIncludes.textOf(entry.file) ?? '';
					const line = lineOf(text);
					this.inactive.push({ path: entry.file, first: line(entry.element.start), last: line(entry.element.end), id: entry.element.attributes.get('id')?.trim() ?? id });
				}
			});
		}
		const root = parseXml(generatedText);
		if (!root) {
			return;
		}
		const local = (e: XmlElement) => e.name.replace(/^.*:/, '');
		const isXslt = (e: XmlElement) => !e.name.includes(':');
		const ancestor = (e: XmlElement, name: string) => {
			for (let a = e.parent; a; a = a.parent) {
				if (isXslt(a) && local(a) === name) {
					return a;
				}
			}
			return undefined;
		};
		const generated = descendants(root);
		// the rules: where each fires for a node - and its template, for the steps in it that aren't the schema's
		generated.filter((e) => e.name === 'svrl:fired-rule' && e.attributes.has('id')).forEach((fired) => {
			const rule = rules.get(fired.attributes.get('id')!);
			const template = ancestor(fired, 'template');
			if (!rule || !template) {
				return;
			}
			this.ranges.push({ first: generatedLine(template.start), last: generatedLine(template.end), path: rule.file, line: sourceLine(rule.file, rule.element) });
			add(rule.file, rule.element, fired, fired);
			// its pattern - for an abstract pattern's rule, the instance it's for - as SchXslt2 reports it: a breakpoint on
			// the pattern's line pauses where its rules fire
			const patternId = descendants(template).map((e) => e.attributes.get('patternId')).find((id) => id);
			const pattern = patternId ? patterns.get(patternId) : undefined;
			if (pattern) {
				add(pattern.file, pattern.element, fired, fired);
			}
			const abstractId = pattern?.element.attributes.get('is-a')?.trim();
			const abstractPattern = abstractId ? patterns.get(abstractId) : undefined;
			const parameters = pattern && abstractPattern ? abstractPattern.element.children.filter((c) => abstractPattern.local(c) === 'param').map((p) => {
				const name = p.attributes.get('name')?.trim() ?? '';
				const given = pattern.element.children.find((c) => pattern.local(c) === 'param' && c.attributes.get('name')?.trim() === name);
				return { name: '$' + name, value: given?.attributes.get('value') ?? p.attributes.get('value') ?? '(not supplied)' };
			}) : undefined;
			this.templates.push({
				first: generatedLine(template.start), last: generatedLine(template.end), parameters,
				name: `rule ${fired.attributes.get('context') ?? rule.element.attributes.get('context') ?? ''}${abstractId ? ` - ${patternId} (is-a ${abstractId})` : ''}`
			});
			// its sch:let - and those of the abstract rules it extends, copied into it - as variables, in order, by name
			const lets = this.letsOf(rule, rules);
			const variables = descendants(template).filter((v) => isXslt(v) && local(v) === 'variable' && !v.attributes.get('name')!.startsWith('Q{') &&
				!ancestor(v, 'map-entry') && !v.name.includes(':') && ![...SchematronSourceMap.ancestors(v)].some((a) => a.name.startsWith('svrl:')));
			let next = 0;
			lets.forEach((l) => {
				const name = l.element.attributes.get('name')?.trim();
				const index = variables.findIndex((v, i) => i >= next && v.attributes.get('name') === name);
				if (index > -1) {
					add(l.file, l.element, variables[index]);
					next = index + 1;
				}
			});
		});
		// the assertions and reports: the xsl:if that tests each - and the value-of in its message
		generated.filter((e) => (e.name === 'svrl:failed-assert' || e.name === 'svrl:successful-report') && e.attributes.has('id')).forEach((reported) => {
			const assertion = assertions.get(reported.attributes.get('id')!);
			const test = ancestor(reported, 'if');
			if (!assertion || !test) {
				return;
			}
			add(assertion.file, assertion.element, test);
			// where it's reported - having failed, or succeeded for a report - with its SVRL element, as a variable
			const variable = reported.name === 'svrl:failed-assert' ? 'failed-assert' : 'successful-report';
			const output = test.children.find((c) => isXslt(c) && local(c) === 'sequence' && c.attributes.get('select')?.trim() === '$' + variable);
			if (output) {
				(variable === 'failed-assert' ? this.failedAsserts : this.successfulReports).set(generatedLine(output.start), reported.attributes.get('id')!);
			}
			const message = reported.children.find((c) => c.name === 'svrl:text');
			const generatedValues = message ? descendants(message).filter((v) => isXslt(v) && local(v) === 'value-of') : [];
			const values = descendants(assertion.element).filter((v) => assertion.local(v) === 'value-of');
			const normalized = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim();
			// on a line of its own: on the assertion's line, a breakpoint is the test's
			const assertionLine = sourceLine(assertion.file, assertion.element);
			values.forEach((v, i) => {
				if (generatedValues[i] && normalized(generatedValues[i].attributes.get('select')) === normalized(v.attributes.get('select')) && sourceLine(assertion.file, v) !== assertionLine) {
					add(assertion.file, v, generatedValues[i]);
				}
			});
		});
		// the schema's global sch:let and sch:param, and its phases' sch:let: the stylesheet's global parameters
		const globals = entries.filter((entry) => (entry.local(entry.element) === 'let' || entry.local(entry.element) === 'param') &&
			entry.element.parent && ['schema', 'library', 'phase'].includes(entry.local(entry.element.parent) ?? ''));
		root.children.filter((c) => isXslt(c) && (local(c) === 'param' || local(c) === 'variable')).forEach((global) => {
			const declaration = globals.find((g) => g.element.attributes.get('name')?.trim() === global.attributes.get('name'));
			if (declaration) {
				add(declaration.file, declaration.element, global);
			}
		});
	}

	public static load(schemaPath: string, generatedPath: string, phase?: string): SchematronSourceMap | undefined {
		try {
			return new SchematronSourceMap(schemaPath, generatedPath, fs.readFileSync(generatedPath, 'utf8'), phase);
		} catch {
			return undefined;
		}
	}

	// a rule's sch:let - and those of the abstract rules it extends, in turn - with their files
	private letsOf(rule: { file: string, element: XmlElement, local: (e: XmlElement) => string | undefined }, rules: Map<string, { file: string, element: XmlElement, local: (e: XmlElement) => string | undefined }>,
		seen = new Set<XmlElement>()): { file: string, element: XmlElement }[] {
		if (seen.has(rule.element)) {
			return [];
		}
		seen.add(rule.element);
		return rule.element.children.flatMap((c) => {
			const name = rule.local(c);
			if (name === 'let') {
				return [{ file: rule.file, element: c }];
			}
			const extended = name === 'extends' ? rules.get(c.attributes.get('rule')?.trim() ?? '') : undefined;
			return extended ? this.letsOf(extended, rules, seen) : [];
		});
	}

	private static * ancestors(element: XmlElement) {
		for (let a = element.parent; a; a = a.parent) {
			yield a;
		}
	}

	public isSource(file: string): boolean {
		return [...this.lines.keys()].some((source) => XSpecSourceMap.samePath(source, file)) || XSpecSourceMap.samePath(file, this.schemaPath);
	}

	public sources(): string[] {
		return [...this.lines.keys()];
	}

	public generatedLines(sourcePath: string, line: number): number[] | undefined {
		const file = [...this.lines.keys()].find((source) => XSpecSourceMap.samePath(source, sourcePath));
		return file ? this.lines.get(file)!.get(line) : undefined;
	}

	public sourceOf(generatedLine: number): { path: string, line: number, name?: string } | undefined {
		const containing = this.ranges.filter((range) => range.first <= generatedLine && generatedLine <= range.last);
		containing.sort((a, b) => (a.last - a.first) - (b.last - b.first));
		return containing[0] ? { path: containing[0].path, line: containing[0].line, name: this.templateAt(generatedLine)?.name } : undefined;
	}

	// the rule's template the line is in
	private templateAt(generatedLine: number) {
		return this.templates.find((t) => t.first <= generatedLine && generatedLine <= t.last);
	}

	// paused in a rule of an abstract pattern's instance: the instance's parameters, as text, replaced in its copy
	public readonly hidesBuiltInRules = true;

	public parametersAt(generatedLine: number): { scope: string, variables: { name: string, value: string }[] } | undefined {
		const template = this.templateAt(generatedLine);
		return template?.parameters ? { scope: 'Parameters', variables: template.parameters } : undefined;
	}

	// a breakpoint in a pattern that isn't active in the phase: why it has no step
	public noStepMessageFor(sourcePath: string, line: number): string | undefined {
		const pattern = this.inactive.filter((p) => XSpecSourceMap.samePath(p.path, sourcePath) && p.first <= line && line <= p.last).pop();
		return pattern ? `Schematron: the pattern ${pattern.id} isn't active in the phase ${this.phaseId}` : undefined;
	}

	public stepLines(): number[] {
		return [...this.stops].sort((a, b) => a - b);
	}

	// in a frame paused in the schema, SchXslt2's own variables, e.g. $schxslt:severity - shown by their local names, as
	// they're declared with EQNames: those the schema doesn't declare with sch:let or sch:param
	public isHiddenVariable(name: string): boolean {
		return !this.declared.has(name.replace(/^\$/, '').replace(/ \(tunnel\)$/, ''));
	}
}
