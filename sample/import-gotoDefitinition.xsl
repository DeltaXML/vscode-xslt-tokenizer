<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/array/math"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:import href="import-globalDefintion2.xsl"/>
    <!-- <xsl:mode name="mod1New" on-no-match="shallow-copy"/> -->
    
    <xsl:variable name="import1New" as="xs:integer" select="2"/>   
    
    <xsl:template match="/" mode="mod1New mode1Old2again">
        <xsl:copy>
            <xsl:sequence select="$import1New, $import2"/>
            <xsl:apply-templates select="node()" mode="mod1New"/>
            <xsl:apply-templates select="node()" mode="mnode1Old2again"/>
        </xsl:copy>        
    </xsl:template>
    
    <xsl:template match="*" mode="mod1New something">
        <xsl:apply-templates select="node()" mode="something"/>        
    </xsl:template>
    
</xsl:stylesheet>