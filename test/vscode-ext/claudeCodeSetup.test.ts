/**
 * Test suite for ClaudeCodeSetup: setting up the MCP server in Claude Code by running its CLI - here a stub 'claude'
 * script, which keeps where the server is set up (a scope, and the folder for 'local') as 'claude mcp' does
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { ClaudeCodeSetup } from '../../src/mcp/claudeCodeSetup';

suite('Claude Code MCP setup', function () {
	this.timeout(20000);
	// the stub is a shell script
	if (process.platform === 'win32') {
		return;
	}
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-claude-'));
	const state = path.join(dir, 'state');
	const calls = path.join(dir, 'calls');
	const stub = path.join(dir, 'claude');
	const project = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-claude-project-'));
	const other = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-claude-other-'));
	const url = 'http://127.0.0.1:6745/mcp';
	const program = ClaudeCodeSetup.program;

	// args: mcp add --transport http --scope <scope> <name> <url> --header <header>, or mcp remove --scope <scope> <name>
	fs.writeFileSync(stub, `#!/bin/sh
echo "$*" >> "${calls}"
command="$2"
[ "$command" = add ] && shift 2
shift 2
scope="$2"; name="$3"; url="$4"; header="$6"
where="$scope"
[ "$scope" = local ] && where="local:$(pwd -P)"
if [ "$command" = remove ]; then
  grep -qx "$where" "${state}" 2>/dev/null || { echo "No MCP server named $name in $scope scope" >&2; exit 1; }
  grep -vx "$where" "${state}" > "${state}.new"; mv "${state}.new" "${state}"
  exit 0
fi
[ "$header" = "Authorization: Bearer bad" ] && { echo "Invalid header: $header" >&2; exit 1; }
echo "$where" >> "${state}"
echo "Added HTTP MCP server $name with URL: $url - headers: $header"
`, { mode: 0o755 });

	const callLines = () => fs.readFileSync(calls, 'utf8').trim().split('\n');
	const states = () => fs.existsSync(state) ? fs.readFileSync(state, 'utf8').trim().split('\n').filter((line) => line) : [];

	setup(() => {
		ClaudeCodeSetup.program = stub;
		[state, calls].forEach((file) => fs.rmSync(file, { force: true }));
	});

	suiteTeardown(() => { ClaudeCodeSetup.program = program; });

	test('set up for all projects: any earlier set-up removed first', async () => {
		const result = await ClaudeCodeSetup.setUp(url, 'tok1', 'user');
		assert.isTrue(result.ok, result.output);
		assert.deepEqual(callLines(), ['mcp remove --scope user xslt-xpath', `mcp add --transport http --scope user xslt-xpath ${url} --header Authorization: Bearer tok1`]);
		// the token isn't in the output, which is shown
		assert.match(result.output, /headers: Authorization: Bearer \*\*\*$/);
		assert.isTrue((await ClaudeCodeSetup.setUp(url, 'tok2', 'user')).ok);
		assert.deepEqual(states(), ['user']);
	});

	test('set up for a project: run in its folder', async () => {
		assert.isTrue((await ClaudeCodeSetup.setUp(url, 'tok1', 'local', project)).ok);
		assert.deepEqual(states(), [`local:${fs.realpathSync(project)}`]);
	});

	test('a failure: the output, without the token', async () => {
		const result = await ClaudeCodeSetup.setUp(url, 'bad', 'user');
		assert.isFalse(result.ok);
		assert.isFalse(result.notFound);
		assert.strictEqual(result.output, 'Invalid header: Authorization: Bearer ***');
	});

	test('claude not found', async () => {
		ClaudeCodeSetup.program = path.join(dir, 'none');
		const result = await ClaudeCodeSetup.setUp(url, 'tok1', 'user');
		assert.isTrue(result.notFound);
		assert.isTrue((await ClaudeCodeSetup.update(url, 'tok1', [project])).result?.notFound);
	});

	test('a new token: set up again only where it was set up', async () => {
		await ClaudeCodeSetup.setUp(url, 'tok1', 'local', project);
		const { updated, result } = await ClaudeCodeSetup.update(url, 'tok2', [other, project]);
		assert.isUndefined(result);
		assert.deepEqual(updated, [project]);
		assert.deepEqual(states(), [`local:${fs.realpathSync(project)}`]);
		assert.strictEqual(callLines().pop(),`mcp add --transport http --scope local xslt-xpath ${url} --header Authorization: Bearer tok2`);
		assert.deepEqual((await ClaudeCodeSetup.update(url, 'tok3', [])).updated, []);
	});
});
