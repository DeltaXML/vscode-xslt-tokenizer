/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import { BaseToken } from './xpLexer';
import { GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { RecordTypes } from './recordTypes';

export interface StaticHref {
	type: GlobalInstructionType.Import | GlobalInstructionType.Include;
	href: string;
	// of the _href attribute's value, within its quotes
	offset: number;
	length: number;
}

// The href of an xsl:import or xsl:include given by its _href shadow attribute, as far as a linter can work it out: an
// attribute value template whose expressions are each a static parameter or variable of the module, with a string
// literal for its value - e.g. _href="{$dir}/lib.xsl" with <xsl:param name="dir" static="yes" select="'lib'"/>. A static
// parameter's value may be given when the stylesheet is compiled, so this is the module its default value imports.
// Any other expression, or a static parameter or variable that isn't a string literal, and the import isn't followed
export class StaticHrefs {

	public static resolve(text: string): StaticHref[] {
		return StaticHrefs.find(text).hrefs;
	}

	// whether the module has an xsl:import or xsl:include with a _href that isn't resolved: what it declares isn't known
	public static hasUnresolved(text: string): boolean {
		const found = StaticHrefs.find(text);
		return found.hrefs.length < found.count;
	}

	private static find(text: string): { hrefs: StaticHref[], count: number } {
		if (!text.includes('_href')) {
			return { hrefs: [], count: 0 };
		}
		const markup = RecordTypes.blankMarkup(text);
		const attribute = (tag: string, name: string) => {
			const match = new RegExp(`\\s${name.replace(/[.-]/g, '\\$&')}\\s*=\\s*("[^"]*"|'[^']*')`).exec(tag);
			return match ? RecordTypes.decodeReferences(match[1].slice(1, -1)).text : undefined;
		};
		// the static parameters and variables with a string literal value
		const statics = new Map<string, string>();
		for (const match of markup.matchAll(RecordTypes.xsltPattern(/<xsl:(?:param|variable)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g, markup))) {
			const tag = match[0];
			const name = attribute(tag, 'name')?.trim();
			const select = attribute(tag, 'select')?.trim();
			const literal = select !== undefined ? /^(["'])((?:(?!\1)[^]|\1\1)*)\1$/.exec(select) : null;
			if (name && literal && /^(yes|true|1)$/.test(attribute(tag, 'static')?.trim() ?? '')) {
				// a quote within a string literal is doubled, e.g. 'it''s'
				statics.set(name, literal[2].split(literal[1] + literal[1]).join(literal[1]));
			}
		}
		const hrefs: StaticHref[] = [];
		let count = 0;
		for (const match of markup.matchAll(RecordTypes.xsltPattern(/<xsl:(import|include)\b(?:[^>"']|"[^"]*"|'[^']*')*?\s_href\s*=\s*("[^"]*"|'[^']*')/g, markup))) {
			count++;
			const value = RecordTypes.decodeReferences(match[2].slice(1, -1)).text;
			let resolved = true;
			// each expression of the template, e.g. {$dir} - its braces, escaped as {{ and }}, aren't expressions
			const href = value.replace(/\{\{|\}\}|\{\s*\$([\w.-]+(?::[\w.-]+)?)\s*\}|[{}]/g, (part: string, name?: string) => {
				if (part === '{{' || part === '}}') {
					return part.charAt(0);
				}
				const staticValue = name !== undefined ? statics.get(name) : undefined;
				resolved = resolved && staticValue !== undefined;
				return staticValue ?? '';
			});
			if (resolved && href.trim().length > 0) {
				hrefs.push({
					type: match[1].endsWith('import') ? GlobalInstructionType.Import : GlobalInstructionType.Include,
					href: href.trim(), offset: match.index! + match[0].length - match[2].length + 1, length: match[2].length - 2
				});
			}
		}
		return { hrefs, count };
	}

	// the declarations a lexer found, with the imports and includes of _href attributes in their places, in document
	// order - which, for imports, is their order of precedence
	public static withDeclarations(declarations: GlobalInstructionData[], text: string): GlobalInstructionData[] {
		const added = StaticHrefs.declarations(text);
		if (added.length === 0) {
			return declarations;
		}
		const result = declarations.slice();
		const before = (a: BaseToken, b: BaseToken) => a.line < b.line || (a.line === b.line && a.startCharacter < b.startCharacter);
		added.forEach((declaration) => {
			const index = result.findIndex((existing) => before(declaration.token, existing.token));
			result.splice(index < 0 ? result.length : index, 0, declaration);
		});
		return result;
	}

	// the hrefs as the lexer's declarations of the module's imports and includes, e.g. for the modules to check with it
	public static declarations(text: string): GlobalInstructionData[] {
		const hrefs = StaticHrefs.resolve(text);
		if (hrefs.length === 0) {
			return [];
		}
		const lineStarts = [0];
		for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
			lineStarts.push(i + 1);
		}
		return hrefs.map((href) => {
			let line = lineStarts.length - 1;
			while (lineStarts[line] > href.offset) {
				line--;
			}
			const token: BaseToken = { line, startCharacter: href.offset - lineStarts[line], length: href.length, value: href.href, tokenType: 0 };
			return { type: href.type, name: href.href, token, idNumber: 0 };
		});
	}
}
