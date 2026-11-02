<?xml version="1.0" encoding="UTF-8"?>
<!--
  XSpec's HTML report, as XSpec's format-xspec-report.xsl makes it - and, for VS Code's diff of each failed expectation,
  its expected and actual values as XSpec compares them (see deq:deep-equal in XSpec's src/common/deep-equal.xsl):
  without namespace declarations, with attributes sorted and without whitespace-only text - other than in mixed content -
  each serialised indented in the same way. Written as JSON - test id: {expected, actual} - to $diffs-uri.
  reporter: the URI of XSpec's format-xspec-report.xsl
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:diff="urn:x-deltaxml:xspec-diff"
  exclude-result-prefixes="#all" version="3.0">

  <xsl:param name="reporter" as="xs:string" static="yes"/>
  <xsl:param name="diffs-uri" as="xs:string"/>

  <xsl:import _href="{$reporter}"/>

  <xsl:mode name="diff:normalise" on-no-match="fail"/>

  <xsl:template match="document-node(element(x:report))">
    <xsl:apply-imports/>
    <xsl:result-document href="{$diffs-uri}" method="json" indent="yes">
      <xsl:map>
        <xsl:for-each select="//x:scenario/x:test[@successful = 'false']">
          <xsl:map-entry key="string(@id)" select="map {
            'expected': diff:value(x:expect),
            'actual': diff:value(parent::x:scenario/x:result)
          }"/>
        </xsl:for-each>
      </xsl:map>
    </xsl:result-document>
  </xsl:template>

  <!-- a value in the report: its nodes, or else the expression XSpec shows for it, e.g. an atomic value's -->
  <xsl:function name="diff:value" as="xs:string?">
    <xsl:param name="value" as="element()?"/>
    <xsl:variable name="content" as="node()*" select="($value/content-wrap, $value)[1]/node()"/>
    <xsl:variable name="nodes" as="node()*">
      <xsl:apply-templates select="$content" mode="diff:normalise"/>
    </xsl:variable>
    <xsl:sequence select="if (empty($value)) then () else if (empty($nodes)) then string($value/@select)
      else string-join($nodes ! diff:serialise(.), '&#10;')"/>
  </xsl:function>

  <xsl:function name="diff:serialise" as="xs:string">
    <xsl:param name="node" as="node()"/>
    <xsl:variable name="options" as="map(*)" select="map { 'method': 'xml', 'indent': true(), 'omit-xml-declaration': true() }"/>
    <!-- each start tag on one line, so tags only wrapped on one side don't differ -->
    <xsl:try>
      <xsl:sequence select="serialize($node, map:put($options, QName('http://saxon.sf.net/', 'line-length'), 1000000))"
        xmlns:map="http://www.w3.org/2005/xpath-functions/map"/>
      <xsl:catch>
        <xsl:sequence select="serialize($node, $options)"/>
      </xsl:catch>
    </xsl:try>
  </xsl:function>

  <!-- with only the namespaces its names need -->
  <xsl:template match="*" mode="diff:normalise">
    <xsl:element name="{name()}" namespace="{namespace-uri()}">
      <xsl:apply-templates select="@*" mode="#current">
        <xsl:sort select="namespace-uri()"/>
        <xsl:sort select="local-name()"/>
      </xsl:apply-templates>
      <xsl:apply-templates select="node()" mode="#current"/>
    </xsl:element>
  </xsl:template>

  <xsl:template match="@*" mode="diff:normalise">
    <xsl:attribute name="{name()}" namespace="{namespace-uri()}" select="."/>
  </xsl:template>

  <xsl:template match="text() | comment() | processing-instruction()" mode="diff:normalise">
    <xsl:copy/>
  </xsl:template>

  <!-- whitespace: only in mixed content, where it's part of the text - XSpec reports it as x:ws -->
  <xsl:template match="text()[not(normalize-space())] | x:ws" mode="diff:normalise">
    <xsl:if test="../text()[normalize-space()]">
      <xsl:value-of select="."/>
    </xsl:if>
  </xsl:template>
</xsl:stylesheet>
