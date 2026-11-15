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
import { SchematronValidation, SchematronOutcome } from './schematronValidation';
import { SchematronContext } from './schematronContext';

// The status bar item for the last Schematron validation - of the XML file in the editor, or for a Schematron file, of
// its schema's XML context file: valid, its problems by severity, running or failed to run - and out of date when the file,
// the schema or a file the schema includes has changed since. Shown only for a file validated in this session - with
// Validate, Quick Run or at the end of a Schematron debug session. A click validates again, or with problems shows them
export class SchematronStatus {
	private static item: vscode.StatusBarItem | undefined;
	// the XML files whose outcome is out of date, by path
	private static readonly changed = new Set<string>();
	private static visible = false;

	public static activate(context: vscode.ExtensionContext) {
		// left of the phase (99.9)
		const item = vscode.window.createStatusBarItem('xslt-xpath.schematronResult', vscode.StatusBarAlignment.Right, 99.91);
		item.name = 'Schematron Validation';
		SchematronStatus.item = item;
		context.subscriptions.push(item,
			vscode.window.onDidChangeActiveTextEditor(() => SchematronStatus.show()),
			SchematronValidation.onDidChangeOutcome((outcome) => {
				if (outcome.state !== 'running') {
					SchematronStatus.changed.delete(outcome.xml);
				}
				SchematronStatus.show();
			}),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.contentChanges.length === 0 || event.document.uri.scheme !== 'file') {
					return;
				}
				const file = event.document.fileName;
				const schema = /\.sch$/i.test(file) ? SchematronContext.schemaOf(event.document.uri) : undefined;
				let changed = false;
				SchematronValidation.outcomes.forEach((outcome) => {
					if (outcome.state === 'done' && (outcome.xml === file || outcome.schema === file || outcome.schema === schema) && !SchematronStatus.changed.has(outcome.xml)) {
						SchematronStatus.changed.add(outcome.xml);
						changed = true;
					}
				});
				if (changed) {
					SchematronStatus.show();
				}
			}));
		SchematronStatus.show();
	}

	// the outcome for the active editor: its file's, or for a Schematron file, its schema's context file's with the schema
	private static outcomeFor(document: vscode.TextDocument | undefined): SchematronOutcome | undefined {
		if (!document || document.uri.scheme !== 'file') {
			return undefined;
		}
		if (document.languageId === 'sch') {
			const schema = SchematronContext.schemaOf(document.uri);
			const xml = schema ? SchematronContext.contextFor(schema)?.file : undefined;
			const outcome = xml ? SchematronValidation.outcomes.get(xml) : undefined;
			return outcome?.schema === schema ? outcome : undefined;
		}
		return SchematronValidation.outcomes.get(document.fileName);
	}

	public static show() {
		const item = SchematronStatus.item;
		if (!item) {
			return;
		}
		const document = vscode.window.activeTextEditor?.document;
		const outcome = SchematronStatus.outcomeFor(document);
		SchematronStatus.visible = !!document && !!outcome;
		if (!document || !outcome) {
			item.hide();
			return;
		}
		const isSchema = document.languageId === 'sch';
		// the other file: the schema for an XML file, the XML file for a schema
		const other = path.basename(isSchema ? outcome.xml : outcome.schema);
		const files = `\`${path.basename(outcome.xml)}\` with \`${path.basename(outcome.schema)}\`${outcome.phase ? `, phase **${outcome.phase}**` : ''}`;
		const time = outcome.at.toLocaleTimeString();
		const problems = outcome.errors + outcome.warnings + outcome.infos;
		const stale = outcome.state === 'done' && SchematronStatus.changed.has(outcome.xml);
		const validate = { command: SchematronValidation.validateCommand, title: 'Validate with Schematron', arguments: [document.uri] };
		const counts = [[outcome.errors, 'error'], [outcome.warnings, 'warning'], [outcome.infos, 'info']]
			.filter(([n]) => n as number > 0).map(([n, kind]) => `${n} ${kind}${n === 1 || kind === 'info' ? '' : 's'}`).join(', ');
		let text: string;
		let summary: string;
		if (outcome.state === 'running') {
			text = `$(sync~spin) ${other}`;
			summary = `Schematron: validating ${files}...`;
			item.command = undefined;
		} else if (outcome.state === 'failed') {
			text = `$(circle-slash) ${other}`;
			summary = `Schematron: the validation of ${files} failed to run, at ${time} - see the Schematron output.\n\nClick to validate again.`;
			item.command = validate;
		} else if (stale) {
			text = `$(circle-outline) ${other}`;
			summary = `Schematron: ${files} ${problems === 0 ? 'was valid' : `had ${counts}`} at ${time} - changed since.\n\nClick to validate again.`;
			item.command = validate;
		} else if (problems === 0) {
			text = `$(pass) ${other}`;
			summary = `Schematron: ${files} is valid - validated at ${time}.\n\nClick to validate again.`;
			item.command = validate;
		} else {
			text = `$(${outcome.errors > 0 ? 'error' : outcome.warnings > 0 ? 'warning' : 'info'}) ${problems} · ${other}`;
			summary = `Schematron: ${files} has ${counts} - validated at ${time}.\n\nClick to show them in the Problems view.`;
			item.command = { command: 'workbench.actions.view.problems', title: 'Show Problems' };
		}
		item.text = text;
		item.tooltip = new vscode.MarkdownString(summary);
		item.show();
	}

	// for testing: the status bar item
	public static status() {
		const item = SchematronStatus.item;
		return item && SchematronStatus.visible ? { text: item.text, tooltip: (item.tooltip as vscode.MarkdownString).value, command: (item.command as vscode.Command | undefined)?.command } : undefined;
	}
}
