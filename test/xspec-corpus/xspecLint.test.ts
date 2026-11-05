/**
 * Not part of the test suite: lints the XSpec files of a folder, e.g. the XSpec project's own tests and tutorials, to
 * measure the linter's accuracy for XSpec - run with `npm run xspec-lint` (see .vscode-test.xspec.js). Each .xspec file
 * is linted as the extension lints it, with the stylesheet it tests.
 *
 * - XSPEC_CORPUS: the folder to lint, e.g. a copy of https://github.com/xspec/xspec
 * - XSPEC_OUT: the folder for the results - default xspec-lint-results in the OS temp folder
 * - XSPEC_FILTER: a regular expression for the paths of the files to lint, relative to the folder - default all
 *
 * The results are results.jsonl (a line for each file) and summary.md: the problems reported, grouped by message
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSpecConfiguration } from '../../src/languageConfigurations';
import { LanguageConfiguration } from '../../src/xslLexer';

interface Problem { line: number, severity: string, message: string }

const severityName = (severity: vscode.DiagnosticSeverity) => ['error', 'warning', 'information', 'hint'][severity];
// a message's kind, for grouping: without the names and values quoted in it
const kind = (message: string) => message.replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N');

function xspecFiles(folder: string): string[] {
	return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(folder, entry.name);
		return entry.isDirectory() ? xspecFiles(entryPath) : entry.name.endsWith('.xspec') ? [entryPath] : [];
	});
}

suite('XSpec files: lint', function () {
	this.timeout(0);
	test('lint each XSpec file', async () => {
		const corpus = process.env.XSPEC_CORPUS;
		if (!corpus) {
			throw new Error('XSPEC_CORPUS is not set');
		}
		const outDir = process.env.XSPEC_OUT ?? path.join(os.tmpdir(), 'xspec-lint-results');
		fs.mkdirSync(outDir, { recursive: true });
		const moduleDiagnostics = (XsltSymbolProvider as unknown as { moduleDiagnostics(d: vscode.TextDocument, parent: boolean, config: LanguageConfiguration): Promise<vscode.Diagnostic[]> }).moduleDiagnostics;
		const results: { file: string, problems: Problem[], exception?: string }[] = [];
		const filter = process.env.XSPEC_FILTER ? new RegExp(process.env.XSPEC_FILTER) : undefined;
		for (const file of xspecFiles(corpus).sort().filter((f) => !filter || filter.test(path.relative(corpus, f)))) {
			let problems: Problem[] = [];
			let exception: string | undefined;
			try {
				const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
				const diagnostics = await moduleDiagnostics.call(XsltSymbolProvider, document, false, XSpecConfiguration.configuration);
				problems = diagnostics.filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint)
					.map((d) => ({ line: d.range.start.line + 1, severity: severityName(d.severity), message: d.message }));
			} catch (error) {
				exception = String(error instanceof Error ? error.stack ?? error.message : error).split('\n').slice(0, 4).join(' | ');
			}
			results.push({ file: path.relative(corpus, file), problems, exception });
		}
		fs.writeFileSync(path.join(outDir, 'results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n') + '\n');
		const lines = ['# XSpec lint results', '', `- files: ${results.length}`,
			`- with errors: **${results.filter((r) => r.problems.some((p) => p.severity === 'error')).length}**`,
			`- with only warnings: ${results.filter((r) => r.problems.length > 0 && r.problems.every((p) => p.severity !== 'error')).length}`,
			`- linter exceptions: ${results.filter((r) => r.exception).length}`, ''];
		for (const severity of ['error', 'warning']) {
			const groups = new Map<string, { files: Set<string>, examples: string[] }>();
			results.forEach((r) => r.problems.filter((p) => p.severity === severity).forEach((p) => {
				const group = groups.get(kind(p.message)) ?? { files: new Set(), examples: [] };
				group.files.add(r.file);
				if (group.examples.length < 3) {
					group.examples.push(`${r.file}:${p.line} - ${p.message}`);
				}
				groups.set(kind(p.message), group);
			}));
			lines.push(`## ${severity === 'error' ? 'Errors' : 'Warnings'}, by message`, '');
			[...groups.entries()].sort((a, b) => b[1].files.size - a[1].files.size).forEach(([message, group]) => {
				lines.push(`### ${group.files.size} files: ${message}`, '', ...group.examples.map((e) => `- ${e}`), '');
			});
		}
		const exceptions = results.filter((r) => r.exception);
		if (exceptions.length > 0) {
			lines.push('## Linter exceptions', '', ...exceptions.slice(0, 50).map((r) => `- ${r.file}: ${r.exception}`), '');
		}
		fs.writeFileSync(path.join(outDir, 'summary.md'), lines.join('\n'));
		console.log(`results: ${outDir}`);
	});
});
