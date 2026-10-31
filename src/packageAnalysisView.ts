/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - converting a library to an XSLT package
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImportIndex } from './importIndex';
import { ConversionAnalysis, ConversionItem, ConversionSection, PackageConversion, Place } from './packageConversion';

/**
 * The 'Analyse as Package' command: for a library module - one that other stylesheets import or include - the report
 * of what converting it to an XSLT package would change (see PackageConversion), in a Markdown preview, with links to
 * the places in the modules. Nothing is changed. The report is a file in a temporary folder: the preview doesn't allow
 * file: links, so its links are paths relative to it, with #L for the line.
 */
export class PackageAnalysisView {

	public async analyse(target?: vscode.Uri | { path: string }) {
		const analysis = await PackageAnalysisView.analysisOf(target);
		if (analysis) {
			await PackageAnalysisView.showReport(analysis);
		}
	}

	// the 'Convert to Package' command: the library is converted, with the name and version given, in a refactoring that
	// the Refactor Preview shows - unless it can't be, when the analysis is shown
	public async convert(target?: vscode.Uri | { path: string }) {
		const analysis = await PackageAnalysisView.analysisOf(target);
		if (!analysis) {
			return;
		}
		const library = path.basename(analysis.library);
		const showAnalysis = 'Show Analysis';
		if (analysis.plan.preventing.length > 0) {
			const choice = await vscode.window.showWarningMessage(`${library} can't be converted to a package yet: ${PackageConversion.convert(analysis, '', '')}`, showAnalysis);
			if (choice === showAnalysis) {
				await PackageAnalysisView.showReport(analysis);
			}
			return;
		}
		const name = await vscode.window.showInputBox({
			title: `Convert ${library} to a Package`, prompt: 'The package\'s name - a URI', value: analysis.packageName,
			validateInput: (value) => /^\S+$/.test(value) ? undefined : 'A name without spaces, e.g. http://example.com/strings'
		});
		const version = name ? await vscode.window.showInputBox({
			title: `Convert ${library} to a Package`, prompt: 'The package\'s version', value: analysis.packageVersion,
			validateInput: (value) => /^\d+(\.\d+)*(-\S+)?$/.test(value.trim()) ? undefined : 'A version, e.g. 1.0 or 2.1.0-beta'
		}) : undefined;
		if (!name || !version) {
			return;
		}
		const edits = PackageConversion.convert(analysis, name, version.trim());
		if (typeof edits === 'string') {
			vscode.window.showWarningMessage(`${library} can't be converted to a package: ${edits}`);
			return;
		}
		const workspaceEdit = new vscode.WorkspaceEdit();
		for (const [file, fileEdits] of edits) {
			const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
			if (document.isDirty) {
				vscode.window.showWarningMessage(`Save ${path.basename(file)} before converting ${library} to a package`);
				return;
			}
			const label = { label: `Convert ${library} to package ${name}`, needsConfirmation: true };
			fileEdits.forEach((edit) => workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text, label));
		}
		if (await vscode.workspace.applyEdit(workspaceEdit, { isRefactoring: true })) {
			const decisions = analysis.items.filter((i) => i.severity === 'decision');
			if (decisions.length > 0 && await vscode.window.showInformationMessage(`${library} is converted to package ${name}: ${decisions.length} ${decisions.length === 1 ? 'item needs' : 'items need'} a decision - see the analysis`, showAnalysis) === showAnalysis) {
				await PackageAnalysisView.showReport(analysis);
			}
		}
	}

	private static async analysisOf(target?: vscode.Uri | { path: string }) {
		const file = target instanceof vscode.Uri ? target.fsPath : target?.path ?? vscode.window.activeTextEditor?.document.fileName;
		if (!file) {
			return undefined;
		}
		if (!ImportIndex.isEnabled()) {
			vscode.window.showWarningMessage('The workspace isn\'t scanned for stylesheets - see the XSLT.resources.inferParentFromWorkspace setting');
			return undefined;
		}
		await ImportIndex.instance.whenBuilt();
		const analysis = await PackageConversion.analyse(file);
		if (typeof analysis === 'string') {
			vscode.window.showInformationMessage(`${path.basename(file)}: ${analysis}`);
			return undefined;
		}
		return analysis;
	}

	private static async showReport(analysis: ConversionAnalysis) {
		const file = analysis.library;
		const folder = path.join(os.tmpdir(), 'xslt-package-analysis');
		fs.mkdirSync(folder, { recursive: true });
		const report = path.join(folder, `${path.basename(file)} as a package.md`);
		fs.writeFileSync(report, PackageAnalysisView.markdown(analysis, (p) => vscode.workspace.asRelativePath(p), (p, line) => PackageAnalysisView.href(folder, p, line)));
		await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(report));
	}

	// a link from a report in the folder to a line of a module: its path relative to the folder - or where there's none,
	// e.g. on another Windows drive, its absolute path - with the line as a fragment, e.g. #L12
	public static href(folder: string, file: string, line?: number) {
		const relative = path.relative(folder, file);
		const linkPath = path.isAbsolute(relative) ? vscode.Uri.file(file).path : relative.split(path.sep).map(encodeURIComponent).join('/');
		return linkPath + (line !== undefined ? `#L${line + 1}` : '');
	}

	private static readonly sections: [ConversionSection, string, string][] = [
		['blockers', 'To rework first', 'These would fail in a package, so they must be changed before converting.'],
		['visibility', 'Made public', 'A package\'s components are private unless made public, e.g. with xsl:expose.'],
		['override', 'Overrides', 'A stylesheet\'s declaration with the name of the library\'s must be in xsl:override.'],
		['abstract', 'Abstract components', 'The library uses these, but only the stylesheets declare them.'],
		['modes', 'Modes and template rules', ''],
		['not-shared', 'Not shared by a package', 'A package keeps these to itself, so the stylesheets need their own.']
	];

	// the report: a summary, then the items by section - each with a link to its first place, and its other places in a
	// list by module, e.g. the stylesheets that use a component - relative gives a module's name, href a link to a line
	public static markdown(analysis: ConversionAnalysis, relative: (file: string) => string, href: (file: string, line?: number) => string): string {
		const link = (place: Place) => `[${relative(place.path)}:${place.line + 1}](${href(place.path, place.line)})`;
		const byModule = (places: Place[]) => {
			const modules = [...new Set(places.map((p) => p.path))];
			return modules.map((module) => {
				const lines = [...new Set(places.filter((p) => p.path === module).map((p) => p.line))].sort((a, b) => a - b);
				const shown = lines.slice(0, 10).map((line) => `[${line + 1}](${href(module, line)})`).join(', ');
				return `  - [${relative(module)}](${href(module)}) - ${lines.length === 1 ? 'line' : 'lines'} ${shown}${lines.length > 10 ? ` and ${lines.length - 10} more` : ''}`;
			});
		};
		const files = (paths: string[]) => paths.map((p) => `[${relative(p)}](${href(p)})`).join(', ');
		const count = (severity: ConversionItem['severity']) => analysis.items.filter((i) => i.severity === severity).length;
		const blockers = count('blocker');
		const decisions = count('decision');
		const changes = count('change');
		const verdict = blockers > 0 ? `❌ **${blockers} ${blockers === 1 ? 'item needs' : 'items need'} reworking before it can be converted**` :
			decisions > 0 ? `⚠️ **It can be converted, with ${decisions} ${decisions === 1 ? 'decision' : 'decisions'}** - and ${changes} ${changes === 1 ? 'change' : 'changes'}` :
			`✅ **It can be converted** - with ${changes} ${changes === 1 ? 'change' : 'changes'}`;
		const lines = [
			`# ${path.basename(analysis.library)} as a package`, '',
			`What converting the library to an XSLT package - used with \`xsl:use-package\` instead of \`xsl:import\` or \`xsl:include\` - would change, for the stylesheets that use it to work as before. Nothing has been changed.`, '',
			`- **Package**: \`${analysis.packageName}\`, version ${analysis.packageVersion}`,
			`- **Library**: ${files(analysis.libraryModules)}`,
			`- **Stylesheets using it**: ${files(analysis.topLevels)}`, '',
			verdict, ''
		];
		if (analysis.plan.preventing.length === 0) {
			lines.push('To convert it, run **XSLT: Convert to Package...** - the changes are shown in the Refactor Preview before they\'re made.', '');
		}
		for (const [section, title, description] of PackageAnalysisView.sections) {
			const items = analysis.items.filter((i) => i.section === section);
			if (items.length === 0) {
				continue;
			}
			lines.push(`## ${title}`, '');
			if (description) {
				lines.push(description, '');
			}
			const icon = { change: '', decision: '⚠️ ', blocker: '❌ ' };
			items.forEach((item) => {
				lines.push(`- ${icon[item.severity]}**${item.subject}** - ${item.text}${item.places.length > 0 ? ' - ' + link(item.places[0]) : ''}`);
				lines.push(...byModule(item.places.slice(1)));
			});
			lines.push('');
		}
		if (analysis.items.length === 0) {
			lines.push('Nothing needs to change: the stylesheets don\'t use any of the library\'s components.', '');
		}
		return lines.join('\n');
	}
}
