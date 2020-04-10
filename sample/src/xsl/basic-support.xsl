<xsl:stylesheet
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:fn="http://www.w3.org/2005/xpath-functions"
    xmlns:j="http://www.w3.org/2013/XSLT/xml-to-json"
    xmlns:ext="com.example.functions"
    exclude-result-prefixes="xs fn j" version="3.0">
    
   <xsl:function name="ext:test" as="xs:string">
        <xsl:sequence select="22 + (8 * 15)"/>
    </xsl:function>

    
</xsl:stylesheet>