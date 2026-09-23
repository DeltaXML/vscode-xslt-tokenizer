/**
 * Test suite for identifying Quick Run's persisted tasks
 *
 * Quick Run re-runs the task whose xsltFile + xmlSource pair matches the active stylesheet and XML context file.
 * Labels are ignored, since stylesheets with the same file name in different folders (or hand-written tasks)
 * can share a label. With no XML context file ('None'), the task has an empty xmlSource and starts from
 * xsl:initial-template - such tasks must be found for the stylesheet alone, and never confused with tasks
 * that do have a source.
 */
import * as path from 'path';
import { assert } from 'chai';
import * as vscode from 'vscode';
import { SaxonTaskProvider, QuickRunTaskType } from '../../src/saxonTaskProvider';
import { SaxonJsTaskProvider } from '../../src/saxonJsTaskProvider';
import { SaxonCTaskProvider } from '../../src/saxonCTaskProvider';

suite('Quick Run - persisted task matching', () => {
	const workspaceFolder = path.resolve('/work/project');
	const fsPath = (...segments: string[]) => path.join(workspaceFolder, ...segments);
	const definition = (xsltFile: string, xmlSource: string, type = 'xslt') => ({ type, label: 'report with books.xml', xsltFile, xmlSource });

	test('matches on xsltFile and xmlSource, not on label', () => {
		const taskA = definition('${workspaceFolder}/a/report.xsl', '${workspaceFolder}/books.xml');
		const taskB = definition('${workspaceFolder}/b/report.xsl', '${workspaceFolder}/books.xml');
		const xslt = fsPath('b', 'report.xsl');
		const source = fsPath('books.xml');

		assert.isFalse(SaxonTaskProvider.isQuickRunTaskFor(taskA, 'xslt', xslt, source, workspaceFolder));
		assert.isTrue(SaxonTaskProvider.isQuickRunTaskFor(taskB, 'xslt', xslt, source, workspaceFolder));
	});

	test('distinguishes tasks with the same stylesheet but different XML sources', () => {
		const task = definition('${workspaceFolder}/report.xsl', '${workspaceFolder}/a/books.xml');
		assert.isFalse(SaxonTaskProvider.isQuickRunTaskFor(task, 'xslt', fsPath('report.xsl'), fsPath('b', 'books.xml'), workspaceFolder));
	});

	test('only matches tasks of the selected processor type', () => {
		const task = definition('${workspaceFolder}/report.xsl', '${workspaceFolder}/books.xml', 'xslt-c');
		assert.isFalse(SaxonTaskProvider.isQuickRunTaskFor(task, 'xslt', fsPath('report.xsl'), fsPath('books.xml'), workspaceFolder));
		assert.isTrue(SaxonTaskProvider.isQuickRunTaskFor(task, 'xslt-c', fsPath('report.xsl'), fsPath('books.xml'), workspaceFolder));
	});

	test('matches absolute stored paths, e.g. for files outside the workspace folder', () => {
		const outside = path.resolve('/elsewhere/report.xsl');
		const task = definition(outside, '${workspaceFolder}/books.xml');
		assert.isTrue(SaxonTaskProvider.isQuickRunTaskFor(task, 'xslt', outside, fsPath('books.xml'), workspaceFolder));
	});

	test('with no XML source, matches tasks whose xmlSource is empty or absent', () => {
		const xslt = fsPath('report.xsl');
		const emptySource = definition('${workspaceFolder}/report.xsl', '');
		const { xmlSource, ...absentSource } = emptySource;
		assert.isTrue(SaxonTaskProvider.isQuickRunTaskFor(emptySource, 'xslt', xslt, undefined, workspaceFolder));
		assert.isTrue(SaxonTaskProvider.isQuickRunTaskFor(absentSource, 'xslt', xslt, undefined, workspaceFolder));
	});

	test('keeps tasks with and without an XML source apart for the same stylesheet', () => {
		const xslt = fsPath('report.xsl');
		const withSource = definition('${workspaceFolder}/report.xsl', '${workspaceFolder}/books.xml');
		const withoutSource = definition('${workspaceFolder}/report.xsl', '');
		assert.isFalse(SaxonTaskProvider.isQuickRunTaskFor(withSource, 'xslt', xslt, undefined, workspaceFolder));
		assert.isFalse(SaxonTaskProvider.isQuickRunTaskFor(withoutSource, 'xslt', xslt, fsPath('books.xml'), workspaceFolder));
	});

	test('ignores tasks whose paths are file-picker commands rather than files', () => {
		const task = definition('${command:xslt-xpath.pickXsltFile}', '${command:xslt-xpath.pickXmlSourceFile}');
		assert.isFalse(SaxonTaskProvider.isQuickRunTaskFor(task, 'xslt', fsPath('report.xsl'), fsPath('books.xml'), workspaceFolder));
	});
});

