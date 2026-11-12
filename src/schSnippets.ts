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
}
