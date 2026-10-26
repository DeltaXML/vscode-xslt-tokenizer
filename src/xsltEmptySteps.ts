/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - XSLT debugger: empty steps
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { BaseToken, TokenLevelState } from './xpLexer';
import { XslLexer, XSLTokenLevelState } from './xslLexer';
import { XSLTConfiguration } from './languageConfigurations';

// a point in a path or lookup chain where its value so far can be checked: the variable it starts with, a step
// ('/' or '//' and a node test), a predicate ('[...]') or a lookup ('?key')
export interface ChainPoint {
	kind: 'root' | 'step' | 'predicate' | 'lookup';
	// the chain's text up to here is evaluated (offsets in the document)
	end: number;
	// the part faded when the value becomes empty here
	markStart: number;
	markEnd: number;
	// the chain's text before this point, whose items this point selects from - '' for a relative path's first step
	// (the context item), or for a path's first step after '/', the root
	before: string;
	// for a step: its separator ('/', '//', or '' for a relative path's first step), axis, and node test as written
	separator?: string;
	axis?: string;
	test?: string;
	// for a lookup: its key as written (a name, an integer, '*' or a parenthesized expression)
	key?: string;
}

export interface PathChain {
	start: number;
	line: number;
	// the variable it starts with, if any - not checked when Saxon hasn't evaluated it yet
	variable?: string;
	points: ChainPoint[];
}

const builtInPrefixes = new Set(['fn', 'map', 'array', 'math', 'xs']);
// attributes whose XPath isn't evaluated in the instruction's focus, or isn't an expression (a sequence type)
const otherFocusAttributes = new Set(['match', 'count', 'from', 'group-starting-with', 'group-ending-with', 'use-when', 'use', 'as']);
// instructions whose content is evaluated in another focus than their own attributes
const focusChangingElements = new Set(['xsl:for-each', 'xsl:for-each-group', 'xsl:iterate', 'xsl:analyze-string', 'xsl:merge', 'xsl:source-document']);

/**
 * While paused, the first step in a path - or predicate, or map or array lookup - after which the path's value is
 * empty, faded like unused code, with a hover that says why: e.g. the elements there are, one with the same local
 * name in another namespace, or the map's keys. The paths checked are those in the template or function paused in, on
 * lines up to the one paused at, that start from a variable or the root - and relative paths too, in instructions with
 * the same focus as the one paused at (within the same xsl:for-each etc., or none). Paths are evaluated as Watch
 * expressions are, in the paused frame, each chain in one evaluation where each step is evaluated once (see bindings).
 * A chain may start with a call of a stylesheet function, which is then called once more than the stylesheet calls it;
 * a chain isn't checked beyond one later on, which may have side effects (e.g. xsl:message output) for each item
 */
export class XsltEmptySteps {
	private static decoration: vscode.TextEditorDecorationType | undefined;
	private static decorated: vscode.TextEditor[] = [];
	private static generation = 0;
	private static readonly timeBudget = 300;
	// for tests: what was faded at the last pause, and the hovers' text
	public static lastFaded: { line: number; text: string; hover: string }[] = [];

