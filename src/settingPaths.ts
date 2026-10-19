/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

// A path from a setting, without quotes around it - as Windows Explorer's 'Copy as path' adds, so a path pasted into
// the Settings editor often has them. They can't be part of a Windows path, and are very unlikely in any other.
export function unquotedPath<T extends string | undefined>(fsPath: T): T {
	const match = typeof fsPath === 'string' ? /^\s*"(.*)"\s*$/.exec(fsPath) : null;
	return <T>(match ? match[1] : fsPath);
}

// each path of a setting that's a list of paths
export function unquotedPaths<T extends string[] | undefined>(fsPaths: T): T {
	return <T>(Array.isArray(fsPaths) ? fsPaths.map((p) => unquotedPath(p)) : fsPaths);
}
