<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:dx="com.deltaxml"
                xmlns:q="com.short"
                version="3.0">
  
  
  <xsl:function name="dx:test" as="item()">
    <xsl:apply-templates/>
    <xsl:copy>      
    </xsl:copy>
    <xsl:sequence select="@*, text(), *, child::*, div, @class, ., .., *, @*:latest, *:something, @*:newer"/>
    <xsl:for-each select="/*:abc, /@*:def, $a, /base-uri(), child::node(), attribute::*:name, *[node-name()]">
      <xsl:sequence select="@*, dx, /count(*:stentry), root()[.], $a[root()[@name]]/*:any"/>     
      <xsl:variable name="v1" as="xs:string" select="node-name()"/>
    </xsl:for-each>
  </xsl:function>  
  
  <xsl:variable name="a" as="" select=" /@*:some, *:some"/>
  
</xsl:stylesheet>