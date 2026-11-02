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
import { XmlElement, parseXml, localName, descendants } from './xspecXml';

// Warnings for x:expect elements that XSpec 4 stops the run for, where XSpec before 1.0 ran them (see the
// XSLT.xspec.legacyCompatibility setting): a test that's boolean with an expected value - select, as, href or content -
// and a test that isn't boolean without one. A test's type isn't known in general, so only those that are clearly one
// or the other, from the top level of the expression, are reported - with quick fixes for the form XSpec 4 runs
export class XSpecCompat {
	public static readonly booleanWithExpected = 'xspec-boolean-test-with-expected';
	public static readonly nonBooleanWithoutExpected = 'xspec-non-boolean-test-without-expected';

	// functions returning a boolean, e.g. exists($x:result/p)
	private static readonly booleanFunctions = new Set(['exists', 'empty', 'not', 'boolean', 'true', 'false', 'starts-with', 'ends-with', 'contains',
		'contains-token', 'matches', 'deep-equal', 'has-children', 'nilled', 'lang', 'doc-available', 'unparsed-text-available', 'function-lookup-exists']);
	// functions that never return a boolean, e.g. distinct-values(...)
	private static readonly nonBooleanFunctions = new Set(['distinct-values', 'string', 'data', 'string-join', 'concat', 'normalize-space', 'substring',
		'substring-before', 'substring-after', 'upper-case', 'lower-case', 'translate', 'replace', 'tokenize', 'reverse', 'subsequence', 'remove',
		'insert-before', 'sort', 'count', 'sum', 'avg', 'min', 'max', 'name', 'local-name', 'namespace-uri', 'string-length', 'number',
		'index-of', 'in-scope-prefixes', 'serialize', 'root', 'head', 'tail', 'string-to-codepoints', 'codepoints-to-string']);

