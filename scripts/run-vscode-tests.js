/**
 * Runs the VS Code extension tests (vscode-test) with the same arguments, hiding VS Code's 'potential ... LEAK
 * detected' warnings: the tests open many untitled documents, which VS Code keeps (they have unsaved content), and
 * each one adds listeners, working copies and editor inputs to VS Code's internals - the extension itself adds none.
 * Each warning is its message line and the stack trace lines after it. The exit code is that of vscode-test.
 *
 * Set SHOW_LEAK_WARNINGS=1 to see the warnings.
 */
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const bin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'vscode-test.cmd' : 'vscode-test');
const child = spawn(bin, process.argv.slice(2), { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const showWarnings = !!process.env.SHOW_LEAK_WARNINGS;
let hidden = 0;

function filter(stream, output) {
	let inWarning = false;
	readline.createInterface({ input: stream }).on('line', (line) => {
		// e.g. 'potential listener LEAK detected', 'Potential working copy LEAK detected' or 'Potential text editor input LEAK
		// detected' - all from the test documents
		if (!showWarnings && /potential .*LEAK detected/i.test(line)) {
			inWarning = true;
			hidden++;
			return;
		}
		if (inWarning && /^\s+at\s/.test(line)) {
			return;
		}
		inWarning = false;
		output.write(line + '\n');
	});
}

filter(child.stdout, process.stdout);
filter(child.stderr, process.stderr);

child.on('close', (code) => {
	if (hidden > 0) {
		process.stdout.write(`(${hidden} VS Code 'potential LEAK' warnings from the test documents were hidden - set SHOW_LEAK_WARNINGS=1 to see them)\n`);
	}
	process.exit(code ?? 1);
});
