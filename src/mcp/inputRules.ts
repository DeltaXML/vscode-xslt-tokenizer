/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as path from 'path';
import { McpRoot } from './mcpRoot';
import { OutputOrigin } from './outputOrigin';
import { XsltNodeRules } from '../xsltNodeRules';
import { XmlElement } from '../xspecXml';
import { RunRequest, RunOutcome } from './runRequest';

export interface RulesResult {
	text: string;
	isError: boolean;
}

type Processed = NonNullable<ReturnType<typeof XsltNodeRules.recorded>>['elements'] extends Map<number, infer T> ? T : never;

// The input_rules tool: for an input file of the last debug session in the window (Run and Debug, or Run Without
// Debugging, with SaxonJ), what processed its elements - the template rules, the xsl:for-each, xsl:for-each-group and
// xsl:iterate instructions, and the built-in rules where no template matched - as the input file's hover shows it
export class InputRules {
	private static readonly maxListed = 20;

	// file: the input file; line: of an element's start tag, from 1; xpath: an element's path in the simple form the tools
	// give, e.g. /orders/order[2] - optionally ending /@name or /text() for that node of it
	// stylesheet: the one to ask the user to run, if there's no run of the input, or it has changed since - by default, the
	// last run's; waitForRunSeconds: how long to wait for the user to run it - 0 not to ask
	public static async describe(file: string, line?: number, xpath?: string, stylesheet?: string, waitForRunSeconds = RunRequest.defaultWait): Promise<RulesResult> {
		const inputPath = InputRules.resolve(file);
		const target = stylesheet ? InputRules.resolve(stylesheet) : RunRequest.lastRun()?.xsltFile;
		const why = RunRequest.whyRun(XsltNodeRules.hasRecord() && !!XsltNodeRules.recorded(inputPath), target, inputPath);
		const outcome: RunOutcome | undefined = why && target ? await RunRequest.ask(target, inputPath, why, 'which templates processed its input', waitForRunSeconds) : undefined;
		const note = why && !target ? `Note: ${why} - give the stylesheet, to ask the user to run it.` : RunRequest.note(outcome, why);
		const result = InputRules.describeNow(inputPath, line, xpath);
		return note && outcome !== 'ran' ? { ...result, text: `${result.text}\n\n${note}` } : outcome === 'ran' ? { ...result, text: `${note}\n\n${result.text}` } : result;
	}

