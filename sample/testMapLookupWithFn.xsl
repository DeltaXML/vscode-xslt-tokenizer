<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:pre="namespace-uri"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map" exclude-result-prefixes="#all"
                expand-text="yes" version="3.0">
    
    <xsl:variable name="var" as="" select="map {}"/>
    <xsl:variable name="new" select="?abc"/>
    
    <xsl:template match="/*">
        <root>
            <xsl:variable name="map" as="map(*)" 
                select="
                map {
                    'foo': function () {
                        'bar'
                    },
                    'qta': '876'
                }"/>
            
            
            <!-- Alternative is fine -->
            <xsl:sequence select="($map?foo)()"/>
            <xsl:for-each select="$map">
                <xsl:sequence select="?qta"/>
                <xsl:sequence select="abc?abc"/>
            </xsl:for-each>
        </root>
    </xsl:template>
    
</xsl:stylesheet>
