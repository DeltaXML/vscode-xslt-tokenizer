/**
 * Test suite for the SaxonC task provider's platform-specific command lines
 *
 * The provider builds a different execution for each platform:
 * - macOS/Linux: /bin/sh running the bundled xslt-resources/saxonc-transform.sh script, which is passed the
 *   library path as SAXONC_LIBRARY_PATH and exports it as DYLD_LIBRARY_PATH/LD_LIBRARY_PATH itself (macOS strips
 *   DYLD_* variables a process merely inherits) and, with unescapeMessages, unescapes xsl:message output
 * - Windows: a plain process launch of Transform.exe, with SaxonC's lib folder prepended to PATH
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

const extensionRoot = path.resolve(__dirname, '..', '..', '..');
const scriptPath = path.join(extensionRoot, 'xslt-resources', 'saxonc-transform.sh');

type Platform = 'darwin' | 'linux' | 'win32';

// paths with spaces, and a result path with a single quote, to exercise the shell quoting
function taskDefinition(saxonCPath: string, extraLibraryPath: string, workFolder: string, unescapeMessages?: boolean): vscode.TaskDefinition {
	const workPath = (name: string) => workFolder + name;
	return {
		unescapeMessages: unescapeMessages,
		type: 'xslt-c',
		label: 'platform test',
		saxonCPath: saxonCPath,
		saxonCLibraryPaths: [extraLibraryPath],
		licenseFileLocation: workPath('saxon-license.lic'),
		xsltFile: workPath('my style.xsl'),
		xmlSource: workPath('in file.xml'),
		resultPath: workPath("bob's out.xml"),
		parameters: [{ name: '?greeting', value: "'hello world'" }],
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

function getTaskForPlatform(platform: Platform, definition: vscode.TaskDefinition, libraryEnvVar: string, existingLibraryPath: string) {
	const originalPlatform = os.platform;
	const originalJoin = path.join;
	const originalEnvValue = process.env[libraryEnvVar];
	(os as any).platform = () => platform;
	if (platform === 'win32') {
		(path as any).join = path.win32.join;
	}
	process.env[libraryEnvVar] = existingLibraryPath;
	try {
		return new SaxonCTaskProvider('').getTask(definition);
	} finally {
		(os as any).platform = originalPlatform;
		(path as any).join = originalJoin;
		if (originalEnvValue === undefined) {
			delete process.env[libraryEnvVar];
		} else {
			process.env[libraryEnvVar] = originalEnvValue;
		}
	}
}

// runs the script with the given environment, with Transform swapped for a fake that prints its arguments and
// library path, then escaped text on stdout and stderr, and exits with status 3
function runScript(env: { [key: string]: string }, args: string[]) {
	const fakeTransform = path.join(os.tmpdir(), `fake-transform-${process.pid}.sh`);
	fs.writeFileSync(fakeTransform, [
		'#!/bin/sh',
		`printf '%s\\n' "\${LD_LIBRARY_PATH:-none}"`,
		`printf '%s\\n' "$@"`,
		`printf '%s\\n' '&lt;a href=&quot;x&quot;&gt; &amp;#x1b; caf&#xe9; &#8364;'`,
		`printf '%s\\n' '&#x1b;[31mred&#27;[0m' >&2`,
		'exit 3',
	].join('\n'), { mode: 0o755 });
	try {
		return spawnSync('/bin/sh', [scriptPath, fakeTransform].concat(args), { encoding: 'utf8', env: { ...process.env, ...env } });
	} finally {
		fs.unlinkSync(fakeTransform);
	}
}

suite('SaxonC Task Provider - platform command lines', () => {
	suiteSetup(() => {
		SaxonTaskProvider.extensionURI ??= vscode.Uri.file(extensionRoot);
	});

	const posixPlatforms: { platform: Platform; libraryEnvVar: string }[] = [
		{ platform: 'darwin', libraryEnvVar: 'DYLD_LIBRARY_PATH' },
		{ platform: 'linux', libraryEnvVar: 'LD_LIBRARY_PATH' },
	];

	for (const { platform, libraryEnvVar } of posixPlatforms) {
		for (const unescapeMessages of [undefined, false]) {
			test(`${platform}: runs Transform via the bundled script, passing ${libraryEnvVar} as SAXONC_LIBRARY_PATH (unescapeMessages: ${unescapeMessages})`, () => {
				const definition = taskDefinition('/opt/Saxon C/bin', '/opt/extra libs', '/work/my files/', unescapeMessages);
				const task = getTaskForPlatform(platform, definition, libraryEnvVar, '/usr/existing');
				assert.exists(task);

				const execution = task!.execution;
				assert.instanceOf(execution, vscode.ProcessExecution);
				const processExecution = execution as vscode.ProcessExecution;
				assert.strictEqual(processExecution.process, '/bin/sh');
				// arguments are passed as an array - no shell command line, so no quoting
				assert.deepEqual(processExecution.args, [scriptPath, '/opt/Saxon C/bin/Transform'].concat(expectedArgs('/work/my files/')));
				assert.deepEqual(processExecution.options?.env, {
					SAXONC_LIBRARY_PATH: '/opt/Saxon C/lib:/opt/extra libs:/usr/existing',
					// unescapeMessages is on unless explicitly set to false
					SAXONC_UNESCAPE_MESSAGES: String(unescapeMessages !== false),
				});
			});
		}

		test(`${platform}: with no library path and unescapeMessages false, launches Transform directly`, () => {
			const definition: vscode.TaskDefinition = { type: 'xslt-c', label: 'direct', xsltFile: '/work/a.xsl', xmlSource: '/work/a.xml', unescapeMessages: false };
			const task = getTaskForPlatform(platform, definition, libraryEnvVar, '');
			const processExecution = task!.execution as vscode.ProcessExecution;
			assert.strictEqual(processExecution.process, 'Transform');
			assert.deepEqual(processExecution.args, ['-xsl:/work/a.xsl', '-s:/work/a.xml']);
		});
	}

	test('saxonc-transform.sh: unescapes the output of Transform, keeping its arguments and exit status', function () {
		if (os.platform() === 'win32' || spawnSync('/bin/sh', ['-c', 'command -v perl']).status !== 0) {
			this.skip(); // needs /bin/sh and perl
		}
		const args = expectedArgs('/work/my files/');
		const result = runScript({ SAXONC_UNESCAPE_MESSAGES: 'true', SAXONC_LIBRARY_PATH: '/opt/Saxon C/lib' }, args);
		assert.strictEqual(result.status, 3);
		// stderr is merged into stdout, so its line may be interleaved anywhere
		const lines = result.stdout.replace(/\n$/, '').split('\n');
		const stderrLine = '\x1b[31mred\x1b[0m';
		assert.include(lines, stderrLine);
		const stdoutLines = lines.filter((line) => line !== stderrLine);
		// the fake prints LD_LIBRARY_PATH, exported by the script on Linux - on macOS it exports DYLD_LIBRARY_PATH
		// instead, which SIP strips before it reaches the /bin/sh-run fake
		assert.deepEqual(stdoutLines, [os.platform() === 'linux' ? '/opt/Saxon C/lib' : 'none'].concat(args, ['<a href="x"> &#x1b; caf\u00e9 \u20ac']));
		assert.strictEqual(result.stderr, '');
	});

	test('saxonc-transform.sh: leaves the output of Transform unchanged when not unescaping', function () {
		if (os.platform() === 'win32') {
			this.skip(); // needs /bin/sh
		}
		const result = runScript({ SAXONC_UNESCAPE_MESSAGES: 'false' }, ['-xsl:a.xsl']);
		assert.strictEqual(result.status, 3);
		assert.deepEqual(result.stdout.split('\n').slice(1), ['-xsl:a.xsl', '&lt;a href=&quot;x&quot;&gt; &amp;#x1b; caf&#xe9; &#8364;', '']);
		assert.strictEqual(result.stderr, '&#x1b;[31mred&#27;[0m\n');
	});

	test('win32: launches Transform.exe directly, prepending the lib folders to PATH', () => {
		// unescapeMessages is not supported on Windows, so is ignored
		const definition = taskDefinition('C:\\Saxon C\\bin', 'D:\\extra libs', 'C:\\work\\my files\\', true);
		const task = getTaskForPlatform('win32', definition, 'PATH', 'C:\\Windows\\System32');
		assert.exists(task);

		const execution = task!.execution;
		assert.instanceOf(execution, vscode.ProcessExecution);
		const processExecution = execution as vscode.ProcessExecution;
		assert.strictEqual(processExecution.process, 'C:\\Saxon C\\bin\\Transform.exe');
		// arguments are passed as an array - no shell, so no quoting
		assert.deepEqual(processExecution.args, expectedArgs('C:\\work\\my files\\'));
		assert.deepEqual(processExecution.options?.env, { PATH: 'C:\\Saxon C\\lib;D:\\extra libs;C:\\Windows\\System32' });
	});
});
