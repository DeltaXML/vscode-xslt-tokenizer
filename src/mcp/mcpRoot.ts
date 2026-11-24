/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import { AsyncLocalStorage } from 'async_hooks';
import * as vscode from 'vscode';

// The folder the MCP tools resolve relative paths against, and show paths relative to: the project folder of the request -
// set up in a multi-root workspace for the folder that Claude Code runs in, as the root in the server's URL - else the
// first workspace folder. It's kept for the request, as its tools run
export class McpRoot {
	private static readonly storage = new AsyncLocalStorage<string>();

	// the workspace folders a root may be: for testing, others
	public static allowed = () => (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file').map((folder) => folder.uri.fsPath);

	public static current(): string | undefined {
		return McpRoot.storage.getStore() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	// the root a request's URL asks for - only one of the workspace folders, else none
	public static fromUrl(requestUrl: string | undefined): string | undefined {
		const root = new URL(requestUrl ?? '', 'http://127.0.0.1').searchParams.get('root');
		return root ? McpRoot.allowed().find((folder) => folder === root) : undefined;
	}

	public static run<T>(root: string | undefined, action: () => T): T {
		return root ? McpRoot.storage.run(root, action) : action();
	}

	// the workspace folders, in a window with more than one - else none: the root first, as it's where relative paths start
	public static folders(): string[] {
		const all = McpRoot.allowed();
		const root = McpRoot.current();
		return all.length > 1 ? [...all.filter((folder) => folder === root), ...all.filter((folder) => folder !== root)] : [];
	}

	// what an assistant is told when it connects, in a window with more than one workspace folder - the paths it can't know
	public static instructions(): string {
		const [root, ...others] = McpRoot.folders();
		const folders = root ? `This VS Code window has ${others.length + 1} workspace folders: ${root} (where relative paths start) and ${others.join(', ')}. ` +
			'The tools can check files in all of them: give an absolute path for a file that\'s not in the first. lint_files with no folder checks only ' +
			'the first - to check every folder, call it for each.\n\n' : '';
		return folders + McpRoot.workflow;
	}

	// for every session: the checks to make whenever an XSLT, XSpec or Schematron file is changed - even a small edit, where a
	// skill may not seem needed (e.g. removing an instruction), as the user's editor shows the same problems
	public static readonly workflow = 'Before changing an XSLT (.xsl, .xslt), XSpec (.xspec) or Schematron (.sch) file - however small the ' +
		'change, e.g. removing an instruction - load the skill for it: xslt-xpath, xspec-testing or schematron (xslt-debugging to find why ' +
		'output is wrong). After each change, check the file with lint_file: the user\'s editor shows the same problems, and a change can leave ' +
		'others behind, e.g. a prefix or an xsl:include no longer used. Before changing an XSLT task in .vscode/tasks.json - how a stylesheet ' +
		'is run: its source, parameters, initial template or mode, catalog - call run_configuration with tasks: true, for the properties a task ' +
		'has and its problems; check it again after the change.';

	// the server's URL for a project's folder
	public static urlFor(url: string, folder: string) {
		return `${url}?root=${encodeURIComponent(folder)}`;
	}
}
