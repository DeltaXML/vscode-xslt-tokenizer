/**
 * Test suite for the SaxonC task provider's platform-specific command lines
 *
 * When SaxonC's library path must be set, or its xsl:message output unescaped (the default), the provider runs
 * VS Code's own executable as Node.js, running the bundled xslt-resources/saxonc-transform.js script. The script
 * is passed the library path as SAXONC_LIBRARY_PATH and prepends it to DYLD_LIBRARY_PATH (macOS strips DYLD_*
 * variables a process merely inherits), LD_LIBRARY_PATH or PATH for Transform itself. Otherwise, Transform is
 * launched directly.
 *
 * os.platform() (and, for Windows, path.join) are swapped out while each task is built, so all three
 * platforms can be verified from any one host. On a POSIX host the script itself is also run, with Transform
 * swapped for a fake that emits its arguments and XML-escaped text, then exits with a non-zero status.
 */
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { assert } from 'chai';
import { SaxonCTaskProvider } from '../../src/saxonCTaskProvider';
import { SaxonTaskProvider } from '../../src/saxonTaskProvider';

type Platform = 'darwin' | 'linux' | 'win32';

const extensionRoot = path.resolve(__dirname, '..', '..', '..');
// derived as the provider does, via Uri.fsPath (which normalizes e.g. a Windows drive letter)
const scriptPath = vscode.Uri.joinPath(vscode.Uri.file(extensionRoot), 'xslt-resources', 'saxonc-transform.js').fsPath;

const platforms: { platform: Platform; saxonCPath: string; executablePath: string; extraLibraryPath: string; workFolder: string; expectedLibraryPath: string; lineBreak: string }[] = [
	{ platform: 'darwin', saxonCPath: '/opt/Saxon C/bin', executablePath: '/opt/Saxon C/bin/Transform', extraLibraryPath: '/opt/extra libs', workFolder: '/work/my files/', expectedLibraryPath: '/opt/Saxon C/lib:/opt/extra libs', lineBreak: '\\\r\n   ' },
	{ platform: 'linux', saxonCPath: '/opt/Saxon C/bin', executablePath: '/opt/Saxon C/bin/Transform', extraLibraryPath: '/opt/extra libs', workFolder: '/work/my files/', expectedLibraryPath: '/opt/Saxon C/lib:/opt/extra libs', lineBreak: '\\\r\n   ' },
	{ platform: 'win32', saxonCPath: 'C:\\Saxon C\\bin', executablePath: 'C:\\Saxon C\\bin\\Transform.exe', extraLibraryPath: 'D:\\extra libs', workFolder: 'C:\\work\\my files\\', expectedLibraryPath: 'C:\\Saxon C\\lib;D:\\extra libs', lineBreak: '^\r\n   ' },
];

// paths with spaces, and a result path with a single quote
function taskDefinition(saxonCPath: string, extraLibraryPath: string, workFolder: string, unescapeMessages?: boolean): vscode.TaskDefinition {
	const workPath = (name: string) => workFolder + name;
	return {
		type: 'xslt-c',
		label: 'platform test',
		saxonCPath: saxonCPath,
		saxonCLibraryPaths: [extraLibraryPath],
		licenseFileLocation: workPath('saxon-license.lic'),
		xsltFile: workPath('my style.xsl'),
		xmlSource: workPath('in file.xml'),
		resultPath: workPath("bob's out.xml"),
		parameters: [{ name: '?greeting', value: "'hello world'" }],
		unescapeMessages: unescapeMessages,
	};
}

function expectedArgs(workFolder: string) {
	return [
		`-xsl:${workFolder}my style.xsl`,
		`-s:${workFolder}in file.xml`,
		`-o:${workFolder}bob's out.xml`,
		`--licenseFileLocation:${workFolder}saxon-license.lic`,
		"?greeting='hello world'",
	];
}

function getTaskForPlatform(platform: Platform, definition: vscode.TaskDefinition) {
	const originalPlatform = os.platform;
	const originalJoin = path.join;
	(os as any).platform = () => platform;
	if (platform === 'win32') {
		(path as any).join = path.win32.join;
	}
	try {
		return new SaxonCTaskProvider('').getTask(definition);
	} finally {
		(os as any).platform = originalPlatform;
		(path as any).join = originalJoin;
	}
}

// runs the script with Transform swapped for a fake: it prints LD_LIBRARY_PATH, the env vars that shouldn't be
// passed on, its arguments and an escaped (result) line to stdout, then escaped (message) lines to stderr, and
// exits with status 3
function runScript(env: { [key: string]: string }, args: string[]) {
	const fakeTransform = path.join(os.tmpdir(), `fake-transform-${process.pid}.sh`);
	fs.writeFileSync(fakeTransform, [
		'#!/bin/sh',
		`printf '%s\\n' "\${LD_LIBRARY_PATH:-none}" "\${ELECTRON_RUN_AS_NODE:-none}\${SAXONC_LIBRARY_PATH:-none}\${SAXONC_UNESCAPE_MESSAGES:-none}"`,
		`printf '%s\\n' "$@"`,
		`printf '%s\\n' '&lt;result/&gt;'`,
		`printf '%s\\n' '&lt;a href=&quot;x&quot;&gt; &amp;#x1b; caf&#xe9; &#8364;' '&#x1b;[31mred&#27;[0m' >&2`,
		'exit 3',
	].join('\n'), { mode: 0o755 });
	try {
		const result = spawnSync(process.execPath, [scriptPath, '\\\r\n   ', fakeTransform].concat(args), {
			encoding: 'utf8',
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LD_LIBRARY_PATH: '/usr/existing', ...env },
		});
		return { status: result.status, stdout: result.stdout.split('\n'), stderr: result.stderr.split('\n') };
	} finally {
		fs.unlinkSync(fakeTransform);
	}
}