	private static describeNow(inputPath: string, line?: number, xpath?: string): RulesResult {
		if (!XsltNodeRules.hasRecord()) {
			return {
				text: 'No run recorded in this window: input_rules uses the last debug session - run the stylesheet in VS Code with Run and Debug, ' +
					'or Run Without Debugging (SaxonJ), first. The record is kept until the next run, or until VS Code is restarted.',
				isError: true
			};
		}
		const recorded = XsltNodeRules.recorded(inputPath);
		if (!recorded) {
			return {
				text: `The last run didn't record ${InputRules.shown(inputPath)}: it records the input files the stylesheet processed nodes of - its ` +
					'source, and files read with doc() or document(). Run it on this file, or check the path. (A file changed outside VS Code since the run is dropped.)',
				isError: true
			};
		}
		const lineStarts = XsltNodeRules.lineStarts(recorded.text);
		const lineOf = (offset: number) => {
			let lo = 0;
			let hi = lineStarts.length - 1;
			while (lo < hi) {
				const mid = (lo + hi + 1) >> 1;
				if (lineStarts[mid] <= offset) {
					lo = mid;
				} else {
					hi = mid - 1;
				}
			}
			return lo + 1;
		};
		const run = `in the last run${recorded.session ? ` (${recorded.session})` : ''}`;
		if (line === undefined && xpath === undefined) {
			return { text: InputRules.summary(inputPath, recorded, lineOf, run), isError: false };
		}
		let element: XmlElement | undefined;
		let nodeStep: string | undefined;
		if (xpath !== undefined) {
			const found = InputRules.byPath(recorded.all[0], xpath.trim());
			if (typeof found === 'string') {
				return { text: found, isError: true };
			}
			({ element, nodeStep } = found);
		} else {
			if (line! < 1 || line! > lineStarts.length) {
				return { text: `${InputRules.shown(inputPath)} has ${lineStarts.length} lines - no line ${line}`, isError: true };
			}
			const lineStart = lineStarts[line! - 1];
			const lineEnd = line! < lineStarts.length ? lineStarts[line!] : recorded.text.length;
			element = recorded.all.find((e) => e.start >= lineStart && e.start < lineEnd) ?? recorded.all.find((e) => e.start < lineStart && e.contentStart > lineStart);
			if (!element) {
				return { text: `No start tag on line ${line} of ${InputRules.shown(inputPath)} - give the line of an element's start tag, or its path`, isError: true };
			}
		}
		const ordinal = recorded.all.indexOf(element!);
		const where = `${OutputOrigin.path(element!)}${nodeStep ?? ''} (line ${lineOf(element!.start)})`;
		const lines = [`Input ${InputRules.shown(inputPath)}: ${where}, ${run}:`];
		let processed = recorded.elements.get(ordinal) ?? [];
		if (nodeStep) {
			processed = processed.filter((p) => p.nodeText === nodeStep.substring(1));
		}
		if (processed.length === 0) {
			lines.push(nodeStep ? `  Nothing processed ${nodeStep.substring(1)} of this element.` :
				'  No rule processed it: no xsl:apply-templates, xsl:for-each, xsl:for-each-group or xsl:iterate selected it. An XPath expression may still have read it, e.g. in xsl:value-of.');
			for (let e = element!.parent; e && !nodeStep; e = e.parent) {
				const ancestor = recorded.elements.get(recorded.all.indexOf(e))?.filter((p) => p.node.startsWith('element:'));
				if (ancestor && ancestor.length > 0) {
					lines.push(`  Its nearest ancestor processed by a rule: ${OutputOrigin.path(e)} (line ${lineOf(e.start)}) - ${ancestor.map((p) => InputRules.rule(p)).join(', ')}`);
					break;
				}
			}
		} else {
			// the element first, then its attributes, text etc.
			const order = (node: string) => node.startsWith('element:') ? 0 : node.startsWith('attribute:') ? 1 : 2;
			const byNode = new Map<string, Processed>();
			[...processed].sort((a, b) => order(a.node) - order(b.node)).forEach((p) => byNode.set(p.nodeText, [...(byNode.get(p.nodeText) ?? []), p]));
			// a rule on the node's line - several, each on a line of its own
			for (const [node, rules] of byNode) {
				lines.push(rules.length === 1 ? `  ${node}: ${InputRules.rule(rules[0])}` : `  ${node}:\n${rules.map((p) => `    ${InputRules.rule(p)}`).join('\n')}`);
			}
			if (processed.every((p) => p.builtIn)) {
				const effects = [...new Set(processed.map((p) => InputRules.effect(p.builtInRule)))];
				lines.push('', `Only built-in rules processed it: no template rule matched it in that mode - ${effects.join('; ')}. If a template was meant to, check its match pattern and mode.`);
			}
		}
		lines.push('', 'Rules are as Saxon applied them in that run; a stylesheet changed since may differ. Run it again to update.');
		return { text: lines.join('\n'), isError: false };
	}

	// the file's elements: how many each rule processed, and those only built-in rules did
	private static summary(inputPath: string, recorded: NonNullable<ReturnType<typeof XsltNodeRules.recorded>>, lineOf: (offset: number) => number, run: string): string {
		const total = recorded.all.length;
		const byRule = new Map<string, { label: string, elements: number, times: number }>();
		const builtInOnly: number[] = [];
		let byRules = 0;
		for (const [ordinal, processed] of recorded.elements) {
			if (processed.every((p) => p.builtIn)) {
				builtInOnly.push(ordinal);
			} else {
				byRules++;
			}
			const seen = new Set<string>();
			for (const p of processed.filter((q) => !q.builtIn)) {
				const key = InputRules.rule({ ...p, count: 1 });
				const entry = byRule.get(key) ?? { label: key, elements: 0, times: 0 };
				if (!seen.has(key)) {
					entry.elements++;
					seen.add(key);
				}
				entry.times += p.count;
				byRule.set(key, entry);
			}
		}
		const lines = [`Input ${InputRules.shown(inputPath)}, ${run}: ${total} elements - ${byRules} processed by a template rule or an instruction ` +
			`(or their attributes or text were), ${builtInOnly.length} only by built-in rules, ${total - byRules - builtInOnly.length} not selected by any.`];
		if (byRule.size > 0) {
			lines.push('', 'Template rules and instructions that processed its nodes:');
			[...byRule.values()].sort((a, b) => b.elements - a.elements).slice(0, InputRules.maxListed)
				.forEach((r) => lines.push(`  ${r.label}: ${r.elements} element${r.elements === 1 ? '' : 's'}${r.times > r.elements ? ` (${r.times} times)` : ''}`));
			if (byRule.size > InputRules.maxListed) {
				lines.push(`  ... ${byRule.size - InputRules.maxListed} more`);
			}
		}
		if (builtInOnly.length > 0) {
			// the topmost: an element's descendants that only built-in rules processed too are counted with it - the built-in
			// rule went on to them, so the element is where to look
			// - only through a parent that only built-in rules processed: an element a template processed breaks the chain
			const topmost: { ordinal: number, path: string, descendants: number }[] = [];
			const chainOf = new Map<XmlElement, { ordinal: number, path: string, descendants: number }>();
			for (const ordinal of [...builtInOnly].sort((a, b) => a - b)) {
				const element = recorded.all[ordinal];
				const chain = element.parent ? chainOf.get(element.parent) : undefined;
				if (chain) {
					chain.descendants++;
					chainOf.set(element, chain);
				} else {
					const entry = { ordinal, path: OutputOrigin.path(element), descendants: 0 };
					topmost.push(entry);
					chainOf.set(element, entry);
				}
			}
			lines.push('', 'Only built-in rules - no template matched them:');
			topmost.slice(0, InputRules.maxListed).forEach(({ ordinal, path, descendants }) => {
				const element = recorded.all[ordinal];
				const processed = recorded.elements.get(ordinal)!;
				const modes = [...new Set(processed.map((p) => p.label))];
				const effects = [...new Set(processed.map((p) => InputRules.effect(p.builtInRule)))];
				lines.push(`  ${path} (line ${lineOf(element.start)}): ${modes.join(', ')} - ${effects.join('; ')}${descendants > 0 ? ` - and its ${descendants} ${descendants === 1 ? 'descendant' : 'descendants'}` : ''}`);
			});
			if (topmost.length > InputRules.maxListed) {
				lines.push(`  ... ${topmost.length - InputRules.maxListed} more`);
			}
		}
		lines.push('', 'Give a line or a path (e.g. /orders/order[2], as evaluate_xpath and output_origin give them) for what processed an element and its attributes and text.');
		return lines.join('\n');
	}

