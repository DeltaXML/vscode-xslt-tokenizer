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
import { RecordTypes } from './recordTypes';
import { SyntaxExtensions } from './syntaxExtensions';

// A template rule whose match pattern is a union with branches of different default priorities, and no priority
// attribute: XSLT 3.0 treats it as one rule for each branch, with its own priority, but XSLT 4.0 as one rule, with the
// highest - so a different rule may be chosen. Saxon 13 uses 4.0's rule for XSLT 4.0, and for a stylesheet before 4.0
// run with its syntax extensions on, with the warning SXWN9052 - e.g. match="@d:keep" no longer wins over
// match="@d:* | @other". Reported for XSLT 4.0, as Saxon does - and before 4.0, where 4.0's rule applies: when the
// stylesheet runs with the syntax extensions, as its compile needs them (see SyntaxExtensions) - or for any, with the
// XSLT.validation.xslt40UnionPriorities setting
export class UnionPatternPriority {

	// the default priority of a pattern that isn't a union, as XSLT 3.0 gives it (section 6.6)
	public static defaultPriority(pattern: string): number {
		const p = pattern.trim().replace(/^child::/, '').replace(/^attribute::/, '@');
		const name = '(?:Q\\{[^}]*\\})?[\\p{L}_][\\p{L}\\p{N}_.-]*(?::[\\p{L}_][\\p{L}\\p{N}_.-]*)?';
		if (p === '/' || /^@?\*$/u.test(p) || /^(node|text|comment|processing-instruction|namespace-node|document-node|element|attribute)\(\s*\*?\s*\)$/.test(p)) {
			return -0.5;
		} else if (/^@?([\p{L}_][\p{L}\p{N}_.-]*:\*|\*:[\p{L}_][\p{L}\p{N}_.-]*|Q\{[^}]*\}\*)$/u.test(p) || /^(element|attribute)\(\s*\*\s*,/.test(p)) {
			return -0.25;
		} else if (new RegExp(`^@?${name}$`, 'u').test(p) || new RegExp(`^(element|attribute|schema-element|schema-attribute)\\(\\s*${name}\\s*\\)$`, 'u').test(p) ||
			/^processing-instruction\(\s*(["']?)[\p{L}_][\p{L}\p{N}_.-]*\1\s*\)$/u.test(p)) {
			return 0;
		} else if (new RegExp(`^(element|attribute)\\(\\s*${name}\\s*,`, 'u').test(p)) {
			return 0.25;
		}
		// e.g. with a predicate or more than one step
		return 0.5;
	}

	// the branches of a union pattern: those of its top level, outside parentheses, brackets, braces and literals
	public static branches(pattern: string): string[] {
		const branches: string[] = [];
		let depth = 0;
		let quote = '';
		let start = 0;
		for (let i = 0; i < pattern.length; i++) {
			const c = pattern[i];
			if (quote) {
				quote = c === quote ? '' : quote;
			} else if (c === '"' || c === '\'') {
				quote = c;
			} else if ('([{'.includes(c)) {
				depth++;
			} else if (')]}'.includes(c)) {
				depth--;
			} else if (depth === 0 && (c === '|' || (/\sunion\s/.test(pattern.substring(i - 1, i + 6)) && pattern.startsWith('union', i)))) {
				branches.push(pattern.substring(start, i));
				start = i + (c === '|' ? 1 : 5);
			}
		}
		branches.push(pattern.substring(start));
		return branches.map((b) => b.trim()).filter((b) => b !== '');
	}

	public static problems(document: vscode.TextDocument, isXslt40: boolean): vscode.Diagnostic[] {
		const text = document.getText();
		const markup = RecordTypes.blankMarkup(text);
		// the template rules with such patterns: the match value's range, and its branches with their priorities
		const found: { range: vscode.Range, listed: string }[] = [];
		for (const tag of markup.matchAll(RecordTypes.xsltPattern(/<xsl:template\s[^>]*>/g, markup))) {
			const tagStart = tag.index!;
			const match = RecordTypes.attributeOfElementAt(text, tagStart + 1, 'match');
			const matchStart = RecordTypes.attributeValueOffset(text, tagStart + 1, 'match');
			if (!match || matchStart === undefined || RecordTypes.attributeOfElementAt(text, tagStart + 1, 'priority') !== undefined) {
				continue;
			}
			const branches = UnionPatternPriority.branches(match);
			const priorities = branches.map(UnionPatternPriority.defaultPriority);
			if (branches.length < 2 || new Set(priorities).size < 2) {
				continue;
			}
			found.push({ range: new vscode.Range(document.positionAt(matchStart), document.positionAt(matchStart + match.length)), listed: branches.map((b, i) => `${b} (${priorities[i]})`).join(', ') });
		}
		if (found.length === 0) {
			return [];
		}
		// before 4.0: why 4.0's rule applies, if it does
		let reason = '';
		if (!isXslt40) {
			if (document.uri.scheme === 'file' && SyntaxExtensions.neededForModule(document.fileName, text)) {
				reason = 'This stylesheet is run with Saxon\'s syntax extensions - it, or a module of its stylesheet, is XSLT 4.0, or uses item types or notes - so Saxon 13 uses XSLT 4.0\'s rule. ';
			} else if (!vscode.workspace.getConfiguration('XSLT.validation', document.uri).get<boolean>('xslt40UnionPriorities', false)) {
				return [];
			}
		}
		const diagnostics = found.map(({ range, listed }) => new vscode.Diagnostic(range, `XSLT: The branches of this union pattern have different default priorities: ${listed}. XSLT 3.0 makes a rule for each branch, with its own priority, but XSLT 4.0 one rule, with the highest (SXWN9052) - so another rule may be chosen. ${reason}Give the template a priority, or split it into a template for each branch`, vscode.DiagnosticSeverity.Warning));
		return diagnostics;
	}
}
