/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as cp from 'child_process';

// A long-running Java process for 'Find Nodes with XPath' queries: XPathQuery --server, with a request on each line of
// its stdin and each result on a line of its stdout - so a query needn't wait for Java and Saxon to start, or xdm-view to
// compile, again. It's a child of the extension host (no port, so nothing else can reach it, and it ends with VS Code),
// started on the first query, restarted when the command changes (e.g. the XSLT.tasks.saxonJar setting) and stopped
// after a few idle minutes. One request runs at a time; a request while one is running (e.g. an expression that never
// ends) stops the process, and the earlier request fails with 'superseded'.
export class XPathQueryServer {
	public static readonly idleMs = 5 * 60 * 1000;
	public static readonly superseded = 'superseded';

	private child: cp.ChildProcessWithoutNullStreams | undefined;
	private key: string | undefined;
	private buffer = '';
	private stderr = '';
	private pending: { resolve: (result: any) => void; reject: (e: Error) => void } | undefined;
	private idleTimer: NodeJS.Timeout | undefined;

	constructor(private readonly idleMs = XPathQueryServer.idleMs) { }

	public request(command: string, args: string[], cwd: string | undefined, request: object): Promise<any> {
		const key = JSON.stringify([command, args, cwd]);
		if (this.pending || (this.child && this.key !== key)) {
			this.stop(XPathQueryServer.superseded);
		}
		if (!this.child) {
			this.start(command, args, cwd, key);
		}
		this.clearIdle();
		return new Promise((resolve, reject) => {
			this.pending = { resolve, reject };
			this.child!.stdin.write(JSON.stringify(request) + '\n', 'utf8');
		});
	}

	public get running() {
		return !!this.child;
	}

	public dispose() {
		this.stop('stopped');
	}

	private start(command: string, args: string[], cwd: string | undefined, key: string) {
		const child = cp.spawn(command, [...args, '--server'], { cwd });
		this.child = child;
		this.key = key;
		this.buffer = '';
		this.stderr = '';
		child.stdout.on('data', (data: Buffer) => {
			this.buffer += data.toString('utf8');
			for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
				const line = this.buffer.substring(0, end);
				this.buffer = this.buffer.substring(end + 1);
				this.settle((pending) => {
					try {
						pending.resolve(JSON.parse(line));
					} catch {
						pending.reject(new Error(`unexpected output: ${line.substring(0, 200)}`));
					}
				});
				this.startIdle();
			}
		});
		// kept short: only what's needed to say why it stopped
		child.stderr.on('data', (data: Buffer) => this.stderr = (this.stderr + data.toString('utf8')).slice(-4000));
		const ended = (e?: Error) => {
			if (this.child !== child) {
				return;
			}
			this.child = undefined;
			this.clearIdle();
			const reason = e?.message ?? (this.stderr.trim().split('\n').slice(0, 3).join(' ') || 'Java stopped');
			this.settle((pending) => pending.reject(new Error(reason)));
		};
		child.on('error', ended);
		child.on('exit', () => ended());
		// a write after it's stopped: reported by 'exit'
		child.stdin.on('error', () => undefined);
	}

	private stop(reason: string) {
		const child = this.child;
		this.child = undefined;
		this.clearIdle();
		this.settle((pending) => pending.reject(new Error(reason)));
		child?.kill();
	}

	private settle(action: (pending: { resolve: (result: any) => void; reject: (e: Error) => void }) => void) {
		const pending = this.pending;
		this.pending = undefined;
		if (pending) {
			action(pending);
		}
	}

	private startIdle() {
		this.clearIdle();
		this.idleTimer = setTimeout(() => this.stop('idle'), this.idleMs);
		// it doesn't keep Node running, e.g. at the end of a test
		this.idleTimer.unref?.();
	}

	private clearIdle() {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = undefined;
		}
	}
}
