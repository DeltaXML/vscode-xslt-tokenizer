/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *
 *  Contributors:
 *  DeltaXML Ltd. - entity references: completion, hover and go to definition
 */
import * as vscode from 'vscode';
import { XMLConfiguration } from './languageConfigurations';
import { XslLexer, XSLTokenLevelState } from './xslLexer';

// a general entity a DOCTYPE's internal subset declares: its name, where it's declared, and its value - or, for an
// external entity, the file it's in
export interface DeclaredEntity {
	name: string;
	range: vscode.Range;
	value?: string;
	systemId?: string;
}

// an entity reference in the text, e.g. &company; or &#160; - its name without the '&' and ';', and its range
export interface EntityReference {
	name: string;
	range: vscode.Range;
}

// Entity references, e.g. '&company;', in XML and XSLT: completion after '&' of the entities the DOCTYPE declares, and
// the predefined ones; hover with an entity's value, or a character reference's character; and go to an entity's
// <!ENTITY> declaration
export class EntityReferences {
	public static readonly predefined: { [name: string]: string } = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
	private static readonly languages = ['xml', 'xslt', 'sch', 'dcp', 'xspec', 'bpmn'];
	private static readonly xmlStart = XslLexer.getXsltStartTokenNumber();
	private static cache = new Map<string, { version: number; entities: DeclaredEntity[] }>();

