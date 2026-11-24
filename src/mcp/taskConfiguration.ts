/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as jsc from 'jsonc-parser';
import { unquotedPath } from '../settingPaths';

interface PropertySchema {
	type?: string | string[];
	description?: string;
	markdownDescription?: string;
	enum?: string[];
}

interface TaskDefinitionSchema {
	type: string;
	required?: string[];
	properties: { [name: string]: PropertySchema };
}

// For run_configuration's tasks: the XSLT tasks in the workspace's tasks.json - the stylesheet's, or all - with the problems
// that would stop one running as meant, and the properties each kind of task has, from the extension's own task definitions
// (package.json), so an assistant changing a task uses their names, not guesses. Lexical checks of the file, as the user's
// editor would show them, and of the files it names - not a run
export class TaskConfiguration {
	// a task's properties that any VS Code task may have, not the extension's
	private static readonly vscodeProperties = new Set(['type', 'label', 'group', 'problemMatcher', 'dependsOn', 'dependsOrder', 'presentation',
		'isBackground', 'detail', 'icon', 'runOptions', 'options', 'hide', 'promptOnClose']);
	private static readonly xsltTypes = new Set(['xslt', 'xslt-js', 'xslt-c']);
	private static readonly kinds: { [type: string]: string } = { 'xslt': 'SaxonJ', 'xslt-js': 'SaxonJS', 'xslt-c': 'SaxonC' };

	public static describe(extensionPackage: { contributes?: { taskDefinitions?: TaskDefinitionSchema[] } } | undefined, folder: string | undefined, stylesheet?: string): string[] {
		const definitions = new Map((extensionPackage?.contributes?.taskDefinitions ?? []).map((d) => [d.type, d]));
		const lines: string[] = [];
		const tasksFile = folder ? path.join(folder, '.vscode', 'tasks.json') : undefined;
		if (!tasksFile || !fs.existsSync(tasksFile)) {
			lines.push('Tasks: no .vscode/tasks.json yet - Quick Run creates a task for a stylesheet the first time it runs it, which you can then change');
			lines.push(...TaskConfiguration.properties(definitions, ['xslt']));
			return lines;
		}
		const errors: jsc.ParseError[] = [];
		const json = jsc.parse(fs.readFileSync(tasksFile, 'utf8'), errors, { allowTrailingComma: true }) ?? {};
		const all: { [key: string]: unknown }[] = Array.isArray(json.tasks) ? json.tasks : [];
		const inputIds = new Set<string>((Array.isArray(json.inputs) ? json.inputs : []).map((input: { id?: string }) => input.id).filter((id: unknown): id is string => typeof id === 'string'));
		const resolve = (value: string) => {
			const substituted = value.replace(/\$\{workspaceFolder\}/g, folder!);
			return path.isAbsolute(substituted) ? substituted : path.join(folder!, substituted);
		};
		const xsltTasks = all.filter((t) => typeof t.type === 'string' && TaskConfiguration.xsltTypes.has(t.type));
		const tasks = stylesheet ? xsltTasks.filter((t) => typeof t.xsltFile === 'string' && !/\$\{/.test(t.xsltFile.replace(/\$\{workspaceFolder\}/g, '')) &&
			path.normalize(resolve(t.xsltFile)) === path.normalize(stylesheet)) : xsltTasks;
		lines.push(`Tasks in ${tasksFile}${stylesheet ? ` for ${path.basename(stylesheet)}` : ''}: ${tasks.length === 0 ? 'none' : tasks.length}` +
			(errors.length > 0 ? ` - the file has ${errors.length} JSON syntax problem${errors.length === 1 ? '' : 's'}, e.g. at offset ${errors[0].offset}` : ''));
		const labels = new Map<string, number>();
		all.forEach((t) => typeof t.label === 'string' && labels.set(t.label, (labels.get(t.label) ?? 0) + 1));
		for (const task of tasks) {
			const definition = definitions.get(task.type as string);
			lines.push(`  '${task.label ?? '(no label)'}' - type ${task.type} (${TaskConfiguration.kinds[task.type as string]})`);
			const problems = definition ? TaskConfiguration.problems(task, definition, inputIds, resolve) : [];
			if (typeof task.label === 'string' && (labels.get(task.label) ?? 0) > 1) {
				problems.push(`another task has the label '${task.label}' - Quick Run and the debugger find a task by its label`);
			}
			lines.push(...(problems.length > 0 ? problems.map((p) => `    problem: ${p}`) : ['    no problems found']));
		}
		const types = [...new Set(tasks.map((t) => t.type as string))];
		lines.push(...TaskConfiguration.properties(definitions, types.length > 0 ? types : ['xslt']));
		return lines;
	}

	private static problems(task: { [key: string]: unknown }, definition: TaskDefinitionSchema, inputIds: Set<string>, resolve: (value: string) => string): string[] {
		const problems: string[] = [];
		const known = new Set(Object.keys(definition.properties));
		for (const name of Object.keys(task)) {
			if (!known.has(name) && !TaskConfiguration.vscodeProperties.has(name)) {
				problems.push(`'${name}' isn't a property of a '${definition.type}' task - see the properties below`);
			}
		}
		if (typeof task.xsltFile !== 'string' || task.xsltFile.trim() === '') {
			problems.push('no xsltFile');
		}
		if ((typeof task.xmlSource !== 'string' || task.xmlSource.trim() === '') && typeof task.initialTemplate !== 'string') {
			problems.push('no xmlSource, and no initialTemplate to start from instead');
		}
		// the files it names - not those a ${command:...} or ${input:...} asks for when it runs
		const files: [string, unknown][] = [['xsltFile', task.xsltFile], ['xmlSource', task.xmlSource], ['configFilename', task.configFilename]];
		if (typeof task.catalogFilenames === 'string') {
			task.catalogFilenames.split(';').map((f) => f.trim()).filter((f) => f).forEach((f) => files.push(['catalogFilenames', f]));
		}
		for (const [name, value] of files) {
			if (typeof value === 'string' && value.trim() !== '' && !/\$\{(?!workspaceFolder\})/.test(value) && !fs.existsSync(resolve(value))) {
				problems.push(`${name} '${value}' - no such file`);
			}
		}
		if (typeof task.saxonJar === 'string') {
			const jar = task.saxonJar === '${config:XSLT.tasks.saxonJar}' ? unquotedPath(vscode.workspace.getConfiguration('XSLT.tasks').get<string>('saxonJar')) : task.saxonJar;
			if (!jar) {
				problems.push('saxonJar is the XSLT.tasks.saxonJar setting, which isn\'t set');
			} else if (!/\$\{(?!workspaceFolder\})/.test(jar) && !fs.existsSync(resolve(jar))) {
				problems.push(`saxonJar '${jar}' - no such file`);
			}
		}
		// ${input:id} with no input of that id in tasks.json
		const text = JSON.stringify(task);
		for (const [, id] of text.matchAll(/\$\{input:([^}]+)\}/g)) {
			if (!inputIds.has(id)) {
				problems.push(`\${input:${id}} - tasks.json has no input with the id '${id}' in its "inputs"`);
			}
		}
		if (task.parameters !== undefined) {
			const parameters = Array.isArray(task.parameters) ? task.parameters : [];
			if (!Array.isArray(task.parameters)) {
				problems.push('parameters isn\'t a list: it\'s a list of { "name": ..., "value": ... }');
			}
			parameters.forEach((p: unknown, i: number) => {
				const parameter = p as { name?: unknown, value?: unknown };
				if (typeof parameter?.name !== 'string' || parameter.value === undefined) {
					problems.push(`parameters[${i}] needs a "name" and a "value"`);
				}
			});
		}
		return problems;
	}

