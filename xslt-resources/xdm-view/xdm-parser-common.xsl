<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                xmlns:zxd="http://deltaxignia.com/ns/xdm-persistence/internal"
                exclude-result-prefixes="xsl zxd"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       Shared between xdm-parser.xsl and xdm-parser-refs.xsl: reconstructing
       a standalone attribute or namespace node is the same operation
       regardless of serialization mode. Not self-sufficient - relies on
       nothing beyond core XPath, so no further imports needed here.
  -->

  <!-- Standalone attribute nodes cannot be constructed directly in XPath, so
       one is built on a throwaway element and then extracted. -->
  <xsl:function name="zxd:parse-attribute" as="attribute()">
    <xsl:param name="el" as="element(xdm:attribute)"/>
    <xsl:variable name="name" as="xs:string" select="$el/@name"/>
    <xsl:variable name="uri" as="xs:string" select="$el/@uri"/>
    <xsl:variable name="temp" as="element()">
      <xsl:element name="{$name}" namespace="{$uri}">
        <xsl:attribute name="{$name}" namespace="{$uri}" select="string($el)"/>
      </xsl:element>
    </xsl:variable>
    <xsl:sequence select="$temp/@*"/>
  </xsl:function>

  <!-- Same trick for a standalone namespace node. -->
  <xsl:function name="zxd:parse-namespace" as="namespace-node()">
    <xsl:param name="el" as="element(xdm:namespace)"/>
    <xsl:variable name="prefix" as="xs:string" select="$el/@prefix"/>
    <xsl:variable name="uri" as="xs:string" select="$el/@uri"/>
    <xsl:variable name="temp" as="element()">
      <xsl:element name="tmp">
        <xsl:namespace name="{$prefix}" select="$uri"/>
      </xsl:element>
    </xsl:variable>
    <xsl:sequence select="$temp/namespace::*[name() eq $prefix]"/>
  </xsl:function>

</xsl:stylesheet>
