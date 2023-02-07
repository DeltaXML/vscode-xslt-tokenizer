<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
  <!-- 
       Use this entry-point XSLT module to force color output (ANSI color codes)
       - otherwise color output is only set if Saxon version prior to 9.9.02
       is used
  -->
  <xsl:param name="alwaysUseColor" static="yes" as="xs:boolean" select="true()"/>
  <xsl:import href="xpath-result-serializer.xsl"/>  
  
</xsl:stylesheet>