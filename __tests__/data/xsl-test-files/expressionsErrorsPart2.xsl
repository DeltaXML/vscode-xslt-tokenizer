<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:fn="http://www.w3.org/2005/xpath-functions"
                version="3.0">

  <?test-attribute select?>
  
  <!-- String literals in expressions -->
  <xsl:variable name="nodeStringNoErr19-PENDING" select="'book' castable as 'book'"/>
  <xsl:variable name="nodeStringNoErr20-PENDING" select="'book' instance of 'book'"/>
  <xsl:variable name="nodeStringNoErr21-PENDING" select="'book' instance of 1"/>
  <xsl:variable name="stringErr34-PENDING" select="22 div 'book'"/>
  <xsl:variable name="nodeStringErr38-PENDING" select="'book' Q{'test'}name"/>
  <!-- there should be no error on final token below: -->
  <xsl:variable name="stringEr1" select="'&#160;'"/>
  
</xsl:stylesheet>