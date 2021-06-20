export interface Snippet {
	name: string
	body: string
	description: string
}

export class XSLTSnippets {
	static xsltRootTags: Snippet[] = [
		{
		name: 'xsl:stylesheet',
		description: 'xsl:stylesheet` snippet for identity transform ',
		body:
			`?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

\t<xsl:output method="xml" indent="yes"/>
\t<xsl:mode on-no-match="shallow-copy"/>

\t<xsl:template match="\${1:/*}" mode="#all">
\t\t<xsl:copy>
\t\t\t<xsl:apply-templates select="\${2:@*, node()}" mode="#current"/>
\t\t</xsl:copy>
\t</xsl:template>

\t$0

</xsl:stylesheet>`
	},
	{
		name: 'xsl:package',
		description: 'xsl:package` snippet - root element and required attributes',
		body:
			`?xml version="1.0" encoding="UTF-8"?>
<xsl:package xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
						 xmlns:xs="http://www.w3.org/2001/XMLSchema"
						 xmlns:array="http://www.w3.org/2005/xpath-functions/array"
						 xmlns:map="http://www.w3.org/2005/xpath-functions/map"
						 xmlns:math="http://www.w3.org/2005/xpath-functions/math"
						 name="\${1:package-uri}"
						 package-version="1.0"
						 exclude-result-prefixes="#all"
						 expand-text="yes"
						 version="3.0">

\t<xsl:output method="xml" indent="yes"/>
\t<xsl:mode name="\${2:mode-name}" streamable="false" on-no-match="shallow-copy" visibility="public"/>


\t<xsl:template match="\${3:/*}" mode="\$2">
\t\t<xsl:copy>
\t\t\t<xsl:apply-templates select="\${4:@*, node()}" mode="#current"/>
\t\t</xsl:copy>
\t</xsl:template>

\t$0

</xsl:package>`
	},
];
	static xsltXMLNS: Snippet[] = [
		{
			name: 'xmlns:xsl',
			description: 'W3C XSLT Namespace',
			body: `xmlns:xsl="http://www.w3.org/1999/XSL/Transform"$0`,
		},
		{
			name: 'xmlns:xs',
			description: 'W3C XMLSchema Namespace',
			body: `xmlns:xs="http://www.w3.org/2001/XMLSchema"$0`
		},
		{
			name: 'xmlns:array',
			description: 'W3C XPath Array Namespace',
			body: `xmlns:array="http://www.w3.org/2005/xpath-functions/array"$0`
		},
		{
			name: 'xmlns:map',
			description: 'W3C XPath Map Namespace',
			body: `xmlns:map="http://www.w3.org/2005/xpath-functions/map"$0`
		},
		{
			name: 'xmlns:math',
			description: 'W3C XPath Math Namespace',
			body: `xmlns:math="http://www.w3.org/2005/xpath-functions/math"$0`
		},
		{
			name: 'xmlns:any',
			description: 'Generic namespace snippet',
			body: `xmlns:\${1:prefix}="\${2:namespace-uri}"$0`
		},
		{
			name: 'xmlns:saxon',
			description: 'Saxonica Saxon XSLT Namespace',
			body: `xmlns:saxon="http://saxon.sf.net/"$0`
		},
		{
			name: 'xmlns:sql',
			description: 'Saxonica Saxon SQL Namespace',
			body: `xmlns:sql="http://saxon.sf.net/sql"$0`
		},
		{
			name: 'xmlns:ixsl',
			description: 'Saxonica Saxon-JS Interactive XSLT Namespace',
			body: `xmlns:ixsl="http://saxonica.com/ns/interactiveXSLT"$0`
		},
		{
			name: 'xmlns:xhtml',
			description: 'W3C XHTML Namespace',
			body: `xmlns:xhtml="http://www.w3.org/1999/xhtml"$0`
		},
		{
			name: 'xmlns:err',
			description: 'W3C XSLT Standard Error Namespace',
			body: `xmlns:err="http://www.w3.org/2005/xqt-errors"$0`
		},
		{
			name: 'xmlns:xsi',
			description: 'W3C XML Schema Instance Namespace',
			body: `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"$0`
		},
		{
			name: 'xmlns:deltaxml',
			description: 'DeltaXML namespace',
			body: `xmlns:deltaxml="http://www.deltaxml.com/ns/well-formed-delta-v1"$0`
		},
		{
			name: 'xmlns:dxa',
			description: 'DeltaXML non-namespaced attribute',
			body: `xmlns:dxa="http://www.deltaxml.com/ns/non-namespaced-attribute"$0`
		},
		{
			name: 'xmlns:dxx',
			description: 'DeltaXML xml-namespaced attribute',
			body: `xmlns:dxx="http://www.deltaxml.com/ns/xml-namespaced-attribute"$0`
		},
		{
			name: 'xmlns:preserve',
			description: 'DeltaXML preservation-item namespace',
			body: `xmlns:preserve="http://www.deltaxml.com/ns/preserve"$0`
		},
		{
			name: 'xmlns:ignore',
			description: 'DeltaXML ignore-for-alignment namespace',
			body: `xmlns:ignore="http://www.deltaxml.com/ns/ignoreForAlignment"$0`
		},
		{
			name: 'xmlns:pi',
			description: 'DeltaXML processing-instruction namespace',
			body: `xmlns:pi="http://www.deltaxml.com/ns/processing-instructions"$0`
		},
		{
			name: 'xmlns:er',
			description: 'DeltaXML entity-references namespace',
			body: `xmlns:er="http://www.deltaxml.com/ns/entity-references"$0`
		},
		{
			name: 'xmlns:docbook',
			description: 'Oasis DocBook namespace',
			body: `xmlns:docbook="http://docbook.org/ns/docbook"$0`
		},
		{
			name: 'xmlns:xlink',
			description: 'W3C XLink namespace',
			body: `xmlns:xlink="http://www.w3.org/1999/xlink"$0`
		},
		{
			name: 'xmlns:svg',
			description: 'W3C SVG namespace',
			body: `xmlns:svg="http://www.w3.org/2000/svg"$0`
		},
	]

}

