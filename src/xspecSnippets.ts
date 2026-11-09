/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

// The completions for an XSpec element, after '<': each form it's commonly written in, with the attributes to give -
// the most common form with the element's name, the others with what they have in brackets, e.g. 'x:expect (test)'.
// Every form has the attributes XSpecRequired requires (checked by the tests). suggest: the first value has completion,
// e.g. x:like's scenario labels or x:import's files, so the list is shown once the element is inserted
export interface XSpecSnippet {
	label: string;
	body: string;
	suggest?: boolean;
}

export class XSpecSnippets {
	// for the element - its name with the prefix it's written with, e.g. x:expect - in the parent, by its local name;
	// undefined for an element with no snippets, completed as any other
	public static forElement(tagName: string, parent: string | undefined): XSpecSnippet[] | undefined {
		const local = tagName.replace(/^.*:/, '');
		const withContent = (attributes: string) => `${tagName}${attributes}>\n\t$0\n</${tagName}>`;
		const empty = (attributes: string) => `${tagName}${attributes}/>$0`;
		// x:variable - and x:param where it declares a variable - with its name and type: the type is a placeholder,
		// and typing there lists the types, as for any 'as'
		const declaration = (): XSpecSnippet[] => [
			{ label: `${tagName} (select)`, body: empty(' name="${1:name}" as="${2:item()*}" select="$3"') },
			{ label: tagName, body: withContent(' name="${1:name}" as="${2:item()*}"') }
		];
		switch (local) {
			case 'variable':
				return declaration();
			case 'param':
				return parent === 'description' || parent === 'scenario' ? declaration() : undefined;
			case 'scenario':
				return [{ label: tagName, body: withContent(' label="$1"') }];
			case 'call':
				return [
					{ label: tagName, body: withContent(' function="$1"'), suggest: true },
					{ label: `${tagName} (template)`, body: withContent(' template="$1"'), suggest: true }
				];
			case 'context':
				return [
					{ label: tagName, body: withContent('') },
					{ label: `${tagName} (href)`, body: empty(' href="$1" select="$2"'), suggest: true },
					{ label: `${tagName} (mode)`, body: withContent(' mode="$1"'), suggest: true }
				];
			case 'expect':
				return [
					{ label: tagName, body: empty(' label="$1" select="$2"') },
					{ label: `${tagName} (test)`, body: empty(' label="$1" test="$2"') },
					{ label: `${tagName} (content)`, body: withContent(' label="$1"') }
				];
			case 'like':
				return [{ label: tagName, body: empty(' label="$1"'), suggest: true }];
			case 'import':
				return [{ label: tagName, body: empty(' href="$1"'), suggest: true }];
			case 'helper':
				return [
					{ label: tagName, body: empty(' stylesheet="$1"'), suggest: true },
					{ label: `${tagName} (package)`, body: empty(' package-name="$1"'), suggest: true }
				];
			case 'pending':
				return [{ label: tagName, body: withContent(' label="$1"') }];
			case 'expect-valid':
				return [{ label: tagName, body: empty('') }];
			default:
				return undefined;
		}
	}
}
