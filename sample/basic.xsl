<xsl:stylesheet
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:fn="http://www.w3.org/2005/xpath-functions"
    xmlns:j="http://www.w3.org/2013/XSLT/xml-to-json"
    xmlns:xx="namespace-uri"
    exclude-result-prefixes="xs fn j" version="3.0">
    
    <xsl:variable name="test" as="xs:string" select="function('a')"/>
    
    <xsl:function name="xx:test" as="xs:string">
        <new>test</new>
    </xsl:function>

</xsl:stylesheet>