	// what a built-in rule does with an element (XSLT 3.0's on-no-match values)
	private static effect(builtInRule: string | undefined): string {
		switch (builtInRule) {
			// as Saxon names it, and as XSLT's on-no-match does
			case 'text-only':
			case 'text-only-copy': return 'its text is copied to the output as it is';
			case 'shallow-copy': return 'it is copied to the output, and its content processed';
			case 'deep-copy': return 'it is copied to the output with its content';
			case 'shallow-skip': return 'it is skipped, and its content processed';
			case 'deep-skip': return 'it is skipped with its content';
			case 'fail': return 'the run fails (XTDE0555)';
			default: return `built-in rule ${builtInRule ?? ''}`.trim();
		}
	}

	// e.g. 'match="order" mode="summary" - report.xsl:12 ×2'
	private static rule(p: Processed[number]): string {
		const where = p.path && p.line ? ` - ${InputRules.shown(p.path)}:${p.line}` : '';
		return `${p.label}${p.builtIn ? '' : where}${p.count > 1 ? ` ×${p.count}` : ''}`;
	}

	// an element by a path in the simple form: /name/name[n]/..., optionally ending /@name or /text() - or why not
	private static byPath(root: XmlElement, xpath: string): { element: XmlElement, nodeStep?: string } | string {
		const steps = xpath.replace(/^\//, '').split('/');
		let nodeStep: string | undefined;
		const last = steps[steps.length - 1];
		if (/^@[\w.:-]+$|^text\(\)$/.test(last)) {
			nodeStep = '/' + last;
			steps.pop();
		}
		const simple = /^([\w.-]+(?::[\w.-]+)?)(?:\[(\d+)\])?$/;
		if (!xpath.startsWith('/') || steps.some((s) => !simple.test(s))) {
			return `Give an element's path in the simple form /orders/order[2] - names, with a position where siblings share a name - or its line. ` +
				'For another XPath, use evaluate_xpath on the input file first: it gives each node\'s line.';
		}
		let current: XmlElement[] = [root];
		let element: XmlElement | undefined;
		for (const [k, step] of steps.entries()) {
			const [, name, position] = simple.exec(step)!;
			const candidates = (k === 0 ? current : current.flatMap((e) => e.children)).filter((e) => e.name === name);
			element = candidates[(position ? parseInt(position, 10) : 1) - 1];
			if (!element) {
				return `No element ${'/' + steps.slice(0, k + 1).join('/')} in the input file`;
			}
			current = [element];
		}
		return { element: element!, nodeStep };
	}

	private static resolve(file: string): string {
		const folder = McpRoot.current();
		return path.isAbsolute(file) || !folder ? path.resolve(file) : path.resolve(folder, file);
	}

	private static shown(file: string): string {
		const folder = McpRoot.current();
		return folder && file.startsWith(folder + path.sep) ? path.relative(folder, file) : file;
	}
}
