<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:fn="http://www.w3.org/2005/xpath-functions"
                version="3.0">

  <?test-attribute select?>
  
  <!-- String literals in expressions -->
  <xsl:variable name="stringErr1-PENDING" select="'book'as'title'"/>
  <xsl:variable name="stringErr5-PENDING" select="'book'map{}"/>
  <xsl:variable name="stringErr6-PENDING" select="'book'array{}"/>
  <xsl:variable name="stringErr7-PENDING" select="'book'{}"/>
  <xsl:variable name="stringErr33-PENDING" select="'book' * 22"/>
  <xsl:variable name="stringErr34b-PENDING" select="'book' div 298"/>
  
  <xsl:variable name="stringErr8-PENDING" select="{'book'}"/>
  <xsl:variable name="nodeStringErr12-PENDING" select="'book'()"/>
  <xsl:variable name="nodeStringErr14-PENDING" select="'book'(1)"/>
  <xsl:variable name="nodeStringErr15-PENDING" select="'book'[]"/>
  <xsl:variable name="stringErrMessage39-PENDING" select="'book' count(1)"/>
  <xsl:variable name="nodeStringNoErr19-PENDING" select="'book' castable as 'book'"/>
  <xsl:variable name="nodeStringNoErr20-PENDING" select="'book' instance of 'book'"/>
  <xsl:variable name="nodeStringNoErr21-PENDING" select="'book' instance of 1"/>
  <xsl:variable name="stringErr34-PENDING" select="22 div 'book'"/>
  <xsl:variable name="stringErr41-PENDING" select="'book' if (1) then 1 else 2"/>
  <xsl:variable name="nodeStringErr38-PENDING" select="'book' Q{'test'}name"/>
  
</xsl:stylesheet>