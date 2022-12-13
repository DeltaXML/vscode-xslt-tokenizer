<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:dx="com.deltaxml"
                version="3.0">
  
  <xsl:variable name="main" select="*[qqq]"/>
  
  <xsl:function name="dx:test" as="item()">
    <xsl:for-each select="/current()">
      <xsl:variable name="v1" as="xs:string" select="node-name()"/>
      <xsl:sequence select="text(), *, child::*, div, @class, ., .."/>
    </xsl:for-each>
  </xsl:function>  
  
</xsl:stylesheet>