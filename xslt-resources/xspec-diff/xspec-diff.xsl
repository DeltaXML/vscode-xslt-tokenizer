<?xml version="1.0" encoding="UTF-8"?>
<!--
  XSpec's HTML report, as XSpec's format-xspec-report.xsl makes it - and, for VS Code's diff of each failed expectation,
  its expected and actual values as XSpec compares them (see deq:deep-equal in XSpec's src/common/deep-equal.xsl):
  without namespace declarations, with attributes sorted and without whitespace-only text - other than in mixed content -
  each serialised indented in the same way. A map's entries are in the order of the expected map's, as XSpec ignores
  their order: from Saxon 13, maps are ordered, so the actual map may be in another order. Written as JSON - test id:
  {expected, actual} - to $diffs-uri.
  reporter: the URI of XSpec's format-xspec-report.xsl
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:diff="urn:x-deltaxml:xspec-diff"
  xmlns:map="http://www.w3.org/2005/xpath-functions/map" xmlns:array="http://www.w3.org/2005/xpath-functions/array"
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
            'expected': diff:value(x:expect, ()),
            'actual': diff:value(parent::x:scenario/x:result, x:expect)
          }"/>
        </xsl:for-each>
      </xsl:map>
    </xsl:result-document>
  </xsl:template>

  <!-- a value in the report: its nodes, or else the expression XSpec shows for it, e.g. an atomic value's - expected: for
    the actual value, the expected one, whose maps' order its maps are put in -->
  <xsl:function name="diff:value" as="xs:string?">
    <xsl:param name="value" as="element()?"/>
    <xsl:param name="expected" as="element()?"/>
    <xsl:variable name="nodes" as="node()*" select="diff:content($value)"/>
    <xsl:variable name="expected-nodes" as="node()*" select="diff:content($expected)"/>
    <xsl:sequence select="if (empty($value)) then () else if (empty($nodes)) then string($value/@select)
      else if (diff:is-pseudo($nodes[1]))
        then string-join(for $i in 1 to count($nodes) return diff:pseudo-item($nodes[$i], $expected-nodes[$i][diff:is-pseudo(.)]), ',&#10;')
      else string-join($nodes ! diff:serialise(.), '&#10;')"/>
  </xsl:function>

  <xsl:function name="diff:content" as="node()*">
    <xsl:param name="value" as="element()?"/>
    <xsl:apply-templates select="($value/content-wrap, $value)[1]/node()" mode="diff:normalise"/>
  </xsl:function>

  <xsl:function name="diff:is-pseudo" as="xs:boolean">
    <xsl:param name="node" as="node()?"/>
    <xsl:sequence select="$node instance of element() and namespace-uri($node) eq 'http://www.jenitennison.com/xslt/xspec'
      and starts-with(local-name($node), 'pseudo-')"/>
  </xsl:function>

  <!-- an item of a sequence XSpec reports as pseudo elements, e.g. x:pseudo-map: a node as itself; a map or array in the
    order of the expected one, if any; and a function or atomic value as the text XSpec gives it - without its blank
    lines -->
  <xsl:function name="diff:pseudo-item" as="xs:string">
    <xsl:param name="item" as="element()"/>
    <xsl:param name="expected" as="element()?"/>
    <xsl:sequence select="if ($item/*) then string-join($item/node() ! diff:serialise(.), '&#10;')
      else if (local-name($item) = ('pseudo-map', 'pseudo-array')) then diff:map-or-array($item, $expected)
      else diff:text($item)"/>
  </xsl:function>

  <xsl:function name="diff:text" as="xs:string">
    <xsl:param name="item" as="element()"/>
    <xsl:sequence select="replace(string($item), '\n\s*\n', '&#10;')"/>
  </xsl:function>

  <!-- a map or array: its value, from the text XSpec gives it, serialised as XSpec serialises it, with its maps' entries in
    the order of the expected one's - or else, e.g. for a map with a node, which the text isn't an expression for, the
    text -->
  <xsl:function name="diff:map-or-array" as="xs:string">
    <xsl:param name="item" as="element()"/>
    <xsl:param name="expected" as="element()?"/>
    <xsl:try>
      <xsl:variable name="value" as="item()" select="diff:evaluate(string($item))"/>
      <xsl:variable name="ordered" as="item()"
        select="if (exists($expected)) then diff:in-order-of($value, diff:evaluate(string($expected))) else $value"/>
      <xsl:sequence select="replace(serialize($ordered, map { 'method': 'adaptive', 'indent': true() }), '\n\s*\n', '&#10;')"/>
      <xsl:catch>
        <xsl:sequence select="diff:text($item)"/>
      </xsl:catch>
    </xsl:try>
  </xsl:function>

  <xsl:function name="diff:evaluate" as="item()">
    <xsl:param name="text" as="xs:string"/>
    <xsl:variable name="namespaces" as="element()">
      <xsl:element name="namespaces">
        <xsl:namespace name="xs" select="'http://www.w3.org/2001/XMLSchema'"/>
      </xsl:element>
    </xsl:variable>
    <xsl:evaluate xpath="$text" namespace-context="$namespaces"/>
  </xsl:function>

  <!-- value, with the entries of its maps in the order of those in expected, and then those that aren't in it - in maps
    and arrays within them too -->
  <xsl:function name="diff:in-order-of" as="item()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:param name="expected" as="item()*"/>
    <xsl:choose>
      <xsl:when test="$value instance of map(*) and $expected instance of map(*)">
        <xsl:sequence select="map:merge((
          map:keys($expected)[map:contains($value, .)] ! map:entry(., diff:in-order-of($value(.), $expected(.))),
          map:keys($value)[not(map:contains($expected, .))] ! map:entry(., $value(.))))"/>
      </xsl:when>
      <xsl:when test="$value instance of array(*) and $expected instance of array(*)">
        <xsl:sequence select="array:join(for $i in 1 to array:size($value) return
          [if ($i le array:size($expected)) then diff:in-order-of($value($i), $expected($i)) else $value($i)])"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:sequence select="$value"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="diff:serialise" as="xs:string">
    <xsl:param name="node" as="node()"/>
    <xsl:variable name="options" as="map(*)" select="map { 'method': 'xml', 'indent': true(), 'omit-xml-declaration': true() }"/>
    <!-- each start tag on one line, so tags only wrapped on one side don't differ -->
    <xsl:try>
      <xsl:sequence select="serialize($node, map:put($options, QName('http://saxon.sf.net/', 'line-length'), 1000000))"/>
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
