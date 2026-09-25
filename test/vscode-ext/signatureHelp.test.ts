/**
 * Test suite for finding the function call enclosing the cursor, used by the signature help provider
 *
 * Each XPath expression marks the cursor position with '|'. The expected result is the name of the
 * enclosing function and the index of its active parameter, or null when there is no enclosing call.
 * With the arrow operators '=>' and '=!>' the first argument is supplied by the left-hand operand,
 * so the active parameter is one more than the count of preceding commas.
 */
import * as vscode from 'vscode';
import { assert } from 'chai';
import { XSLTSignatureHelpProvider } from '../../src/xsltSignatureHelpProvider';
import { ExitCondition, LexPosition, XPathLexer } from '../../src/xpLexer';

const cases: [string, string | null, number?][] = [
	['substring(|', 'substring', 0],
	['substring($s, |', 'substring', 1],
	['substring($s, 1, |)', 'substring', 2],
	['$s => substring(|', 'substring', 1],
	['$s => substring(1, |', 'substring', 2],
	['$s => substring(|)', 'substring', 1],
	['$s =!> substring(|', 'substring', 1],
	['$s =!> concat("a", |)', 'concat', 2],
	['$s => tokenize() =!> replace(|', 'replace', 1],
	['upper-case(|)', 'upper-case', 0],
	['$s => upper-case(|)', 'upper-case', 1],
	['$s -> substring(., |', 'substring', 1],
	['$s => substring(string-length(|', 'string-length', 0],
	['$s => substring(1, string-length(|', 'string-length', 0],
	['$f(|', null],
	['$s => $f(|', null],
];

suite('Signature help: enclosing function call', () => {
	cases.forEach(([marked, expectedName, expectedParam]) => {
		test(marked, () => {
			const cursor = marked.indexOf('|');
			const xpath = marked.substring(0, cursor) + marked.substring(cursor + 1);
			const lexPosition: LexPosition = { line: 0, startCharacter: 0, documentOffset: 0 };
			const tokens = new XPathLexer().analyse(xpath, ExitCondition.None, lexPosition);
			const result = XSLTSignatureHelpProvider.findEnclosingCall(tokens, new vscode.Position(0, cursor));
			if (expectedName === null) {
				assert.isNull(result);
			} else {
				assert.deepEqual(result, { functionName: expectedName, activeParameter: expectedParam });
			}
		});
	});
});
