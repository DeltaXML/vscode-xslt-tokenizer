<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:pre="namespace-uri"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map" exclude-result-prefixes="#all"
                expand-text="yes" version="3.0">
    
    <xsl:variable select="acb div 18"/>
    <xsl:variable select="$map?foo21 div 32"/>
    
    
    <xsl:template match="/*">
        <root>
            <xsl:variable name="map" as="map(*)" select="
                map {
                    'foo': function () {
                        'bar'
                    }
                }"/>
            
            <!-- XPath: Function: 'foo' with 0 arguments not found -->
            <xsl:variable select="acb div 18"/>
            <xsl:variable select="$map?foo21 div 18"/>
            <xsl:sequence select="$map?foo()"/>
            <xsl:sequence select="abc[$map?pre:member]"/>
            <xsl:sequence select="/def/abc"/>
            
            <!-- Alternative is fine -->
            <xsl:sequence select="($map?foo)()"/>
        </root>
    </xsl:template>
    
</xsl:stylesheet>