	// each kind of task's properties: its name, its type, and the first sentence of its description - the required ones marked
	private static properties(definitions: Map<string, TaskDefinitionSchema>, types: string[]): string[] {
		const lines: string[] = [];
		for (const type of types) {
			const definition = definitions.get(type);
			if (!definition) {
				continue;
			}
			lines.push('', `The properties of a '${type}' task (${TaskConfiguration.kinds[type]}), as tasks.json takes them${definition.required ? ` - required: ${definition.required.join(', ')}` : ''}:`);
			for (const [name, schema] of Object.entries(definition.properties)) {
				if (name === 'group' || name === 'label') {
					continue;
				}
				const description = (schema.description ?? schema.markdownDescription ?? '').replace(/\s+/g, ' ').replace(/`/g, '').trim();
				const first = /^(.*?[.!?])(\s|$)/.exec(description)?.[1] ?? description;
				const kind = Array.isArray(schema.type) ? schema.type.join('|') : schema.type ?? '';
				lines.push(`  ${name} (${kind}${schema.enum ? `: ${schema.enum.join(', ')}` : ''}) - ${first}`);
			}
			if (definition.properties.parameters) {
				lines.push('  parameters is a list of { "name": "p", "value": "..." }: the value is a string, as Saxon takes it on its command line. Prefix the name ' +
					'with ? for an XPath value (e.g. "?count" with "3", or "?when" with "xs:date(\'2026-01-01\')"), + for a document read from a file, ! for an ' +
					'xsl:output property; write a namespaced name as {uri}local');
			}
			if (definition.properties.features) {
				lines.push('  features is a list of { "name": ..., "value": ... }: Saxon configuration features, by the last part of their name');
			}
		}
		return lines;
	}
}
