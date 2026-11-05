// .vscode-test.xspec.js - not the test suite: lints a folder of XSpec files (see test/xspec-corpus/xspecLint.test.ts)
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
	files: 'out/test/xspec-corpus/**/*.test.js',
	mocha: { timeout: 0 }
});