suite('Quick Run - tasks listed for the active XML file', () => {
	const workspaceFolder = path.resolve('/work/project');
	const fsPath = (...segments: string[]) => path.join(workspaceFolder, ...segments);

	test('lists tasks for any stylesheet whose xmlSource is the file', () => {
		const reportTask = { type: 'xslt', label: 'report with books.xml', xsltFile: '${workspaceFolder}/report.xsl', xmlSource: '${workspaceFolder}/data/books.xml' };
		const summaryTask = { type: 'xslt-c', label: 'summary', xsltFile: '/tools/summary.xsl', xmlSource: fsPath('data', 'books.xml') };
		assert.isTrue(SaxonTaskProvider.hasXmlSource(reportTask, fsPath('data', 'books.xml'), workspaceFolder));
		assert.isTrue(SaxonTaskProvider.hasXmlSource(summaryTask, fsPath('data', 'books.xml'), workspaceFolder));
		assert.isFalse(SaxonTaskProvider.hasXmlSource(reportTask, fsPath('data', 'other.xml'), workspaceFolder));
	});

	test('does not treat tasks with no source, or a variable source, as being for the file', () => {
		const xml = fsPath('books.xml');
		const withoutSource = { type: 'xslt', label: 'report with xsl:initial-template', xsltFile: '${workspaceFolder}/report.xsl', xmlSource: '' };
		const pickerSource = { type: 'xslt', label: 'Saxon Transform (New)', xsltFile: '${command:xslt-xpath.pickXsltFile}', xmlSource: '${command:xslt-xpath.pickXmlSourceFile}' };
		const currentFileSource = { type: 'xslt', label: 'Summarise', xsltFile: '${workspaceFolder}/summary.xsl', xmlSource: '${file}' };
		assert.isFalse(SaxonTaskProvider.hasXmlSource(withoutSource, xml, workspaceFolder));
		assert.isFalse(SaxonTaskProvider.hasXmlSource(pickerSource, xml, workspaceFolder));
		// '${file}' tasks are listed separately, as 'tasks for the current file'
		assert.isFalse(SaxonTaskProvider.hasXmlSource(currentFileSource, xml, workspaceFolder));
	});
});

suite('Quick Run - tasks with no XML source', () => {
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

	for (const taskType of Object.keys(providers) as QuickRunTaskType[]) {
		test(`${taskType}: starts from xsl:initial-template, with no source document`, () => {
			const definition = SaxonTaskProvider.createQuickRunTaskDefinition(taskType, 'report with xsl:initial-template', '/work/report.xsl', undefined, '/work/out.xml');
			// xmlSource is required by the task schemas, so it's written as an empty string rather than left out
			assert.strictEqual(definition.xmlSource, '');
			assert.strictEqual(definition.initialTemplate, '');

			const task = providers[taskType].getTask(definition);
			assert.exists(task);
			const args = processorArgs(task!);
			assert.include(args, '-it');
			assert.include(args, '-xsl:/work/report.xsl');
			assert.isFalse(args.some((arg) => arg.startsWith('-s:')), `unexpected source argument in: ${args.join(' ')}`);
		});
	}

	test('tasks with an XML source have no initialTemplate', () => {
		const definition = SaxonTaskProvider.createQuickRunTaskDefinition('xslt', 'report with books.xml', '/work/report.xsl', '/work/books.xml');
		assert.strictEqual(definition.xmlSource, '/work/books.xml');
		assert.notProperty(definition, 'initialTemplate');
	});
});
