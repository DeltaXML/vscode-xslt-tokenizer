<xsl:stylesheet
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:fn="http://www.w3.org/2005/xpath-functions"
    xmlns:j="http://www.w3.org/2013/XSLT/xml-to-json"
    exclude-result-prefixes="xs fn j" version="3.0">
    
    <xsl:template match='/'>
        <root test="count: {count(//*)}">
            <xsl:sequence select="'test'"/>
        </root>
    </xsl:template>
    
</xsl:stylesheet>