/**
 * Test suite for the extension's MCP server (XsltMcpServer): MCP requests over HTTP, as an assistant sends them - the
 * token and host checks, and the tools: lint_file, for a module that isn't open in an editor, with its imports, and
 * module_imports, the tree of a module's imports from its top-level stylesheet
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { XsltMcpServer } from '../../src/mcp/xsltMcpServer';
import { XsltSymbolProvider } from '../../src/xsltSymbolProvider';
import { XSLTConfiguration } from '../../src/languageConfigurations';

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
function post(body: object, headers: Record<string, string>): Promise<{ status: number, message?: any }> {
	return new Promise((resolve, reject) => {
		const request = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST',
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
	fs.writeFileSync(lib, `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="3.0">
  <xsl:include href="missing.xsl"/>
  <xsl:function name="f:twice" as="xs:integer"><xsl:param name="n" as="xs:integer"/><xsl:sequence select="$n * 2"/></xsl:function>
</xsl:stylesheet>`);

	const symbolProvider = new XsltSymbolProvider(XSLTConfiguration.configuration, null);
	const server = new XsltMcpServer(memorySecrets(), { problems: (document) => symbolProvider.diagnosticsFor(document), declarations: (document) => symbolProvider.declarationsFor(document) });
	let token = '';
	let id = 0;
	const call = (name: string, args: object) => post({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, { Authorization: `Bearer ${token}` });
	const text = (response: { message?: any }) => response.message?.result?.content?.[0]?.text as string;

	suiteSetup(async () => {
		assert.isTrue(await server.start(port));
		token = await server.getToken();
	});

	suiteTeardown(() => server.stop());

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
		assert.deepEqual(response.message.result.tools.map((tool: { name: string }) => tool.name), ['lint_file', 'lint_files', 'module_imports', 'find_declaration', 'find_references', 'describe_type', 'xpath_function']);
	});

	test('lint_file: a module that is not open, checked with its imports', async () => {
		assert.isUndefined(vscode.workspace.textDocuments.find((d) => d.fileName === main && vscode.window.visibleTextEditors.some((e) => e.document === d)));
		const result = text(await call('lint_file', { path: main }));
		// the variable isn't declared; the function, from the imported module, is - a warning, as the imported module
		// includes one that isn't found, which might declare it
		assert.match(result, /^1 problem in .*main\.xsl:\n3:61 warning XPath: The variable\/parameter: \$undeclared cannot be resolved here, but it may be defined in an external module/, result);
		assert.notMatch(result, /twice/);
	});

	test('lint_file: an import problem', async () => {
		assert.match(text(await call('lint_file', { path: lib })), /2:\d+ error .*missing\.xsl/);
	});

	test('lint_file: not an XSLT file, or not found', async () => {
		const notXslt = await call('lint_file', { path: path.join(dir, 'data.xml') });
		assert.isTrue(notXslt.message.result.isError);
		assert.match(text(notXslt), /^Not an XSLT or XSpec file/);
		assert.match(text(await call('lint_file', { path: path.join(dir, 'none.xsl') })), /^File not found/);
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

	test('lint_files: the files with problems, after a summary - warnings or worse by default', async () => {
		const lines = text(await call('lint_files', { folder: dir })).split('\n');
		assert.match(lines[0], /^Checked 6 files in .*: 3 problems in 3 files \(warnings or worse\)$/, lines.join('\n'));
		assert.match(text(await call('lint_files', { folder: dir, pattern: 'sub/*.xsl' })), /^Checked 1 file in .*: 1 problem in 1 file \(warnings or worse\)\n\n.*empty\.xsl - 1 problem:\n {2}1:1 error The file is empty/);
		assert.isTrue((await call('lint_files', { folder: path.join(dir, 'none') })).message.result.isError);
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
