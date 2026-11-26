// .vscode-test.redhat.js - not the test suite: the tests with Red Hat's XML extension (redhat.vscode-xml), which the test
// suite doesn't have, as it changes how XML files are checked (see test/redhat/redHatXml.test.ts). Run with
// npm run test-redhat. The extension is copied from REDHAT_XML_EXTENSION - its folder - or else the newest one installed
// in VS Code (~/.vscode/extensions), into an extensions folder of its own, with a workspace folder for the tests' files
const { defineConfig } = require('@vscode/test-cli');
const fs = require('fs');
const os = require('os');
const path = require('path');

const installed = path.join(os.homedir(), '.vscode', 'extensions');
const source = process.env.REDHAT_XML_EXTENSION ?? (fs.existsSync(installed) ? fs.readdirSync(installed)
	.filter((name) => name.startsWith('redhat.vscode-xml-')).sort().map((name) => path.join(installed, name)).pop() : undefined);
if (!source || !fs.existsSync(source)) {
	throw new Error('Red Hat\'s XML extension (redhat.vscode-xml) isn\'t installed in VS Code: install it, or set REDHAT_XML_EXTENSION to its folder');
}
const extensionsDir = path.join(__dirname, '.vscode-test', 'redhat-extensions');
const workspace = path.join(__dirname, '.vscode-test', 'redhat-workspace');
fs.rmSync(extensionsDir, { recursive: true, force: true });
fs.rmSync(workspace, { recursive: true, force: true });
fs.mkdirSync(extensionsDir, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.cpSync(source, path.join(extensionsDir, path.basename(source)), { recursive: true });

module.exports = defineConfig({
	files: 'out/test/redhat/**/*.test.js',
	workspaceFolder: workspace,
	launchArgs: [`--extensions-dir=${extensionsDir}`],
	mocha: { timeout: 60000 }
});
