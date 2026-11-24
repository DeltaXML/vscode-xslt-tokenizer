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
	name: string;
	status: SkillStatus;
	// the skill's file
	path: string;
}

// The extension's skills for Claude Code (a folder each, in xslt-resources/skills, with a SKILL.md): how to use the MCP server's
// tools well, for XSLT and XPath, XSpec tests and Schematron. They're installed in the user's Claude Code skills folder when the
// user sets up the MCP server for Claude Code, and updated, at that time and at start-up, while each is as we installed it - the
// file ends with a line that has a hash of the text above it, so a copy the user edited is left alone. At start-up one that's
// installed is updated, and - where the user has set them up - a skill the extension hasn't offered before (new in this version)
// is installed, so the others don't point to a skill that isn't there; one the user deleted isn't installed again
export class ClaudeSkill {
	public static readonly mainSkill = 'xslt-xpath';
	// the key of the record of the skills offered, in the extension's global state
	public static readonly offeredKey = 'xslt.claudeSkillsOffered';
	// Claude Code's folder: for testing, another
	public static configFolder = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

	private static readonly marker = /\n<!-- Installed by the XSLT\/XPath extension: sha256 ([0-9a-f]{64}) - edit a copy under another name to keep changes -->\n$/;

	public static skillFile(name = ClaudeSkill.mainSkill) {
		return path.join(ClaudeSkill.configFolder(), 'skills', name, 'SKILL.md');
	}

	// the names of the skills the extension ships: the folders of xslt-resources/skills that have a SKILL.md
	public static names(extensionUri: vscode.Uri): string[] {
		const folder = vscode.Uri.joinPath(extensionUri, 'xslt-resources', 'skills').fsPath;
		if (!fs.existsSync(folder)) {
			return [];
		}
		return fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(folder, entry.name, 'SKILL.md')))
			.map((entry) => entry.name).sort((a, b) => (a === ClaudeSkill.mainSkill ? -1 : b === ClaudeSkill.mainSkill ? 1 : a.localeCompare(b)));
	}

	private static hash(text: string) {
		return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
	}

	// the skill as the extension ships it
	private static shipped(extensionUri: vscode.Uri, name: string) {
		return fs.readFileSync(vscode.Uri.joinPath(extensionUri, 'xslt-resources', 'skills', name, 'SKILL.md').fsPath, 'utf8').replace(/\r\n/g, '\n');
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

	// installs a skill - or updates it, if it's out of date and as installed: 'modified' if the file is another's or was edited
	public static install(extensionUri: vscode.Uri, name = ClaudeSkill.mainSkill): SkillResult {
		const file = ClaudeSkill.skillFile(name);
		const shipped = ClaudeSkill.shipped(extensionUri, name);
		if (!fs.existsSync(file)) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, ClaudeSkill.withMarker(shipped), 'utf8');
			return { name, status: 'installed', path: file };
		}
		const installed = ClaudeSkill.asInstalled(file);
		if (installed === undefined) {
			return { name, status: 'modified', path: file };
		}
		if (installed === shipped) {
			return { name, status: 'current', path: file };
		}
		fs.writeFileSync(file, ClaudeSkill.withMarker(shipped), 'utf8');
		return { name, status: 'updated', path: file };
	}

	// installs or updates each skill the extension ships
	public static installAll(extensionUri: vscode.Uri): SkillResult[] {
		return ClaudeSkill.names(extensionUri).map((name) => ClaudeSkill.install(extensionUri, name));
	}

	// updates a skill if it's installed as we installed it - never installs it: 'absent' if it isn't there
	public static refresh(extensionUri: vscode.Uri, name = ClaudeSkill.mainSkill): SkillResult {
		const file = ClaudeSkill.skillFile(name);
		return fs.existsSync(file) ? ClaudeSkill.install(extensionUri, name) : { name, status: 'absent', path: file };
	}

	// the skills the extension shipped before it kept a record of those it offered (see refreshAll)
	public static readonly offeredBeforeRecord: readonly string[] = ['xslt-xpath', 'schematron', 'xspec-testing'];

	// updates each skill that's installed - and, if any of them is (the user set them up), installs each skill not offered
	// before: offered, the skills shipped when the user last set them up or the extension last started (undefined before
	// there was a record). A skill the user deleted has been offered, so it isn't installed again
	public static refreshAll(extensionUri: vscode.Uri, offered?: readonly string[]): SkillResult[] {
		const names = ClaudeSkill.names(extensionUri);
		const known = new Set(offered ?? ClaudeSkill.offeredBeforeRecord);
		const setUp = names.some((name) => fs.existsSync(ClaudeSkill.skillFile(name)));
		return names.map((name) => setUp && !known.has(name) ? ClaudeSkill.install(extensionUri, name) : ClaudeSkill.refresh(extensionUri, name));
	}

	// the record of the skills offered, after refreshAll or installAll: with those shipped now - undefined if the user
	// hasn't set any up, when there's nothing to record
	public static offeredAfter(extensionUri: vscode.Uri, offered: readonly string[] | undefined, results: SkillResult[]): string[] | undefined {
		if (results.every((result) => result.status === 'absent')) {
			return offered ? [...offered] : undefined;
		}
		return [...new Set([...(offered ?? ClaudeSkill.offeredBeforeRecord), ...ClaudeSkill.names(extensionUri)])];
	}
}
