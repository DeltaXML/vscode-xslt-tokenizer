<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:pre="abcd"
                
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

    <xsl:output method="xml" indent="yes"/>  
    <xsl:mode on-no-match="shallow-copy"/>
    
    <xsl:param name="varP" as="xs:integer" select="25 + 8"/>   
    
    
    <xsl:variable name="var1" as="xs:integer" select="25 + 8"/>   
    <xsl:variable name="var2" as="xs:integer" select="$var1 + 9"/>
    
    <xsl:function name="pre:test" as="xs:string">
        
    </xsl:function>

    <xsl:template match="book" mode="#all">
        <xsl:variable name="var2" as="xs:integer"
            select="2873 + $varP"/>
        <xsl:copy>
            <xsl:apply-templates select="$var2" mode="#current"/>
        </xsl:copy>
    </xsl:template>

</xsl:stylesheet>
