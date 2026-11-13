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
import { XslLexer } from './xslLexer';

// Schematron: text value templates in messages, e.g. 'Order {@id} has no lines' - SchXslt2's schxslt:expand-text
// parameter, by the XSLT.schematron.expandText setting. A schema doesn't say it uses them, so it's for every schema: the
// lexer treats the whole schema as expand-text="yes" (see XslLexer.schExpandText), 'Validate with Schematron' passes the
// parameter (see validate.xsl), and 'tvt:on' is shown in the status bar, beside the language, for a Schematron file
export class SchExpandText {
	public static readonly section = 'XSLT.schematron';
	public static readonly setting = 'expandText';
	private static statusBarItem: vscode.StatusBarItem | undefined;

	public static enabled(): boolean {
		return vscode.workspace.getConfiguration(SchExpandText.section).get<boolean>(SchExpandText.setting, false);
	}

	// onChange: when the setting changes - to check and highlight the open schemas again
	public static activate(context: vscode.ExtensionContext, onChange: () => void) {
		XslLexer.schExpandText = SchExpandText.enabled();
		// just right of the language - whose priority is 100.1 - and left of the context file's item, at 100
		const item = vscode.window.createStatusBarItem('xslt-xpath.schematronExpandText', vscode.StatusBarAlignment.Right, 100.05);
		item.name = 'Schematron Text Value Templates';
		item.text = 'tvt:on';
		item.tooltip = new vscode.MarkdownString('Text value templates are enabled in Schematron messages, e.g. `{@id}` - by the `XSLT.schematron.expandText` setting. Click to change it.');
		item.command = { title: 'Open the setting', command: 'workbench.action.openSettings', arguments: [`${SchExpandText.section}.${SchExpandText.setting}`] };
		SchExpandText.statusBarItem = item;
		context.subscriptions.push(item,
			vscode.window.onDidChangeActiveTextEditor(() => SchExpandText.update()),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration(`${SchExpandText.section}.${SchExpandText.setting}`)) {
					XslLexer.schExpandText = SchExpandText.enabled();
					SchExpandText.update();
					onChange();
				}
			}));
		SchExpandText.update();
	}

	private static update() {
		const item = SchExpandText.statusBarItem;
		if (!item) {
			return;
		}
		if (XslLexer.schExpandText && vscode.window.activeTextEditor?.document.languageId === 'sch') {
			item.show();
		} else {
			item.hide();
		}
	}
}
