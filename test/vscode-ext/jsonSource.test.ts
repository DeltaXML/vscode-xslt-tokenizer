/**
 * Test suite for JSON source documents in XSLT tasks
 *
 * All three task types pass 'xmlSource' as '-json:' rather than '-s:' when 'useJsonSource' is true, or - when
 * 'useJsonSource' is not set - when xmlSource is a '.json' file. 'useJsonSource: false' always passes '-s:'.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { assert } from 'chai';
import { SaxonTaskProvider, QuickRunTaskType } from '../../src/saxonTaskProvider';
import { SaxonJsTaskProvider } from '../../src/saxonJsTaskProvider';
import { SaxonCTaskProvider } from '../../src/saxonCTaskProvider';

suite('XSLT tasks - JSON source documents', () => {
	// SaxonC tasks on macOS/Linux run a script bundled with the extension - the extension may not be activated
	suiteSetup(() => {
		SaxonTaskProvider.extensionURI ??= vscode.Uri.file(path.resolve(__dirname, '..', '..', '..'));
	});

	const providers: { [type in QuickRunTaskType]: { getTask(definition: vscode.TaskDefinition): vscode.Task | undefined } } = {
		'xslt': new SaxonTaskProvider(''),
		'xslt-js': new SaxonJsTaskProvider(''),
		'xslt-c': new SaxonCTaskProvider(''),
	};

	// the arguments passed to the processor - SaxonC on macOS/Linux runs via a /bin/sh command line instead
	const processorArgs = (task: vscode.Task) => {
		const execution = task.execution;
		if (execution instanceof vscode.ProcessExecution) {
			return execution.args;
		}
		return (execution as vscode.ShellExecution).commandLine!.split(' ').map((arg) => arg.replace(/^'|'$/g, ''));
	};

	const sourceArg = (taskType: QuickRunTaskType, xmlSource: string, useJsonSource?: boolean) => {
		const definition: vscode.TaskDefinition = { type: taskType, label: 'json test', saxonJar: '/saxon/saxon-he-12.5.jar', saxonCPath: '/saxonc/bin', xsltFile: '/work/report.xsl', xmlSource };
		if (useJsonSource !== undefined) {
			definition.useJsonSource = useJsonSource;
		}
		const task = providers[taskType].getTask(definition);
		assert.exists(task);
		const sourceArgs = processorArgs(task!).filter((arg) => arg.startsWith('-s:') || arg.startsWith('-json:'));
		assert.lengthOf(sourceArgs, 1, `expected exactly one source argument in: ${processorArgs(task!).join(' ')}`);
		return sourceArgs[0];
	};

	for (const taskType of Object.keys(providers) as QuickRunTaskType[]) {
		test(`${taskType}: useJsonSource passes the source as -json:`, () => {
			assert.strictEqual(sourceArg(taskType, '/work/data.txt', true), '-json:/work/data.txt');
		});

		test(`${taskType}: a .json source is passed as -json: when useJsonSource is not set`, () => {
			assert.strictEqual(sourceArg(taskType, '/work/data.JSON'), '-json:/work/data.JSON');
		});

		test(`${taskType}: useJsonSource false passes the source as -s:, even for a .json file`, () => {
			assert.strictEqual(sourceArg(taskType, '/work/data.json', false), '-s:/work/data.json');
		});

		test(`${taskType}: an XML source is passed as -s:`, () => {
			assert.strictEqual(sourceArg(taskType, '/work/books.xml'), '-s:/work/books.xml');
		});
	}
});
