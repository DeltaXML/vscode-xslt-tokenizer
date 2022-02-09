<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:variable name="number" as="xs:string" select="'twenty'"/>
    <xsl:variable name="two" as="xs:string" select="$inner"/>
    <xsl:variable name="inner" as="xs:string" select="'outside'"/>
    
    <xsl:variable name="test" as="xs:string" 
        select="for $number in 1 to 20 return ($number + 1, $number + 2)"/>
    
    <xsl:template match=".">
        <xsl:variable name="inner" as="xs:string" select="'inside'"/>
        <xsl:sequence select="$inner"/>
    </xsl:template>
    
    <xsl:variable name="ab" as="xs:string" select="$number"/>
    
    <xsl:variable name="bc">
        <xsl:variable name="de" select="2"/>
        <xsl:variable name="number">
            <xsl:variable name="de" select="2"/>
            <xsl:sequence select="$de"/>
        </xsl:variable>
        <xsl:sequence select="$number"/>
    </xsl:variable>
    
</xsl:stylesheet>