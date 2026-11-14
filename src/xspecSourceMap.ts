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
import * as path from 'path';
import { XSpecTests, XSpecTestNode, XSpecRunnerTemplate } from './xspecTests';
import { DebugSourceMap } from './debugSourceMap';

// The lines of an XSpec file and of the test runner compiled from it, for debugging an XSpec file (see
// XsltDebugAdapterProcess): a breakpoint on an x:scenario, x:call, x:context or x:expect is set where the runner does
// that - and where the runner pauses is shown in the XSpec file. Lines are 1-based, as the debug adapter's
//
// - x:scenario: its template
// - x:call or x:context: the scenario's $x:result variable, which calls the stylesheet under test
// - x:expect: the expectation's outcome, tested with $x:result
export class XSpecSourceMap implements DebugSourceMap {
	public readonly noStepMessage = 'XSpec: no step here - set a breakpoint on an x:scenario, x:call, x:context or x:expect';
	public get generatedPath() {
		return this.runnerPath;
	}
	// a breakpoint's line in the runner, by its line in the XSpec file
	private readonly runnerLines = new Map<number, number>();
	// the runner's lines for an element of the XSpec file - the innermost range is the element paused at
	private readonly ranges: { first: number, last: number, xspecLine: number }[] = [];

	constructor(public readonly xspecPath: string, xspecText: string, public readonly runnerPath: string, runnerText: string) {
		const xspecLine = XSpecSourceMap.lineOf(xspecText);
		const runnerLine = XSpecSourceMap.lineOf(runnerText);
		// the runner's templates for this file - not for the XSpec files it imports - by their labels
		const templates = new Map<string, XSpecRunnerTemplate>();
		XSpecTests.runnerTemplates(runnerText).filter((template) => !template.file || XSpecSourceMap.samePath(template.file, xspecPath)).forEach((template) => {
			templates.set(XSpecSourceMap.uniqueKey(templates, XSpecTests.key(undefined, template.labelPath)), template);
		});
		const seen = new Map<string, unknown>();
		const visit = (node: XSpecTestNode) => {
			const key = XSpecSourceMap.uniqueKey(seen, XSpecTests.key(undefined, node.labelPath));
			seen.set(key, true);
			const template = templates.get(key);
			if (template) {
				const nodeLine = xspecLine(node.start);
				this.ranges.push({ first: runnerLine(template.start), last: runnerLine(template.end), xspecLine: nodeLine });
				const step = template.step ? { first: runnerLine(template.step.start), last: runnerLine(template.step.end) } : undefined;
				if (node.kind === 'expect') {
					this.runnerLines.set(nodeLine, step?.first ?? runnerLine(template.start));
				} else {
					this.runnerLines.set(nodeLine, runnerLine(template.start));
					if (step && node.callStart !== undefined) {
						const callLine = xspecLine(node.callStart);
						this.runnerLines.set(callLine, step.first);
						this.ranges.push({ ...step, xspecLine: callLine });
					}
				}
			}
			node.children.forEach(visit);
		};
		XSpecTests.testTree(xspecText).forEach(visit);
	}

	public static load(xspecPath: string, runnerPath: string): XSpecSourceMap | undefined {
		try {
			return new XSpecSourceMap(xspecPath, fs.readFileSync(xspecPath, 'utf8'), runnerPath, fs.readFileSync(runnerPath, 'utf8'));
		} catch {
			return undefined;
		}
	}

	// the same file - e.g. on macOS, /var/folders/… and /private/var/folders/…, its real path, which the debugger gives
	public static samePath(a: string, b: string) {
		const real = (p: string) => {
			try {
				return fs.realpathSync(p);
			} catch {
				return path.normalize(p);
			}
		};
		return a === b || real(a).toLowerCase() === real(b).toLowerCase();
	}

	public isSource(file: string): boolean {
		return XSpecSourceMap.samePath(file, this.xspecPath);
	}

	public generatedLines(_sourcePath: string, line: number): number[] | undefined {
		const runnerLine = this.runnerLine(line);
		return runnerLine === undefined ? undefined : [runnerLine];
	}

	public sourceOf(generatedLine: number): { path: string, line: number } | undefined {
		const line = this.xspecLine(generatedLine);
		return line === undefined ? undefined : { path: this.xspecPath, line };
	}

	public runnerLine(xspecLine: number): number | undefined {
		return this.runnerLines.get(xspecLine);
	}

	// the runner's lines for the XSpec file's steps: where a step in the runner stops (the debugger's stepStops)
	public stepLines(): number[] {
		return [...new Set(this.runnerLines.values())].sort((a, b) => a - b);
	}

	// the XSpec file's line for a line of the runner - undefined if it's not in a scenario's or expectation's template
	public xspecLine(runnerLine: number): number | undefined {
		const containing = this.ranges.filter((range) => range.first <= runnerLine && runnerLine <= range.last);
		containing.sort((a, b) => (a.last - a.first) - (b.last - b.first));
		return containing[0]?.xspecLine;
	}

	// the key, with an occurrence number if it's already used, as XSpecTestController numbers repeated labels
	private static uniqueKey(used: Map<string, unknown>, key: string) {
		let unique = key;
		for (let n = 2; used.has(unique); n++) {
			unique = `${key}\u001f#${n}`;
		}
		return unique;
	}

	// a function for the 1-based line of an offset in the text
	private static lineOf(text: string): (offset: number) => number {
		const lineStarts = [0];
		for (let i = text.indexOf('\n'); i > -1; i = text.indexOf('\n', i + 1)) {
			lineStarts.push(i + 1);
		}
		return (offset: number) => {
			let low = 0;
			let high = lineStarts.length - 1;
			while (low < high) {
				const middle = Math.ceil((low + high) / 2);
				if (lineStarts[middle] <= offset) {
					low = middle;
				} else {
					high = middle - 1;
				}
			}
			return low + 1;
		};
	}
}
