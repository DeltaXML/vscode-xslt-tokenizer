/**
 * The $saxon-xslt problem matcher in package.json, for the output of Saxon's Transform: Saxon-PE 13, Saxon-HE 13,
 * Saxon-PE 12.8 and SaxonC-PE 13. The output in saxon-output/<case>.<version>.txt is from the stylesheets there, each with
 * one error, run with -s:in.xml -ea:on - with the paths replaced by /work/proj, and SaxonC's native crash report after
 * its 'Fatal error' line removed.
 *
 * Each problem is a header line ending with 'line N column M of FILE:' - after e.g. 'Type error in expression in
 * xsl:sequence/@select on', 'Error at char 13 in xsl:variable/@select on', 'Error evaluating ($p) in expression in ...
 * on' (Saxon 12) or 'Error in {1 +} at char 4 in ... on' - then a line with the error code, e.g. XTTE0780 or a QName
 * from fn:error(), and the first line of the message. The patterns are applied as VS Code does for a multi-line
 * matcher: to consecutive lines.
 *
 * Not matched: a warning whose location isn't in its header, e.g. XTDE0540 for an ambiguous rule match (w01) - and the
 * file is the module's name only, e.g. lib.xsl for sub/lib.xsl (c11, c12), as Saxon reports it.
 */
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const outputFolder = path.join(__dirname, 'saxon-output');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));

interface Pattern { regexp: string, line?: number, column?: number, severity?: number, file?: number, code?: number, message?: number }

function matcherPatterns(name: string): Pattern[] {
	return packageJson.contributes.problemMatchers.find((matcher: { name: string }) => matcher.name === name).pattern;
}

// the problems in the output, as 'severity file:line:column code' - with the message, which must not be empty
function problems(output: string, patterns: Pattern[]) {
	const [header, detail] = patterns.map((pattern) => new RegExp(pattern.regexp));
	const lines = output.split(/\r?\n/);
	const found: string[] = [];
	for (let i = 0; i < lines.length - 1; i++) {
		const location = header.exec(lines[i]);
		const code = location ? detail.exec(lines[i + 1]) : null;
		if (location && code) {
			const [h, d] = patterns;
			expect(code[d.message!], lines[i + 1]).to.not.be.empty;
			found.push(`${location[h.severity!].toLowerCase()} ${location[h.file!]}:${location[h.line!]}:${location[h.column!]} ${code[d.code!]}`);
		}
	}
	return found;
}

const versions = ['pe13', 'he13', 'pe12', 'sc13'];

// the problem for each case - or for each version, where they differ
const expected: { [testCase: string]: string | null | { [version: string]: string } } = {
	c01: 'error c01.xsl:3:35 XTTE0780', // function result: static type error
	c02: 'error c02.xsl:4:32 XTTE0780', // function result: dynamic type error
	c03: 'error c03.xsl:3:58 XTTE0570', // xsl:variable as: static
	c04: 'error c04.xsl:3:66 XTTE0570', // xsl:variable as: cardinality
	c05: 'error c05.xsl:6:15 XTTE0505', // template result type
	c06: 'error c06.xsl:3:86 XTTE0590', // xsl:with-param type
	c07: 'error c07.xsl:4:45 FOAR0001', // integer division by zero
	c08: 'error c08.xsl:5:47 FORG0001', // cast
	c09: 'error c09.xsl:3:74 f:bad', // fn:error() with a QName
	c10: { pe13: 'error c10.xsl:3:61 XTMM9000', he13: 'error c10.xsl:3:61 XTMM9000', pe12: 'error c10.xsl:3:34 XTMM9000', sc13: 'error c10.xsl:3:61 XTMM9000' }, // xsl:message terminate
	c11: 'error lib.xsl:4:32 XTTE0780', // dynamic error in sub/lib.xsl
	c12: 'error libstatic.xsl:3:35 XTTE0780', // static error in sub/libstatic.xsl
	c13: 'error c13.xsl:4:37 XPTY0019', // path step on an atomic value
	c14: 'error c14.xsl:3:51 FODC0002', // doc() of a missing file
	c15: 'error c15.xsl:3:80 XPTY0004', // arithmetic on a string
	c16: null, // no error
	c17: 'error c17.xsl:3:36 XPST0003', // syntax error
	c18: { pe13: 'error c18.xsl:3:76 XTMM9001', he13: 'error c18.xsl:3:76 XTMM9001', pe12: 'error c18.xsl:3:39 XTMM9001', sc13: 'error c18.xsl:3:76 XTMM9001' }, // xsl:assert
	c19: 'error c19.xsl:4:44 FORG0001', // error in a nested function call
	c20: 'error c20.xsl:3:51 XTDE0410', // attribute after a child
	c21: 'error c21.xsl:3:94 XTTE0570', // map type
	c22: { pe13: 'error c22.xsl:6:65 FORG0001', he13: 'error c22.xsl:6:65 FORG0001', pe12: 'error c22.xsl:4:40 FORG0001', sc13: 'error c22.xsl:6:65 FORG0001' }, // function parameter type
	w01: null // a warning without a location in its header
};

describe('The $saxon-xslt problem matcher', () => {
	for (const [testCase, problem] of Object.entries(expected)) {
		for (const version of versions) {
			it(`${testCase} - ${version}`, () => {
				const output = fs.readFileSync(path.join(outputFolder, `${testCase}.${version}.txt`), 'utf8');
				const expectedProblem = problem === null || typeof problem === 'string' ? problem : problem[version];
				expect(problems(output, matcherPatterns('saxon-xslt'))).to.deep.equal(expectedProblem ? [expectedProblem] : []);
			});
		}
	}

	it('the same patterns in each $saxon-xslt matcher, and the named patterns', () => {
		const patterns = JSON.stringify(matcherPatterns('saxon-xslt'));
		const names = ['saxon-xslt.workspace', 'saxon-xslt.workspace.src', 'saxon-xslt.workspace.src.xsl', 'saxon-xslt.workspace.resources.xsl'];
		names.forEach((name) => expect(JSON.stringify(matcherPatterns(name)), name).to.equal(patterns));
		const named = packageJson.contributes.problemPatterns.map(({ name, ...pattern }: { name: string }) => pattern);
		expect(JSON.stringify(named)).to.equal(patterns);
	});
});
