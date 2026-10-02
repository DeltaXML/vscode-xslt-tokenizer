<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                xmlns:zxd="http://deltaxignia.com/ns/xdm-persistence/internal"
                exclude-result-prefixes="xsl map array zxd"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       Serializes an arbitrary XPath 3.1 data model value (any item()*:
       nodes, maps, arrays, atomic values, in any combination/nesting) to
       an XML tree in the xdm: namespace that xdm-parser.xsl can read back
       into an equivalent value.

       Not self-sufficient - relies on xdm-serializer-common.xsl and
       xdm-types.xsl being imported alongside it (see xdm-persistence.xsl,
       the master that does this). Deliberately not imported here:
       xdm-serializer-refs.xsl also imports xdm-serializer-common.xsl, and
       importing it a second time from here too would create a diamond.
  -->

  <xsl:function name="xdm:to-document" as="document-node()">
    <xsl:param name="value" as="item()*"/>
    <xsl:document>
      <xdm:sequence xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xsl:sequence select="zxd:build-item-seq($value)"/>
      </xdm:sequence>
    </xsl:document>
  </xsl:function>

  <!-- One xdm:item per item in the sequence. Used for the top-level value,
       for a map entry's value (item()*), and for an array member's value
       (item()*) - all three are "an arbitrary XDM sequence" in the same sense. -->
  <xsl:function name="zxd:build-item-seq" as="element(xdm:item)*">
    <xsl:param name="items" as="item()*"/>
    <xsl:for-each select="$items">
      <xdm:item>
        <xsl:sequence select="zxd:build-payload(.)"/>
      </xdm:item>
    </xsl:for-each>
  </xsl:function>

  <xsl:function name="zxd:build-payload" as="element()">
    <xsl:param name="item" as="item()"/>
    <xsl:variable name="nodeKind" as="xs:string?" select="zxd:node-kind($item)"/>
    <xsl:choose>
      <xsl:when test="exists($nodeKind)">
        <xsl:sequence select="zxd:build-node($item, $nodeKind)"/>
      </xsl:when>
      <xsl:when test="$item instance of map(*)">
        <xsl:sequence select="zxd:build-map($item)"/>
      </xsl:when>
      <xsl:when test="$item instance of array(*)">
        <xsl:sequence select="zxd:build-array($item)"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:sequence select="zxd:build-atomic($item)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:build-map" as="element(xdm:map)">
    <xsl:param name="m" as="map(*)"/>
    <xdm:map>
      <xsl:for-each select="map:keys($m)">
        <xsl:variable name="k" as="xs:anyAtomicType" select="."/>
        <xsl:variable name="keyType" as="xs:string" select="zxd:type-name($k)"/>
        <xdm:entry key="{zxd:atomic-lexical($k)}" key-type="{$keyType}">
          <xsl:if test="$keyType eq 'xs:QName' and string-length(namespace-uri-from-QName($k)) gt 0">
            <xsl:attribute name="key-uri" select="namespace-uri-from-QName($k)"/>
          </xsl:if>
          <xsl:sequence select="zxd:build-item-seq($m($k))"/>
        </xdm:entry>
      </xsl:for-each>
    </xdm:map>
  </xsl:function>

  <xsl:function name="zxd:build-array" as="element(xdm:array)">
    <xsl:param name="a" as="array(*)"/>
    <xdm:array>
      <xsl:for-each select="1 to array:size($a)">
        <xdm:member>
          <xsl:sequence select="zxd:build-item-seq($a(.))"/>
        </xdm:member>
      </xsl:for-each>
    </xdm:array>
  </xsl:function>

</xsl:stylesheet>
