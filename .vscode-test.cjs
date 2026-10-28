// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
	files: 'out/test/vscode-ext/**/*.test.js',
	// Mocha's default of 2 seconds a test fails tests at random when the machine is busy, e.g. with VS Code running too:
	// a test that's stuck still fails
	mocha: { timeout: 10000 }
});
