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

// the jars in the lib folder of a SaxonJ download that Saxon needs on the classpath for a feature, with the Saxon jar:
// CoffeeFilter and CoffeeGrinder (nineml), which Saxon 13's invisible-xml() function parses with - without them, it
// fails at run time with NoClassDefFoundError org/nineml/coffeefilter/InvisibleXml. Not the other jars there, e.g.
// xmlresolver: the debugger has its own, and two versions on the classpath may conflict
export class SaxonLib {
	private static readonly jarPattern = /^coffee(filter|grinder)-.*\.jar$/;
	private static cache = new Map<string, string[]>();

	// the jars for the Saxon jar - ${workspaceFolder} is the first workspace folder, as for the XSLT.tasks.saxonJar setting,
	// and a relative path is relative to it. None for a path with another variable, or without a lib folder, e.g. a jar
	// from Maven. Not those the classpath already has, by name
	public static jarsFor(saxonJar: string | undefined, classPath: string[] = []): string[] {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (saxonJar && workspaceFolder) {
			saxonJar = saxonJar.replace(/\$\{workspaceFolder\}/g, workspaceFolder);
			saxonJar = path.isAbsolute(saxonJar) ? saxonJar : path.join(workspaceFolder, saxonJar);
		}
		if (!saxonJar || saxonJar.includes('${')) {
			return [];
		}
		let jars = SaxonLib.cache.get(saxonJar);
		if (!jars) {
			const lib = path.join(path.dirname(saxonJar), 'lib');
			try {
				jars = fs.readdirSync(lib).filter((name) => SaxonLib.jarPattern.test(name)).sort().map((name) => path.join(lib, name));
			} catch {
				jars = [];
			}
			SaxonLib.cache.set(saxonJar, jars);
		}
		const present = new Set(classPath.map((entry) => path.basename(entry)));
		return jars.filter((jar) => !present.has(path.basename(jar)));
	}

	// the classpath: the Saxon jar, the entries given, then the jars for the Saxon jar
	public static classPath(saxonJar: string, entries: string[] = []): string[] {
		const classPath = [saxonJar, ...entries];
		return classPath.concat(SaxonLib.jarsFor(saxonJar, classPath));
	}

	// for tests: forget the folders read
	public static clearCache() {
		SaxonLib.cache.clear();
	}
}