	// whether the expression is clearly boolean, clearly not, or either - from its top level, outside parentheses,
	// brackets, braces and string literals
	public static testType(xpath: string): 'boolean' | 'non-boolean' | undefined {
		const expression = xpath.replace(/\(:[\s\S]*?:\)/g, ' ').trim();
		if (expression === '') {
			return undefined;
		}
		// the top level, with nested parts and string literals blanked
		let top = '';
		let depth = 0;
		let quote = '';
		for (const c of expression) {
			if (quote) {
				quote = c === quote ? '' : quote;
				top += ' ';
			} else if (c === '"' || c === '\'') {
				quote = c;
				top += depth === 0 ? '"' : ' ';
			} else if ('([{'.includes(c)) {
				top += depth === 0 ? c : ' ';
				depth++;
			} else if (')]}'.includes(c)) {
				depth--;
				top += depth === 0 ? c : ' ';
			} else {
				top += depth === 0 ? c : ' ';
			}
		}
		// a comparison, or 'and', 'or', 'instance of', 'castable as', a quantified expression
		if (/(^|[^=!<>])(=|!=|<=?|>=?)(?![=>])/.test(top.replace(/=>|=!>|->/g, '  ')) || /(^|\s)(eq|ne|lt|le|gt|ge|is|and|or)\s/.test(top) ||
			/\s(instance\s+of|castable\s+as)\s/.test(top) || /^(every|some)\s+\$/.test(top)) {
			return 'boolean';
		}
		// any other operator, or 'if', 'let', 'for' and the like: either
		if (/(^|\s)(if|let|for|return|then|else|to|div|idiv|mod|union|intersect|except|treat|cast)(\s|\(|$)|\s[-+*|]\s|=>|=!>|->|!(?!=)/.test(top)) {
			return undefined;
		}
		// a call of one function: boolean if it's one returning a boolean - not, if it never returns one
		const call = /^(?:fn:)?([\w.-]+)\s*\(\s*\)$/.exec(top);
		if (call) {
			return XSpecCompat.booleanFunctions.has(call[1]) ? 'boolean' : XSpecCompat.nonBooleanFunctions.has(call[1]) ? 'non-boolean' : undefined;
		}
		// a path or a filter - with a step or predicate, e.g. $x:result/p[@a], tgroup/row, ('a', 'b')[not(. = $v)] - is
		// nodes or items, not a boolean: unless its last step is a function call, e.g. $x:result/exists(p), which may be
		// one boolean. Not $x:result alone, which is the result, which may be a boolean
		const lastStep = top.substring(top.lastIndexOf('/') + 1).trim();
		if (/[/[]/.test(top) && !/^[\w.:-]+\s*\(\s*\)$/.test(lastStep)) {
			return 'non-boolean';
		}
		return undefined;
	}

	// the problems of the x:expect elements
	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		return XSpecCompat.expects(document.getText()).flatMap(({ element, testStart, testEnd, type, hasExpected }) => {
			const range = new vscode.Range(document.positionAt(testStart), document.positionAt(testEnd));
			let diagnostic: vscode.Diagnostic | undefined;
			if (type === 'boolean' && hasExpected) {
				diagnostic = new vscode.Diagnostic(range, `XSpec: this test is boolean, so XSpec 4 doesn't allow select, as, href or content with it, and stops the run ('Boolean @test must not be accompanied by...'). XSpec before 1.0 ignored them - remove them, or make the test return the value to compare`, vscode.DiagnosticSeverity.Warning);
				diagnostic.code = XSpecCompat.booleanWithExpected;
			} else if (type === 'non-boolean' && !hasExpected) {
				diagnostic = new vscode.Diagnostic(range, `XSpec: this test isn't boolean, so XSpec 4 needs an expected value - select, href or content - with it, and stops the run ('Non-boolean @test must be accompanied by...'). XSpec before 1.0 passed it if the test returned nothing, as empty() does`, vscode.DiagnosticSeverity.Warning);
				diagnostic.code = XSpecCompat.nonBooleanWithoutExpected;
			}
			return diagnostic && element ? [diagnostic] : [];
		});
	}

	// the x:expect elements with a test: where its value is, its type, and whether there's an expected value
	private static expects(text: string) {
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return [];
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':') + 1) : '';
		return descendants(root).filter((element) => element.name === `${prefix}expect` && element.attributes.has('test')).flatMap((element) => {
			const value = XSpecCompat.attributeValue(text, element, 'test');
			if (!value) {
				return [];
			}
			const hasContent = element.children.some((child) => child.name !== `${prefix}label`) || element.text.trim() !== '';
			const hasExpected = ['select', 'as', 'href'].some((name) => element.attributes.has(name)) || hasContent;
			return [{ element, testStart: value[0], testEnd: value[1], type: XSpecCompat.testType(element.attributes.get('test')!), hasExpected, hasContent }];
		});
	}

	private static attributeValue(text: string, element: XmlElement, attribute: string): [number, number] | undefined {
		const match = new RegExp(`\\s${attribute}\\s*=\\s*(["'])`).exec(text.substring(element.start, element.contentStart));
		const start = match ? element.start + match.index + match[0].length : -1;
		return match ? [start, text.indexOf(match[1], start)] : undefined;
	}

	// quick fixes: for a boolean test, removing select, as and href - not content, which may be wanted - and for a test
	// that isn't boolean, wrapping it in empty(), as XSpec before 1.0 ran it, or in exists()
	public static codeActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
		const text = document.getText();
		const actions: vscode.CodeAction[] = [];
		for (const diagnostic of diagnostics) {
			if (diagnostic.code !== XSpecCompat.booleanWithExpected && diagnostic.code !== XSpecCompat.nonBooleanWithoutExpected) {
				continue;
			}
			const offset = document.offsetAt(diagnostic.range.start);
			const expect = XSpecCompat.expects(text).find((e) => e.testStart === offset);
			if (!expect) {
				continue;
			}
			if (diagnostic.code === XSpecCompat.booleanWithExpected && !expect.hasContent) {
				const action = new vscode.CodeAction('Remove select, as and href - the boolean test decides', vscode.CodeActionKind.QuickFix);
				action.diagnostics = [diagnostic];
				action.isPreferred = true;
				action.edit = new vscode.WorkspaceEdit();
				const startTag = text.substring(expect.element.start, expect.element.contentStart);
				for (const match of startTag.matchAll(/\s+(select|as|href)\s*=\s*("[^"]*"|'[^']*')/g)) {
					const start = expect.element.start + match.index!;
					action.edit.delete(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(start + match[0].length)));
				}
				actions.push(action);
			} else if (diagnostic.code === XSpecCompat.nonBooleanWithoutExpected) {
				const test = text.substring(expect.testStart, expect.testEnd);
				[['empty', 'Wrap the test in empty() - as XSpec before 1.0 ran it: it passes if the test returns nothing'], ['exists', 'Wrap the test in exists() - it passes if the test returns something']]
					.forEach(([fn, title], index) => {
						const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
						action.diagnostics = [diagnostic];
						action.isPreferred = index === 0;
						action.edit = new vscode.WorkspaceEdit();
						action.edit.replace(document.uri, new vscode.Range(document.positionAt(expect.testStart), document.positionAt(expect.testEnd)), `${fn}(${test.trim()})`);
						actions.push(action);
					});
			}
		}
		return actions;
	}
}
