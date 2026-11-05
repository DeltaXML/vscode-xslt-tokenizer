/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - trace code actions
 */

// The text edits for the 'Wrap with xdm:trace()' / 'Wrap with trace()' code actions, for a selected XPath
// expression, and 'Remove trace()', which unwraps the expression traced by a call of trace(), fn:trace() or
// xdm:trace() - as text: the XPath is within an XML attribute (or a value template), so it's as written there,
// e.g. with &lt; for '<'

export interface TraceCall {
	// the call, from its name to its closing bracket
	start: number;
	end: number;
	name: string;
	// its first argument - the expression traced - without the whitespace around it
	argStart: number;
	argEnd: number;
}

export class TraceActions {
	public static readonly traceFunctions = ['trace', 'fn:trace', 'xdm:trace'];
	private static readonly labelMaxLength = 40;
	private static readonly openBrackets = '([{';
	private static readonly closeBrackets = ')]}';

	// the call of a trace function whose name the offset is in (or just after), if any
	public static traceCallAt(text: string, offset: number): TraceCall | undefined {
		let nameStart = offset;
		while (nameStart > 0 && /[\w:.-]/.test(text.charAt(nameStart - 1))) {
			nameStart--;
		}
		let nameEnd = offset;
		while (nameEnd < text.length && /[\w:.-]/.test(text.charAt(nameEnd))) {
			nameEnd++;
		}
		const name = text.substring(nameStart, nameEnd);
		if (!TraceActions.traceFunctions.includes(name) || text.charAt(nameStart - 1) === '$') {
			return undefined;
		}
		let open = nameEnd;
		while (open < text.length && /\s/.test(text.charAt(open))) {
			open++;
		}
		if (text.charAt(open) !== '(') {
			return undefined;
		}
		const parts = TraceActions.topLevelParts(text, open + 1);
		if (!parts) {
			return undefined;
		}
		const [argStart, argEnd] = TraceActions.trimmed(text, open + 1, parts.commas.length > 0 ? parts.commas[0] : parts.close);
		return argStart < argEnd ? { start: nameStart, end: parts.close + 1, name, argStart, argEnd } : undefined;
	}

	// the replacement for a trace call: the expression traced - in brackets unless that keeps its meaning without them,
	// as a single term (a function call, variable, path, literal or bracketed expression), or where the call is an
	// argument, a member of a sequence, or the whole expression
	public static unwrapped(text: string, call: TraceCall): string {
		const arg = text.substring(call.argStart, call.argEnd);
		if (TraceActions.isSingleTerm(arg) || TraceActions.standsAlone(text, call)) {
			return arg;
		}
		return '(' + arg + ')';
	}

	// the selected expression wrapped in a call of the trace function, with the expression (shortened) as its label - in
	// whichever quote the attribute's value isn't delimited by; the snippet's tab stop selects the label
	public static wrapSnippet(selection: string, functionName: string, attributeQuote: string): { prefix: string; label: string; suffix: string } {
		const quote = attributeQuote === '\'' ? '"' : '\'';
		const parts = TraceActions.topLevelParts(selection + ')', 0);
		const argument = parts && parts.commas.length > 0 ? '(' + selection + ')' : selection;
		let label = selection.replace(/\s+/g, ' ').trim().replace(/[{}]/g, '');
		if (label.length > TraceActions.labelMaxLength) {
			label = label.substring(0, TraceActions.labelMaxLength - 1) + '…';
		}
		label = label.split(quote).join(quote + quote);
		return { prefix: functionName + '(' + argument + ', ' + quote, label, suffix: quote + ')' };
	}

	// from just after an opening bracket: the offsets of the commas within it, not in nested brackets, strings or
	// comments, and of its closing bracket - undefined if it isn't closed
	private static topLevelParts(text: string, from: number): { commas: number[]; close: number } | undefined {
		const commas: number[] = [];
		let depth = 0;
		for (let i = from; i < text.length; i++) {
			const c = text.charAt(i);
			if (c === '\'' || c === '"') {
				// a string literal - a quote is escaped by doubling it
				let j = i + 1;
				while (j < text.length && !(text.charAt(j) === c && text.charAt(j + 1) !== c)) {
					j += text.charAt(j) === c ? 2 : 1;
				}
				i = j;
			} else if (c === '(' && text.charAt(i + 1) === ':') {
				const end = text.indexOf(':)', i + 2);
				if (end < 0) {
					return undefined;
				}
				i = end + 1;
			} else if (TraceActions.openBrackets.includes(c)) {
				depth++;
			} else if (TraceActions.closeBrackets.includes(c)) {
				if (depth === 0) {
					return c === ')' ? { commas, close: i } : undefined;
				}
				depth--;
			} else if (c === ',' && depth === 0) {
				commas.push(i);
			}
		}
		return undefined;
	}

	private static trimmed(text: string, start: number, end: number): [number, number] {
		while (start < end && /\s/.test(text.charAt(start))) {
			start++;
		}
		while (end > start && /\s/.test(text.charAt(end - 1))) {
			end--;
		}
		return [start, end];
	}

	// a single term, with no operator at its top level: a name, variable, number, string, function call or path,
	// possibly with predicates, or a bracketed expression
	private static isSingleTerm(expression: string): boolean {
		let depth = 0;
		for (let i = 0; i < expression.length; i++) {
			const c = expression.charAt(i);
			if (c === '\'' || c === '"') {
				let j = i + 1;
				while (j < expression.length && !(expression.charAt(j) === c && expression.charAt(j + 1) !== c)) {
					j += expression.charAt(j) === c ? 2 : 1;
				}
				i = j;
			} else if (TraceActions.openBrackets.includes(c)) {
				depth++;
			} else if (TraceActions.closeBrackets.includes(c)) {
				depth--;
			} else if (depth === 0 && (/\s/.test(c) || '!|,=<>+*'.includes(c) || (c === '-' && i > 0 && /[\s)\]]/.test(expression.charAt(i - 1))) ||
				(c === '&' && /^&(lt|gt);/.test(expression.substring(i))))) {
				return false;
			}
		}
		return true;
	}

	// the call is delimited as an argument or sequence member - between '(' or ',' and ',' or ')' - or is the whole
	// expression, between the attribute's quotes or a value template's braces
	private static standsAlone(text: string, call: TraceCall): boolean {
		let before = call.start - 1;
		while (before >= 0 && /\s/.test(text.charAt(before))) {
			before--;
		}
		let after = call.end;
		while (after < text.length && /\s/.test(text.charAt(after))) {
			after++;
		}
		const b = text.charAt(before);
		const a = text.charAt(after);
		return ('(,[{"\''.includes(b) || before < 0) && (',)]}"\''.includes(a) || after >= text.length);
	}
}
