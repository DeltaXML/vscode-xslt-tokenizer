<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="no"
                version="3.0">
    
    <xsl:param name="param1" as="" select="22"/>
    <xsl:variable name="myVar" as="xs:string" select="'test'"/>
    <xsl:variable name="myVar2" as="xs:string" select="'test' || $param1 || $myVar/"/>
    
    
    <xsl:template match="@*" mode="#all">
        <xsl:variable name="depth" select="count(ancestor::*) + 1 + $myVar2"/>
        <xsl:value-of select="count($depth)"/>
        <xsl:for-each select="*">
            <xsl:value-of select="count($depth)"/>
            <xsl:sequence select="for $new in 1 to 20 return $new, $new"/>
            <xsl:sequence select="alpha/bravo/charlie"/>
            
            
        </xsl:for-each>
        
    </xsl:template>
    
    
    
</xsl:stylesheet>