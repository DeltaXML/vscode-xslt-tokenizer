/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import * as fs from 'fs';
import { GlobalInstructionData, GlobalInstructionType } from './xslLexer';
import { RecordTypes } from './recordTypes';
import { XdocNotes } from './xdocNote';

// the longest default shown in a signature, before it's shortened
const maxDefaultLength = 40;
const entities: { [name: string]: string } = { lt: '<', gt: '>', amp: '&', quot: '"', apos: '\'' };

// the parameters of a user-defined function or named template for its signature, in hover and signature help, e.g.
// '$scale as xs:double := 1' - an optional parameter has its default, in the XPath 4.0 notation used for built-in
// functions: from the xsl:param elements of the declaration, in the document text or the module declaring it (href)
// - a function parameter is optional with required="no", and has the default () if it has no select or content
// - a template parameter is optional unless required="yes", and has a default only if it has a select or content, as
//   the default otherwise depends on the 'as' type
export function declarationParamLabels(declaration: GlobalInstructionData, documentText: string): string[] {
	const fallback = () => (declaration.memberNames ?? []).map((name, i) => declaration.memberTypes?.[i] ? `$${name} as ${declaration.memberTypes[i]}` : `$${name}`);
	let text: string;
	try {
		text = declaration.href ? fs.readFileSync(declaration.href, 'utf8') : documentText;
	} catch {
		return fallback();
	}
	const tagStart = text.lastIndexOf('<', XdocNotes.offsetAt(text, declaration.token.line, declaration.token.startCharacter));
	if (tagStart < 0) {
		return fallback();
	}
	const markup = RecordTypes.blankMarkup(text);
	const isFunction = declaration.type === GlobalInstructionType.Function;
	const labels = RecordTypes.childElements(text, markup, tagStart, 'xsl:param').map((paramOffset) => {
		const attribute = (name: string) => RecordTypes.attributeOfElementAt(text, paramOffset + 1, name);
		const type = attribute('as');
		const required = (attribute('required') ?? '').trim();
		const isOptional = isFunction ? ['no', 'false', '0'].includes(required) : !['yes', 'true', '1'].includes(required);
		const select = attribute('select')?.replace(/\s+/g, ' ').trim().replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => entities[name]);
		// a sequence constructor: the start tag isn't self-closing, and there's more than whitespace before the end tag
		const tagRgx = new RegExp(RecordTypes.tagPattern, 'y');
		tagRgx.lastIndex = paramOffset;
		const startTag = tagRgx.exec(markup);
		const contentEnd = startTag && !startTag[3] ? markup.indexOf('</xsl:param', tagRgx.lastIndex) : -1;
		const hasContent = contentEnd > -1 && markup.substring(tagRgx.lastIndex, contentEnd).trim().length > 0;
		let defaultValue = select !== undefined ? select : hasContent ? '…' : isFunction ? '()' : undefined;
		if (defaultValue && defaultValue.length > maxDefaultLength) {
			defaultValue = defaultValue.substring(0, maxDefaultLength - 1).trimEnd() + '…';
		}
		return `$${attribute('name')}${type ? ' as ' + type : ''}${isOptional && defaultValue !== undefined ? ' := ' + defaultValue : ''}`;
	});
	return labels.length === (declaration.memberNames ?? []).length ? labels : fallback();
}
