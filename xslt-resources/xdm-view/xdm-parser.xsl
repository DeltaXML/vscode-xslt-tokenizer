<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                xmlns:zxd="http://deltaxignia.com/ns/xdm-persistence/internal"
                exclude-result-prefixes="#all"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       Reads back the XML tree produced by xdm-serializer.xsl into an
       equivalent XPath 3.1 data model value (item()*).

       Not self-sufficient - relies on xdm-parser-common.xsl and
       xdm-types.xsl being imported alongside it (see xdm-persistence.xsl,
       the master that does this). Deliberately not imported here:
       xdm-parser-refs.xsl also imports xdm-parser-common.xsl, and
       importing it a second time from here too would create a diamond.
  -->

  <xsl:function name="xdm:from-document" as="item()*">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:sequence select="zxd:parse-item-seq($doc/xdm:sequence/xdm:item)"/>
  </xsl:function>

  <xsl:function name="zxd:parse-item-seq" as="item()*">
    <xsl:param name="items" as="element(xdm:item)*"/>
    <xsl:for-each select="$items">
      <xsl:sequence select="zxd:parse-item(.)"/>
    </xsl:for-each>
  </xsl:function>

  <xsl:function name="zxd:parse-item" as="item()*">
    <xsl:param name="item" as="element(xdm:item)"/>
    <xsl:variable name="payload" as="element()" select="$item/*[1]"/>
    <xsl:choose>
      <xsl:when test="$payload/self::xdm:atomic">
        <xsl:sequence select="zxd:parse-atomic($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:map">
        <xsl:sequence select="zxd:parse-map($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:array">
        <xsl:sequence select="zxd:parse-array($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:text">
        <xsl:value-of select="string($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:comment">
        <xsl:comment><xsl:value-of select="string($payload)"/></xsl:comment>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:pi">
        <xsl:processing-instruction name="{string($payload/@name)}">
          <xsl:value-of select="string($payload)"/>
        </xsl:processing-instruction>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:attribute">
        <xsl:sequence select="zxd:parse-attribute($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:namespace">
        <xsl:sequence select="zxd:parse-namespace($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:document">
        <xsl:document>
          <xsl:sequence select="$payload/node()"/>
        </xsl:document>
      </xsl:when>
      <xsl:otherwise> <!-- a plain copied element node -->
        <xsl:sequence select="$payload"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:parse-atomic" as="xs:anyAtomicType">
    <xsl:param name="atomicEl" as="element(xdm:atomic)"/>
    <xsl:variable name="type" as="xs:string" select="zxd:resolve-type-name($atomicEl/@type)"/>
    <xsl:sequence select="
      if ($type eq 'xs:QName') then zxd:cast-qname($atomicEl/@uri, string($atomicEl))
      else zxd:cast-atomic($type, string($atomicEl))"/>
  </xsl:function>

  <xsl:function name="zxd:parse-map" as="map(*)">
    <xsl:param name="mapEl" as="element(xdm:map)"/>
    <xsl:sequence select="
      map:merge(
        for $entry in $mapEl/xdm:entry
        return map:entry(zxd:parse-key($entry), zxd:parse-item-seq($entry/xdm:item)))"/>
  </xsl:function>

  <xsl:function name="zxd:parse-key" as="xs:anyAtomicType">
    <xsl:param name="entry" as="element(xdm:entry)"/>
    <xsl:variable name="keyType" as="xs:string" select="zxd:resolve-type-name($entry/@key-type)"/>
    <xsl:sequence select="
      if ($keyType eq 'xs:QName') then zxd:cast-qname($entry/@key-uri, string($entry/@key))
      else zxd:cast-atomic($keyType, string($entry/@key))"/>
  </xsl:function>

  <xsl:function name="zxd:parse-array" as="array(*)">
    <xsl:param name="arrayEl" as="element(xdm:array)"/>
    <xsl:sequence select="
      fold-left($arrayEl/xdm:member, array{},
        function($acc, $m) { array:append($acc, zxd:parse-item-seq($m/xdm:item)) })"/>
  </xsl:function>

</xsl:stylesheet>
