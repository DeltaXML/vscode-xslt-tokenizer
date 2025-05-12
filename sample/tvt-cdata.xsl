<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                expand-text="yes"
                version="3.0">
    
    <xsl:output method="text"/>
    <xsl:variable name="min" as="xs:integer" select="1"/>
    <xsl:variable name="max" as="xs:integer" select="2"/>
    
    <xsl:template match="/*" mode="#all">
        <result>
            before the CDATA
            <![CDATA[
            <this is in CDATA> {for $n in 1 to $max return $nx || ','} 
            <and this is also> {225 + $max}
            ]]> this is not wihin CDATA
        </result>
    </xsl:template>
</xsl:stylesheet>





