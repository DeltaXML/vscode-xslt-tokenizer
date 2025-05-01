<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
    
    <xsl:variable name="test3" as="map(xs:integer-x, map(xs:string-y, array(*)))" select="/*"/>
    <xsl:variable name="test1" as="xs:integer-z" select="1"/>
    <xsl:variable name="test2" as="element('books')" select="/*"/>
    <xsl:template match="/*">
        <xsl:copy select="$test1">
            <xsl:attribute name="int" select="$test2"/>
        </xsl:copy>
    </xsl:template>


</xsl:stylesheet>