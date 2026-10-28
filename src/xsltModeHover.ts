/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - hover for XSLT modes
 */
import * as vscode from 'vscode';
import { RecordTypes } from './recordTypes';
import { ModulePrefixes } from './modulePrefixes';
import { XslLexerLight } from './xslLexerLight';

/**
 * The hover of a mode's name: where the mode is applied from - the other modes of the template rules, and the named
 * templates or functions, with an xsl:apply-templates for it, across the stylesheet's modules, as 'Find All
 * References' finds them. Not the mode itself, which its own template rules commonly apply, e.g. with mode="#current".
 * An xsl:apply-templates without a mode, for a default-mode that names the mode, isn't included.
 */
export class ModeHover {

	// the mode name at a position: in the mode attribute of an xsl:template or xsl:apply-templates, or the name of an
	// xsl:mode - not #current, #default etc.
	public static modeAt(document: vscode.TextDocument, position: vscode.Position): { name: string, range: vscode.Range } | undefined {
		const text = document.getText();
		const offset = document.offsetAt(position);
		const tagStart = text.lastIndexOf('<', offset);
		const writtenElement = RecordTypes.xsltPattern(/^<(xsl:template|xsl:apply-templates|xsl:mode)[\s>/]/, text).exec(text.substring(tagStart, tagStart + 40))?.[1];
		const element = writtenElement ? RecordTypes.xsltName(writtenElement, RecordTypes.xsltPrefix(text)) : undefined;
		const attributeName = element === 'xsl:mode' ? 'name' : 'mode';
		const valueStart = element ? RecordTypes.attributeValueOffset(text, tagStart + 1, attributeName) : undefined;
		const value = element ? RecordTypes.attributeOfElementAt(text, tagStart + 1, attributeName, true) : undefined;
		if (valueStart === undefined || value === undefined || offset < valueStart || offset > valueStart + value.length) {
			return undefined;
		}
		// one of the whitespace-separated names, e.g. b in mode="a b"
		const nameRgx = /\S+/g;
		for (let m = nameRgx.exec(value); m; m = nameRgx.exec(value)) {
			const start = valueStart + m.index;
			if (offset >= start && offset <= start + m[0].length) {
				return m[0].startsWith('#') ? undefined :
					{ name: m[0], range: new vscode.Range(document.positionAt(start), document.positionAt(start + m[0].length)) };
			}
		}
		return undefined;
	}

	public static async hover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
		const mode = ModeHover.modeAt(document, position);
		if (!mode) {
			return undefined;
		}
		const references = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', document.uri, mode.range.start.translate(0, 1)) ?? [];
		if (token.isCancellationRequested) {
			return undefined;
		}
		// the mode's name with its namespace: another module may use another prefix for it
		const expandedName = ModulePrefixes.expandedName(mode.name, XslLexerLight.prefixBindingsOf(document.getText()));
		const { invokers, appliedByItself } = await ModeHover.invokers(expandedName, references);
		const markdown = new vscode.MarkdownString(`**mode** \`${mode.name}\`\n\n`);
		if (invokers.size === 0) {
			markdown.appendMarkdown(appliedByItself ? 'Only applied by its own template rules' : 'Not applied by an `xsl:apply-templates` in the stylesheet\'s modules');
			markdown.appendMarkdown(' - it may be the initial mode, set when the transform is run');
		} else {
			markdown.appendMarkdown('Applied from:\n');
			for (const [invoker, count] of invokers) {
				markdown.appendMarkdown(`- ${invoker}${count > 1 ? ` (${count})` : ''}\n`);
			}
		}
		return new vscode.Hover(markdown, mode.range);
	}

	// where the mode is applied from, with the number of xsl:apply-templates for each: e.g. 'mode `summary`', for the
	// template rules in that mode, or 'named template `t`' - from the modules with references to the mode. Not the mode
	// itself, by its expanded name (see ModulePrefixes): a template rule in it and another mode is listed for the other mode
	private static async invokers(modeName: string, references: vscode.Location[]): Promise<{ invokers: Map<string, number>, appliedByItself: boolean }> {
		const invokers = new Map<string, number>();
		let appliedByItself = false;
		const uris = new Map<string, vscode.Uri>(references.map((r) => [r.uri.toString(), r.uri]));
		for (const uri of uris.values()) {
			const document = await vscode.workspace.openTextDocument(uri);
			const text = document.getText();
			const markup = RecordTypes.blankMarkup(text);
			const bindings = XslLexerLight.prefixBindingsOf(text);
			// the xsl:apply-templates referencing the mode
			const tagStarts = new Set<number>();
			for (const reference of references.filter((r) => r.uri.toString() === uri.toString())) {
				const tagStart = markup.lastIndexOf('<', document.offsetAt(reference.range.start));
				if (markup.startsWith(RecordTypes.xsltTag(markup, 'apply-templates'), tagStart)) {
					tagStarts.add(tagStart);
				}
			}
			const offsets = [...tagStarts].sort((a, b) => a - b);
			const ancestorsAt = RecordTypes.openElementsAt(markup, offsets);
			offsets.forEach((offset, i) => {
				const invoker = ModeHover.invoker(text, ancestorsAt[i], modeName, bindings);
				if (invoker) {
					invokers.set(invoker, (invokers.get(invoker) ?? 0) + 1);
				} else {
					appliedByItself = true;
				}
			});
		}
		return { invokers, appliedByItself };
	}

	// what an xsl:apply-templates is within: the template rule, with its modes other than the mode applied, the named
	// template, or the function or other declaration - undefined for a template rule only in the mode applied
	private static invoker(text: string, ancestors: { name: string, offset: number }[], modeName: string, bindings: Map<string, string> | undefined): string | undefined {
		const attribute = (element: { offset: number }, name: string) => RecordTypes.attributeOfElementAt(text, element.offset + 1, name);
		const template = ancestors.find((a) => a.name === 'xsl:template');
		if (template) {
			const name = attribute(template, 'name');
			const match = attribute(template, 'match');
			// XSLT 4.0: a template rule within an xsl:mode is in that mode
			const enclosingMode = ancestors.find((a) => a.name === 'xsl:mode');
			const modes = (enclosingMode ? attribute(enclosingMode, 'name') : attribute(template, 'mode'))?.trim().split(/\s+/) ?? [];
			if (match !== undefined) {
				const otherModes = (modes.length > 0 ? modes : ['#default']).filter((m) => ModulePrefixes.expandedName(m, bindings) !== modeName);
				return otherModes.length > 0 ? otherModes.map((m) => `mode \`${m}\``).join(', ') : undefined;
			}
			return `named template \`${name}\``;
		}
		const fn = ancestors.find((a) => a.name === 'xsl:function');
		if (fn) {
			return `function \`${attribute(fn, 'name')}\``;
		}
		// e.g. a global variable - the child of the xsl:stylesheet
		const declaration = ancestors[1];
		const declarationName = declaration ? attribute(declaration, 'name') : undefined;
		return declaration ? `\`${declaration.name}\`${declarationName ? ` \`${declarationName}\`` : ''}` : 'the stylesheet';
	}
}