	public static register(context: vscode.ExtensionContext, debugType: string) {
		XsltEmptySteps.decoration = vscode.window.createTextEditorDecorationType({ opacity: '0.5' });
		context.subscriptions.push(XsltEmptySteps.decoration);
		context.subscriptions.push(vscode.debug.onDidChangeActiveStackItem((item) => {
			XsltEmptySteps.update(item, debugType).catch(() => undefined);
		}));
		context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(() => XsltEmptySteps.clear()));
		context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.contentChanges.length > 0 && XsltEmptySteps.decorated.some((editor) => editor.document === e.document)) {
				XsltEmptySteps.clear();
			}
		}));
	}

	private static clear() {
		XsltEmptySteps.generation++;
		XsltEmptySteps.decorated.forEach((editor) => editor.setDecorations(XsltEmptySteps.decoration!, []));
		XsltEmptySteps.decorated = [];
		XsltEmptySteps.lastFaded = [];
	}

	private static async update(item: vscode.DebugThread | vscode.DebugStackFrame | undefined, debugType: string) {
		XsltEmptySteps.clear();
		const generation = XsltEmptySteps.generation;
		if (!(item instanceof vscode.DebugStackFrame) || item.session.type !== debugType) {
			return;
		}
		const session = item.session;
		const { stackFrames } = await session.customRequest('stackTrace', { threadId: item.threadId });
		const frame = (stackFrames ?? []).find((f: { id: number }) => f.id === item.frameId);
		const framePath: string | undefined = frame?.source?.path;
		const editor = framePath ? vscode.window.visibleTextEditors.find((e) => path.normalize(e.document.uri.fsPath) === path.normalize(framePath)) : undefined;
		if (!editor || generation !== XsltEmptySteps.generation) {
			return;
		}
		const document = editor.document;
		const text = document.getText();
		const chains = XsltEmptySteps.chains(text, frame.line - 1, frame.column, /\(XPath\)$/.test(frame.name ?? ''));
		if (chains.length === 0) {
			return;
		}
		const evaluate = async (expression: string) => session.customRequest('evaluate', { expression, frameId: item.frameId, context: 'watch' });
		// variables Saxon hasn't evaluated yet aren't evaluated for this: it could run stylesheet code
		const notEvaluated = new Set<string>();
		try {
			const { scopes } = await session.customRequest('scopes', { frameId: item.frameId });
			const locals = (scopes ?? []).find((s: { name: string }) => s.name === 'Locals');
			const { variables } = locals ? await session.customRequest('variables', { variablesReference: locals.variablesReference }) : { variables: [] };
			(variables ?? []).filter((v: { value: string }) => v.value === '(not evaluated yet)').forEach((v: { name: string }) => notEvaluated.add(v.name));
		} catch {
			// as if all were evaluated
		}
		// a sequence of strings, as evaluated
		const strings = async (expression: string) => {
			try {
				const result = await evaluate(expression);
				const values: string[] = result.variablesReference > 0 ?
					((await session.customRequest('variables', { variablesReference: result.variablesReference })).variables ?? []).map((v: { value: string }) => v.value) :
					[result.result];
				return values.map((v) => v.replace(/^"|"$/g, ''));
			} catch {
				// e.g. a variable not in scope, or a lookup on something that's not a map or array
				return undefined;
			}
		};
		const decorations: vscode.DecorationOptions[] = [];
		// the paths are checked for up to this long at each pause - after that, the rest aren't, so a slow one (e.g. a
		// stylesheet function it starts with) doesn't slow down stepping
		const deadline = Date.now() + XsltEmptySteps.timeBudget;
		for (const chain of chains.slice(0, 100)) {
			if (Date.now() > deadline) {
				break;
			}
			if (chain.variable && notEvaluated.has(chain.variable)) {
				continue;
			}
			// whether each of its points has a value (1 or 0), all at once, each step evaluated once - exists() only
			// needs a step's first item, as the stylesheet may, where count() would need them all
			const bindings = XsltEmptySteps.bindings(text, chain);
			const counts = await strings(`let ${bindings.join(', ')} return (${bindings.map((_, k) => `(if (exists($_step${k})) then 1 else 0)`).join(', ')})`);
			if (generation !== XsltEmptySteps.generation) {
				return;
			}
			const empty = counts ? counts.indexOf('0') : -1;
			if (empty >= 0) {
				const point = chain.points[empty];
				const range = new vscode.Range(document.positionAt(point.markStart), document.positionAt(point.markEnd));
				decorations.push({ range, hoverMessage: await XsltEmptySteps.hover(point, bindings.slice(0, empty), strings) });
			}
		}
		if (generation === XsltEmptySteps.generation && decorations.length > 0) {
			editor.setDecorations(XsltEmptySteps.decoration!, decorations);
			XsltEmptySteps.decorated.push(editor);
			XsltEmptySteps.lastFaded = decorations.map((d) => ({ line: d.range.start.line, text: document.getText(d.range), hover: (d.hoverMessage as vscode.MarkdownString).value }));
		}
	}

	/**
	 * For each point of a chain, its value as a let binding ($_step0, $_step1, ...) - each from the one before, so each
	 * step is evaluated once. A step's predicates filter it for each item it's from (a/b[1] is each a's first b), so
	 * they're applied to the step, not to the step's result
	 */
	public static bindings(text: string, chain: PathChain): string[] {
		const bindings: string[] = [];
		// the step the predicates so far apply to, with them
		let step: string | undefined;
		chain.points.forEach((point, k) => {
			const written = XsltEmptySteps.unescape(text.substring(point.markStart, point.markEnd));
			const previous = k > 0 ? `$_step${k - 1}` : '';
			let value: string;
			switch (point.kind) {
				case 'root':
					value = written;
					step = undefined;
					break;
				case 'step':
					// a path's first step: from the context item, or the root
					value = step = k > 0 ? previous + point.separator + written : point.before === '/' ? point.separator + written : written;
					break;
				case 'predicate':
					value = step = step !== undefined ? step + written : previous + written;
					if (k === 0 || chain.points[k - 1].kind === 'root' || chain.points[k - 1].kind === 'lookup') {
						step = undefined;
					}
					break;
				case 'lookup':
					value = previous + written;
					step = undefined;
					break;
			}
			bindings.push(`$_step${k} := ${value}`);
		});
		return bindings;
	}

	// why it's empty there - given the bindings of the points before it, and how to evaluate a sequence of strings
	private static async hover(point: ChainPoint, bindings: string[], strings: (expression: string) => Promise<string[] | undefined>) {
		const markdown = new vscode.MarkdownString();
		const code = (s: string) => '`' + s.replace(/`/g, '\'') + '`';
		// the value before this point: the context item, or the root, for a path's first step
		const before = bindings.length > 0 ? `$_step${bindings.length - 1}` : point.before === '/' ? '/' : '.';
		const lets = bindings.length > 0 ? `let ${bindings.join(', ')} return ` : '';
		switch (point.kind) {
			case 'root':
				markdown.appendMarkdown(`${code(point.test!)} is empty here`);
				break;
			case 'predicate': {
				const counted = (await strings(`${lets}string(count(${before}))`))?.[0];
				markdown.appendMarkdown(`Empty here: the predicate kept none of the ${counted ? counted + ' ' : ''}items`);
				break;
			}
			case 'lookup': {
				const keys = await strings(`${lets}let $v := (${before}) return (string(count($v)), distinct-values($v!(if (. instance of map(*)) then Q{http://www.w3.org/2005/xpath-functions/map}keys(.)!string() ` +
					`else if (. instance of array(*)) then '#array ' || Q{http://www.w3.org/2005/xpath-functions/array}size(.) else ()))[position() le 50])`);
				const arrays = (keys ?? []).slice(1).filter((k) => k.startsWith('#array '));
				const mapKeys = (keys ?? []).slice(1).filter((k) => !k.startsWith('#array '));
				const key = point.key!;
				if (key === '*') {
					markdown.appendMarkdown('Empty here: the map or array is empty');
				} else if (arrays.length > 0 && mapKeys.length === 0) {
					markdown.appendMarkdown(`Empty here: ${code('?' + key)} - the array has ${arrays.map((a) => a.substring(7)).join(', ')} members`);
				} else if (mapKeys.includes(key)) {
					markdown.appendMarkdown(`Empty here: the value of ${code(key)} is empty`);
				} else {
					const sameCase = mapKeys.filter((k) => k.toLowerCase() === key.toLowerCase());
					markdown.appendMarkdown(`Empty here: no key ${code(key)}` + (sameCase.length ? ` - but there's ${sameCase.map(code).join(', ')}` : '') +
						(mapKeys.length ? `\n\nKeys: ${mapKeys.slice(0, 20).map(code).join(', ')}${mapKeys.length > 20 ? ', ...' : ''}` : '\n\nThe map is empty'));
				}
				break;
			}
			case 'step': {
				const test = point.test!;
				const isAttribute = point.axis === 'attribute';
				const axis = point.separator === '//' ? '//' : '/';
				const candidates = isAttribute ? `${axis}@*` : point.axis ? `${axis}${point.axis}::*` : `${axis}*`;
				const what = isAttribute ? 'attributes' : point.separator === '//' ? 'descendant elements' : point.axis ? `elements on the ${point.axis} axis` : 'child elements';
				const names = await strings(`${lets}let $all := (${before})${candidates} return (string(count($all)), distinct-values($all!(name() || ' ' || local-name() || ' ' || namespace-uri()))[position() le 50])`);
				if (!names) {
					markdown.appendMarkdown(`Empty here: no ${code(test)} nodes`);
					break;
				}
				const found = names.slice(1).map((n) => { const [name, local, uri] = n.split(' '); return { name, local, uri: uri ?? '' }; });
				const local = test.replace(/^.*:/, '');
				markdown.appendMarkdown(`Empty here: no ${code(test)} - ${names[0]} ${what} in all`);
				if (/[()]/.test(test) || local === '*') {
					break;
				}
				const otherNamespace = found.filter((f) => f.local === local);
				const otherCase = found.filter((f) => f.local !== local && f.local.toLowerCase() === local.toLowerCase());
				otherNamespace.forEach((f) => markdown.appendMarkdown(`\n\nThere's ${code(f.name)} in ${f.uri ? 'namespace ' + code(f.uri) : 'no namespace'} - is the namespace (or xpath-default-namespace) right?`));
				otherCase.forEach((f) => markdown.appendMarkdown(`\n\nThere's ${code(f.name)} - a different case`));
				if (found.length > 0 && otherNamespace.length === 0 && otherCase.length === 0) {
					markdown.appendMarkdown(`\n\nNames: ${[...new Set(found.map((f) => f.name))].slice(0, 20).map(code).join(', ')}${found.length > 20 ? ', ...' : ''}`);
				}
				break;
			}
		}
		return markdown;
	}

	public static unescape(xml: string) {
		return xml.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/g, (_, ref: string) =>
			ref === 'lt' ? '<' : ref === 'gt' ? '>' : ref === 'amp' ? '&' : ref === 'quot' ? '"' : ref === 'apos' ? '\'' :
				String.fromCodePoint(ref.startsWith('#x') ? parseInt(ref.substring(2), 16) : parseInt(ref.substring(1), 10)));
	}

	/**
	 * The path and lookup chains to check while paused at this (0-based) line - and, if known, the 1-based column of
	 * the instruction's start tag, as the call stack gives it. In an XPath expression's frame (stepped through), only
	 * chains starting from a variable or the root are checked: the focus there may be another
	 */
	public static chains(text: string, stopLine: number, stopColumn: number | undefined, inXPathFrame: boolean): PathChain[] {
		const tokens = new XslLexer(XSLTConfiguration.configuration).analyse(text);
		const xslStart = XslLexer.getXsltStartTokenNumber();
		const lineStarts = [0];
		for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
			lineStarts.push(i + 1);
		}
		const offset = (token: BaseToken) => lineStarts[token.line] + token.startCharacter;
		const tokenText = (token: BaseToken) => text.substr(offset(token), token.length);

		// the XPath tokens of each attribute, with the element: where its start tag starts, its name, and the instructions
		// around it that change the focus ('line:character' of each) - an instruction's attributes are evaluated in the
		// focus of those, so a relative path there can be checked while paused at an instruction with the same ones
		const groups: { elementLine: number; elementCharacter: number; elementName: string; focus: string; attribute: string; tokens: BaseToken[] }[] = [];
		const startTags: { line: number; character: number; focus: string }[] = [];
		const stack: { name: string; line: number; character: number }[] = [];
		const focusOf = () => stack.filter((e) => focusChangingElements.has(e.name)).map((e) => `${e.line}:${e.character}`).join(' ');
		let elementName: string | undefined;
		let elementLine = -1;
		let elementCharacter = -1;
		let elementFocus = '';
		let isEndTag = false;
		let attributeName: string | undefined;
		let current: BaseToken[] | undefined;
		for (const token of tokens) {
			if (token.tokenType < xslStart) {
				if (attributeName !== undefined && elementName !== undefined) {
					if (!current) {
						current = [];
						groups.push({ elementLine, elementCharacter, elementName, focus: elementFocus, attribute: attributeName, tokens: current });
					}
					current.push(token);
				}
				continue;
			}
			const type = token.tokenType - xslStart;
			if (type === XSLTokenLevelState.attributeValue || type === XSLTokenLevelState.entityRef || type === XSLTokenLevelState.attributeEquals) {
				continue;
			}
			current = undefined;
			attributeName = undefined;
			if (type === XSLTokenLevelState.elementName || type === XSLTokenLevelState.xslElementName) {
				if (isEndTag) {
					stack.pop();
				} else {
					elementName = tokenText(token);
				}
			} else if (type === XSLTokenLevelState.attributeName) {
				attributeName = elementName !== undefined ? tokenText(token) : undefined;
			} else if (type === XSLTokenLevelState.xmlPunctuation) {
				const punctuation = tokenText(token);
				if (punctuation === '<' || punctuation === '</') {
					if (token.line > stopLine) {
						break;
					}
					isEndTag = punctuation === '</';
					elementName = undefined;
					elementLine = token.line;
					elementCharacter = token.startCharacter;
					elementFocus = focusOf();
					if (!isEndTag) {
						startTags.push({ line: elementLine, character: elementCharacter, focus: elementFocus });
					}
				} else if (punctuation === '>' && elementName !== undefined && !isEndTag) {
					stack.push({ name: elementName, line: elementLine, character: elementCharacter });
					elementName = undefined;
				} else if (punctuation === '/>') {
					elementName = undefined;
				}
			}
		}
		// the instruction paused at: at the column given, else the first starting on the line
		const onLine = startTags.filter((s) => s.line === stopLine);
		const stopped = onLine.find((s) => stopColumn !== undefined && s.character === stopColumn - 1) ?? onLine[0];
		// from the template or function paused in - else the top-level declaration, e.g. a global variable being
		// evaluated (stack[0] is the xsl:stylesheet element), or the instruction paused at, if it's one
		const declaration = [...stack].reverse().find((element) => element.name === 'xsl:template' || element.name === 'xsl:function');
		const scopeStart = declaration ? declaration.line : stack.length > 1 ? stack[1].line : stopped ? stopped.line : stopLine;

		const chains: PathChain[] = [];
		for (const group of groups) {
			if (group.elementLine < scopeStart || otherFocusAttributes.has(group.attribute) || group.elementName === 'xsl:template') {
				continue;
			}
			const isStopped = stopped !== undefined && group.elementLine === stopped.line && group.elementCharacter === stopped.character;
			// an xsl:sort's select is evaluated for each item sorted
			const relativeAllowed = !inXPathFrame && stopped !== undefined && group.focus === stopped.focus && (isStopped || group.elementName !== 'xsl:sort');
			chains.push(...XsltEmptySteps.groupChains(group.tokens, text, offset, relativeAllowed));
		}
		return chains;
	}

	private static groupChains(t: BaseToken[], text: string, offset: (token: BaseToken) => number, relativeAllowed: boolean): PathChain[] {
		const op = (i: number, ...values: string[]) => i >= 0 && i < t.length && t[i].tokenType === TokenLevelState.operator && values.includes(t[i].value);
		const end = (i: number) => offset(t[i]) + t[i].length;
		const isStepStart = (i: number) => i < t.length && (t[i].tokenType === TokenLevelState.axisName || t[i].tokenType === TokenLevelState.nodeNameTest ||
			t[i].tokenType === TokenLevelState.attributeNameTest || t[i].tokenType === TokenLevelState.nodeType || t[i].value === '*');
		const operandEnds = new Set([TokenLevelState.nodeNameTest, TokenLevelState.attributeNameTest, TokenLevelState.variable, TokenLevelState.number,
			TokenLevelState.string, TokenLevelState.nodeType, TokenLevelState.mapNameLookup]);
		const isOperandEnd = (i: number) => i >= 0 && (operandEnds.has(t[i].tokenType) || op(i, ')', ']', '()', '}', '*'));
		const isUnsafe = (i: number) => (t[i].tokenType === TokenLevelState.function && t[i].value.includes(':') && !builtInPrefixes.has(t[i].value.split(':')[0])) ||
			(t[i].tokenType === TokenLevelState.variable && op(i + 1, '(')) || t[i].tokenType === TokenLevelState.anonymousFunction;
		// the index of the bracket closing the one at i
		const closing = (i: number, open: string, close: string) => {
			let depth = 0;
			for (let j = i; j < t.length; j++) {
				if (op(j, open)) {
					depth++;
				} else if (op(j, close) && --depth === 0) {
					return j;
				}
			}
			return -1;
		};
		// a step from i: [axis ::] node test, or a kind test with its parentheses - its last token's index
		const step = (i: number): { last: number; axis?: string; test: string } | undefined => {
			let axis: string | undefined;
			let j = i;
			if (t[j].tokenType === TokenLevelState.axisName && op(j + 1, '::')) {
				axis = t[j].value;
				j += 2;
			}
			if (j >= t.length || !isStepStart(j) || t[j].tokenType === TokenLevelState.axisName) {
				return undefined;
			}
			const first = j;
			if (t[j].tokenType === TokenLevelState.nodeType && op(j + 1, '(')) {
				j = closing(j + 1, '(', ')');
				if (j < 0) {
					return undefined;
				}
			} else if (t[j].tokenType === TokenLevelState.nodeType && t[j + 1]?.tokenType === TokenLevelState.nodeType && t[j + 1].value === '()') {
				j++;
			}
			const test = text.substring(offset(t[first]), end(j));
			if (t[first].tokenType === TokenLevelState.attributeNameTest) {
				return { last: j, axis: 'attribute', test: test.replace(/^@/, '') };
			}
			return { last: j, axis: axis === 'child' ? undefined : axis, test };
		};

		const chains: PathChain[] = [];
		// the brackets open at each token: whether each changes the focus - a predicate, a parenthesized step, an inline
		// function's body or a map's entries (not checked further)
		const focus: boolean[] = [];
		for (let i = 0; i < t.length; i++) {
			if (op(i, '[', '{')) {
				focus.push(true);
			} else if (op(i, '(')) {
				focus.push(op(i - 1, '/', '//', '!') || focus[focus.length - 1] === true);
			} else if (op(i, ']', ')', '}')) {
				focus.pop();
			}
			if (op(i - 1, '/', '//', '::', '?', '!', '=>', '=!>') && !(op(i, '/', '//'))) {
				continue;
			}
			const focusChanged = focus.includes(true) || op(i - 1, '!');
			const start = offset(t[i]);
			const points: ChainPoint[] = [];
			let j: number;
			let variable: string | undefined;
			// the last token of what the chain starts with, if it's a variable, function call or parenthesized expression
			let rootLast = i - 1;
			const isCall = t[i].tokenType === TokenLevelState.function && op(i + 1, '(', '()');
			const isParenthesized = op(i, '(') && !isOperandEnd(i - 1) && !(i > 0 && (t[i - 1].tokenType === TokenLevelState.function || t[i - 1].tokenType === TokenLevelState.nodeType));
			if (t[i].tokenType === TokenLevelState.variable && !op(i + 1, '(')) {
				variable = t[i].value;
				points.push({ kind: 'root', end: end(i), markStart: start, markEnd: end(i), before: '', test: variable });
				rootLast = i;
				j = i + 1;
			} else if (isCall || isParenthesized) {
				// a parenthesized expression or a function call, e.g. (a | b)/c or key('k', @ref)/name - in the focus,
				// unless it's only variables and literals
				const last = isCall ? (op(i + 1, '()') ? i + 1 : closing(i + 1, '(', ')')) : closing(i, '(', ')');
				if (last < 0 || !op(last + 1, '/', '//', '[', '?')) {
					continue;
				}
				const usesFocus = isCall || t.slice(i, last + 1).some((token) => token.tokenType === TokenLevelState.function ||
					token.tokenType === TokenLevelState.nodeNameTest || token.tokenType === TokenLevelState.attributeNameTest ||
					token.tokenType === TokenLevelState.axisName || token.tokenType === TokenLevelState.nodeType) || t.slice(i, last + 1).some((token, k) => k > 0 && op(i + k, '/', '//'));
				if (usesFocus && !(relativeAllowed && !focusChanged)) {
					continue;
				}
				points.push({ kind: 'root', end: end(last), markStart: start, markEnd: end(last), before: '', test: text.substring(start, end(last)) });
				rootLast = last;
				j = last + 1;
			} else if (op(i, '/', '//') && !isOperandEnd(i - 1)) {
				j = i;
			} else if (isStepStart(i) && !isOperandEnd(i - 1) && relativeAllowed && !focusChanged) {
				const s = step(i);
				if (!s) {
					continue;
				}
				points.push({ kind: 'step', end: end(s.last), markStart: start, markEnd: end(s.last), before: '', separator: '', axis: s.axis, test: s.test });
				j = s.last + 1;
			} else {
				continue;
			}
			// the rest of the chain: steps, predicates and lookups
			while (j < t.length) {
				if (op(j, '/', '//') && j + 1 < t.length && isStepStart(j + 1)) {
					const s = step(j + 1);
					if (!s) {
						break;
					}
					const before = j === i ? '/' : text.substring(start, offset(t[j]));
					points.push({ kind: 'step', end: end(s.last), markStart: offset(t[j + 1]), markEnd: end(s.last), before, separator: t[j].value, axis: s.axis, test: s.test });
					j = s.last + 1;
				} else if (op(j, '[') && j > i) {
					const close = closing(j, '[', ']');
					if (close < 0) {
						break;
					}
					points.push({ kind: 'predicate', end: end(close), markStart: offset(t[j]), markEnd: end(close), before: text.substring(start, offset(t[j])) });
					j = close + 1;
				} else if (op(j, '?') && j + 1 < t.length && j > i) {
					let last = j + 1;
					if (op(last, '(')) {
						last = closing(last, '(', ')');
					} else if (!(t[last].tokenType === TokenLevelState.mapNameLookup || t[last].tokenType === TokenLevelState.number)) {
						break;
					}
					if (last < 0) {
						break;
					}
					points.push({ kind: 'lookup', end: end(last), markStart: offset(t[j]), markEnd: end(last), before: text.substring(start, offset(t[j])),
						key: text.substring(offset(t[j + 1]), end(last)) });
					j = last + 1;
				} else {
					break;
				}
			}
			// not beyond a call of a stylesheet function, a dynamic function call or an inline function after what the chain
			// starts with - which is evaluated once, as the stylesheet does, e.g. (f:element())/item
			let safe = points.length;
			for (let k = rootLast + 1; k < j && safe > 0; k++) {
				if (isUnsafe(k)) {
					safe = points.findIndex((p) => p.end > offset(t[k]));
					safe = safe < 0 ? points.length : safe;
					break;
				}
			}
			// a variable (or other expression it starts with) alone isn't a path
			const checked = points.slice(0, safe);
			if (checked.length > (checked[0]?.kind === 'root' ? 1 : 0)) {
				chains.push({ start, line: t[i].line, variable, points: checked });
			}
		}
		return chains;
	}
}
