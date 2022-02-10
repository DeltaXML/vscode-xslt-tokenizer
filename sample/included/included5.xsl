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
  
  <xsl:variable name="new53" as="xs:string" select="count($inc1p1)"/>
  
  <xsl:template name="level5">       
    <xsl:param name="inc5p1" as="xs:integer" select="1"/>
    <xsl:variable name="inc1v1" as="xs:integer" select="fn:inc1name(2)"/>
    
    <xsl:variable name="inc5v1" as="xs:integer" select="2"/>
    <xsl:sequence select="$inc5p1"/>
  </xsl:template>
  
  <xsl:function name="fn:inc5name" as="xs:string">
    <xsl:param name="fp1" as="node()"/>
    <xsl:sequence select="'abc'"/>      
  </xsl:function>
  
</xsl:stylesheet>