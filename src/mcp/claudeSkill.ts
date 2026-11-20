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
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type SkillStatus = 'installed' | 'updated' | 'current' | 'modified' | 'absent';

export interface SkillResult {
	status: SkillStatus;
	// the skill's file
	path: string;
}

// The extension's skill for Claude Code (xslt-resources/skills/xslt-xpath/SKILL.md): how to use the MCP server's tools well. It's
// installed in the user's Claude Code skills folder when the user sets up the MCP server for Claude Code, and updated, at that
// time and at start-up, while it's as we installed it - the file ends with a line that has a hash of the text above it, so a
// copy the user edited is left alone
export class ClaudeSkill {
	public static readonly skillName = 'xslt-xpath';
	// Claude Code's folder: for testing, another
	public static configFolder = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

	private static readonly marker = /\n<!-- Installed by the XSLT\/XPath extension: sha256 ([0-9a-f]{64}) - edit a copy under another name to keep changes -->\n$/;

	public static skillFile() {
		return path.join(ClaudeSkill.configFolder(), 'skills', ClaudeSkill.skillName, 'SKILL.md');
	}

	private static hash(text: string) {
		return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
	}

	// the skill as the extension ships it
	private static shipped(extensionUri: vscode.Uri) {
		return fs.readFileSync(vscode.Uri.joinPath(extensionUri, 'xslt-resources', 'skills', ClaudeSkill.skillName, 'SKILL.md').fsPath, 'utf8').replace(/\r\n/g, '\n');
	}

	private static withMarker(text: string) {
		return `${text}\n<!-- Installed by the XSLT/XPath extension: sha256 ${ClaudeSkill.hash(text)} - edit a copy under another name to keep changes -->\n`;
	}

	// the installed text without its marker - undefined if it hasn't the marker, or the text isn't as it was installed
	private static asInstalled(file: string): string | undefined {
		const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
		const marker = ClaudeSkill.marker.exec(text);
		if (!marker) {
			return undefined;
		}
		const body = text.substring(0, marker.index);
		return ClaudeSkill.hash(body) === marker[1] ? body : undefined;
	}

	// installs it - or updates it, if it's out of date and as installed: 'modified' if the file is another's or was edited
	public static install(extensionUri: vscode.Uri): SkillResult {
		const file = ClaudeSkill.skillFile();
		const shipped = ClaudeSkill.shipped(extensionUri);
		if (!fs.existsSync(file)) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, ClaudeSkill.withMarker(shipped), 'utf8');
			return { status: 'installed', path: file };
		}
		const installed = ClaudeSkill.asInstalled(file);
		if (installed === undefined) {
			return { status: 'modified', path: file };
		}
		if (installed === shipped) {
			return { status: 'current', path: file };
		}
		fs.writeFileSync(file, ClaudeSkill.withMarker(shipped), 'utf8');
		return { status: 'updated', path: file };
	}

	// updates it if it's installed as we installed it - never installs it: 'absent' if it isn't there
	public static refresh(extensionUri: vscode.Uri): SkillResult {
		const file = ClaudeSkill.skillFile();
		return fs.existsSync(file) ? ClaudeSkill.install(extensionUri) : { status: 'absent', path: file };
	}
}
