<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:output method="xml" indent="yes"/>
    <xsl:mode on-no-match="shallow-copy"/>
      
    <xsl:template name="xsl:initial-template">       
        <xsl:variable name="var1" as="xs:integer" select="22"/>
        <xsl:variable name="var2" as="xs:integer" select="$var1 + 22"/>
        <xsl:variable name="var3" as="xs:integer" select="$var2 + 22 + count(div)"/>
        <xsl:variable name="var4" as="xs:integer" select="22"/>
        <xsl:variable name="var5" as="xs:integer" select="22"/>
        <xsl:variable name="t1" as="xs:integer" select="let $a :=  (2 + $var5) return $a"/>
        
        <xsl:sequence select="$var5"/>
        
    </xsl:template>
    
    
    
</xsl:stylesheet>