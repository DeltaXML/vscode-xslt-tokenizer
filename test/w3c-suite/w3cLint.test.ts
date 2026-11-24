/**
 * Not part of the test suite: lints the stylesheets of the W3C XSLT test suites, to measure the linter's accuracy -
 * run with `npm run w3c-lint` (see .vscode-test.w3c.js). Each test case's principal stylesheet is linted, with its
 * imports and includes, as the extension lints a module on its own, and the problems are compared with the test
 * case's expected result in the catalog: a test case that expects no static error should have no problems reported.
 *
 * - W3C_SUITES: the suites' folders, separated by the path delimiter - default ~/Documents/xslt30-test and xslt40-test
 * - W3C_OUT: the folder for the results - default w3c-lint-results in the OS temp folder
 * - W3C_FILTER: a regular expression for the test-set names to lint, e.g. '^attr' - default all
 *
 * The results are results.jsonl (a line for each test case) and summary.md: for the test cases expected to compile,
 * the errors and warnings reported, grouped by message, with the test cases - and the linter's exceptions. And for
 * each suite, false-errors-<suite>.md: those test cases with errors, by test set, each error linked to its line
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XsltSymbolProvider, XsltPackage } from '../../src/xsltSymbolProvider';
import { XsltPackages } from '../../src/xsltPackages';
import { ImportIndex } from '../../src/importIndex';

type Expectation = 'compiles' | 'dynamic-error' | 'static-error' | 'maybe-static';
interface TestCase { suite: string, set: string, name: string, stylesheets: string[], packages: XsltPackage[], expectation: Expectation, errorCodes: string[], skipped?: string }
interface Problem { file: string, line: number, severity: string, message: string }

// static errors are reported when a stylesheet is compiled; XPTY0004 may be static or dynamic
const isStatic = (code: string) => /^(XTSE|XPST|XQST|XTTE0590)/.test(code);
const isDynamic = (code: string) => !isStatic(code) && code !== 'XPTY0004' && !/^\*$/.test(code);

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`).exec(tag)?.[2];

// the dependencies that rule a test case out: schema-aware processing (see the project's scope), and for the XSLT 3.0
// suite, a spec other than XSLT 3.0 or earlier
function unsupported(dependencies: string, suite: string): string | undefined {
	for (const tag of dependencies.match(/<(spec|feature)\s[^>]*>/g) ?? []) {
		const value = attribute(tag, 'value') ?? '';
		const satisfied = attribute(tag, 'satisfied') !== 'false';
		if (tag.startsWith('<feature') && satisfied && /schema_aware/.test(value)) {
			return 'schema_aware';
		}
		if (tag.startsWith('<spec') && suite === 'xslt30-test' && !/XSLT(10|20|30)\+|XSLT30\b/.test(value)) {
			return `spec ${value}`;
		}
	}
	return undefined;
}

function testCases(suiteDir: string, setFilter: RegExp | undefined): TestCase[] {
	const suite = path.basename(suiteDir);
	const catalog = fs.readFileSync(path.join(suiteDir, 'catalog.xml'), 'utf8');
	const cases: TestCase[] = [];
	for (const setTag of catalog.match(/<test-set\s[^>]*>/g) ?? []) {
		const set = attribute(setTag, 'name') ?? '';
		const file = attribute(setTag, 'file');
		if (!file || (setFilter && !setFilter.test(set))) {
			continue;
		}
		const setPath = path.join(suiteDir, file);
		const text = fs.readFileSync(setPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
		// the named environments, which test cases refer to - for the packages they use
		const environments = new Map<string, string>();
		for (const env of text.match(/<environment\s+name\s*=\s*["'][^"']*["'][\s\S]*?<\/environment>/g) ?? []) {
			environments.set(attribute(/<environment\s[^>]*>/.exec(env)![0], 'name') ?? '', env);
		}
		const setDependencies =/<dependencies>([\s\S]*?)<\/dependencies>(?=[\s\S]*<test-case)/.exec(text.substring(0, text.indexOf('<test-case')))?.[1] ?? '';
		for (const block of text.match(/<test-case\s[\s\S]*?<\/test-case>/g) ?? []) {
			const name = attribute(/<test-case\s[^>]*>/.exec(block)![0], 'name') ?? '';
			const test = /<test>([\s\S]*?)<\/test>/.exec(block)?.[1] ?? '';
			// the principal stylesheet or package, not a secondary one, e.g. an imported module
			const stylesheets = (test.match(/<(stylesheet|package)\s[^>]*>/g) ?? [])
				.filter((tag) => !/\srole\s*=\s*["']secondary/.test(tag))
				.map((tag) => attribute(tag, 'file')).filter((f): f is string => !!f).map((f) => path.join(path.dirname(setPath), f));
			// the packages it may use: the secondary packages - in the test, or its environment
			const environmentRef = /<environment\s+ref\s*=\s*["']([^"']*)["']/.exec(block)?.[1];
			const packageTags = (block + (environmentRef ? environments.get(environmentRef) ?? '' : '')).match(/<package\s[^>]*>/g) ?? [];
			// as Saxon's -lib finds them: by the name and version of their xsl:package, which may not be the catalog's
			const packages: XsltPackage[] = packageTags.filter((tag) => attribute(tag, 'file') && attribute(tag, 'role') === 'secondary').map((tag) => {
				const packagePath = path.join(path.dirname(setPath), attribute(tag, 'file')!);
				let declaration: { name: string, version: string } | undefined;
				try {
					declaration = ImportIndex.packageDeclaration(fs.readFileSync(packagePath, 'utf8'));
				} catch {
					declaration = undefined;
				}
				return { name: declaration?.name ?? attribute(tag, 'uri') ?? '', version: declaration?.version ?? attribute(tag, 'package-version') ?? '1', path: packagePath };
			});
			const result = /<result>([\s\S]*?)<\/result>/.exec(block)?.[1] ?? '';
			const errorCodes = (result.match(/<error\s[^>]*>/g) ?? []).map((tag) => attribute(tag, 'code') ?? '*');
			// an any-of with an assertion and an error, e.g. an optional feature: may or may not compile
			const hasAssertion = /<assert/.test(result);
			const expectation: Expectation = errorCodes.length === 0 ? 'compiles' : errorCodes.every(isDynamic) ? 'dynamic-error' :
				errorCodes.some(isStatic) && !hasAssertion ? 'static-error' : 'maybe-static';
			const dependencies = (/<dependencies>([\s\S]*?)<\/dependencies>/.exec(block)?.[1] ?? '') + setDependencies;
			const skipped = stylesheets.length === 0 ? 'no stylesheet' : unsupported(dependencies, suite) ?? (stylesheets.some((s) => !fs.existsSync(s)) ? 'missing file' : undefined);
			cases.push({ suite, set, name, stylesheets, packages, expectation, errorCodes, skipped });
		}
	}
	return cases;
}

const severityName = (severity: vscode.DiagnosticSeverity) => ['error', 'warning', 'information', 'hint'][severity];
// a message's kind, for grouping: without the names and values quoted in it
const kind = (message: string) => message.replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N');

suite('W3C XSLT test suites: lint', function () {
	this.timeout(0);
	test('lint each test case\'s stylesheet', async () => {
		const suites = (process.env.W3C_SUITES ?? ['xslt30-test', 'xslt40-test'].map((s) => path.join(os.homedir(), 'Documents', s)).join(path.delimiter)).split(path.delimiter);
		const outDir = process.env.W3C_OUT ?? path.join(os.tmpdir(), 'w3c-lint-results');
		const setFilter = process.env.W3C_FILTER ? new RegExp(process.env.W3C_FILTER) : undefined;
		fs.mkdirSync(outDir, { recursive: true });
		const results = fs.createWriteStream(path.join(outDir, 'results.jsonl'));
		const progress = path.join(outDir, 'progress.txt');
		// a stylesheet that isn't linted in the time is a timeout, e.g. for a promise that's never resolved
		const timeLimit = Number(process.env.W3C_TIME_LIMIT ?? 20000);
		const withinLimit = <T>(promise: Thenable<T>) => Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout: not linted in ${timeLimit}ms`)), timeLimit))]);
		const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean | string): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
		// the problems by stylesheet: a stylesheet may be shared by test cases
		const linted = new Map<string, { problems: Problem[], exception?: string }>();
		const all: (TestCase & { problems: Problem[], exception?: string })[] = [];
		for (const suiteDir of suites) {
			const cases = testCases(suiteDir, setFilter);
			console.log(`${path.basename(suiteDir)}: ${cases.length} test cases`);
			for (const testCase of cases) {
				let problems: Problem[] = [];
				let exception: string | undefined;
				if (!testCase.skipped) {
					XsltPackages.additional = testCase.packages;
					for (const file of testCase.stylesheets) {
						// a stylesheet linted with other packages is linted again
						const key = [file, ...testCase.packages.map((p) => p.path)].join(' ');
						let entry = linted.get(key);
						if (!entry) {
							try {
								fs.writeFileSync(progress, file);
								const document = await withinLimit(vscode.workspace.openTextDocument(vscode.Uri.file(file)));
								const xslt = document.languageId === 'xslt' ? document : await withinLimit(vscode.languages.setTextDocumentLanguage(document, 'xslt'));
								const diagnostics = await withinLimit(moduleDiagnostics.call(XsltSymbolProvider, xslt, false));
								entry = { problems: diagnostics.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint)
									.map((d) => ({ file: path.relative(suiteDir, file), line: d.range.start.line + 1, severity: severityName(d.severity), message: d.message })) };
							} catch (error) {
								entry = { problems: [], exception: String(error instanceof Error ? error.stack ?? error.message : error).split('\n').slice(0, 4).join(' | ') };
							}
							linted.set(key, entry);
						}
						problems = problems.concat(entry.problems);
						exception = exception ?? entry.exception;
					}
				}
				const record = { ...testCase, stylesheets: testCase.stylesheets.map((s) => path.relative(suiteDir, s)), problems, exception, rootVersion: rootVersion(testCase.stylesheets[0]) };
				all.push(record);
				results.write(JSON.stringify(record) + '\n');
			}
		}
		results.end();
		fs.writeFileSync(path.join(outDir, 'summary.md'), summary(all));
		for (const suiteDir of suites) {
			const suite = path.basename(suiteDir);
			fs.writeFileSync(path.join(outDir, `false-errors-${suite}.md`), falseErrors(all.filter((c) => c.suite === suite), suiteDir, outDir));
		}
		console.log(`results: ${outDir}`);
	});
});

type LintedCase = TestCase & { problems: Problem[], exception?: string, rootVersion?: string };

// the version attribute of a stylesheet's root element, if it has one
function rootVersion(file: string | undefined): string | undefined {
	try {
		const text = file ? fs.readFileSync(file, 'utf8') : '';
		return /<(?:[\w.-]+:)?(?:stylesheet|transform|package)\b[^>]*?\sversion\s*=\s*["']\s*([^"']*?)\s*["']/.exec(text)?.[1];
	} catch {
		return undefined;
	}
}

// why a test case expected to compile, with errors reported, isn't counted as having false errors - or undefined:
// - it expects a dynamic error, and the linter has often found that error, before the stylesheet's run, e.g. key('k')
//   with no key k (XTDE1260), or no context item for '.' (XPDY0002) - listed apart, to be checked
// - in the XSLT 3.0 suite, with version="4.0": a forwards compatible stylesheet for an XSLT 3.0 processor, but XSLT 4.0
//   for Saxon 13 with syntax extensions, which reports the same errors as the linter (e.g. forwards-101)
function notCounted(c: LintedCase): 'dynamic-error' | 'xslt40' | undefined {
	if (c.expectation === 'dynamic-error') {
		return 'dynamic-error';
	}
	return c.suite === 'xslt30-test' && Number(c.rootVersion) === 4 ? 'xslt40' : undefined;
}

const hasErrors = (c: LintedCase) => !c.skipped && (c.expectation === 'compiles' || c.expectation === 'dynamic-error') &&
	c.problems.some((p) => p.severity === 'error');

// a suite's false errors: each test case expected to compile that has errors reported, by test set, with a link to the
// file of each error - the stylesheet, or a module it imports or includes - to open in VS Code, and its line. Then those
// not counted (see notCounted)
function falseErrors(cases: LintedCase[], suiteDir: string, outDir: string): string {
	const suite = path.basename(suiteDir);
	const withErrors = cases.filter(hasErrors);
	const failing = withErrors.filter((c) => !notCounted(c));
	// the line is in the link's text: a '#L' fragment stops VS Code's Markdown preview opening the file
	// relative to this file: VS Code's Markdown takes a path starting with '/' as in the workspace folder, not the file system
	const link = (p: Problem) => `[${p.file}:${p.line}](${encodeURI(path.relative(outDir, path.join(suiteDir, p.file)).split(path.sep).join('/'))})`;
	const lines = [`# W3C false errors: ${suite}`, '',
		`${failing.length} test cases expected to compile have errors reported, in ${new Set(failing.map((c) => c.set)).size} test sets. ` +
		'Each error links to its file, with the line in the link text.', ''];
	const caseLines = (c: LintedCase, label: string) => {
		// each error once: a stylesheet may be shared by test cases, and an imported module's errors repeated
		const errors = [...new Map(c.problems.filter((p) => p.severity === 'error').map((p) => [`${p.file}:${p.line}:${p.message}`, p])).values()];
		return errors.length === 1 ? [`- **${label}** - ${link(errors[0])} - ${errors[0].message}`] :
			[`- **${label}**`, ...errors.map((p) => `  - ${link(p)} - ${p.message}`)];
	};
	const sets = [...new Set(failing.map((c) => c.set))].sort();
	for (const set of sets) {
		const inSet = failing.filter((c) => c.set === set);
		lines.push(`## ${set} (${inSet.length})`, '');
		inSet.forEach((c) => lines.push(...caseLines(c, c.name)));
		lines.push('');
	}
	const dynamic = withErrors.filter((c) => notCounted(c) === 'dynamic-error');
	if (dynamic.length > 0) {
		lines.push(`# Not counted: test cases expecting a dynamic error (${dynamic.length})`, '',
			'The linter may have found the error the test case expects Saxon to report when the stylesheet runs - check that it has.', '');
		dynamic.forEach((c) => lines.push(...caseLines(c, `${c.name} (${c.errorCodes.join(', ')})`)));
		lines.push('');
	}
	const xslt40 = withErrors.filter((c) => notCounted(c) === 'xslt40');
	if (xslt40.length > 0) {
		lines.push(`# Not counted: version="4.0" in the XSLT 3.0 suite (${xslt40.length})`, '',
			'Forwards compatible for an XSLT 3.0 processor - but XSLT 4.0 for Saxon 13 with syntax extensions, which reports these errors too.', '');
		xslt40.forEach((c) => lines.push(...caseLines(c, c.name)));
		lines.push('');
	}
	return lines.join('\n');
}

function summary(all: LintedCase[]): string {
	const lines: string[] = ['# W3C XSLT test suites: lint results', ''];
	const counted = (filter: (c: typeof all[number]) => boolean) => all.filter(filter).length;
	for (const suite of [...new Set(all.map((c) => c.suite))]) {
		const cases = all.filter((c) => c.suite === suite);
		const linted = cases.filter((c) => !c.skipped);
		const shouldCompile = linted.filter((c) => c.expectation === 'compiles' || c.expectation === 'dynamic-error');
		const withErrors = shouldCompile.filter(hasErrors);
		const falseErrors = withErrors.filter((c) => !notCounted(c));
		const staticExpected = linted.filter((c) => c.expectation === 'static-error');
		const caught = staticExpected.filter((c) => c.problems.some((p) => p.severity === 'error'));
		lines.push(`## ${suite}`, '',
			`- test cases: ${cases.length}, skipped: ${cases.length - linted.length} (${[...new Set(cases.filter((c) => c.skipped).map((c) => c.skipped!.replace(/ .*/, '')))].join(', ')})`,
			`- expected to compile: ${shouldCompile.length} - with errors reported: **${falseErrors.length}**, with only warnings: ${shouldCompile.filter((c) => !withErrors.includes(c) && c.problems.length > 0).length}`,
			`- not counted: ${withErrors.filter((c) => notCounted(c) === 'dynamic-error').length} expecting a dynamic error the linter may have found, ` +
				`${withErrors.filter((c) => notCounted(c) === 'xslt40').length} with version="4.0" in the XSLT 3.0 suite - see false-errors-${suite}.md`,
			`- expected to have a static error: ${staticExpected.length} - with an error reported: ${caught.length} (Saxon reports the rest)`,
			`- may or may not compile: ${counted((c) => c.suite === suite && !c.skipped && c.expectation === 'maybe-static')}`,
			`- linter exceptions: ${linted.filter((c) => c.exception).length}`, '');
	}
	// those counted as having false errors - and their warnings
	const shouldCompile = all.filter((c) => !c.skipped && (c.expectation === 'compiles' || c.expectation === 'dynamic-error') && !notCounted(c));
	for (const severity of ['error', 'warning']) {
		const groups = new Map<string, { cases: Set<string>, examples: string[] }>();
		shouldCompile.forEach((c) => c.problems.filter((p) => p.severity === severity).forEach((p) => {
			const group = groups.get(kind(p.message)) ?? { cases: new Set(), examples: [] };
			group.cases.add(`${c.suite}/${c.set}/${c.name}`);
			if (group.examples.length < 3) {
				group.examples.push(`${c.suite}/${p.file}:${p.line} - ${p.message}`);
			}
			groups.set(kind(p.message), group);
		}));
		lines.push(`## ${severity === 'error' ? 'Errors' : 'Warnings'} in test cases expected to compile, by message`, '');
		[...groups.entries()].sort((a, b) => b[1].cases.size - a[1].cases.size).forEach(([message, group]) => {
			lines.push(`### ${group.cases.size} test cases: ${message}`, '', ...group.examples.map((e) => `- ${e}`), '');
		});
	}
	const exceptions = all.filter((c) => c.exception);
	if (exceptions.length > 0) {
		lines.push('## Linter exceptions', '', ...exceptions.slice(0, 50).map((c) => `- ${c.suite}/${c.stylesheets[0]}: ${c.exception}`), '');
	}
	return lines.join('\n');
}