suite('SaxonC Task Provider - platform command lines', () => {
	suiteSetup(() => {
		SaxonTaskProvider.extensionURI ??= vscode.Uri.file(extensionRoot);
	});

	for (const { platform, saxonCPath, executablePath, extraLibraryPath, workFolder, expectedLibraryPath, lineBreak } of platforms) {
		for (const unescapeMessages of [undefined, false]) {
			test(`${platform}: runs Transform via the bundled script, passing SAXONC_LIBRARY_PATH (unescapeMessages: ${unescapeMessages})`, () => {
				const task = getTaskForPlatform(platform, taskDefinition(saxonCPath, extraLibraryPath, workFolder, unescapeMessages));
				assert.exists(task);

				const execution = task!.execution;
				assert.instanceOf(execution, vscode.ProcessExecution);
				const processExecution = execution as vscode.ProcessExecution;
				// VS Code's own executable, run as Node.js
				assert.strictEqual(processExecution.process, process.execPath);
				// arguments are passed as an array - no shell, so no quoting
				assert.deepEqual(processExecution.args, [scriptPath, lineBreak, executablePath].concat(expectedArgs(workFolder)));
				assert.deepEqual(processExecution.options?.env, {
					ELECTRON_RUN_AS_NODE: '1',
					// unescapeMessages is on unless explicitly set to false
					SAXONC_UNESCAPE_MESSAGES: String(unescapeMessages !== false),
					SAXONC_LIBRARY_PATH: expectedLibraryPath,
				});
			});
		}

		test(`${platform}: the echoed command line breaks before the Transform executable`, () => {
			const processExecution = getTaskForPlatform(platform, taskDefinition(saxonCPath, extraLibraryPath, workFolder))!.execution as vscode.ProcessExecution;
			// as VS Code echoes a ProcessExecution in the terminal: its arguments joined with spaces
			const echoedLines = `${processExecution.process} ${processExecution.args.join(' ')}`.split('\r\n');
			assert.deepEqual(echoedLines, [
				`${process.execPath} ${scriptPath} ${lineBreak.charAt(0)}`,
				`    ${executablePath} ${expectedArgs(workFolder).join(' ')}`,
			]);
		});

		test(`${platform}: with no library path and unescapeMessages false, launches Transform directly`, () => {
			const definition: vscode.TaskDefinition = { type: 'xslt-c', label: 'direct', xsltFile: 'a.xsl', xmlSource: 'a.xml', unescapeMessages: false };
			const processExecution = getTaskForPlatform(platform, definition)!.execution as vscode.ProcessExecution;
			assert.strictEqual(processExecution.process, platform === 'win32' ? 'Transform.exe' : 'Transform');
			assert.deepEqual(processExecution.args, ['-xsl:a.xsl', '-s:a.xml']);
			assert.isUndefined(processExecution.options?.env);
		});
	}

	test('saxonc-transform.js: unescapes messages on stderr, leaving stdout and the exit status unchanged', function () {
		if (os.platform() === 'win32') {
			this.skip(); // the fake Transform is a shell script
		}
		const args = expectedArgs('/work/my files/').concat(['?quoted="a \\"b\\""', '']);
		const result = runScript({ SAXONC_UNESCAPE_MESSAGES: 'true', SAXONC_LIBRARY_PATH: '/opt/Saxon C/lib' }, args);
		assert.strictEqual(result.status, 3);
		// the fake prints LD_LIBRARY_PATH, prepended to by the script on Linux - on macOS it prepends to
		// DYLD_LIBRARY_PATH instead, which SIP strips before it reaches the /bin/sh-run fake
		const expectedLibraryPath = os.platform() === 'linux' ? '/opt/Saxon C/lib:/usr/existing' : '/usr/existing';
		// neither ELECTRON_RUN_AS_NODE nor the SAXONC_ variables are passed on, nor the line-break argument
		assert.deepEqual(result.stdout, [expectedLibraryPath, 'nonenonenone'].concat(args, ['&lt;result/&gt;', '']));
		assert.deepEqual(result.stderr, ['<a href="x"> &#x1b; caf\u00e9 \u20ac', '\x1b[31mred\x1b[0m', '']);
	});

	test('saxonc-transform.js: leaves messages unchanged when not unescaping', function () {
		if (os.platform() === 'win32') {
			this.skip(); // the fake Transform is a shell script
		}
		const result = runScript({ SAXONC_UNESCAPE_MESSAGES: 'false' }, ['-xsl:a.xsl']);
		assert.strictEqual(result.status, 3);
		assert.deepEqual(result.stdout, ['/usr/existing', 'nonenonenone', '-xsl:a.xsl', '&lt;result/&gt;', '']);
		assert.deepEqual(result.stderr, ['&lt;a href=&quot;x&quot;&gt; &amp;#x1b; caf&#xe9; &#8364;', '&#x1b;[31mred&#27;[0m', '']);
	});
});
