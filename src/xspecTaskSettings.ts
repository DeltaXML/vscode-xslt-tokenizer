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
import * as path from 'path';
import * as fs from 'fs';
import * as jsc from 'jsonc-parser';
import { SaxonTaskProvider } from './saxonTaskProvider';

// the Saxon settings of the stylesheet's task - an 'xslt' task in tasks.json, e.g. its Quick Run task - that XSpec's runs
// of its tests use: those for Saxon itself, e.g. the classpath for extension functions, or a configuration file. Not
// those of the transform, e.g. its source, parameters or initial template, which the test runner has its own of. Nor
// the task's saxonJar: tests always run with the XSLT.tasks.saxonJar setting, so one setting switches the Saxon
// version for all of them
export interface XSpecTaskSettings {
	// the task's label
	label: string;
	classPathEntries?: string[];
	configFilename?: string;
	catalogFilenames?: string;
	features?: { name: string, value: string }[];
	dtd?: string;
	enableAssertions?: string;
	expandValues?: string;
}

export class XSpecTaskSettingsFinder {
	public static readonly properties = ['classPathEntries', 'configFilename', 'catalogFilenames', 'features', 'dtd', 'enableAssertions', 'expandValues'];
	// the labels of the tasks picked for each stylesheet, most recently picked first
	private static picked = new Map<string, string[]>();

	// the 'xslt' tasks for the stylesheet - with any source
	public static tasksFor(tasks: vscode.TaskDefinition[], xsltFsPath: string, workspaceFolderFsPath: string): vscode.TaskDefinition[] {
		return tasks.filter((t) => t.type === SaxonTaskProvider.SaxonBuildScriptType && typeof t.xsltFile === 'string' &&
			SaxonTaskProvider.resolveStoredPath(t.xsltFile, workspaceFolderFsPath) === path.normalize(xsltFsPath));
	}

	public static settingsOf(task: vscode.TaskDefinition): XSpecTaskSettings {
		const settings: XSpecTaskSettings = { label: String(task.label ?? '') };
		for (const property of XSpecTaskSettingsFinder.properties) {
			if (task[property] !== undefined) {
				(<any>settings)[property] = task[property];
			}
		}
		return settings;
	}

	// whether the tasks' Saxon settings are all the same - e.g. Quick Run's tasks for different sources - so there's no
	// need to pick one
	public static allTheSame(settings: XSpecTaskSettings[]): boolean {
		const key = ({ label, ...rest }: XSpecTaskSettings) => JSON.stringify(rest);
		return settings.every((s) => key(s) === key(settings[0]));
	}

	// a summary of the settings, e.g. 'classpath: lib/ext.jar · config: saxon.xml'
	public static describe(settings: XSpecTaskSettings): string {
		const parts: string[] = [];
		if (settings.classPathEntries?.length) {
			parts.push('classpath: ' + settings.classPathEntries.join(', '));
		}
		if (settings.configFilename) {
			parts.push('config: ' + settings.configFilename);
		}
		if (settings.catalogFilenames) {
			parts.push('catalog: ' + settings.catalogFilenames);
		}
		if (settings.features?.length) {
			parts.push('features: ' + settings.features.map((f) => `${f.name}=${f.value}`).join(', '));
		}
		for (const [property, option] of [['dtd', 'dtd'], ['enableAssertions', 'ea'], ['expandValues', 'expand']]) {
			const value = (<any>settings)[property];
			if (value !== undefined) {
				parts.push(`${option}: ${value}`);
			}
		}
		return parts.length > 0 ? parts.join(' · ') : 'no Saxon settings';
	}

	// the settings of the task for the stylesheet the XSpec file tests: undefined if it has none, or with several tasks
	// whose settings differ, those of the one the user picks - 'cancelled' if they didn't
	public static async find(xsltFsPath: string): Promise<XSpecTaskSettings | undefined | 'cancelled'> {
		const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(xsltFsPath)) ?? vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return undefined;
		}
		let tasks: vscode.TaskDefinition[];
		try {
			tasks = jsc.parse(fs.readFileSync(path.join(folder.uri.fsPath, '.vscode', 'tasks.json'), 'utf8'))?.tasks || [];
		} catch {
			return undefined;
		}
		const settings = XSpecTaskSettingsFinder.tasksFor(tasks, xsltFsPath, folder.uri.fsPath).map(XSpecTaskSettingsFinder.settingsOf);
		if (settings.length === 0) {
			return undefined;
		}
		if (XSpecTaskSettingsFinder.allTheSame(settings)) {
			return settings[0];
		}
		const recentlyPicked = XSpecTaskSettingsFinder.picked.get(xsltFsPath) ?? [];
		const order = SaxonTaskProvider.quickRunTaskChoices(settings.map((s) => ({ type: SaxonTaskProvider.SaxonBuildScriptType, label: s.label })), recentlyPicked);
		const items = settings.map((s) => ({ label: s.label, description: XSpecTaskSettingsFinder.describe(s), settings: s }))
			.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
		const picked = await vscode.window.showQuickPick(items,
			{ placeHolder: `${settings.length} tasks run ${path.basename(xsltFsPath)} - pick the one whose Saxon settings the XSpec tests use` });
		if (!picked) {
			return 'cancelled';
		}
		XSpecTaskSettingsFinder.picked.set(xsltFsPath, [picked.label, ...recentlyPicked.filter((label) => label !== picked.label)]);
		return picked.settings;
	}

	// for running Saxon from the extension: the classpath entries and Saxon options - with the variables VS Code
	// substitutes in a task, e.g. ${workspaceFolder}, substituted, and relative paths, relative to the workspace folder
	// where the task runs, made absolute, as Saxon's run in the XSpec file's folder
	public static commandLine(settings: XSpecTaskSettings, workspaceFolderFsPath: string): { classPath: string[], args: string[] } {
		const substitute = (value: string) => value
			.replace(/\$\{workspaceFolder\}/g, workspaceFolderFsPath)
			.replace(/\$\{workspaceFolderBasename\}/g, path.basename(workspaceFolderFsPath))
			.replace(/\$\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? '')
			.replace(/\$\{config:([^}]+)\}/g, (_, name) => String(vscode.workspace.getConfiguration().get(name) ?? ''));
		const absolute = (value: string) => {
			const substituted = substitute(value);
			return path.isAbsolute(substituted) ? substituted : path.join(workspaceFolderFsPath, substituted);
		};
		const args: string[] = [];
		if (settings.configFilename) {
			args.push('-config:' + absolute(settings.configFilename));
		}
		if (settings.catalogFilenames) {
			args.push('-catalog:' + settings.catalogFilenames.split(';').map((c) => absolute(c.trim())).join(';'));
		}
		if (settings.dtd !== undefined) {
			args.push('-dtd:' + settings.dtd);
		}
		if (settings.enableAssertions !== undefined) {
			args.push('-ea:' + settings.enableAssertions);
		}
		if (settings.expandValues !== undefined) {
			args.push('-expand:' + settings.expandValues);
		}
		(settings.features ?? []).forEach((f) => args.push('--' + f.name + ':' + substitute(String(f.value))));
		return { classPath: (settings.classPathEntries ?? []).map(absolute), args };
	}

	// for the debugger: the task's properties, for the launch configuration - VS Code substitutes their variables, and
	// the debugger runs in the workspace folder, as the task does
	public static launchProperties(settings: XSpecTaskSettings | undefined): { [property: string]: unknown } {
		const { label, ...properties } = settings ?? { label: '' };
		return properties;
	}
}
