export interface Snippet {
	name: string
	body: string
	description: string
}

export class XSLTSnippets {
	static xsltRootTags: Snippet[] = [{
		name: 'xsl:stylesheet',
		description: '`xsl:stylesheet` snippet for identity transform ',
		body:
			`?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">"

\t<xsl:output method="xml" indent="yes"/>
\t<xsl:mode on-no-match="shallow-copy"/>

\t<xsl:template match="$1" mode="#all">
\t\t<xsl:copy>
\t\t\t<xsl:apply-templates select="$2" mode="#current"/>
\t\t</xsl:copy>
\t</xsl:template>

\t$0

</xsl:stylesheet>`
	}]
	static xsltXMLNS: Snippet[] = [
		{
			name: 'xmlns:xsl',
			description: 'W3C XSLT Namespace',
			body: `xmlns:xsl="http://www.w3.org/1999/XSL/Transform`,
		},
		{
			name: 'xmlns:xs',
			description: 'W3C XMLSchema Namespace',
			body: `xmlns:xs="http://www.w3.org/2001/XMLSchema"`
		},
		{
			name: 'xmlns:array',
			description: 'W3C XPath Array Namespace',
			body: `xmlns:array="http://www.w3.org/2005/xpath-functions/array"`
		},
		{
			name: 'xmlns:map',
			description: 'W3C XPath Map Namespace',
			body: `xmlns:array="http://www.w3.org/2005/xpath-functions/map"`
		},
		{
			name: 'xmlns:math',
			description: 'W3C XPath Math Namespace',
			body: `xmlns:array="http://www.w3.org/2005/xpath-functions/math"`
		},

	]

}

