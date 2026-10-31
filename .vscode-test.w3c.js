// .vscode-test.w3c.js - not the test suite: lints the W3C XSLT test suites (see test/w3c-suite/w3cLint.test.ts)
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
	files: 'out/test/w3c-suite/**/*.test.js',
	mocha: { timeout: 0 }
});
