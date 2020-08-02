<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:import href="included3.xsl"/>
    
    <xsl:variable name="inc1p1" as="xs:integer" select="2"/>
       
    <xsl:template xmlns:xsl="abc" xmlns:fn="def">
                
        <xsl:param name="inc1p1" as="xs:integer" select="1"/>
        <xsl:variable name="inc1v1" as="xs:integer" select="2"/>
        <xsl:function name="fn:inc1name" as="xs:string">
            <xsl:param name="fp1" as="node()"/>        
        </xsl:function>
        
    </xsl:template>   

</xsl:stylesheet>
