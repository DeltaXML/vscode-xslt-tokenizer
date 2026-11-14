/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

// The lines of source files, and of the stylesheet generated from them that the debugger runs - e.g. an XSpec file's test
// runner (see XSpecSourceMap), or a Schematron schema's compiled stylesheet (see SchematronSourceMap): a breakpoint in a
// source file is set at its lines in the generated stylesheet, and where the debugger pauses in the generated stylesheet
// is shown in the source file (see XsltDebugAdapterProcess). Lines are 1-based, as the debug adapter's
export interface DebugSourceMap {
	// the generated stylesheet's path
	readonly generatedPath: string;
	// the message for a breakpoint at a source line with no step
	readonly noStepMessage: string;
	// whether the file is one of the source files
	isSource(file: string): boolean;
	// the generated stylesheet's lines for a source line - undefined if it has no step, e.g. in an x:context's content
	generatedLines(sourcePath: string, line: number): number[] | undefined;
	// the source file and line for a line of the generated stylesheet - undefined if it's for no step - with a name for the
	// frame, if it has one
	sourceOf(generatedLine: number): { path: string, line: number, name?: string } | undefined;
	// a breakpoint at a source line with no step: why, if there's more to say than noStepMessage
	noStepMessageFor?(sourcePath: string, line: number): string | undefined;
	// paused at a line of the generated stylesheet: values to show in a scope of their own, e.g. an abstract pattern's
	// parameters, which aren't variables
	parametersAt?(generatedLine: number): { scope: string, variables: { name: string, value: string }[] } | undefined;
	// the generated stylesheet's lines for the source files' steps: where a step stops (the debugger's stepStops)
	stepLines(): number[];
	// whether a variable shown when paused in a source file - in its Locals or Globals - is the generated stylesheet's own,
	// not the source's, so hidden
	isHiddenVariable?(name: string): boolean;
	// pausing on a kind of outcome, e.g. a Schematron schema's failed assertions: the options (as exception breakpoint
	// filters), and for each, the generated stylesheet's lines where it happens - with what the paused frame evaluates to
	// say what happened (its message), and its role
	// whether the input nodes the built-in template rules processed aren't shown (see XsltNodeRules): e.g. a Schematron
	// schema's, whose compiled stylesheet applies them to each node no rule is for
	readonly hidesBuiltInRules?: boolean;
	outcomes?: { filter: string, label: string, description: string, lines: number[], message: string, role: string, id: (line: number) => string | undefined }[];
}

// a function for the 1-based line of an offset in the text
export function lineOf(text: string): (offset: number) => number {
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
