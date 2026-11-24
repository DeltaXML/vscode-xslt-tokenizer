/**
 * Test suite for run_configuration's tasks: the XSLT tasks in a project's tasks.json - the stylesheet's, or all - with the
 * problems that would stop one running as meant, and the properties a task has, from the extension's task definitions
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert } from 'chai';
import { TaskConfiguration } from '../../src/mcp/taskConfiguration';

suite('MCP tool run_configuration: the XSLT tasks, their problems and the properties a task has', () => {
	const extensionPackage = () => vscode.extensions.getExtension('deltaxml.xslt-xpath')!.packageJSON;
	let folder = '';

	setup(() => {
		folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-configuration-')));
		fs.writeFileSync(path.join(folder, 'report.xsl'), '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"/>');
		fs.writeFileSync(path.join(folder, 'saxon.jar'), '');
	});
	teardown(() => fs.rmSync(folder, { recursive: true, force: true }));

	const writeTasks = (tasks: object[], inputs: object[] = []) => {
		fs.mkdirSync(path.join(folder, '.vscode'), { recursive: true });
		fs.writeFileSync(path.join(folder, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks, inputs }, null, 2));
	};

	test('a stylesheet\'s task: each problem - a property it doesn\'t have, a file that isn\'t there, a parameter, a label used twice', () => {
		writeTasks([
			{ type: 'xslt', label: 'Quick Run', saxonJar: path.join(folder, 'saxon.jar'), xsltFile: '${workspaceFolder}/report.xsl', xmlSource: 'missing.xml',
				sourceFile: 'orders.xml', resultPath: '${command:xslt-xpath.pickResultFile}', parameters: [{ name: 'p' }] },
			{ type: 'xslt', label: 'Quick Run', saxonJar: path.join(folder, 'saxon.jar'), xsltFile: 'other.xsl', initialTemplate: 'main', parameters: [{ name: 'q', value: '${input:qValue}' }] },
			{ type: 'shell', label: 'build', command: 'make' }
		]);
		const text = TaskConfiguration.describe(extensionPackage(), folder, path.join(folder, 'report.xsl')).join('\n');
		assert.match(text, /^Tasks in .*tasks\.json for report\.xsl: 1\n {2}'Quick Run' - type xslt \(SaxonJ\)\n/);
		assert.include(text, `problem: 'sourceFile' isn't a property of a 'xslt' task`);
		assert.include(text, `problem: xmlSource 'missing.xml' - no such file`);
		assert.include(text, 'problem: parameters[0] needs a "name" and a "value"');
		assert.include(text, 'problem: another task has the label \'Quick Run\'');
		// not the file a ${command:...} asks for when it runs, nor the stylesheet, which is there
		assert.notMatch(text, /problem: resultPath/);
		assert.notMatch(text, /problem: xsltFile/);
		// the properties of the task's type, with what each does
		assert.match(text, /\nThe properties of a 'xslt' task \(SaxonJ\), as tasks\.json takes them - required: /);
		assert.match(text, /\n {2}xmlSource \(string\) - The path to the XML\/JSON source file/);
		assert.match(text, /\n {2}initialTemplate \(string\) - /);
		assert.include(text, 'Prefix the name with ? for an XPath value');
	});

	test('all the tasks, with no stylesheet: an undefined ${input:...} - not one tasks.json defines', () => {
		writeTasks([
			{ type: 'xslt', label: 'one', saxonJar: path.join(folder, 'saxon.jar'), xsltFile: 'report.xsl', initialTemplate: 'main', parameters: [{ name: 'q', value: '${input:qValue}' }] },
			{ type: 'xslt-js', label: 'two', xsltFile: 'report.xsl', xmlSource: '', parameters: [{ name: 'r', value: '${input:defined}' }] }
		], [{ id: 'defined', type: 'promptString' }]);
		const text = TaskConfiguration.describe(extensionPackage(), folder).join('\n');
		assert.match(text, /^Tasks in .*tasks\.json: 2\n/);
		assert.include(text, 'problem: ${input:qValue} - tasks.json has no input with the id \'qValue\'');
		assert.notInclude(text, '${input:defined}');
		// SaxonJS: no xmlSource, and no initialTemplate
		assert.match(text, /'two' - type xslt-js \(SaxonJS\)\n {4}problem: no xmlSource, and no initialTemplate to start from instead/);
		assert.match(text, /\nThe properties of a 'xslt-js' task \(SaxonJS\)/);
	});

	test('no tasks.json yet: said so, with the properties a task has', () => {
		const text = TaskConfiguration.describe(extensionPackage(), folder, path.join(folder, 'report.xsl')).join('\n');
		assert.match(text, /^Tasks: no \.vscode\/tasks\.json yet - Quick Run creates a task/);
		assert.match(text, /\nThe properties of a 'xslt' task \(SaxonJ\)/);
	});
});
