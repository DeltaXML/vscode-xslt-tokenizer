/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as childProcess from 'child_process';

// Claude Code's scopes for an MCP server: 'user' for all projects, 'local' for one project's folder (private to the user)
export type ClaudeScope = 'user' | 'local';

export interface ClaudeResult {
	ok: boolean;
	// 'claude' isn't on the PATH
	notFound: boolean;
	output: string;
}

// Sets up the MCP server in Claude Code by running its CLI: 'claude mcp add', after removing any earlier set-up, e.g. with
// an old token. The CLI is run directly, not in a terminal, so the token isn't shown
export class ClaudeCodeSetup {
	public static readonly serverName = 'xslt-xpath';
	// the program: 'claude', on the PATH - another for tests
	public static program = 'claude';

	public static addCommand(url: string, token: string, scope: ClaudeScope) {
		return `${ClaudeCodeSetup.program} mcp add --transport http${scope === 'user' ? ' --scope user' : ''} ${ClaudeCodeSetup.serverName} ${url} --header "Authorization: Bearer ${token}"`;
	}

	// the folder is the project's, for the 'local' scope
	public static async setUp(url: string, token: string, scope: ClaudeScope, folder?: string): Promise<ClaudeResult> {
		const removed = await ClaudeCodeSetup.remove(scope, folder);
		if (removed.notFound) {
			return removed;
		}
		return ClaudeCodeSetup.run(['mcp', 'add', '--transport', 'http', '--scope', scope, ClaudeCodeSetup.serverName, url, '--header', `Authorization: Bearer ${token}`], folder);
	}

	// sets it up again, with the new token, where it's set up now: for all projects, and for each of the folders - the
	// scopes and folders updated
	public static async update(url: string, token: string, folders: string[]): Promise<{ updated: string[], result?: ClaudeResult }> {
		const updated: string[] = [];
		const places: { scope: ClaudeScope, folder?: string, name: string }[] = [{ scope: 'user', name: 'all projects' }, ...folders.map((folder) => ({ scope: 'local' as ClaudeScope, folder, name: folder }))];
		for (const place of places) {
			const removed = await ClaudeCodeSetup.remove(place.scope, place.folder);
			if (removed.notFound) {
				return { updated, result: removed };
			}
			if (removed.ok) {
				const added = await ClaudeCodeSetup.run(['mcp', 'add', '--transport', 'http', '--scope', place.scope, ClaudeCodeSetup.serverName, url, '--header', `Authorization: Bearer ${token}`], place.folder);
				if (!added.ok) {
					return { updated, result: added };
				}
				updated.push(place.name);
			}
		}
		return { updated };
	}

	// fails when it isn't set up in the scope
	private static remove(scope: ClaudeScope, folder?: string) {
		return ClaudeCodeSetup.run(['mcp', 'remove', '--scope', scope, ClaudeCodeSetup.serverName], folder);
	}

	private static run(args: string[], cwd?: string): Promise<ClaudeResult> {
		return new Promise((resolve) => {
			childProcess.execFile(ClaudeCodeSetup.program, args, { cwd, timeout: 30000, windowsHide: true }, (error, stdout, stderr) => {
				// shown in messages and the log, so without the token
				const output = `${stdout}${stderr}`.trim().replace(/Bearer\s+\S+/g, 'Bearer ***');
				resolve({ ok: !error, notFound: (error as NodeJS.ErrnoException | null)?.code === 'ENOENT', output: output || (error?.message ?? '') });
			});
		});
	}
}
