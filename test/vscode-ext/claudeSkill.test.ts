/**
 * Test suite for ClaudeSkill: the extension's skill for Claude Code, installed in Claude Code's skills folder when the MCP server is set
 * up for it - here in a temporary folder, with an extension folder whose skill the tests change
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { ClaudeSkill } from '../../src/mcp/claudeSkill';

suite('Claude Code skill', function () {
	const config = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-skill-config-'));
	const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'xslt-skill-extension-'));
	const extensionUri = vscode.Uri.file(extension);
	const shippedFile = path.join(extension, 'xslt-resources', 'skills', 'xslt-xpath', 'SKILL.md');
	const configFolder = ClaudeSkill.configFolder;
	const skillFile = () => ClaudeSkill.skillFile();
	const ship = (text: string) => {
		fs.mkdirSync(path.dirname(shippedFile), { recursive: true });
		fs.writeFileSync(shippedFile, text);
	};

	setup(() => {
		ClaudeSkill.configFolder = () => config;
		fs.rmSync(path.join(config, 'skills'), { recursive: true, force: true });
		ship('---\nname: xslt-xpath\n---\n\nversion one\n');
	});

	suiteTeardown(() => {
		ClaudeSkill.configFolder = configFolder;
		fs.rmSync(config, { recursive: true, force: true });
		fs.rmSync(extension, { recursive: true, force: true });
	});

	test('the shipped skills are skills: each with a name that is its folder\'s, and a description', () => {
		const real = vscode.extensions.getExtension('deltaxml.xslt-xpath')!.extensionUri;
		assert.deepEqual(ClaudeSkill.names(real), ['xslt-xpath', 'schematron', 'xslt-debugging', 'xspec-testing']);
		for (const name of ClaudeSkill.names(real)) {
			const text = fs.readFileSync(path.join(real.fsPath, 'xslt-resources', 'skills', name, 'SKILL.md'), 'utf8');
			assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .{80,}\\n---\\n`), name);
		}
	});

	test('several skills: each installed, the main one first - and updated, or left alone if edited, one at a time', () => {
		const shipSkill = (name: string, text: string) => {
			const file = path.join(extension, 'xslt-resources', 'skills', name, 'SKILL.md');
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, text);
		};
		shipSkill('xspec-testing', '---\nname: xspec-testing\n---\n\ntesting one\n');
		// a folder with no SKILL.md isn't a skill
		fs.mkdirSync(path.join(extension, 'xslt-resources', 'skills', 'notes'), { recursive: true });
		assert.deepEqual(ClaudeSkill.names(extensionUri), ['xslt-xpath', 'xspec-testing']);
		const first = ClaudeSkill.installAll(extensionUri);
		assert.deepEqual(first.map((r) => [r.name, r.status]), [['xslt-xpath', 'installed'], ['xspec-testing', 'installed']]);
		assert.isTrue(fs.existsSync(ClaudeSkill.skillFile('xspec-testing')));
		assert.deepEqual(ClaudeSkill.installAll(extensionUri).map((r) => r.status), ['current', 'current']);
		// one out of date, and the other edited by the user
		shipSkill('xspec-testing', '---\nname: xspec-testing\n---\n\ntesting two\n');
		fs.writeFileSync(ClaudeSkill.skillFile(), fs.readFileSync(ClaudeSkill.skillFile(), 'utf8').replace('version one', 'my own notes'));
		shipSkill('xslt-xpath', '---\nname: xslt-xpath\n---\n\nversion three\n');
		assert.deepEqual(ClaudeSkill.installAll(extensionUri).map((r) => [r.name, r.status]), [['xslt-xpath', 'modified'], ['xspec-testing', 'updated']]);
		assert.include(fs.readFileSync(ClaudeSkill.skillFile('xspec-testing'), 'utf8'), 'testing two');
		assert.include(fs.readFileSync(ClaudeSkill.skillFile(), 'utf8'), 'my own notes');
	});

	test('refreshing several: only those installed are updated - a new skill, or one that was deleted, isn\'t installed', () => {
		ClaudeSkill.install(extensionUri);
		const shipSkill = (name: string, text: string) => {
			const file = path.join(extension, 'xslt-resources', 'skills', name, 'SKILL.md');
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, text);
		};
		shipSkill('xspec-testing', '---\nname: xspec-testing\n---\n\ntesting\n');
		shipSkill('xslt-xpath', '---\nname: xslt-xpath\n---\n\nversion four\n');
		const results = ClaudeSkill.refreshAll(extensionUri);
		assert.deepEqual(results.map((r) => [r.name, r.status]), [['xslt-xpath', 'updated'], ['xspec-testing', 'absent']]);
		assert.isFalse(fs.existsSync(ClaudeSkill.skillFile('xspec-testing')));
	});

	test('installed where Claude Code looks for it, with the text as shipped', () => {
		const result = ClaudeSkill.install(extensionUri);
		assert.strictEqual(result.status, 'installed');
		assert.strictEqual(result.path, path.join(config, 'skills', 'xslt-xpath', 'SKILL.md'));
		assert.isTrue(fs.readFileSync(skillFile(), 'utf8').startsWith('---\nname: xslt-xpath\n---\n\nversion one\n'));
	});

	test('already installed and up to date: not written again', () => {
		ClaudeSkill.install(extensionUri);
		const before = fs.statSync(skillFile()).mtimeMs;
		assert.strictEqual(ClaudeSkill.install(extensionUri).status, 'current');
		assert.strictEqual(fs.statSync(skillFile()).mtimeMs, before);
	});

	test('out of date, and as installed: updated', () => {
		ClaudeSkill.install(extensionUri);
		ship('---\nname: xslt-xpath\n---\n\nversion two\n');
		assert.strictEqual(ClaudeSkill.install(extensionUri).status, 'updated');
		assert.include(fs.readFileSync(skillFile(), 'utf8'), 'version two');
		assert.notInclude(fs.readFileSync(skillFile(), 'utf8'), 'version one');
		assert.strictEqual(ClaudeSkill.install(extensionUri).status, 'current');
	});

	test('edited by the user: left alone, even when out of date', () => {
		ClaudeSkill.install(extensionUri);
		fs.writeFileSync(skillFile(), fs.readFileSync(skillFile(), 'utf8').replace('version one', 'my own notes'));
		ship('---\nname: xslt-xpath\n---\n\nversion two\n');
		const result = ClaudeSkill.install(extensionUri);
		assert.strictEqual(result.status, 'modified');
		assert.include(fs.readFileSync(skillFile(), 'utf8'), 'my own notes');
		assert.strictEqual(ClaudeSkill.refresh(extensionUri).status, 'modified');
	});

	test('a skill of that name that the extension didn\'t install: left alone', () => {
		fs.mkdirSync(path.dirname(skillFile()), { recursive: true });
		fs.writeFileSync(skillFile(), '---\nname: xslt-xpath\ndescription: mine\n---\n');
		assert.strictEqual(ClaudeSkill.install(extensionUri).status, 'modified');
		assert.strictEqual(fs.readFileSync(skillFile(), 'utf8'), '---\nname: xslt-xpath\ndescription: mine\n---\n');
	});

	test('refresh: updates one that was installed - never installs one', () => {
		assert.strictEqual(ClaudeSkill.refresh(extensionUri).status, 'absent');
		assert.isFalse(fs.existsSync(skillFile()));
		ClaudeSkill.install(extensionUri);
		ship('---\nname: xslt-xpath\n---\n\nversion two\n');
		assert.strictEqual(ClaudeSkill.refresh(extensionUri).status, 'updated');
		assert.include(fs.readFileSync(skillFile(), 'utf8'), 'version two');
	});

	test('a Windows line-ending copy of the shipped file: the same skill', () => {
		ship('---\r\nname: xslt-xpath\r\n---\r\n\r\nversion one\r\n');
		ClaudeSkill.install(extensionUri);
		assert.strictEqual(ClaudeSkill.install(extensionUri).status, 'current');
	});
});
