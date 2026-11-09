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

// XSpec: an x:expect whose select uses $x:result, e.g. select="$x:result eq 2" - select is the expected result, which
// XSpec compares with the result, so this compares the result with true() or false(): a test written in select for
// test. A warning, with a quick fix that makes it the test - for an x:expect with no test, as with one, select is
// compared with the test's value
export class XSpecExpectResult {
	public static readonly code = 'xspec-result-in-select';

	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		return XSpecExpectResult.expects(document.getText()).map(({ valueStart, valueEnd }) => {
			const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(valueStart), document.positionAt(valueEnd)),
				'XSpec: select is the expected result, compared with the result - this uses $x:result, so it compares the result with its own value or a boolean. To test the result, use test, e.g. test="$x:result eq 2"',
				vscode.DiagnosticSeverity.Warning);
			diagnostic.code = XSpecExpectResult.code;
			return diagnostic;
		});
	}

	// the quick fix: select renamed to test - not with an expected value too, e.g. content or href, as then the test's
	// value would be compared with it
	public static codeActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
		const expects = XSpecExpectResult.expects(document.getText());
		return diagnostics.filter((d) => d.code === XSpecExpectResult.code).flatMap((diagnostic) => {
			const expect = expects.find((e) => e.valueStart === document.offsetAt(diagnostic.range.start));
			if (!expect || !expect.canBeTest) {
				return [];
			}
			const action = new vscode.CodeAction('Make select the test - it passes if the expression is true', vscode.CodeActionKind.QuickFix);
			action.diagnostics = [diagnostic];
			action.isPreferred = true;
			action.edit = new vscode.WorkspaceEdit();
			action.edit.replace(document.uri, new vscode.Range(document.positionAt(expect.nameStart), document.positionAt(expect.nameStart + 'select'.length)), 'test');
			return [action];
		});
	}

	private static expects(text: string): { element: XmlElement, nameStart: number, valueStart: number, valueEnd: number, canBeTest: boolean }[] {
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description') {
			return [];
		}
		const prefix = root.name.includes(':') ? root.name.substring(0, root.name.indexOf(':')) : '';
		// $x:result with the XSpec prefix, or as an EQName - not within a string literal, e.g. 'see $x:result'
		const resultReference = new RegExp(`\\$(?:${prefix ? prefix.replace(/[.-]/g, '\\$&') + ':' : ''}|Q\\{http://www\\.jenitennison\\.com/xslt/xspec\\})result(?![\\w.-])`);
		const withoutStrings = (value: string) => value.replace(/"[^"]*"|'[^']*'/g, '""');
		return descendants(root).filter((element) => element.name === (prefix ? prefix + ':' : '') + 'expect' && !element.attributes.has('test')).flatMap((element) => {
			const select = element.attributes.get('select');
			if (select === undefined || !resultReference.test(withoutStrings(select))) {
				return [];
			}
			const startTag = text.substring(element.start, element.contentStart);
			const match = /\sselect\s*=\s*(["'])([\s\S]*?)\1/.exec(startTag);
			if (!match) {
				return [];
			}
			const nameStart = element.start + match.index + match[0].indexOf('select');
			const valueStart = element.start + match.index + match[0].length - 1 - match[2].length;
			const hasContent = element.children.some((child) => localName(child.name) !== 'label') || element.text.trim() !== '';
			const canBeTest = !hasContent && !element.attributes.has('href') && !element.attributes.has('as');
			return [{ element, nameStart, valueStart, valueEnd: valueStart + match[2].length, canBeTest }];
		});
	}
}
