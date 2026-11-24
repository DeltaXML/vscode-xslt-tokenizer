/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */
import { Snippet } from './xsltSnippets';

// the completions for a Schematron element, after '<': each form it's commonly written in, with the attributes to give -
// the most common form with the element's name, the others with what they have in brackets, e.g. 'sch:rule (abstract)'.
// Every form has the attributes SchRequired requires (checked by the tests)
export interface SchSnippet {
	label: string;
	body: string;
}

// a new Schematron file: its outermost element, as auto-completion offers it after '<' - the Schematron namespace as the
// default, as most Schematron files are written, and the XSLT 3.0 query binding that SchXslt2 implements
export class SchSnippets {
	static rootTags: Snippet[] = [{
		name: 'Schematron schema',
		description: 'An ISO Schematron schema, with a pattern of rules',
		body:
			`?xml version="1.0" encoding="UTF-8"?>
<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt3">
\t<ns prefix="\${1:p}" uri="\${2:http://example.com/ns}"/>

\t<pattern id="\${3:pattern-id}">
\t\t<rule context="\${4:element}">
\t\t\t<assert test="\${5:true()}">\${6:message}</assert>$0
\t\t</rule>
\t</pattern>
</schema>`
	}];

	// for the element - its name as the linter compares it, e.g. sch:rule or xsl:function (the completion items are then
	// given the file's prefix) - in the parent, by its local name; undefined for an element with no snippets
	public static forElement(tagName: string, parent: string | undefined): SchSnippet[] | undefined {
		const local = tagName.replace(/^.*:/, '');
		const withContent = (attributes: string) => `${tagName}${attributes}>\n\t$0\n</${tagName}>`;
		const empty = (attributes: string) => `${tagName}${attributes}/>$0`;
		// a message or text, on one line
		const inline = (attributes: string, last = 2) => `${tagName}${attributes}>$${last}</${tagName}>$0`;
		const form = (label: string, body: string) => ({ label: label ? `${tagName} (${label})` : tagName, body });
		if (tagName.startsWith('xsl:')) {
			// the XSLT declarations SchXslt2 copies into its validation stylesheet, and a property's xsl:copy-of
			switch (local) {
				case 'function':
					return [form('', withContent(' name="$1" as="$2"'))];
				case 'key':
					return [form('', empty(' name="$1" match="$2" use="$3"'))];
				case 'include':
				case 'import':
					return [form('', empty(' href="$1"'))];
				case 'accumulator':
					return [form('', withContent(' name="$1" as="$2" initial-value="$3"'))];
				case 'use-package':
					return [form('', empty(' name="$1" package-version="$2"'))];
				case 'import-schema':
					return [form('', empty(' namespace="$1" schema-location="$2"'))];
				case 'copy-of':
					return [form('', empty(' select="$1"'))];
				default:
					return undefined;
			}
		}
		switch (local) {
			case 'ns':
				return [form('', empty(' prefix="$1" uri="$2"'))];
			case 'title':
			case 'p':
			case 'emph':
				return [form('', inline('', 1))];
			case 'include':
				return [form('', empty(' href="$1"'))];
			case 'extends':
				return parent === 'rule' ? [form('', empty(' rule="$1"')), form('href', empty(' href="$1"'))] : [form('', empty(' href="$1"'))];
			case 'param':
				return [form('', empty(' name="$1" value="$2"'))];
			case 'let':
				return [form('', empty(' name="$1" value="$2"')), form('content', withContent(' name="$1"'))];
			case 'phase':
				return [form('', withContent(' id="$1"'))];
			case 'active':
				return [form('', empty(' pattern="$1"'))];
			case 'pattern':
			case 'group':
				return [form('', withContent(' id="$1"')), form('abstract', withContent(' abstract="true" id="$1"')), form('is-a', withContent(' id="$1" is-a="$2"'))];
			case 'rule':
				return [form('', withContent(' context="$1"')), form('abstract', withContent(' abstract="true" id="$1"'))];
			case 'assert':
			case 'report':
				return [form('', inline(' test="$1"'))];
			case 'name':
				return [form('', empty('')), form('path', empty(' path="$1"'))];
			case 'value-of':
				return [form('', empty(' select="$1"'))];
			case 'dir':
				return [form('', inline(' value="${1|ltr,rtl|}"'))];
			case 'span':
				return [form('', inline(' class="$1"'))];
			case 'diagnostic':
			case 'property':
				return [form('', inline(' id="$1"'))];
			case 'diagnostics':
			case 'properties':
			case 'rules':
			case 'library':
				return [form('', withContent(''))];
			default:
				return undefined;
		}
	}
}
