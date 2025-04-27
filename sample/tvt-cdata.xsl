<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                expand-text="yes"
                version="3.0">
    
    <xsl:output method="text"/>
    <xsl:variable name="min" as="xs:integer" select="1"/>
    <xsl:variable name="max" as="xs:integer" select="2"/>
    
    <xsl:template match="/*" mode="#all">
        before the CDATA
        <![CDATA[
        <this is in CDATA> {1} 
        <and this is also> {2 + count($max < 22)}
        ]]> this is not wihin CDATA
        <xsl:sequence select="$max + count(22)"/>
    </xsl:template>

    <xsl:template match="/*" mode="#all">{4} {5 + $min}</xsl:template>
    
    
</xsl:stylesheet>