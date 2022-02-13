<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:abc="namespace-uri.com"
                xmlns:fn="def"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:import href="included3.xsl"/>
    <xsl:import href="included/included5.xsl"/>
    
    <xsl:param name="inc1p1" as="xs:integer" select="2"/>
    <xsl:variable name="ep" as="xs:integer" select="fn:empty()"/>
    <xsl:variable name="fnRef1" as="function(*)" select="fn:inc5name#1"/>
    
    <xsl:template name="included">               
        <xsl:param name="inc1p1" as="xs:integer" select="count(1)"/>
        <xsl:variable name="inc1v1" as="xs:integer" select="fn:inc1name(2)"/>
        <xsl:variable name="inc1v1" as="xs:integer" select="fn:inc5name(2)"/>
        <xsl:sequence select="$inc1p1"/>
    </xsl:template> 
    
    <xsl:function name="fn:inc1name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>        
    </xsl:function>
    
    
    <xsl:function name="abc:test1" as="xs:string">
        <xsl:param name="p1" as="xs:string"/>
        <xsl:sequence select="'abc'"/>
        
    </xsl:function>

</xsl:stylesheet>
