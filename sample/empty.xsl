<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:p="http://example.com"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

    <xsl:output method="xml" indent="yes"/>
    <xsl:mode on-no-match="shallow-copy"/>

    <xsl:template match="/*" mode="#all">
        <xsl:sequence xmlns:h="example.com" select="h:test"/>
        <xsl:variable name="bounds" as="" select="'abc'"/>
        <xsl:variable name="p:x2-units-per-pixel" as="" select="'abc'"/>
        <xsl:variable name="right" as="xs:decimal"
            select="$bounds[3] * $p:x2-units-per-pixel"/>
        <xsl:copy>
            <xsl:apply-templates select="node()" mode="#current"/>
        </xsl:copy>
    </xsl:template>

    

</xsl:stylesheet>