	public static activate(context: vscode.ExtensionContext) {
		const selector = EntityReferences.languages.map((language) => ({ language }));
		context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
			provideCompletionItems: (document, position) => EntityReferences.completions(document, position)
		}, '&'));
		context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
			provideHover: (document, position) => EntityReferences.hover(document, position)
		}));
		context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, {
			provideDefinition: (document, position) => {
				const reference = EntityReferences.referenceAt(document, position);
				const entity = reference && EntityReferences.declared(document).find((e) => e.name === reference.name);
				return entity ? new vscode.Location(document.uri, entity.range) : undefined;
			}
		}));
		context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => EntityReferences.cache.delete(document.uri.toString())));
	}

	// the general entities the document's DOCTYPE declares - not parameter entities, e.g. <!ENTITY % chars ...>
	public static declared(document: vscode.TextDocument): DeclaredEntity[] {
		const key = document.uri.toString();
		const cached = EntityReferences.cache.get(key);
		if (cached && cached.version === document.version) {
			return cached.entities;
		}
		const entities: DeclaredEntity[] = [];
		const text = document.getText();
		const tokens = new XslLexer(XMLConfiguration.configuration).analyse(text);
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			const xmlType = token.tokenType - EntityReferences.xmlStart;
			if (xmlType === XSLTokenLevelState.dtdEnd) {
				break;
			}
			if (xmlType !== XSLTokenLevelState.dtdEntityName) {
				continue;
			}
			const start = new vscode.Position(token.line, token.startCharacter);
			const before = document.lineAt(token.line).text.substring(0, token.startCharacter);
			if (/%\s*$/.test(before)) {
				continue;
			}
			const range = new vscode.Range(start, start.translate(0, token.length));
			const declaration = EntityReferences.declarationValue(text.substring(document.offsetAt(range.end)));
			entities.push({ name: document.getText(range), range, ...declaration });
		}
		EntityReferences.cache.set(key, { version: document.version, entities });
		return entities;
	}

	// after an <!ENTITY>'s name: its value - a quoted literal - or, for an external entity, its system identifier
	public static declarationValue(rest: string): { value?: string; systemId?: string } {
		const m = /^\s+(?:(SYSTEM)\s+("[^"]*"|'[^']*')|PUBLIC\s+(?:"[^"]*"|'[^']*')\s+("[^"]*"|'[^']*')|("[^"]*"|'[^']*'))/.exec(rest);
		if (!m) {
			return {};
		}
		const unquote = (literal: string) => literal.substring(1, literal.length - 1);
		return m[4] !== undefined ? { value: unquote(m[4]) } : { systemId: unquote(m[2] ?? m[3]) };
	}

	// the entity reference at a position in a line's text: a character reference, e.g. &#160;, or a name, ending with
	// its ';' - or, while it's typed, without it
	public static referenceIn(lineText: string, character: number): { name: string; start: number; end: number } | undefined {
		const reference = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_:][\w.:-]*);?/g;
		let m: RegExpExecArray | null;
		while ((m = reference.exec(lineText)) !== null) {
			if (character >= m.index && character <= m.index + m[0].length) {
				return { name: m[1], start: m.index, end: m.index + m[0].length };
			}
		}
		return undefined;
	}

	private static referenceAt(document: vscode.TextDocument, position: vscode.Position): EntityReference | undefined {
		if (EntityReferences.inCommentOrCdata(document, position)) {
			return undefined;
		}
		const found = EntityReferences.referenceIn(document.lineAt(position.line).text, position.character);
		return found ? { name: found.name, range: new vscode.Range(position.line, found.start, position.line, found.end) } : undefined;
	}

	// within a comment or a CDATA section, where '&' isn't a reference
	public static inCommentOrCdata(document: vscode.TextDocument, position: vscode.Position): boolean {
		const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
		return before.lastIndexOf('<!--') > before.lastIndexOf('-->') || before.lastIndexOf('<![CDATA[') > before.lastIndexOf(']]>');
	}

	// after '&': the declared entities, then the predefined ones - each replacing the name typed so far, and its ';'
	private static completions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
		const lineText = document.lineAt(position.line).text;
		const typed = /&([\w.:-]*)$/.exec(lineText.substring(0, position.character));
		if (!typed || EntityReferences.inCommentOrCdata(document, position)) {
			return undefined;
		}
		const nameStart = position.character - typed[1].length;
		const after = /^[\w.:-]*;?/.exec(lineText.substring(position.character))![0];
		const range = new vscode.Range(position.line, nameStart, position.line, position.character + after.length);
		const item = (name: string, detail: string, documentation: vscode.MarkdownString, sortText: string) => {
			const completion = new vscode.CompletionItem(name, vscode.CompletionItemKind.Constant);
			completion.insertText = name + ';';
			completion.range = range;
			completion.detail = detail;
			completion.documentation = documentation;
			completion.sortText = sortText + name;
			return completion;
		};
		const declared = EntityReferences.declared(document).map((entity) =>
			item(entity.name, EntityReferences.entityDetail(entity), EntityReferences.entityDocumentation(entity), '1'));
		const predefined = Object.entries(EntityReferences.predefined).map(([name, char]) =>
			item(name, `predefined: ${char}`, new vscode.MarkdownString(`Predefined entity for the character \`${char}\``), '2'));
		return declared.concat(predefined);
	}

	private static entityDetail(entity: DeclaredEntity) {
		return entity.systemId !== undefined ? `external: ${entity.systemId}` : `"${entity.value ?? ''}"`;
	}

	private static entityDocumentation(entity: DeclaredEntity) {
		const doc = new vscode.MarkdownString();
		if (entity.systemId !== undefined) {
			doc.appendMarkdown('External entity, declared in the DOCTYPE - its text is in the file:\n\n');
			doc.appendCodeblock(entity.systemId, 'text');
		} else {
			doc.appendMarkdown('Entity declared in the DOCTYPE, with the value:\n\n');
			doc.appendCodeblock(entity.value ?? '', 'xml');
		}
		return doc;
	}

	// the character a character reference stands for, e.g. U+00A0 for &#160;
	public static characterOf(reference: string): { char: string; codePoint: string } | undefined {
		const m = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(reference);
		if (!m) {
			return undefined;
		}
		const code = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2], 10);
		if (code > 0x10FFFF) {
			return undefined;
		}
		return { char: String.fromCodePoint(code), codePoint: 'U+' + code.toString(16).toUpperCase().padStart(4, '0') };
	}

	private static hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
		const reference = EntityReferences.referenceAt(document, position);
		if (!reference) {
			return undefined;
		}
		const character = EntityReferences.characterOf(reference.name);
		if (character) {
			const visible = /\s/.test(character.char) || character.char.trim() === '' ? '' : ` \`${character.char}\``;
			return new vscode.Hover(new vscode.MarkdownString(`Character reference: ${character.codePoint}${visible}`), reference.range);
		}
		const predefined = EntityReferences.predefined[reference.name];
		if (predefined) {
			return new vscode.Hover(new vscode.MarkdownString(`Predefined entity for the character \`${predefined}\``), reference.range);
		}
		const entity = EntityReferences.declared(document).find((e) => e.name === reference.name);
		return entity ? new vscode.Hover(EntityReferences.entityDocumentation(entity), reference.range) : undefined;
	}
}
