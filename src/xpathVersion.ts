/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as path from 'path';

export type XPathVersionNumber = '3.1' | '4.0';

// The XPath version of an XPath document (.xpath): 4.0 - except for 'Find Nodes with XPath's query file, which has the
// version chosen for it in the status bar (3.1, as in XSLT 3.0, or 4.0), as Saxon evaluates its expressions. The
// linter, auto-completion, signature help and hover all follow this, so they agree with each other and with Saxon.
export class XPathVersion {
	public static readonly queryFileName = 'queries.xpath';
	private static queryFileVersion: XPathVersionNumber = '4.0';

	public static setQueryFileVersion(version: XPathVersionNumber) {
		XPathVersion.queryFileVersion = version;
	}

	public static getQueryFileVersion(): XPathVersionNumber {
		return XPathVersion.queryFileVersion;
	}

	public static isQueryFile(document: { languageId: string; uri: { fsPath: string } }) {
		return document.languageId === 'xpath' && path.basename(document.uri.fsPath) === XPathVersion.queryFileName;
	}

	// whether an XPath document is XPath 4.0
	public static isXPath40(document: { languageId: string; uri: { fsPath: string } } | undefined) {
		return !document || !XPathVersion.isQueryFile(document) || XPathVersion.queryFileVersion === '4.0';
	}
}
