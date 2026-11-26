/**
 * Test suite for the extension's MCP server (XsltMcpServer): MCP requests over HTTP, as an assistant sends them - the
 * token and host checks, and the tools: lint_file, for a module that isn't open in an editor, with its imports, and
 * module_imports, the tree of a module's imports from its top-level stylesheet
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltMcpServer } from '../../src/mcp/xsltMcpServer';
import { RunConfiguration } from '../../src/mcp/runConfiguration';
import { XPathEvaluate } from '../../src/mcp/xpathEvaluate';
import { DocumentChangeHandler } from '../../src/documentChangeHandler';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { SchConfiguration, XMLConfiguration, XSLTConfiguration } from '../../src/languageConfigurations';
import { revertAndCloseEditorsIn } from './testEditors';
import { ImportIndex } from '../../src/importIndex';
import { McpRoot } from '../../src/mcp/mcpRoot';

const port = 6799;

// a secret storage that keeps its values in memory
function memorySecrets(): vscode.SecretStorage {
	const values = new Map<string, string>();
	return {
		get: async (key: string) => values.get(key),
		store: async (key: string, value: string) => { values.set(key, value); },
		delete: async (key: string) => { values.delete(key); },
		keys: async () => [...values.keys()],
		onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
	} as vscode.SecretStorage;
}

// an MCP request, as JSON-RPC over HTTP: the status, and the result or error of the message in the event stream
function post(body: object, headers: Record<string, string>, urlPath = '/mcp'): Promise<{ status: number, message?: any }> {
	return new Promise((resolve, reject) => {
		const request = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...headers } }, (response) => {
			let text = '';
			response.on('data', (chunk) => text += chunk);
			response.on('end', () => {
				const data = /^data: (.*)$/m.exec(text);
				resolve({ status: response.statusCode ?? 0, message: data ? JSON.parse(data[1]) : undefined });
			});
		});
		request.on('error', reject);
		request.end(JSON.stringify(body));
	});
}

suite('MCP server', function () {
	this.timeout(20000);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-mcp-'));
	const main = path.join(dir, 'main.xsl');
	const lib = path.join(dir, 'lib.xsl');
	fs.writeFileSync(main, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">
  <xsl:import href="lib.xsl"/>
  <xsl:template match="/"><xsl:sequence select="f:twice(2), $undeclared"/></xsl:template>
  <xsl:import href="overrides.xsl"/>
  <xsl:function name="f:local"><xsl:param name="a"/><xsl:sequence select="f:local($a), f:local(2)"/></xsl:function>
</xsl:stylesheet>`);
	// imported after lib.xsl, so with a higher import precedence: its f:twice is used
	fs.writeFileSync(path.join(dir, 'overrides.xsl'), `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">
  <xsl:function name="f:twice"><xsl:param name="n"/><xsl:sequence select="$n + $n"/></xsl:function>
</xsl:stylesheet>`);
	const types = path.join(dir, 'types.xsl');
	fs.writeFileSync(types, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:cx="urn:cx" version="4.0">
  <xsl:item-type name="cx:point" as="record(x as xs:double, y? as xs:double)"/>
  <xsl:item-type name="cx:colour" as="enum('red', 'green')"/>
  <xsl:variable name="origin" as="cx:point" select="{ 'x': 0 }"/>
  <xsl:template name="xsl:initial-template"><xsl:sequence select="$origin"/></xsl:template>
</xsl:stylesheet>`);
	// documentation: a note (XSLT 4.0), a comment just before a declaration, and a comment separated from one
	const documented = path.join(dir, 'documented.xsl');
	fs.writeFileSync(documented, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:d="urn:d" version="4.0">
  <xsl:function name="d:area" as="xs:double">
    <xsl:note format="xdoc-md">The area of a rectangle.
      @param width the width, in metres
      @param height the height</xsl:note>
    <xsl:param name="width" as="xs:double"/>
    <xsl:param name="height" as="xs:double"/>
    <xsl:sequence select="$width * $height"/>
  </xsl:function>
  <!-- the total for a line:
       its quantity times its price -->
  <xsl:function name="d:total"><xsl:param name="q"/><xsl:sequence select="$q * 2"/></xsl:function>
  <!-- Section: helpers -->

  <xsl:function name="d:helper"><xsl:param name="h"/><xsl:sequence select="$h"/></xsl:function>
  <xsl:item-type name="d:size" as="record(w as xs:double, h? as xs:double)">
    <xsl:note format="xdoc-md">A size.
      @field w the width
      @field h the height, if not square</xsl:note>
  </xsl:item-type>
  <xsl:template name="xsl:initial-template"><xsl:sequence select="d:area(1, 2), d:total(1), d:helper(1)"/></xsl:template>
</xsl:stylesheet>`);
	const empty = path.join(dir, 'sub', 'empty.xsl');
	fs.mkdirSync(path.dirname(empty));
	fs.writeFileSync(empty, '');
	// in a hidden folder, e.g. .vscode-test's saved edit history: left out by lint_files, unless its pattern names the folder
	fs.mkdirSync(path.join(dir, '.hidden'));
	fs.writeFileSync(path.join(dir, '.hidden', 'history.xsl'), '');
	fs.writeFileSync(lib, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="3.0">
  <xsl:include href="missing.xsl"/>
  <xsl:function name="f:twice" as="xs:integer"><xsl:param name="n" as="xs:integer"/><xsl:sequence select="$n * 2"/></xsl:function>
</xsl:stylesheet>`);

	const symbolProvider = new XsltSymbolProvider(XSLTConfiguration.configuration, null);
	// a Schematron schema is checked by its own provider, as the extension does
	const schematronProvider = new XsltSymbolProvider(SchConfiguration.configuration, null);
	// and an XML file by the extension's XML provider, for its well-formedness
	const xmlProvider = new XsltSymbolProvider(XMLConfiguration.configuration, null);
	const providerFor = (document: vscode.TextDocument) => document.languageId === 'sch' ? schematronProvider : document.languageId === 'xml' ? xmlProvider : symbolProvider;
	const server = new XsltMcpServer(memorySecrets(), { problems: (document, topLevel) => providerFor(document).diagnosticsFor(document, topLevel), declarations: (document, topLevel) => providerFor(document).declarationsFor(document, topLevel) });
	let token = '';
	let id = 0;
	const call = (name: string, args: object) => post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, { Authorization: `Bearer ${token}` });
	const text = (response: { message?: any }) => response.message?.result?.content?.[0]?.text as string;

	suiteSetup(async () => {
		assert.isTrue(await server.start(port));
		token = await server.getToken();
	});

	suiteTeardown(() => server.stop());

	test('each window has a server of its own: at its workspace\'s port, kept for the workspace - the next free one, if it\'s taken', async () => {
		const base = XsltMcpServer.basePort();
		const forA = XsltMcpServer.portFor('/projects/a', base);
		assert.strictEqual(XsltMcpServer.portFor('/projects/a', base), forA, 'the same each time');
		assert.isTrue(forA > base && forA < base + 1000);
		assert.notStrictEqual(XsltMcpServer.portFor('/projects/b', base), forA);
		// a workspace's state, as a Memento
		const memento = (): vscode.Memento => {
			const values = new Map<string, unknown>();
			return { keys: () => [...values.keys()], get: <T>(key: string, defaultValue?: T) => (values.has(key) ? values.get(key) : defaultValue) as T, update: async (key: string, value: unknown) => { values.set(key, value); } };
		};
		const modules = { problems: async () => [], declarations: async () => ({ own: [], imported: [] }) };
		const stateA = memento();
		const first = new XsltMcpServer(memorySecrets(), modules, stateA);
		const second = new XsltMcpServer(memorySecrets(), modules, memento());
		const third = new XsltMcpServer(memorySecrets(), modules, stateA);
		try {
			// two starts at once: one server, at the workspace's port
			const [started, again] = await Promise.all([first.start(undefined, '/projects/a'), first.start(undefined, '/projects/a')]);
			assert.isTrue(started && again);
			assert.strictEqual(first.port, forA);
			assert.strictEqual(first.url, `http://127.0.0.1:${forA}/mcp`);
			assert.strictEqual(stateA.get('xslt-xpath.mcpPort'), forA);
			// another window, with a workspace whose port is taken: the next free one
			assert.isTrue(await second.start(undefined, '/projects/a'));
			assert.strictEqual(second.port, forA + 1);
			// the workspace opened again: its port, from its state - free again, so the same URL as before
			first.stop();
			second.stop();
			assert.isTrue(await third.start(undefined, '/projects/a'));
			assert.strictEqual(third.previousPort, forA);
			assert.strictEqual(third.port, forA);
		} finally {
			first.stop();
			second.stop();
			third.stop();
		}
	});

	test('run_configuration: an xsl:package is noted, with the public templates and modes it could be started from', () => {
		const xsl = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform"';
		// a folder of its own, outside the suite's: lint_files counts the files and problems there
		const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-mcp-entry-'));
		const write = (name: string, body: string) => {
			const file = path.join(packageDir, name);
			fs.writeFileSync(file, body);
			return { file, text: body };
		};
		const notes = (name: string, body: string) => { const f = write(name, body); return RunConfiguration.packageNotes(f.file, f.text); };
		assert.deepStrictEqual(notes('entry-stylesheet.xsl', `<xsl:stylesheet ${xsl} version="3.0"><xsl:template name="a" visibility="public"/></xsl:stylesheet>`), []);
		// a > in an attribute, a template element that isn't XSLT's, an xsl:expose, a private template and a comment
		const [note] = notes('entry-package.xsl', `<?xml version="1.0"?><!-- <xsl:package> --><xsl:package ${xsl} version="3.0" name="urn:entry-points" package-version="1.0">
			<xsl:expose component="template" names="exposed" visibility="public"/>
			<xsl:template match="a[b > 1]" name="start" visibility="public"/>
			<xsl:template name="exposed"/><xsl:template name="hidden" visibility="private"/>
			<xsl:mode name="m1" visibility="public"/><xsl:mode name="m2"/>
			<xsl:variable name="v"><template name="notxslt" visibility="public"/></xsl:variable></xsl:package>`);
		assert.include(note, 'public named templates start, exposed (-it:name)');
		assert.include(note, 'public modes m1 (-im:name)');
		assert.notInclude(note, 'hidden');
		assert.notInclude(note, 'notxslt');
		assert.notInclude(note, 'm2');
		assert.include(notes('entry-none.xsl', `<xsl:package ${xsl} version="3.0" name="urn:entry-none" package-version="1.0"/>`)[0], 'makes no named template or mode public');
		fs.rmSync(packageDir, { recursive: true, force: true });
	});

	test('run_configuration: the Saxon jar, with its edition, version and licence - and for a stylesheet, its Quick Run\'s source and command line', async () => {
		assert.strictEqual(RunConfiguration.saxonEdition('/a/saxon-pe-13.1.jar'), 'PE');
		assert.strictEqual(RunConfiguration.saxonVersion('/a/saxon-pe-13.1.jar'), '13.1');
		assert.strictEqual(RunConfiguration.saxonEdition('/a/Saxon-HE-12.9.jar'), 'HE');
		assert.strictEqual(RunConfiguration.saxonVersion('/a/Saxon-HE-12.9.jar'), '12.9');
		assert.strictEqual(RunConfiguration.saxonEdition('/a/saxon9ee.jar'), 'EE');
		assert.isUndefined(RunConfiguration.saxonEdition('/a/other.jar'));
		const saxonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saxon-'));
		const jar = path.join(saxonDir, 'saxon-pe-13.1.jar');
		fs.writeFileSync(jar, '');
		// Saxon's report, as it runs: replaced, for each case - the jar here isn't a real one
		const runSaxon = RunConfiguration.runSaxon;
		const reporting = (output: string, error?: string) => {
			RunConfiguration.runSaxon = async () => ({ output, error });
			// a new report: the jar changed
			fs.utimesSync(jar, new Date(), new Date(Date.now() + Math.random() * 100000));
		};
		const data = path.join(dir, 'data.xml');
		fs.writeFileSync(data, '<data/>');
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const savedJar = tasks.inspect<string>('saxonJar')?.globalValue;
		const savedContext = await DocumentChangeHandler.contextFor(undefined);
		await tasks.update('saxonJar', jar, vscode.ConfigurationTarget.Global);
		DocumentChangeHandler.setLastPicked(vscode.Uri.file(data), false);
		try {
			reporting('SaxonJ-PE 13.1 from Saxonica\nJava version 17.0.20\nUsing license serial number A014667\n');
			const workspace = text(await call('run_configuration', {}));
			assert.include(workspace, `Saxon jar: ${jar} - SaxonJ-PE 13.1\nSaxon licence: Using license serial number A014667`);
			// no licence: as Saxon says - it runs without its licensed features
			reporting('SaxonJ-PE 13.1 from Saxonica\nJava version 17.0.20\nNo license file found - running with licensable features disabled\n');
			assert.include(text(await call('run_configuration', {})), 'Saxon licence: No license file found - running with licensable features disabled');
			reporting('SaxonJ-HE 12.9 from Saxonica\nJava version 17.0.20\n');
			assert.include(text(await call('run_configuration', {})), 'Saxon licence: none needed (Saxon-HE)');
			// Saxon not run: from the jar's name, and why
			reporting('', '\'java\' wasn\'t found on the PATH');
			assert.include(text(await call('run_configuration', {})), `Saxon jar: ${jar} - Saxon-PE 13.1, from its name\nSaxon licence: unknown - Saxon couldn't be run to report it: 'java' wasn't found on the PATH`);
			// the same jar, unchanged: Saxon isn't run again
			let runs = 0;
			RunConfiguration.runSaxon = async () => (runs++, { output: 'SaxonJ-PE 13.1 from Saxonica\n' });
			await call('run_configuration', {});
			assert.strictEqual(runs, 0);
			assert.include(workspace, 'XSpec: ');
			assert.notInclude(workspace, 'For ');
			const forMain = text(await call('run_configuration', { path: main }));
			assert.include(forMain, `For ${main}:`);
			assert.include(forMain, 'this is the one Quick Run would create');
			assert.include(forMain, `XML source: ${data}`);
			assert.include(forMain, 'only the last one picked in the editor, not chosen for this stylesheet', 'a guessed XML source is flagged as one');
			assert.notInclude(forMain, 'this is an xsl:package');
			const command = forMain.split('\n').find((line) => line.trim().startsWith('Command:'))!;
			assert.include(command, `java -cp ${jar} net.sf.saxon.Transform`, 'Saxon\'s own Transform - not the extension\'s terminal-output variant');
			assert.include(command, `-xsl:${main}`);
			assert.include(command, `-s:${data}`);
			assert.notInclude(command, '${', 'no variables left for VS Code to substitute');
			assert.include(text(await call('run_configuration', { path: path.join(dir, 'missing.xsl') })), 'Stylesheet not found');
		} finally {
			RunConfiguration.runSaxon = runSaxon;
			await tasks.update('saxonJar', savedJar, vscode.ConfigurationTarget.Global);
			DocumentChangeHandler.setLastPicked(savedContext.uri, savedContext.isNone);
			fs.rmSync(saxonDir, { recursive: true, force: true });
		}
	});

	test('run_configuration: Saxon\'s own report of its edition and licence - with a real Saxon jar, in XSLT_TEST_SAXON_JAR', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const report = await RunConfiguration.saxonReport(saxonJar!);
		assert.match(report.product ?? '', /^SaxonJ-(HE|PE|EE) \d+/, JSON.stringify(report));
		if (!/-HE /.test(report.product!)) {
			assert.match(report.licence ?? '', /licen[cs]e/i, JSON.stringify(report));
		}
	});

	test('a second server for the port: not started', async () => {
		const other = new XsltMcpServer(memorySecrets(), { problems: async () => [], declarations: async () => ({ own: [], imported: [] }) });
		assert.isFalse(await other.start(port));
		assert.isFalse(other.isRunning);
	});

	test('the token is needed - and a request must be to 127.0.0.1 or localhost by name', async () => {
		const initialize = { jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
		assert.strictEqual((await post(initialize, {})).status, 401);
		assert.strictEqual((await post(initialize, { Authorization: 'Bearer wrong' })).status, 401);
		assert.strictEqual((await post(initialize, { Authorization: `Bearer ${token}`, Host: `attacker.example:${port}` })).status, 403);
		const response = await post(initialize, { Authorization: `Bearer ${token}` });
		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.message.result.serverInfo.name, 'xslt-xpath');
	});

	test('the tools', async () => {
		const response = await post({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }, { Authorization: `Bearer ${token}` });
		assert.deepEqual(response.message.result.tools.map((tool: { name: string }) => tool.name), ['lint_file', 'lint_files', 'module_imports', 'list_declarations', 'find_declaration', 'find_references', 'describe_type', 'xpath_function', 'run_configuration', 'test_configuration', 'validation_configuration', 'output_origin', 'input_rules', 'trace_configuration', 'debug_status', 'debug_evaluate', 'profile_configuration']);
	});

	test('debug_evaluate\'s annotations follow XSLT.mcp.debugEvaluateExtensions: read-only unless it\'s unrestricted', async () => {
		const annotations = async () => {
			const response = await post({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }, { Authorization: `Bearer ${token}` });
			return response.message.result.tools.find((tool: { name: string }) => tool.name === 'debug_evaluate').annotations;
		};
		const settings = vscode.workspace.getConfiguration('XSLT.mcp');
		try {
			assert.include(await annotations(), { readOnlyHint: true });
			await settings.update('debugEvaluateExtensions', 'never', vscode.ConfigurationTarget.Global);
			assert.include(await annotations(), { readOnlyHint: true });
			await settings.update('debugEvaluateExtensions', 'unrestricted', vscode.ConfigurationTarget.Global);
			assert.include(await annotations(), { readOnlyHint: false, destructiveHint: true });
		} finally {
			await settings.update('debugEvaluateExtensions', undefined, vscode.ConfigurationTarget.Global);
		}
	});

	test('lint_file: a module that is not open, checked with its imports', async () => {
		assert.isUndefined(vscode.workspace.textDocuments.find((d) => d.fileName === main && vscode.window.visibleTextEditors.some((e) => e.document === d)));
		const result = text(await call('lint_file', { path: main }));
		// the variable isn't declared; the function, from the imported module, is - a warning, as the imported module
		// includes one that isn't found, which might declare it
		assert.match(result, /^1 problem in .*main\.xsl:\n3:61 warning XPath: The variable\/parameter: \$undeclared cannot be resolved here, but it may be defined in an external module/, result);
		assert.notMatch(result, /twice/);
	});

	test('a root in the URL: relative paths are from it - when it\'s one of the workspace\'s folders', async () => {
		const allowed = McpRoot.allowed;
		McpRoot.allowed = () => [dir];
		try {
			const lintRelative = (root: string) => post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'lint_file', arguments: { path: 'main.xsl' } } },
				{ Authorization: `Bearer ${token}` }, `/mcp?root=${encodeURIComponent(root)}`);
			assert.include(text(await lintRelative(dir)), `1 problem in ${main}`);
			// the paths shown are relative to the root too
			const imports = text(await post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'module_imports', arguments: { path: 'lib.xsl' } } },
				{ Authorization: `Bearer ${token}` }, `/mcp?root=${encodeURIComponent(dir)}`));
			assert.include(imports, 'lib.xsl');
			assert.notInclude(imports, dir);
			// not a folder of the workspace: ignored, so the path isn't found from the first folder - there is none here
			assert.match(text(await lintRelative(path.join(dir, 'sub'))), /^File not found/);
			// no root: as before
			assert.match(text(await call('lint_file', { path: 'main.xsl' })), /^File not found/);
		} finally {
			McpRoot.allowed = allowed;
		}
	});

	test('instructions: several workspace folders, with the root first - and for any folder, to load a skill and lint after each change', async () => {
		const allowed = McpRoot.allowed;
		const sub = path.join(dir, 'sub');
		const initialize = async (root?: string) => (await post({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
			{ Authorization: `Bearer ${token}` }, root ? `/mcp?root=${encodeURIComponent(root)}` : '/mcp')).message?.result?.instructions as string | undefined;
		try {
			McpRoot.allowed = () => [dir, sub];
			const instructions = await initialize(sub);
			assert.match(instructions ?? '', new RegExp(`^This VS Code window has 2 workspace folders: ${sub.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')} \\(where relative paths start\\) and ${dir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\\.`));
			assert.include(instructions ?? '', 'lint_files with no folder checks only the first');
			// run_configuration lists the others too
			const configuration = text(await post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'run_configuration', arguments: {} } },
				{ Authorization: `Bearer ${token}` }, `/mcp?root=${encodeURIComponent(sub)}`));
			assert.include(configuration, `Other workspace folders (relative paths start in the first): ${dir}`);
			// after the folders, and alone for one folder: the checks to make on any change, however small
			assert.include(instructions ?? '', McpRoot.workflow);
			McpRoot.allowed = () => [dir];
			assert.strictEqual(await initialize(dir), McpRoot.workflow);
		} finally {
			McpRoot.allowed = allowed;
		}
	});

	test('lint_file and lint_files: a file changed outside VS Code - e.g. by an AI agent - is checked as it is on disk, not as VS Code last had it', async () => {
		const edited = path.join(dir, 'edited.xsl');
		const withCall = (call: string) => `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">\n  <xsl:template match="/"><xsl:sequence select="${call}"/></xsl:template>\n</xsl:stylesheet>`;
		fs.writeFileSync(edited, withCall('f:missing(1)'));
		assert.match(text(await call('lint_file', { path: edited })), /f:missing/);
		// opened, so VS Code has the text - then edited on disk, as an agent's file tool does
		await vscode.workspace.openTextDocument(vscode.Uri.file(edited));
		fs.writeFileSync(edited, withCall('1 + 1'));
		assert.match(text(await call('lint_file', { path: edited })), /no problems|^0 problems/i);
		assert.notMatch(text(await call('lint_files', { folder: dir, pattern: 'edited.xsl' })), /f:missing/);
		assert.match(text(await call('lint_files', { folder: dir, pattern: 'edited.xsl' })), /no problems/);
		// and the other way
		fs.writeFileSync(edited, withCall('f:missing(1)'));
		assert.match(text(await call('lint_files', { folder: dir, pattern: 'edited.xsl' })), /f:missing/);
		// not left for the other tests, which count the folder's files
		fs.rmSync(edited);
	});

	test('lint_file and lint_files: a Schematron schema, with the extension\'s Schematron checks', async () => {
		// a folder of its own, so the other tests' files are the same
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-mcp-schematron-'));
		// a rule with no context, which ISO Schematron requires - and a prefix that only xmlns declares, which SchXslt2 doesn't
		const schema = path.join(folder, 'rules.sch');
		fs.writeFileSync(schema, `<sch:schema xmlns:sch="http://purl.oclc.org/dsdl/schematron" xmlns:xs="http://www.w3.org/2001/XMLSchema" queryBinding="xslt3">
  <sch:pattern>
    <sch:rule><sch:assert test="true()">never reached</sch:assert></sch:rule>
    <sch:rule context="item"><sch:assert test="xs:integer(@n) gt 0">n must be positive</sch:assert></sch:rule>
  </sch:pattern>
</sch:schema>`);
		const linted = text(await call('lint_file', { path: schema, minSeverity: 'warning' }));
		assert.match(linted, /problems? in .*rules\.sch/, linted);
		assert.match(linted, /error .*context/i, linted);
		assert.match(linted, /xs/, linted);
		const folderResult = text(await call('lint_files', { folder }));
		assert.match(folderResult, /^Checked 1 file in /, folderResult);
		assert.match(folderResult, /rules\.sch - \d+ problems?/, folderResult);
		fs.rmSync(folder, { recursive: true, force: true });
	});

	test('lint_file: an XML file - its well-formedness, without Red Hat\'s XML extension (not installed for the tests)', async () => {
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-mcp-xml-'));
		const malformed = path.join(folder, 'order.xml');
		fs.writeFileSync(malformed, '<order>\n  <item>1</items>\n</order>\n');
		const linted = text(await call('lint_file', { path: malformed }));
		assert.match(linted, /^2 problems in .*order\.xml:\n2:4 error XML: Start tag 'item' has no matching close tag\n2:12 error XML: Unexpected close tag 'items'\n\n/, linted);
		assert.match(linted, /Checked for well-formedness only: Red Hat's XML extension \(redhat\.vscode-xml\).* isn't installed$/, linted);
		const wellFormed = path.join(folder, 'ok.xml');
		fs.writeFileSync(wellFormed, '<order>\n  <item>1</item>\n</order>\n');
		assert.match(text(await call('lint_file', { path: wellFormed })), /^No problems: .*ok\.xml\n\nChecked for well-formedness only/);
		// another file VS Code opens as XML, e.g. an XML Schema
		const xsd = path.join(folder, 'order.xsd');
		fs.writeFileSync(xsd, '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="order"></xs:schema>');
		assert.match(text(await call('lint_file', { path: xsd })), /^1 problem in .*order\.xsd/);
		// not XML
		const json = path.join(folder, 'data.json');
		fs.writeFileSync(json, '{}');
		const notXml = await call('lint_file', { path: json });
		assert.match(text(notXml), /^Not an XSLT, XSpec, Schematron or XML file - VS Code opens it as 'json'/);
		assert.match(text(await call('lint_file', { path: malformed, topLevelStylesheet: main })), /only for an XSLT module, not an XML file/);
		await revertAndCloseEditorsIn(folder);
		fs.rmSync(folder, { recursive: true, force: true });
	});

	test('lint_file: an import problem', async () => {
		assert.match(text(await call('lint_file', { path: lib })), /2:\d+ error .*missing\.xsl/);
	});

	test('lint_file: not an XSLT, XSpec, Schematron or XML file, or not found', async () => {
		const notXslt = path.join(dir, 'notes.txt');
		fs.writeFileSync(notXslt, 'notes');
		const result = await call('lint_file', { path: notXslt });
		fs.rmSync(notXslt);
		assert.isTrue(result.message.result.isError);
		assert.match(text(result), /^Not an XSLT, XSpec, Schematron or XML file - VS Code opens it as 'plaintext'/);
		assert.match(text(await call('lint_file', { path: path.join(dir, 'none.xsl') })), /^File not found/);
		assert.match(text(await call('lint_file', { path: path.join(dir, 'none.xml') })), /^File not found/);
	});

	test('module_imports: from the top-level stylesheet, with the module marked', async () => {
		const lines = text(await call('module_imports', { path: lib })).split('\n');
		// main.xsl isn't in the workspace's index of modules, so lib.xsl is its own top-level stylesheet
		assert.match(lines[0], /^top-level stylesheet .*lib\.xsl {2}<- this module$/);
		assert.match(lines[1], /^ {2}includes .*missing\.xsl - not found$/);
		const fromMain = text(await call('module_imports', { path: main })).split('\n');
		assert.match(fromMain[0], /^top-level stylesheet .*main\.xsl {2}<- this module$/);
		assert.match(fromMain[1], /^ {2}imports .*lib\.xsl$/);
		assert.match(fromMain[2], /^ {4}includes .*missing\.xsl - not found$/);
		assert.match(fromMain[3], /^ {2}imports .*overrides\.xsl$/);
	});

	test('lint_file: an empty file, which the linter doesn\'t report', async () => {
		assert.match(text(await call('lint_file', { path: empty })), /^1 problem in .*empty\.xsl:\n1:1 error The file is empty/);
	});

	test('lint_file: only problems of a severity or worse', async () => {
		assert.match(text(await call('lint_file', { path: main, minSeverity: 'error' })), /^No problems/);
	});

	// a top-level stylesheet and a module it includes, which uses its variable - in a folder of their own, so not lint_files'
	const withTopLevel = (name: string) => {
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), `xslt-mcp-${name}-`));
		const top = path.join(folder, 'top.xsl');
		const part = path.join(folder, 'part.xsl');
		const other = path.join(folder, 'other.xsl');
		fs.writeFileSync(top, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:t="urn:t" version="4.0">
  <xsl:include href="part.xsl"/>
  <xsl:variable name="fromTop" select="1"/>
  <xsl:item-type name="t:size" as="record(w as xs:double, h? as xs:double)"/>
  <xsl:function name="t:area" as="xs:double"><xsl:param name="s" as="t:size"/><xsl:sequence select="$s?w * ($s?h, $s?w)[1]"/></xsl:function>
</xsl:stylesheet>`);
		// with the prefix bound, as names are matched by namespace URI within the module
		fs.writeFileSync(part, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:t="urn:t" exclude-result-prefixes="t" version="3.0">
  <xsl:template match="/"><xsl:sequence select="$fromTop"/></xsl:template>
</xsl:stylesheet>`);
		fs.writeFileSync(other, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>`);
		return { top, part, other };
	};

	test('lint_file: a module with the top-level stylesheet given - one that includes it, not a stylesheet that doesn\'t, nor the module itself', async () => {
		const { top, part, other } = withTopLevel('given');
		// not in the index of the workspace's modules, so on its own
		assert.match(text(await call('lint_file', { path: part })), /\$fromTop/);
		const withTop = text(await call('lint_file', { path: part, topLevelStylesheet: top }));
		assert.match(withTop, /^No problems: .*part\.xsl - checked with the top-level stylesheet .*top\.xsl$/, withTop);
		// kept apart from the editor's check: on its own again, without it
		assert.match(text(await call('lint_file', { path: part })), /\$fromTop/);
		const notIncluding = await call('lint_file', { path: part, topLevelStylesheet: other });
		assert.isTrue(notIncluding.message.result.isError);
		assert.match(text(notIncluding), /other\.xsl doesn't import or include .*part\.xsl/);
		assert.match(text(await call('lint_file', { path: part, topLevelStylesheet: part })), /^The top-level stylesheet is the module itself/);
		assert.match(text(await call('lint_file', { path: part, topLevelStylesheet: path.join(path.dirname(top), 'none.xsl') })), /^The top-level stylesheet isn't found/);
	});

	test('find_declaration and describe_type: with the top-level stylesheet given - its declarations seen from a module it includes', async () => {
		const { top, part, other } = withTopLevel('declarations');
		// not in the index of the workspace's modules, so on its own: none
		assert.match(text(await call('find_declaration', { path: part, name: 't:area', kind: 'function' })), /^No function named t:area is declared in .*part\.xsl or the modules and packages it uses$/);
		const found = text(await call('find_declaration', { path: part, name: 't:area#1', kind: 'function', topLevelStylesheet: top }));
		assert.match(found, /^xsl:function t:area#1\(\$s as t:size\) as xs:double - .*top\.xsl:5:\d+/, found);
		assert.match(found, /\n\nAs seen from .*part\.xsl - checked with the top-level stylesheet .*top\.xsl$/);
		assert.match(text(await call('find_declaration', { path: part, name: 't:none', topLevelStylesheet: top })), /^No declaration named t:none .* - checked with the top-level stylesheet .*top\.xsl$/);
		assert.match(text(await call('describe_type', { path: part, name: 't:size' })), /^No item type named t:size is declared in .*part\.xsl/);
		const type = text(await call('describe_type', { path: part, name: 't:size', topLevelStylesheet: top }));
		assert.match(type, /a record type with 2 fields:\n {2}w as xs:double\n {2}h\? as xs:double\n\nAs seen from .*part\.xsl - checked with the top-level stylesheet .*top\.xsl$/, type);
		// the same checks of the argument as for lint_file
		for (const tool of ['find_declaration', 'describe_type']) {
			const notIncluding = await call(tool, { path: part, name: 't:size', topLevelStylesheet: other });
			assert.isTrue(notIncluding.message.result.isError, tool);
			assert.match(text(notIncluding), /other\.xsl doesn't import or include .*part\.xsl/, tool);
		}
	});

	test('lint_file: waits for the index of the workspace\'s modules, which the module\'s top-level stylesheet is found from', async () => {
		const { top, part } = withTopLevel('index');
		// an index that knows of the two files only once it's been waited for - as one built in the background
		const index = ImportIndex.instance;
		const whenBuilt = index.whenBuilt;
		let waited = false;
		index.whenBuilt = async () => {
			if (!waited) {
				waited = true;
				await index.buildFrom([top, part]);
			}
		};
		try {
			const result = text(await call('lint_file', { path: part }));
			assert.isTrue(waited);
			assert.match(result, /^No problems: .*part\.xsl$/, result);
		} finally {
			index.whenBuilt = whenBuilt;
			index.setReferences(top, []);
		}
	});

	test('lint_files: the files with problems, after a summary - warnings or worse by default', async () => {
		const lines = text(await call('lint_files', { folder: dir })).split('\n');
		assert.match(lines[0], /^Checked 6 files in .*: 3 problems in 3 files \(warnings or worse\)$/, lines.join('\n'));
		assert.match(text(await call('lint_files', { folder: dir, pattern: 'sub/*.xsl' })), /^Checked 1 file in .*: 1 problem in 1 file \(warnings or worse\)\n\n.*empty\.xsl - 1 problem:\n {2}1:1 error The file is empty/);
		assert.match(text(await call('lint_files', { folder: dir, pattern: '.hidden/*.xsl' })), /^Checked 1 file in .*\n\n.*history\.xsl - 1 problem/);
		assert.isTrue((await call('lint_files', { folder: path.join(dir, 'none') })).message.result.isError);
	});

	test('list_declarations: the module\'s own, then those it imports - the overridden one marked, a kind to narrow it', async () => {
		const all = text(await call('list_declarations', { path: main }));
		assert.match(all, /^\d+ declarations usable from .*main\.xsl/, all);
		const own = all.split('\n\n').find((section) => section.startsWith('Declared in this module'))!;
		assert.match(own, /xsl:function f:local#1\(\$a\)/);
		const imported = all.split('\n\n').find((section) => section.startsWith('Declared in the modules and packages it uses'))!;
		assert.match(imported, /xsl:function f:twice#1\(\$n\) - .*overrides\.xsl:2:\d+\n/);
		assert.match(imported, /xsl:function f:twice#1\(\$n as xs:integer\) as xs:integer - .*lib\.xsl:3:\d+ - not used: overridden by one with a higher import precedence/);
		assert.match(all, /find_declaration/);
		// a kind: only those
		const templates = text(await call('list_declarations', { path: types, kind: 'template' }));
		assert.match(templates, /xsl:template name="xsl:initial-template"/);
		assert.notMatch(templates, /xsl:variable/);
		assert.match(text(await call('list_declarations', { path: types, kind: 'item-type' })), /xsl:item-type cx:point as record\(x as xs:double, y\? as xs:double\)/);
		assert.match(text(await call('list_declarations', { path: types, kind: 'key' })), /^No key declarations in .*types\.xsl/);
		// the first line of a declaration's documentation
		assert.match(text(await call('list_declarations', { path: documented, kind: 'function' })), /xsl:function d:area#2\(.*documented\.xsl:2:\d+ - The area of a rectangle\./);
		assert.isTrue((await call('list_declarations', { path: path.join(dir, 'missing.xsl') })).message.result.isError);
	});

	test('evaluate_xpath: with a real Saxon jar, in XSLT_TEST_SAXON_JAR - counts, nodes, a prolog, and Saxon\'s error', async function () {
		const saxonJar = process.env.XSLT_TEST_SAXON_JAR;
		if (!saxonJar) {
			this.skip();
		}
		const data = path.join(dir, 'orders.xml');
		fs.writeFileSync(data, '<orders xmlns:o="urn:o"><o:order id="a" total="50"/><o:order id="b" total="150"/></orders>');
		const tasks = vscode.workspace.getConfiguration('XSLT.tasks');
		const savedJar = tasks.inspect<string>('saxonJar')?.globalValue;
		await tasks.update('saxonJar', saxonJar, vscode.ConfigurationTarget.Global);
		const evaluator = new XPathEvaluate(vscode.extensions.getExtension('deltaxml.xslt-xpath')!.extensionUri);
		try {
			const count = await evaluator.evaluate('count(//*)', data, '3.1');
			assert.isFalse(count.isError, count.content[0].text);
			assert.match(count.content[0].text, /^1 item for XPath 3\.1 on orders\.xml\n3$/);
			const nodes = await evaluator.evaluate("declare namespace o = 'urn:o'; //o:order[@total > 100]/@id", data, '3.1');
			assert.match(nodes.content[0].text, /^1 item for XPath 3\.1 on orders\.xml\n[\s\S]*@id/, nodes.content[0].text);
			assert.include(nodes.content[0].text, 'b');
			const error = await evaluator.evaluate('count(', data, '3.1');
			assert.isTrue(error.isError);
			assert.match(error.content[0].text, /^Error XPST\d+/, error.content[0].text);
			assert.isTrue((await evaluator.evaluate('1', path.join(dir, 'none.xml'))).isError);
			// where the nodes are in the XML file - and saxon:line-number() works, with Saxon-PE or EE
			const located = path.join(dir, 'lines.xml');
			// a start tag over two lines: where the element starts, not where Saxon records it (the end of its start tag)
			fs.writeFileSync(located, '<orders>\n  <order\n      id="a"/>\n  <order id="b">\n    text\n  </order>\n</orders>\n');
			const lines = (await evaluator.evaluate('//order/@id | //order[1] | //order[2]/text()', located, '3.1')).content[0].text;
			assert.include(lines, '\n  /orders/order[1]  2:4\n', lines);
			assert.include(lines, '\n  /orders/order[1]/@id  3:7\n', lines);
			assert.include(lines, '\n  /orders/order[2]/@id  4:10\n', lines);
			// text at its first character that isn't white space: 'text' is on line 5
			assert.match(lines, /\n  \/orders\/order\[2\]\/text\(\)  5:5$/, lines);
			const withoutNodes = (await evaluator.evaluate('count(//order)', located, '3.1')).content[0].text;
			assert.notInclude(withoutNodes, 'Line numbers');
			const lineNumber = await evaluator.evaluate("declare namespace saxon = 'http://saxon.sf.net/'; //order/saxon:line-number(.)", located, '3.1');
			if (/-HE /.test((await RunConfiguration.saxonReport(saxonJar!)).product ?? '')) {
				assert.isTrue(lineNumber.isError);
				assert.include(lineNumber.content[0].text, 'need Saxon-PE or Saxon-EE', lineNumber.content[0].text);
			} else {
				// Saxon's own: where each start tag ends - 3 and 4, not the 2 and 4 where the elements start
				assert.match(lineNumber.content[0].text, /\(\n  3,\n  4\n\)/, lineNumber.content[0].text);
			}
			// map:, array: and math: are predeclared - a stylesheet must declare them itself
			assert.match((await evaluator.evaluate('map:size(map{1:2}) + array:size([1]) + xs:integer(math:pi() > 3)', data, '3.1')).content[0].text, /\n3$/);
			// the document's default namespace isn't bound, as in a stylesheet: nothing found, with a hint - unless the stylesheet's
			// xpath-default-namespace is given
			const defaulted = path.join(dir, 'default.xml');
			fs.writeFileSync(defaulted, '<orders xmlns="urn:o" xmlns:o="urn:o"><order/></orders>');
			const unmatched = await evaluator.evaluate('//order', defaulted, '3.1');
			assert.match(unmatched.content[0].text, /^0 items/);
			assert.include(unmatched.content[0].text, 'xpath-default-namespace');
			assert.match((await evaluator.evaluate('count(//order)', defaulted, '3.1', 'urn:o')).content[0].text, /\n1$/);
			assert.match((await evaluator.evaluate('count(//o:order)', defaulted, '3.1')).content[0].text, /\n1$/, 'a prefix the document declares is bound');
			// safe for an assistant: no extension functions, no collection(), and only files in the workspace folders (and the XML
			// file's) - not another folder's, a ../ path, a symbolic link out, a network address, or an XML entity
			const others = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-mcp-other-'));
			const secret = path.join(others, 'secret.txt');
			fs.writeFileSync(secret, 'secret text');
			fs.writeFileSync(path.join(dir, 'inside.txt'), 'inside text');
			const entity = path.join(dir, 'entity.xml');
			fs.writeFileSync(entity, `<?xml version="1.0"?>\n<!DOCTYPE r [<!ENTITY x SYSTEM "${vscode.Uri.file(secret).toString()}">]>\n<r>&x;</r>`);
			fs.symlinkSync(secret, path.join(dir, 'link.txt'));
			const blocked = async (expression: string, file = data) => {
				const result = await evaluator.evaluate(expression, file, '3.1');
				assert.isTrue(result.isError, `${expression}: ${result.content[0].text}`);
				assert.notInclude(result.content[0].text, 'secret text');
				return result.content[0].text;
			};
			assert.match(await blocked("Q{java:java.lang.Runtime}getRuntime()"), /XPST0017/);
			assert.match(await blocked("Q{http://expath.org/ns/file}exists('/tmp')"), /XPST0017/);
			assert.match(await blocked(`unparsed-text('${vscode.Uri.file(secret).toString()}')`), /Not allowed to read/);
			assert.match(await blocked(`doc('${vscode.Uri.file(path.join(others, 'x.xml')).toString()}')`), /Not allowed to read/);
			assert.match(await blocked(`unparsed-text('../${path.basename(others)}/secret.txt')`), /Not allowed to read|FOUT1170/);
			assert.match(await blocked("unparsed-text('link.txt')"), /Not allowed to read/);
			assert.match(await blocked("unparsed-text('http://example.com/')"), /Not allowed to read/);
			assert.match(await blocked(`collection('${vscode.Uri.file(dir).toString()}?select=*.xml')`), /collection\(\) and uri-collection\(\) aren't available/);
			// an external entity isn't read: not even after a document has been parsed, when the XML parser is reused
			for (const file of [data, entity, data, entity]) {
				const read = await evaluator.evaluate('string(/)', file, '3.1');
				assert.notInclude(read.content[0].text, 'secret text', read.content[0].text);
			}
			assert.match((await evaluator.evaluate("unparsed-text('inside.txt')", data, '3.1')).content[0].text, /inside text/, 'a file beside the XML file is read');
			fs.rmSync(others, { recursive: true, force: true });
			// several at once, as an assistant sends them: each is answered - none is stopped by the next
			const together = await Promise.all(['count(//*)', 'string(/*/name())', "map:size(map{'a':1})", 'count(//o:order)'].map((expression) => evaluator.evaluate(expression, data, '3.1')));
			together.forEach((result, index) => assert.isFalse(result.isError, `${index}: ${result.content[0].text}`));
			assert.deepEqual(together.map((result) => result.content[0].text.split('\n').pop()), ['3', "'orders'", '1', '2']);
			// an expression that doesn't end is stopped - and the next one runs
			const timeoutMs = XPathEvaluate.timeoutMs;
			XPathEvaluate.timeoutMs = 2000;
			try {
				const endless = await evaluator.evaluate('fold-left(1 to 2000000000, 0, function($a, $b) { $a + $b })', data, '3.1');
				assert.isTrue(endless.isError);
				assert.match(endless.content[0].text, /took more than 2 seconds, so it was stopped/);
			} finally {
				XPathEvaluate.timeoutMs = timeoutMs;
			}
			assert.match((await evaluator.evaluate('count(//*)', data, '3.1')).content[0].text, /\n3$/, 'after one was stopped');
		} finally {
			evaluator.dispose();
			await tasks.update('saxonJar', savedJar, vscode.ConfigurationTarget.Global);
		}
	});

	test('find_declaration: from a module, the one with the highest import precedence first', async () => {
		const lines = text(await call('find_declaration', { path: main, name: 'f:twice', kind: 'function' })).split('\n');
		assert.match(lines[0], /^xsl:function f:twice#1\(\$n\) - .*overrides\.xsl:2:\d+$/);
		assert.match(lines[1], /^xsl:function f:twice#1\(\$n as xs:integer\) as xs:integer - .*lib\.xsl:3:\d+ - not used: overridden by the one above/);
		assert.match(text(await call('find_declaration', { path: main, name: 'f:twice#2' })), /^No declaration named f:twice#2/);
		assert.match(text(await call('find_declaration', { path: types, name: '$origin' })), /^xsl:variable \$origin as cx:point - .*types\.xsl:4:\d+$/);
		assert.match(text(await call('find_declaration', { path: main, name: 'replace' })), /is a built-in function: see the xpath_function tool$/);
	});

	test('find_declaration: with its documentation - its note, or a comment just before it', async () => {
		const area = text(await call('find_declaration', { path: documented, name: 'd:area' })).split('\n');
		assert.match(area[0], /^xsl:function d:area#2\(\$width as xs:double, \$height as xs:double\) as xs:double - .*documented\.xsl:2:\d+$/);
		assert.strictEqual(area[1], '    The area of a rectangle.', area.join('\n'));
		assert.match(area.slice(2).join('\n'), /@param\* `\$width` — the width, in metres/);
		assert.deepEqual(text(await call('find_declaration', { path: documented, name: 'd:total' })).split('\n').slice(1), ['    the total for a line:', '    its quantity times its price']);
		// not a comment with a blank line after it, e.g. a section heading
		assert.lengthOf(text(await call('find_declaration', { path: documented, name: 'd:helper' })).split('\n'), 1);
	});

	test('describe_type: with each field\'s @field text', async () => {
		const lines = text(await call('describe_type', { path: documented, name: 'd:size' })).split('\n');
		assert.deepEqual(lines.slice(-2), ['  w as xs:double - the width', '  h? as xs:double - the height, if not square'], lines.join('\n'));
	});

	test('find_references: as Find All References finds them, with their lines', async () => {
		const result = text(await call('find_references', { path: main, name: 'f:local' }));
		assert.match(result, /^3 references to xsl:function f:local#1\(\$a\) - .*main\.xsl:5:\d+, including the declaration:\n\n.*main\.xsl:\n {2}5:\d+ \(declaration\) <xsl:function name="f:local">/, result);
		assert.strictEqual(result.split('\n').filter((line) => /^ {2}5:\d+ /.test(line)).length, 3, result);
	});

	test('find_references: to a function declared in an imported module - with the uses in the module asked about', async () => {
		const result = text(await call('find_references', { path: main, name: 'f:twice' }));
		assert.match(result, /^2 references to xsl:function f:twice#1\(\$n\) - .*overrides\.xsl:2:\d+/, result);
		assert.match(result, /main\.xsl:\n {2}3:\d+ <xsl:template match="\/"><xsl:sequence select="f:twice\(2\)/, result);
		assert.match(result, /overrides\.xsl:\n {2}2:\d+ \(declaration\)/, result);
	});

	test('find_references: the uses in an XSpec file last, as its tests - each with its scenario', async () => {
		// in a folder of its own, so not one of lint_files' files; open, as it's not in the workspace
		const specDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-mcp-spec-'));
		const spec = path.join(specDir, 'main.xspec');
		fs.writeFileSync(spec, `<x:description xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:f="urn:f" stylesheet="${path.relative(specDir, main)}">
  <x:scenario label="f:local">
    <x:scenario label="of 1">
      <x:call function="f:local"><x:param select="1"/></x:call>
      <x:expect label="is itself" test="f:local(1) = 1"/>
    </x:scenario>
  </x:scenario>
</x:description>`);
		await vscode.workspace.openTextDocument(spec);
		const result = text(await call('find_references', { path: main, name: 'f:local' }));
		const [others, tested] = result.split('\n\nTested in XSpec:\n\n');
		assert.match(others, /main\.xsl:\n {2}5:\d+ \(declaration\)/, result);
		assert.notMatch(others, /main\.xspec/, result);
		assert.match(tested, /main\.xspec:\n {2}4:\d+ \(scenario: f:local > of 1\) <x:call function="f:local">/, result);
		assert.match(tested, /\n {2}5:\d+ \(scenario: f:local > of 1\) <x:expect/, result);
	});

	test('describe_type: a record type\'s fields, an enumeration type\'s values', async () => {
		assert.strictEqual(text(await call('describe_type', { path: types, name: 'cx:point' })).replace(/ - .*types\.xsl/, ' - types.xsl'),
			'xsl:item-type cx:point as record(x as xs:double, y? as xs:double) - types.xsl:2:24\na record type with 2 fields:\n  x as xs:double\n  y? as xs:double');
		assert.match(text(await call('describe_type', { path: types, name: 'cx:colour' })), /\nan enumeration type, with the values: 'red', 'green'$/);
		assert.match(text(await call('describe_type', { path: types, name: 'cx:none' })), /^No item type named cx:none .* those declared are: cx:point, cx:colour$/);
	});

	test('xpath_function: a built-in function\'s signature and description - for XPath 3.1 or 4.0', async () => {
		assert.match(text(await call('xpath_function', { name: 'fn:replace' })), /^replace\( input as xs:string\?, pattern as xs:string/);
		assert.match(text(await call('xpath_function', { name: 'map:get' })), /map:get/);
		assert.match(text(await call('xpath_function', { name: 'parse-html' })), /isn't a built-in function in XPath 3\.1 .* it is in XPath 4\.0/);
		assert.notMatch(text(await call('xpath_function', { name: 'parse-html', xpathVersion: '4.0' })), /isn't a built-in function/);
	});

	test('a reset token: the old one is refused', async () => {
		const old = token;
		token = await server.resetToken();
		assert.notStrictEqual(token, old);
		assert.strictEqual((await post({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }, { Authorization: `Bearer ${old}` })).status, 401);
		assert.strictEqual((await post({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }, { Authorization: `Bearer ${token}` })).status, 200);
	});
});

// An MCP request, as JSON-RPC over HTTP: the status, and the result or error - from a JSON body or an event stream
function postTo(serverPort: number, body: object, headers: Record<string, string>): Promise<{ status: number, text: string, message?: any }> {
	return new Promise((resolve, reject) => {
		const request = http.request({ host: '127.0.0.1', port: serverPort, path: '/mcp', method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...headers } }, (response) => {
			let text = '';
			response.on('data', (chunk) => text += chunk);
			response.on('end', () => {
				const data = /^data: (.*)$/m.exec(text);
				let message: any;
				try {
					message = data ? JSON.parse(data[1]) : text ? JSON.parse(text) : undefined;
				} catch {
					message = undefined;
				}
				resolve({ status: response.statusCode ?? 0, text, message });
			});
		});
		request.on('error', reject);
		request.end(JSON.stringify(body));
	});
}

suite('MCP server: the skill it serves', function () {
	this.timeout(20000);
	const skillPort = 6798;
	const extension = vscode.extensions.getExtension('deltaxml.xslt-xpath')!;
	const skillFile = path.join(extension.extensionPath, 'xslt-resources', 'skills', 'xslt-xpath', 'SKILL.md');
	const server = new XsltMcpServer(memorySecrets(), { problems: async () => [], declarations: async () => ({ own: [], imported: [] }) }, undefined, extension.extensionUri);
	let token = '';
	let id = 0;
	// the 2026-07-28 protocol: each request says so in its _meta and in a header, and names its method - and the resource it reads - in others
	const modern = (method: string, params: object = {}) => postTo(skillPort, { jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: {
		'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } } },
	{ Authorization: `Bearer ${token}`, 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...('uri' in params ? { 'Mcp-Name': String((params as { uri: string }).uri) } : {}) });
	// the 2025 protocols: an initialize, then the request
	const legacy = (method: string, params: object = {}) => postTo(skillPort, { jsonrpc: '2.0', id: ++id, method, params }, { Authorization: `Bearer ${token}` });

	suiteSetup(async () => {
		assert.isTrue(await server.start(skillPort));
		token = await server.getToken();
	});

	suiteTeardown(() => server.stop());

	test('the skill is listed, with the digest and size of its file', async () => {
		const bytes = fs.readFileSync(skillFile);
		const listed = await modern('skills/list');
		assert.strictEqual(listed.status, 200, listed.text);
		const skills = listed.message?.result?.skills;
		assert.isArray(skills, listed.text);
		// each skill in xslt-resources/skills: the XSLT and XPath, Schematron and XSpec ones
		assert.deepEqual(skills.map((skill: { frontmatter: { name: string } }) => skill.frontmatter.name).sort(), ['schematron', 'xslt-debugging', 'xslt-xpath', 'xspec-testing'], listed.text);
		const skill = skills.find((s: { frontmatter: { name: string } }) => s.frontmatter.name === 'xslt-xpath');
		assert.strictEqual(skill.uri, 'skill://xslt-xpath/SKILL.md');
		assert.match(skill.frontmatter.description, /XSLT/);
		assert.deepEqual(skill.resources, [{ uri: 'skill://xslt-xpath/SKILL.md', digest: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`, size: bytes.length }]);
		for (const other of ['xspec-testing', 'schematron']) {
			const found = skills.find((s: { frontmatter: { name: string } }) => s.frontmatter.name === other);
			assert.strictEqual(found.uri, `skill://${other}/SKILL.md`);
		}
	});

	test('the skill\'s file is read as a resource, as it is on disk', async () => {
		const read = await modern('resources/read', { uri: 'skill://xslt-xpath/SKILL.md' });
		assert.strictEqual(read.status, 200, read.text);
		assert.strictEqual(read.message?.result?.contents?.[0]?.text, fs.readFileSync(skillFile, 'utf8'), read.text);
	});

	test('skills/get: the skill by its URI - and an error for another', async () => {
		const got = await modern('skills/get', { uri: 'skill://xslt-xpath/SKILL.md' });
		assert.strictEqual(got.message?.result?.skill?.frontmatter?.name, 'xslt-xpath', got.text);
		const unknown = await modern('skills/get', { uri: 'skill://none/SKILL.md' });
		assert.strictEqual(unknown.message?.error?.code, -32602, unknown.text);
	});

	test('the tools are served the same way on the new protocol', async () => {
		const tools = await modern('tools/list');
		assert.strictEqual(tools.status, 200, tools.text);
		const names = (tools.message?.result?.tools ?? []).map((tool: { name: string }) => tool.name);
		assert.include(names, 'lint_file', tools.text);
		assert.include(names, 'list_declarations', tools.text);
	});

	test('a stream a client keeps open on the new protocol (subscriptions/listen) ends when the server is stopped - not when the client gives up', async () => {
		const streamPort = 6797;
		const streaming = new XsltMcpServer(memorySecrets(), { problems: async () => [], declarations: async () => ({ own: [], imported: [] }) }, undefined, extension.extensionUri);
		assert.isTrue(await streaming.start(streamPort));
		const streamToken = await streaming.getToken();
		try {
			const request = http.request({ host: '127.0.0.1', port: streamPort, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream', Authorization: `Bearer ${streamToken}`, 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'subscriptions/listen' } });
			const opened = new Promise<http.IncomingMessage>((resolve, reject) => { request.on('response', resolve); request.on('error', reject); });
			request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'subscriptions/listen', params: { notifications: { toolsListChanged: true }, _meta: {
				'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } } }));
			const response = await opened;
			assert.strictEqual(response.statusCode, 200);
			// a stream: still open, after its first message
			let ended = false;
			response.on('data', () => undefined);
			response.on('close', () => ended = true);
			response.on('error', () => ended = true);
			await new Promise((resolve) => setTimeout(resolve, 500));
			assert.isFalse(ended, 'the stream is open while the server runs');
			streaming.stop();
			for (let waited = 0; waited < 3000 && !ended; waited += 100) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			assert.isTrue(ended, 'the stream is closed by stopping the server');
			// and it serves again when it's started again - e.g. the setting turned off, then on
			assert.isTrue(await streaming.start(streamPort));
			const again = await postTo(streamPort, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { Authorization: `Bearer ${await streaming.getToken()}` });
			assert.strictEqual(again.status, 200, again.text);
			assert.isArray(again.message?.result?.tools, again.text);
		} finally {
			streaming.stop();
		}
	});

	test('the 2025 protocol still works: tools are listed, and the server\'s skill is read as a resource', async () => {
		const tools = await legacy('tools/list');
		assert.strictEqual(tools.status, 200, tools.text);
		assert.include((tools.message?.result?.tools ?? []).map((tool: { name: string }) => tool.name), 'lint_file', tools.text);
		const read = await legacy('resources/read', { uri: 'skill://xslt-xpath/SKILL.md' });
		assert.strictEqual(read.message?.result?.contents?.[0]?.text, fs.readFileSync(skillFile, 'utf8'), read.text);
	});
});
