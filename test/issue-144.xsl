<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:variable name="test1" as="xs:integer" select="1"/>
    <xsl:variable name="test2" as="element('books')" select="/*"/>
    <xsl:variable name="test3" as="map(xs:integer, map(xs:string, array(*)))" select="/*"/>
    
    <xsl:template match="/*">
        <xsl:copy select="$test1">
            <xsl:attribute name="int" select="$test2"/>
        </xsl:copy>
    </xsl:template>


</xsl:stylesheet>