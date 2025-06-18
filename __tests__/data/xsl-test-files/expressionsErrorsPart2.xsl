<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:fn="http://www.w3.org/2005/xpath-functions"
                version="3.0">

  <?test-attribute select?>

  <xsl:variable name="ifErr1-PENDING" select="'book' if (1) then 1 else 2"/>
  <xsl:variable name="ifErr2-PENDING" select="22 if (1) then 1 else 2"/>
  <xsl:variable name="ifErr3" select="22 for $a in 1 return $a"/>
  <xsl:variable name="ifErr4" select="'book' for $a in 1 return $a"/>
  <xsl:variable name="ifErr5" select="22 for $a in 1 return $a"/>

  <xsl:variable name="ifErr1a-PENDING" select="if (1) then 1 else 2"/>
  <xsl:variable name="ifErr2a-PENDING" select="22 if (1) then 1 else 2"/>
  <xsl:variable name="ifErr3a" select="22 for $a in 1 return $a"/>
  <xsl:variable name="ifErr4a" select="'book' for $a in 1 return $a 'book'"/>
  <xsl:variable name="ifErr5a" select="22 for $a in 1 return $a"/>

  
  <!-- String literals in expressions -->
  <xsl:variable name="nodeStringNoErr19-PENDING" select="'book' castable as 'book'"/>
  <xsl:variable name="nodeStringNoErr20-PENDING" select="'book' instance of 'book'"/>
  <xsl:variable name="nodeStringNoErr21-PENDING" select="'book' instance of 1"/>
  <xsl:variable name="stringErr34-PENDING" select="22 div 'book'"/>
  <xsl:variable name="nodeStringErr38-PENDING" select="'book' Q{'test'}name"/>
  
</xsl:stylesheet>