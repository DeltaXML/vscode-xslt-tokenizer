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
import { SchematronValidation } from './schematronValidation';
import { SchIncludes } from './schIncludes';
import { FileSelection } from './fileSelection';

// Schematron: a schema's XML context file - the XML file it's developed for, as a stylesheet's XML context file is: used for
// the element and attribute names of XPath auto-completion, and validated with the schema by Quick Run (the editor
// title's Run button, with the schema in the editor). It's the one chosen for the schema - shown, and chosen, with the
// status bar item - else the one inferred: the file last validated with the schema, else an open file whose xml-model
// names it. There's no 'None', as there's no xsl:initial-template: a schema validates a document.
// A file sch:include brings in has the context file of the schema that includes it (see SchIncludes)
export class SchematronContext {
	public static readonly pickCommand = 'xslt-xpath.pickSchematronContextFile';
	public static readonly quickRunCommand = 'xslt-xpath.quickRunSchematron';
	private static readonly stateKey = 'schematron context files';
	private static state: vscode.Memento | undefined;
	// for testing: how the file is chosen, from the items offered - undefined if cancelled
	public static choose = (items: (vscode.QuickPickItem & { file?: string })[], schema: string) =>
		vscode.window.showQuickPick(items, { title: `XML context file for ${path.basename(schema)}`, placeHolder: 'The XML file the schema is developed for - for auto-completion, and validated by Quick Run', matchOnDescription: true });
	// for testing: an XML file chosen with 'Browse...'
	public static browse = async () => (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'XML': ['xml'], 'All files': ['*'] }, openLabel: 'Choose' }))?.[0]?.fsPath;
	// called when the context file of a schema changes - e.g. to show it in the status bar
	public static onChange: (() => void) | undefined;

	public static activate(context: vscode.ExtensionContext) {
		SchematronContext.state = context.workspaceState;
		context.subscriptions.push(
			vscode.commands.registerCommand(SchematronContext.pickCommand, async (uri?: vscode.Uri) => {
				const schema = SchematronContext.schemaOf(uri ?? vscode.window.activeTextEditor?.document.uri);
				if (schema) {
					await SchematronContext.pick(schema);
				}
			}),
			vscode.commands.registerCommand(SchematronContext.quickRunCommand, (uri?: vscode.Uri) => SchematronContext.quickRun(uri)));
	}

	// the schema whose context file the Schematron file has: the schema that includes it, directly or not - else itself
	public static schemaOf(uri: vscode.Uri | undefined): string | undefined {
		if (!uri || uri.scheme !== 'file' || !/\.sch$/i.test(uri.fsPath)) {
			return undefined;
		}
		return SchIncludes.instance.chain(uri.fsPath)[0];
	}

	// the file chosen for the schema - if it's still there
	public static chosenFor(schema: string): string | undefined {
		const file = SchematronContext.state?.get<{ [schema: string]: string }>(SchematronContext.stateKey)?.[schema];
		return file && fs.existsSync(file) ? file : undefined;
	}

	// the schema's context file: the one chosen for it, else the one inferred (see SchematronValidation.dataFileFor)
	public static contextFor(schema: string): { file: string, chosen: boolean } | undefined {
		const chosen = SchematronContext.chosenFor(schema);
		if (chosen) {
			return { file: chosen, chosen: true };
		}
		const inferred = SchematronValidation.dataFileFor(schema);
		return inferred ? { file: inferred, chosen: false } : undefined;
	}

	public static async setContextFile(schema: string, file: string | undefined) {
		const files = SchematronContext.state?.get<{ [schema: string]: string }>(SchematronContext.stateKey) ?? {};
		const { [schema]: _old, ...others } = files;
		await SchematronContext.state?.update(SchematronContext.stateKey, file ? { ...others, [schema]: file } : others);
		SchematronContext.onChange?.();
	}

	// chooses the schema's context file: those whose xml-model names the schema first, then the XML files viewed recently,
	// then one to browse for
	public static async pick(schema: string): Promise<string | undefined> {
		const current = SchematronContext.contextFor(schema);
		const associated = await SchematronContext.associatedFiles(schema);
		const recent = (FileSelection.instance?.recentXmlFiles() ?? []).filter((file) => !/\.sch$/i.test(file) && !associated.includes(file) && fs.existsSync(file));
		const item = (file: string, detail?: string) => ({
			label: path.basename(file), file, description: vscode.workspace.asRelativePath(path.dirname(file)),
			detail: [file === current?.file ? (current.chosen ? 'current' : 'current - inferred') : undefined, detail].filter((d) => d).join(' - ') || undefined
		});
		const items: (vscode.QuickPickItem & { file?: string, browse?: boolean })[] = [
			...(associated.length > 0 ? [{ label: 'xml-model', kind: vscode.QuickPickItemKind.Separator }, ...associated.map((file) => item(file, 'its xml-model names the schema'))] : []),
			...(recent.length > 0 ? [{ label: 'recent XML files', kind: vscode.QuickPickItemKind.Separator }, ...recent.map((file) => item(file))] : []),
			{ label: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(folder-opened) Browse...', browse: true }
		];
		const picked = await SchematronContext.choose(items, schema) as (vscode.QuickPickItem & { file?: string, browse?: boolean }) | undefined;
		const file = picked?.browse ? await SchematronContext.browse() : picked?.file;
		if (file) {
			await SchematronContext.setContextFile(schema, file);
		}
		return file;
	}

	// the XML files whose xml-model names the schema: those open, and the workspace's
	private static async associatedFiles(schema: string): Promise<string[]> {
		const files = new Set<string>();
		vscode.workspace.textDocuments.filter((d) => d.uri.scheme === 'file' && d.languageId !== 'sch' && SchematronValidation.xmlModel(d.getText(), d.fileName) === schema)
			.forEach((d) => files.add(d.fileName));
		const uris = await vscode.workspace.findFiles('**/*.xml', '**/node_modules/**', 2000);
		for (const uri of uris.filter((u) => u.scheme === 'file' && !files.has(u.fsPath))) {
			try {
				// the processing instructions are before the outermost element: the start of the file
				const fd = fs.openSync(uri.fsPath, 'r');
				const buffer = Buffer.alloc(4096);
				const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
				fs.closeSync(fd);
				const start = buffer.toString('utf8', 0, length);
				if (start.includes('xml-model') && SchematronValidation.xmlModel(start, uri.fsPath) === schema) {
					files.add(uri.fsPath);
				}
			} catch {
				// a file that can't be read
			}
		}
		return [...files];
	}

	// Quick Run, with a Schematron file in the editor: its schema validates the context file - chosen first, if there's none
	public static async quickRun(uri?: vscode.Uri) {
		const schema = SchematronContext.schemaOf(uri ?? vscode.window.activeTextEditor?.document.uri);
		if (!schema) {
			vscode.window.showInformationMessage('Schematron: Quick Run - open a Schematron file first.');
			return;
		}
		const file = SchematronContext.contextFor(schema)?.file ?? await SchematronContext.pick(schema);
		if (file) {
			await SchematronValidation.validate(vscode.Uri.file(file), schema, true);
		}
	}

	// the status bar item, for a Schematron file in the editor: its context file - a click chooses another
	public static showIn(item: vscode.StatusBarItem, document: vscode.TextDocument) {
		const schema = SchematronContext.schemaOf(document.uri);
		if (!schema) {
			item.hide();
			return;
		}
		const context = SchematronContext.contextFor(schema);
		const includes = SchIncludes.instance;
		const forSchema = schema === document.fileName ? path.basename(schema) :
			`${path.basename(schema)}, which includes this file${includes.isChosen(document.fileName) ? ' - chosen' : ''}`;
		// with more than one schema that includes the file: the others, and how to choose
		const others = schema === document.fileName ? [] : includes.topLevelCandidates(document.fileName).filter((s) => s !== schema);
		const alsoIncluded = others.length > 0 ? `\n\nAlso included by ${others.map((s) => `\`${vscode.workspace.asRelativePath(s)}\``).join(', ')} - choose which with **Schematron: Choose Including Schema...**, or the Schematron Includes view.` : '';
		item.text = `$(file-code) ${context ? path.basename(context.file) : '[XML context file]'}`;
		item.tooltip = new vscode.MarkdownString(context ?
			`XML context file for ${forSchema}: \`${vscode.workspace.asRelativePath(context.file)}\` - ${context.chosen ? 'chosen' : 'inferred: the file last validated with the schema, or one whose `xml-model` names it'}.\n\n` +
			'Used for the element and attribute names of XPath auto-completion, and validated with the schema by Quick Run. Click to choose another.' + alsoIncluded :
			`No XML context file for ${forSchema} yet - click to choose one: it's used for XPath auto-completion, and validated with the schema by Quick Run.` + alsoIncluded);
		item.command = SchematronContext.pickCommand;
		item.show();
	}
}
