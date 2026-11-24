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

// Schematron: text value templates in messages, with xsl:expand-text="yes" on a Schematron element - a non-standard
// extension, allowed by the XSLT.schematron.allowExpandText setting. They're rewritten as sch:value-of, for SchXslt2, by
// xslt-resources/schematron/expand-text.xsl: before 'Schematron: Validate' and XSpec tests of a schema, and by 'Schematron:
// Export Standard Copy...'. In the editor, the lexer has them where expand-text.xsl does (see XslLexer.schAllowExpandText).
// For a Schematron file, the status bar shows whether they're allowed - tvt:on or tvt:off - and opens the setting: it's
// for every Schematron file, so it isn't changed with a click, which could seem to change just the file
export class SchExpandText {
	public static readonly section = 'XSLT.schematron';
	public static readonly setting = 'allowExpandText';
	public static readonly openSettingCommand = 'xslt-xpath.openSchematronExpandTextSetting';
	// the messages: where sch:value-of is allowed - and sch:emph, sch:span and sch:dir within them
	public static readonly messages = ['assert', 'report', 'diagnostic', 'property'];
	public static readonly inMessages = ['emph', 'span', 'dir'];
	private static statusBarItem: vscode.StatusBarItem | undefined;

	public static allowed(): boolean {
		return vscode.workspace.getConfiguration(SchExpandText.section).get<boolean>(SchExpandText.setting, false);
	}

	// onChange: when the setting changes - to check and highlight the open schemas again
	public static activate(context: vscode.ExtensionContext, onChange: () => void) {
		XslLexer.schAllowExpandText = SchExpandText.allowed();
		// just right of the language - whose priority is 100.1 - and left of the context file's item, at 100
		const item = vscode.window.createStatusBarItem('xslt-xpath.schematronExpandText', vscode.StatusBarAlignment.Right, 100.05);
		item.name = 'Schematron Text Value Templates';
		item.command = SchExpandText.openSettingCommand;
		SchExpandText.statusBarItem = item;
		context.subscriptions.push(item,
			vscode.commands.registerCommand(SchExpandText.openSettingCommand, () => SchExpandText.openSetting()),
			vscode.window.onDidChangeActiveTextEditor(() => SchExpandText.update()),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration(`${SchExpandText.section}.${SchExpandText.setting}`)) {
					XslLexer.schAllowExpandText = SchExpandText.allowed();
					SchExpandText.update();
					onChange();
				}
			}));
		SchExpandText.update();
	}

	// the setting, in the Settings editor: the workspace's - or, with no workspace folder open, the user's
	public static openSetting() {
		const id = `${SchExpandText.section}.${SchExpandText.setting}`;
		return vscode.commands.executeCommand((vscode.workspace.workspaceFolders?.length ?? 0) > 0 ? 'workbench.action.openWorkspaceSettings' : 'workbench.action.openSettings', id);
	}

	// for testing: the status bar item's text and tooltip, and whether it's shown
	public static status() {
		const item = SchExpandText.statusBarItem;
		return item ? { text: item.text, tooltip: typeof item.tooltip === 'string' ? item.tooltip : item.tooltip?.value, shown: SchExpandText.shown } : undefined;
	}

	private static shown = false;

	private static update() {
		const item = SchExpandText.statusBarItem;
		if (!item) {
			return;
		}
		const allowed = XslLexer.schAllowExpandText;
		item.text = allowed ? 'tvt:on' : 'tvt:off';
		item.tooltip = new vscode.MarkdownString(`Text value templates in Schematron messages, with \`xsl:expand-text="yes"\` - a non-standard extension: ` +
			`**${allowed ? 'allowed' : 'not allowed'}** by the setting \`${SchExpandText.section}.${SchExpandText.setting}\`, for every Schematron file.\n\nClick to open the setting.`);
		SchExpandText.shown = vscode.window.activeTextEditor?.document.languageId === 'sch';
		if (SchExpandText.shown) {
			item.show();
		} else {
			item.hide();
		}
	}
}
