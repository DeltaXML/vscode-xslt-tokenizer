/**
 * Test suite for the SaxonC task provider's platform-specific command lines
 *
 * The provider builds a different execution for each platform:
 * - macOS/Linux: a /bin/sh command line that exports DYLD_LIBRARY_PATH/LD_LIBRARY_PATH itself (macOS strips
 *   DYLD_* variables a process merely inherits), with every argument single-quoted
 * - Windows: a plain process launch of Transform.exe, with SaxonC's lib folder prepended to PATH
 *
 * os.platform() (and, for Windows, path.join) are swapped out while each task is built, so all three
 * platforms can be verified from any one host. On a POSIX host the generated shell command line is also run
 * through the real /bin/sh - with the Transform executable swapped for printf - to prove the quoting yields
 * exactly the intended arguments and library path.
 */
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { assert } from 'chai';
import { SaxonCTaskProvider } from '../../src/saxonCTaskProvider';

type Platform = 'darwin' | 'linux' | 'win32';

// paths with spaces, and a result path with a single quote, to exercise the shell quoting
function taskDefinition(saxonCPath: string, extraLibraryPath: string, workFolder: string): vscode.TaskDefinition {
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

// runs the command line through the real /bin/sh, with 'exec <Transform>' replaced by printf, and returns the
// library path variable's value followed by each argument exactly as Transform would receive it
function runWithShell(commandLine: string, quotedExecutable: string, libraryEnvVar: string) {
	const execPrefix = `exec ${quotedExecutable} `;
	assert.include(commandLine, execPrefix);
	const probe = commandLine.replace(execPrefix, `printf '%s\\n' "$${libraryEnvVar}"; exec printf '%s\\n' `);
	return execFileSync('/bin/sh', ['-c', probe], { encoding: 'utf8' }).replace(/\n$/, '').split('\n');
}

suite('SaxonC Task Provider - platform command lines', () => {
	const posixPlatforms: { platform: Platform; libraryEnvVar: string }[] = [
		{ platform: 'darwin', libraryEnvVar: 'DYLD_LIBRARY_PATH' },
		{ platform: 'linux', libraryEnvVar: 'LD_LIBRARY_PATH' },
	];

	for (const { platform, libraryEnvVar } of posixPlatforms) {
		test(`${platform}: runs Transform via /bin/sh, exporting ${libraryEnvVar}`, function () {
			const definition = taskDefinition('/opt/Saxon C/bin', '/opt/extra libs', '/work/my files/');
			const task = getTaskForPlatform(platform, definition, libraryEnvVar, '/usr/existing');
			assert.exists(task);

			const execution = task!.execution;
			assert.instanceOf(execution, vscode.ShellExecution);
			const shellExecution = execution as vscode.ShellExecution;
			assert.strictEqual(shellExecution.options?.executable, '/bin/sh');
			assert.deepEqual(shellExecution.options?.shellArgs, ['-c']);

			const commandLine = shellExecution.commandLine!;
			const expectedLibraryPath = '/opt/Saxon C/lib:/opt/extra libs:/usr/existing';
			assert.isTrue(commandLine.startsWith(`export ${libraryEnvVar}='${expectedLibraryPath}'; exec '/opt/Saxon C/bin/Transform' `), commandLine);

			if (os.platform() === 'win32') {
				this.skip(); // no /bin/sh to verify the quoting against
			}
			const shellOutput = runWithShell(commandLine, `'/opt/Saxon C/bin/Transform'`, libraryEnvVar);
			assert.deepEqual(shellOutput, [expectedLibraryPath].concat(expectedArgs('/work/my files/')));
		});
	}

	test('win32: launches Transform.exe directly, prepending the lib folders to PATH', () => {
		const definition = taskDefinition('C:\\Saxon C\\bin', 'D:\\extra libs', 'C:\\work\\my files\\');
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
