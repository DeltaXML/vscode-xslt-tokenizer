<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                xmlns:zxd="http://deltaxignia.com/ns/xdm-persistence/internal"
                exclude-result-prefixes="xsl zxd"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       Shared between xdm-serializer.xsl and xdm-serializer-refs.xsl: the
       parts of building the xdm: tree that don't differ between the two
       serialization modes - atomic values never contain nodes, and node
       *kind* classification is the same regardless of how a node ends up
       represented (embedded inline vs. referenced into a pool). Not
       self-sufficient - relies on xdm-types.xsl (zxd:type-name) being
       imported alongside it, same as xdm-serializer.xsl/xdm-parser.xsl.
  -->

  <xsl:function name="zxd:node-kind" as="xs:string?">
    <xsl:param name="item" as="item()"/>
    <xsl:choose>
      <xsl:when test="$item instance of document-node()">document</xsl:when>
      <xsl:when test="$item instance of element()">element</xsl:when>
      <xsl:when test="$item instance of text()">text</xsl:when>
      <xsl:when test="$item instance of attribute()">attribute</xsl:when>
      <xsl:when test="$item instance of comment()">comment</xsl:when>
      <xsl:when test="$item instance of processing-instruction()">processing-instruction</xsl:when>
      <xsl:when test="$item instance of namespace-node()">namespace</xsl:when>
      <xsl:otherwise/>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:build-atomic" as="element(xdm:atomic)">
    <xsl:param name="v" as="xs:anyAtomicType"/>
    <xsl:variable name="type" as="xs:string" select="zxd:type-name($v)"/>
    <xdm:atomic type="{$type}">
      <xsl:if test="$type eq 'xs:QName' and string-length(namespace-uri-from-QName($v)) gt 0">
        <xsl:attribute name="uri" select="namespace-uri-from-QName($v)"/>
      </xsl:if>
      <xsl:value-of select="zxd:atomic-lexical($v)"/>
    </xdm:atomic>
  </xsl:function>

  <!-- Canonical lexical form for an atomic value. xs:QName is special-cased
       to its local name since the namespace URI is captured separately
       (see zxd:build-atomic / zxd:build-map's key-uri). -->
  <xsl:function name="zxd:atomic-lexical" as="xs:string">
    <xsl:param name="v" as="xs:anyAtomicType"/>
    <xsl:sequence select="
      if ($v instance of xs:QName) then local-name-from-QName($v)
      else serialize($v, map{'method':'text'})"/>
  </xsl:function>

  <!-- Element and document nodes are self-describing XML already, so they
       need no wrapper vocabulary of their own: elements are copied inline,
       and a document's children are copied under xdm:document (a document
       node cannot itself be a child of an element). The remaining kinds
       have no native XML representation as a bare sequence item, so each
       gets a small dedicated wrapper. Used both by xdm-serializer.xsl
       (always, every node is embedded this way) and by
       xdm-serializer-refs.xsl (only for a node whose root() is not a
       document-node() - everything else is a reference into the pool
       instead of an inline copy). -->
  <xsl:function name="zxd:build-node" as="element()">
    <xsl:param name="node" as="node()"/>
    <xsl:param name="kind" as="xs:string"/>
    <xsl:choose>
      <xsl:when test="$kind eq 'element'">
        <xsl:copy-of select="$node"/>
      </xsl:when>
      <xsl:when test="$kind eq 'document'">
        <xdm:document>
          <xsl:copy-of select="$node/node()"/>
        </xdm:document>
      </xsl:when>
      <xsl:when test="$kind eq 'text'">
        <xdm:text><xsl:value-of select="$node"/></xdm:text>
      </xsl:when>
      <xsl:when test="$kind eq 'comment'">
        <xdm:comment><xsl:value-of select="$node"/></xdm:comment>
      </xsl:when>
      <xsl:when test="$kind eq 'processing-instruction'">
        <xdm:pi name="{name($node)}"><xsl:value-of select="$node"/></xdm:pi>
      </xsl:when>
      <xsl:when test="$kind eq 'attribute'">
        <xdm:attribute name="{local-name($node)}" uri="{namespace-uri($node)}">
          <xsl:value-of select="$node"/>
        </xdm:attribute>
      </xsl:when>
      <xsl:otherwise> <!-- namespace -->
        <xdm:namespace prefix="{name($node)}" uri="{string($node)}"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

</xsl:stylesheet>
