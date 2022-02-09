<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:fn="def"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:output method="xml" indent="yes"/>
    <xsl:mode on-no-match="shallow-copy"/>
    <xsl:import href="included6.xsl"/>
    
    <xsl:variable name="new3" as="xs:string" select="$inc1p1"/>
    
    <xsl:template name="level3">               
        <xsl:param name="inc3p1" as="xs:integer" select="1"/>
        <xsl:variable name="inc3v1" as="xs:integer" select="2"/>
        <xsl:variable name="inc1v1" as="xs:integer" select="fn:inc1name(2)"/>
        <xsl:variable name="inc5v1" as="xs:integer" select="fn:inc5name(2)"/> 
        <xsl:variable name="inc5v1" as="xs:integer" select="fn:inc3name(2)"/>
        
        <xsl:variable name="inc5v1" as="xs:integer" select="fn:inc6name(2)"/> 
        <xsl:variable name="newer" as="xs:string" select="$inc1p1"/>
                
        <xsl:sequence select="$inc1v1, $inc3v1, $inc5v1, $inc1p1"/>
    </xsl:template>
    
    <xsl:function name="fn:inc3name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:call-template name="level3">
            <xsl:with-param name="inc3p1" as="xs:integer" select="'new'"/>
        </xsl:call-template>
        <xsl:call-template name="level3">
            <xsl:with-param name="inc3p1" as="xs:integer" select="'new'"/>
        </xsl:call-template>
        <xsl:sequence select="$fp1"/>
    </xsl:function>   
    
    <xsl:function name="fn:empty" as="xs:string">
    </xsl:function>   
        
</xsl:stylesheet>

