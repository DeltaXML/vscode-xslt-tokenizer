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
import { HrefPaths } from './hrefPaths';
import { XSpecHrefs } from './xspecHrefs';
import { XsltPackages } from './xsltPackages';
import { parseXml, localName } from './xspecXml';

// XSpec imports the stylesheet it tests - and each x:helper's stylesheet - into its test runner, and an xsl:use-package can't be
// in an imported stylesheet: Saxon stops the run with XTSE3008. That's so for a stylesheet that has one at its top level, and
// for one that includes or imports a module that has - the module is then in an imported stylesheet. Not with run-as="external",
// which doesn't import it, nor a package under test, which has its own check (a package can't be imported). The packages are
// used by the top-level stylesheet: in the test runner, that's what x:helper package-name is for - the modules with the logic
// are tested, and the runner uses the packages for them
export class XSpecUsePackage {
	public static problems(document: vscode.TextDocument): vscode.Diagnostic[] {
		if (document.uri.scheme !== 'file') {
			return [];
		}
		const text = document.getText();
		const root = parseXml(text);
		if (!root || localName(root.name) !== 'description' || root.attributes.get('run-as')?.trim() === 'external') {
			return [];
		}
		return XSpecHrefs.find(text, document.fileName).filter((href) => href.attribute === 'stylesheet' && (href.element === 'description' || href.element === 'helper')).flatMap((href) => {
			const file = HrefPaths.toPath(href.value, href.basePath);
			if (file === undefined || !fs.existsSync(file) || fs.statSync(file).isDirectory() || XsltPackages.isPackage(file)) {
				return [];
			}
			const using = XsltPackages.usingModules(file)[0];
			if (!using) {
				return [];
			}
			const names = using.packages.map((p) => p.name);
			const where = path.normalize(using.file) === path.normalize(file) ? 'it has one' : `${path.basename(using.file)}, which it includes or imports, has one`;
			return [new vscode.Diagnostic(new vscode.Range(document.positionAt(href.start), document.positionAt(href.end)),
				`XSpec: the test runner imports ${href.element === 'helper' ? 'this helper stylesheet' : 'the stylesheet tested'}, and xsl:use-package can't be in an imported stylesheet (XTSE3008) - ${where}, for ${names.length === 1 ? 'the package' : 'the packages'} ${names.join(', ')}. ` +
				`Test a stylesheet without it, and give the runner ${names.length === 1 ? 'the package' : 'each package'} with an x:helper package-name on x:description, as a top-level stylesheet's xsl:use-package would`,
				vscode.DiagnosticSeverity.Error)];
		});
	}
}
