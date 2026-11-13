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
// xslt-resources/schematron/expand-text.xsl: before 'Validate with Schematron' and XSpec tests of a schema, and by 'Export
// as Standard Schematron'. In the editor, the lexer has them where expand-text.xsl does (see XslLexer.schAllowExpandText)
export class SchExpandText {
	public static readonly section = 'XSLT.schematron';
	public static readonly setting = 'allowExpandText';
	// the messages: where sch:value-of is allowed - and sch:emph, sch:span and sch:dir within them
	public static readonly messages = ['assert', 'report', 'diagnostic', 'property'];
	public static readonly inMessages = ['emph', 'span', 'dir'];

	public static allowed(): boolean {
		return vscode.workspace.getConfiguration(SchExpandText.section).get<boolean>(SchExpandText.setting, false);
	}

	// onChange: when the setting changes - to check and highlight the open schemas again
	public static activate(context: vscode.ExtensionContext, onChange: () => void) {
		XslLexer.schAllowExpandText = SchExpandText.allowed();
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(`${SchExpandText.section}.${SchExpandText.setting}`)) {
				XslLexer.schAllowExpandText = SchExpandText.allowed();
				onChange();
			}
		}));
	}
}
