/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - checking the problems of the files in a workspace or folder
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { ImportIndex } from './importIndex';
import { DiskTextDocument } from './mcp/diskTextDocument';
import { XsltMcpTools } from './mcp/xsltMcpTools';
import { XsltSymbolProvider } from './xsltSymbolProvider';

/**
 * 'Check Problems in Workspace' and 'Check Problems in Folder': the problems of the XSLT and XSpec files that aren't open
 * in an editor - e.g. those a change to a package's visibility breaks - shown in the Problems panel. They're in a
 * collection of their own, so 'Clear Workspace Check Problems' removes them and nothing else. A file's are removed when
 * it's opened in an editor - the editor's checks then show its problems - or changed or deleted on disk, as they may no
 * longer apply. Errors only, unless the XSLT.workspaceCheck.includeWarnings setting is on.
 */
export class WorkspaceCheck implements vscode.Disposable {
	public static readonly source = 'XSLT (workspace check)';
	public static readonly clearTitle = 'Clear';
	private static readonly askAbove = 1000;
	private readonly collection = vscode.languages.createDiagnosticCollection('xslt-workspace-check');
	private readonly disposables: vscode.Disposable[] = [this.collection];

	public constructor(private readonly problems: (document: vscode.TextDocument) => Promise<vscode.Diagnostic[]> | undefined) {
		this.disposables.push(
			// opened in an editor: the editor's checks take over
			vscode.window.tabGroups.onDidChangeTabs((event) => event.opened.concat(event.changed).forEach((tab) => {
				if (tab.input instanceof vscode.TabInputText) {
					this.collection.delete(tab.input.uri);
				}
			})),
			vscode.workspace.onDidChangeWorkspaceFolders((event) => event.removed.forEach((folder) => this.clearWithin(folder.uri.fsPath)))
		);
	}

	// for each folder checked: a watcher that removes a file's problems when it's changed or deleted on disk
	private readonly watchers = new Map<string, vscode.Disposable>();

	private watch(base: string) {
		if (this.watchers.has(base)) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), '**/*.{xsl,xslt,xspec}'), true, false, false);
		this.watchers.set(base, vscode.Disposable.from(watcher, watcher.onDidChange((uri) => this.collection.delete(uri)), watcher.onDidDelete((uri) => this.collection.delete(uri))));
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose());
		this.watchers.forEach((d) => d.dispose());
		this.watchers.clear();
	}

	// the problems found by the last checks - for tests
	public get results(): [vscode.Uri, readonly vscode.Diagnostic[]][] {
		const result: [vscode.Uri, readonly vscode.Diagnostic[]][] = [];
		this.collection.forEach((uri, diagnostics) => result.push([uri, diagnostics]));
		return result;
	}

	public clear() {
		this.collection.clear();
		this.watchers.forEach((d) => d.dispose());
		this.watchers.clear();
	}

	// checks the files of the folder - else of every workspace folder - and reports the result: the number of files with
	// problems, with buttons to show them in the Problems panel or clear them. interactive false: no questions or
	// messages, for tests. Returns the number of files checked, or undefined if cancelled
	public async check(folder?: vscode.Uri, interactive = true): Promise<number | undefined> {
		const folders = folder ? [folder.fsPath] : (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
		if (folders.length === 0) {
			if (interactive) {
				vscode.window.showInformationMessage('No folder is open, so there are no files to check');
			}
			return 0;
		}
		const where = folder ? path.basename(folder.fsPath) : folders.length === 1 ? path.basename(folders[0]) : 'the workspace';
		const files: string[] = [];
		for (const base of folders) {
			const pattern = '**/*.{xsl,xslt,xspec}';
			const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(base, pattern), XsltMcpTools.lintExcludes(base, pattern));
			files.push(...uris.map((uri) => uri.fsPath).filter((file) => /\.(xslt?|xspec)$/i.test(file)));
		}
		const unique = [...new Set(files)].sort();
		if (interactive && unique.length > WorkspaceCheck.askAbove &&
			await vscode.window.showWarningMessage(`Check the problems of ${unique.length} files in ${where}? It may take a while`, { modal: true }, 'Check') !== 'Check') {
			return undefined;
		}
		const includeWarnings = vscode.workspace.getConfiguration('XSLT.workspaceCheck').get<boolean>('includeWarnings', false);
		const worst = includeWarnings ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
		// the results of the files checked before, in the folders checked now, are replaced
		folders.forEach((base) => {
			this.clearWithin(base);
			this.watch(base);
		});
		const run = async (progress?: vscode.Progress<{ message?: string, increment?: number }>, token?: vscode.CancellationToken) => {
			if (ImportIndex.isEnabled()) {
				await ImportIndex.instance.whenBuilt();
			}
			let checked = 0;
			for (const file of unique) {
				if (token?.isCancellationRequested) {
					return undefined;
				}
				progress?.report({ message: `${checked + 1} of ${unique.length}: ${path.basename(file)}`, increment: 100 / unique.length });
				const uri = vscode.Uri.file(file);
				const document = await DiskTextDocument.current(uri);
				// one open in an editor has the editor's checks
				if (XsltSymbolProvider.isOpenInEditor(document)) {
					continue;
				}
				const diagnostics = await this.problems(document);
				if (!diagnostics) {
					continue;
				}
				checked++;
				const shown = diagnostics.filter((d) => d.severity <= worst).map((d) => {
					const diagnostic = new vscode.Diagnostic(d.range, d.message, d.severity);
					diagnostic.code = d.code;
					diagnostic.relatedInformation = d.relatedInformation;
					diagnostic.tags = d.tags;
					diagnostic.source = WorkspaceCheck.source;
					return diagnostic;
				});
				if (shown.length > 0) {
					this.collection.set(uri, shown);
				}
			}
			return checked;
		};
		const checked = interactive ? await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Checking the problems of the files in ${where}`, cancellable: true },
			(progress, token) => run(progress, token)) : await run();
		if (checked === undefined || !interactive) {
			return checked;
		}
		let problems = 0;
		let withProblems = 0;
		this.collection.forEach((uri, diagnostics) => {
			if (folders.some((base) => WorkspaceCheck.isWithin(uri.fsPath, base))) {
				problems += diagnostics.length;
				withProblems++;
			}
		});
		const kind = includeWarnings ? 'problem' : 'error';
		if (problems === 0) {
			vscode.window.showInformationMessage(`Checked ${checked} ${checked === 1 ? 'file' : 'files'} in ${where}: no ${kind}s${includeWarnings ? '' : ' (warnings aren\'t checked - see the XSLT.workspaceCheck.includeWarnings setting)'}`);
			return checked;
		}
		const show = 'Show Problems';
		const choice = await vscode.window.showWarningMessage(`Checked ${checked} ${checked === 1 ? 'file' : 'files'} in ${where}: ${problems} ${problems === 1 ? kind : kind + 's'} in ${withProblems} ${withProblems === 1 ? 'file' : 'files'} that aren't open`, show, WorkspaceCheck.clearTitle);
		if (choice === show) {
			vscode.commands.executeCommand('workbench.actions.view.problems');
		} else if (choice === WorkspaceCheck.clearTitle) {
			this.clear();
		}
		return checked;
	}

	private clearWithin(base: string) {
		const within: vscode.Uri[] = [];
		this.collection.forEach((uri) => {
			if (WorkspaceCheck.isWithin(uri.fsPath, base)) {
				within.push(uri);
			}
		});
		within.forEach((uri) => this.collection.delete(uri));
	}

	private static isWithin(file: string, folder: string) {
		const relative = path.relative(folder, file);
		return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
	}
}
