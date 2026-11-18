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

	// the server's URL for a project's folder
	public static urlFor(url: string, folder: string) {
		return `${url}?root=${encodeURIComponent(folder)}`;
	}
}
