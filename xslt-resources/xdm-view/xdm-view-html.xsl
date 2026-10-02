<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                xmlns:zxd="http://deltaxignia.com/ns/xdm-persistence/internal"
                exclude-result-prefixes="xsl xdm xs zxd"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       Renders an XPath 3.1 Data Model value as a browsable HTML page -
       maps and arrays as collapsible <details> sections, atomic values
       and nodes as small color-coded spans. Same underlying xdm: tree as
       xdm-view-text.xsl, just a different rendering of it.
  -->

  <xsl:variable name="zxd:NUMERIC-TYPES" as="xs:string*" select="(
    'xs:integer', 'xs:decimal', 'xs:double', 'xs:float',
    'xs:byte', 'xs:short', 'xs:int', 'xs:long',
    'xs:nonNegativeInteger', 'xs:nonPositiveInteger', 'xs:positiveInteger', 'xs:negativeInteger',
    'xs:unsignedByte', 'xs:unsignedShort', 'xs:unsignedInt', 'xs:unsignedLong'
  )"/>

  <xsl:function name="xdm:view-html" as="document-node()">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="xdm:persisted-to-html-view(xdm:to-document($value))"/>
  </xsl:function>

  <!-- For a value already persisted via xdm-persistence's xdm:to-document()
       (e.g. read back with doc()) - renders the tree directly rather than
       parsing it into a value and immediately re-serializing it, and
       doesn't need xdm-persistence's xdm:from-document() at all. -->
  <xsl:function name="xdm:persisted-to-html-view" as="document-node()">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:document>
      <html>
        <head>
          <meta charset="UTF-8"/>
          <title>xdm-viewer</title>
          <style><xsl:sequence select="xdm:stylesheet-text()"/></style>
        </head>
        <body>
          <div class="xdm-root">
            <xsl:sequence select="xdm:persisted-to-html-fragment($doc)"/>
          </div>
        </body>
      </html>
    </xsl:document>
  </xsl:function>

  <!-- The rendered content alone - no <html>/<head>/<body> page shell, no
       title, no <style>. For embedding in a page with its own styling and
       title rather than the fixed one xdm:view-html/persisted-to-html-view
       produce; xdm:stylesheet-text() is still available separately if you
       want the same CSS this project uses. -->
  <xsl:function name="xdm:view-html-fragment" as="element()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="xdm:persisted-to-html-fragment(xdm:to-document($value))"/>
  </xsl:function>

  <xsl:function name="xdm:persisted-to-html-fragment" as="element()*">
    <xsl:param name="doc" as="document-node()"/>
    <!-- Everything below zxd:render-item-seq-html is shared between the
         two persisted formats unchanged - see xdm-view-text.xsl's
         xdm:persisted-to-text-view for why only the root's own location
         needs to differ per format. -->
    <xsl:variable name="items" as="element(xdm:item)*" select="
      if (xdm:is-refs-format($doc)) then $doc/xdm:context/xdm:sequence/xdm:item else $doc/xdm:sequence/xdm:item"/>
    <xsl:sequence select="zxd:render-item-seq-html($items)"/>
  </xsl:function>

  <!-- Value-level entry points for the reference-preserving mode,
       mirroring xdm:view-html/xdm:view-html-fragment the same way they
       mirror xdm:to-document. -->
  <xsl:function name="xdm:view-html-with-refs" as="document-node()">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="xdm:persisted-to-html-view(xdm:to-document-with-refs($value))"/>
  </xsl:function>

  <xsl:function name="xdm:view-html-fragment-with-refs" as="element()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:sequence select="xdm:persisted-to-html-fragment(xdm:to-document-with-refs($value))"/>
  </xsl:function>

  <xsl:function name="zxd:render-item-seq-html" as="element()*">
    <xsl:param name="items" as="element(xdm:item)*"/>
    <xsl:choose>
      <xsl:when test="count($items) = 0">
        <span class="xdm-bracket">()</span>
      </xsl:when>
      <xsl:when test="count($items) = 1">
        <xsl:sequence select="zxd:render-payload-html($items[1]/*[1])"/>
      </xsl:when>
      <xsl:when test="zxd:all-atomic($items)">
        <span class="xdm-seq">
          <span class="xdm-bracket">(</span>
          <xsl:for-each select="$items">
            <xsl:if test="position() gt 1"><span class="xdm-comma">, </span></xsl:if>
            <xsl:sequence select="zxd:render-payload-html(./*[1])"/>
          </xsl:for-each>
          <span class="xdm-bracket">)</span>
        </span>
      </xsl:when>
      <xsl:otherwise>
        <!-- Not all atomic (nodes, attributes, maps, arrays mixed in) -
             those tend to be too verbose to cram inline, so each item
             gets its own line instead. -->
        <ul class="xdm-seq-list">
          <xsl:for-each select="$items">
            <li><xsl:sequence select="zxd:render-payload-html(./*[1])"/></li>
          </xsl:for-each>
        </ul>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-payload-html" as="element()">
    <xsl:param name="payload" as="element()"/>
    <xsl:choose>
      <xsl:when test="$payload/self::xdm:atomic">
        <xsl:sequence select="zxd:render-atomic-html($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:map">
        <xsl:sequence select="zxd:render-map-html($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:array">
        <xsl:sequence select="zxd:render-array-html($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:node-ref">
        <xsl:sequence select="zxd:render-node-ref-html($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:text">
        <span class="xdm-text-node">"<xsl:value-of select="string($payload)"/>"</span>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:comment">
        <span class="xdm-comment">&lt;!--<xsl:value-of select="string($payload)"/>--&gt;</span>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:pi">
        <span class="xdm-pi">&lt;?<xsl:value-of select="string($payload/@name)"/><xsl:text> </xsl:text><xsl:value-of select="string($payload)"/>?&gt;</span>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:attribute">
        <span class="xdm-attr">@<xsl:value-of select="string($payload/@name)"/>="<xsl:value-of select="string($payload)"/>"</span>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:namespace">
        <span class="xdm-ns">xmlns<xsl:if test="string-length($payload/@prefix) gt 0">:<xsl:value-of select="string($payload/@prefix)"/></xsl:if>="<xsl:value-of select="string($payload/@uri)"/>"</span>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:document">
        <xsl:sequence select="zxd:render-node-html($payload/node())"/>
      </xsl:when>
      <xsl:otherwise> <!-- a plain copied element node -->
        <xsl:sequence select="zxd:render-node-html($payload)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-atomic-html" as="element(span)">
    <xsl:param name="el" as="element(xdm:atomic)"/>
    <xsl:variable name="type" as="xs:string" select="$el/@type"/>
    <xsl:variable name="lexical" as="xs:string" select="string($el)"/>
    <xsl:choose>
      <xsl:when test="$type eq 'xs:string'">
        <span class="xdm-string" title="{$type}">'<xsl:value-of select="$lexical"/>'</span>
      </xsl:when>
      <xsl:when test="$type eq 'xs:boolean'">
        <span class="xdm-boolean" title="{$type}"><xsl:value-of select="$lexical"/>()</span>
      </xsl:when>
      <xsl:when test="$type = $zxd:NUMERIC-TYPES">
        <span class="xdm-number" title="{$type}"><xsl:value-of select="$lexical"/></span>
      </xsl:when>
      <xsl:when test="$type eq 'xs:QName'">
        <xsl:variable name="uri" as="xs:string?" select="$el/@uri"/>
        <span class="xdm-other" title="{$type}"><xsl:if test="string-length($uri) gt 0">Q{<xsl:value-of select="$uri"/>}</xsl:if><xsl:value-of select="$lexical"/></span>
      </xsl:when>
      <xsl:otherwise>
        <!-- The value gets the xdm-other color; the '(type)' annotation is
             left unstyled (default text color) so it reads as a quieter
             aside, not part of the value itself. Grouped under one outer
             span since callers expect a single element() per payload. -->
        <span><span class="xdm-other" title="{$type}"><xsl:value-of select="$lexical"/></span><xsl:text> (</xsl:text><xsl:value-of select="$type"/><xsl:text>)</xsl:text></span>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:render-map-html" as="element(details)">
    <xsl:param name="mapEl" as="element(xdm:map)"/>
    <xsl:variable name="n" as="xs:integer" select="count($mapEl/xdm:entry)"/>
    <details class="xdm-map" open="open">
      <summary>map{<xsl:value-of select="$n || ' ' || (if ($n = 1) then 'entry' else 'entries')"/>}</summary>
      <ul>
        <xsl:for-each select="$mapEl/xdm:entry">
          <xsl:sequence select="zxd:render-entry-html(.)"/>
        </xsl:for-each>
      </ul>
    </details>
  </xsl:function>

  <xsl:function name="zxd:render-entry-html" as="element(li)">
    <xsl:param name="entry" as="element(xdm:entry)"/>
    <xsl:variable name="keyType" as="xs:string" select="$entry/@key-type"/>
    <xsl:variable name="keyText" as="xs:string" select="
      if ($keyType eq 'xs:string') then '''' || string($entry/@key) || '''' else string($entry/@key)"/>
    <li>
      <span class="xdm-key" title="{$keyType}"><xsl:value-of select="$keyText"/></span>
      <xsl:text>: </xsl:text>
      <xsl:sequence select="zxd:render-item-seq-html($entry/xdm:item)"/>
    </li>
  </xsl:function>

  <xsl:function name="zxd:render-array-html" as="element(details)">
    <xsl:param name="arrayEl" as="element(xdm:array)"/>
    <xsl:variable name="n" as="xs:integer" select="count($arrayEl/xdm:member)"/>
    <details class="xdm-array" open="open">
      <summary>array{<xsl:value-of select="$n || ' ' || (if ($n = 1) then 'member' else 'members')"/>}</summary>
      <ul>
        <xsl:for-each select="$arrayEl/xdm:member">
          <li><xsl:sequence select="zxd:render-item-seq-html(./xdm:item)"/></li>
        </xsl:for-each>
      </ul>
    </details>
  </xsl:function>

  <!-- A real element/document node has no compact HTML-native form, so its
       own markup is shown, syntax-escaped, inside a <pre>. -->
  <xsl:function name="zxd:render-node-html" as="element(pre)">
    <xsl:param name="node" as="node()*"/>
    <xsl:variable name="clean" as="node()*" select="zxd:strip-unused-namespaces($node)"/>
    <xsl:variable name="raw" as="xs:string" select="
      string-join(for $n in $clean return serialize($n, map{'method':'xml', 'indent': true()}), '')"/>
    <pre class="xdm-node"><xsl:value-of select="$raw"/></pre>
  </xsl:function>

  <!-- The resolved node's own rendering (exactly as zxd:render-node-html
       would render it inline), with the location line
       (zxd:render-node-ref-path-text) shown above it in the page's
       default text color (no .xdm-* color class), so it reads as a
       quiet annotation rather than part of the value. A block-level
       wrapper, matching zxd:render-map-html/zxd:render-array-html/
       zxd:render-node-html's own block-level return types (<details>,
       <pre>) in this same dispatch - not <span>, which zxd:render-node-html's
       <pre> shouldn't be nested inside. -->
  <xsl:function name="zxd:render-node-ref-html" as="element(div)">
    <xsl:param name="ref" as="element(xdm:node-ref)"/>
    <xsl:variable name="resolved" as="node()" select="zxd:resolve-node-ref($ref)"/>
    <div class="xdm-noderef">
      <div class="xdm-noderef-path"><xsl:value-of select="zxd:render-node-ref-path-text($ref)"/></div>
      <xsl:sequence select="zxd:render-node-html($resolved)"/>
    </div>
  </xsl:function>

  <xsl:function name="xdm:stylesheet-text" as="xs:string">
    <xsl:sequence select="
      'body { font-family: ui-monospace, monospace; font-size: 14px; line-height: 1.5; margin: 1.5rem; }' ||
      '.xdm-root { max-width: 60rem; }' ||
      'details.xdm-map, details.xdm-array { margin-left: 1rem; border-left: 2px solid #ddd; padding-left: 0.75rem; }' ||
      'details > ul { list-style: none; margin: 0.25rem 0; padding: 0; }' ||
      'details > ul > li { margin: 0.15rem 0; }' ||
      'summary { cursor: pointer; color: #555; }' ||
      '.xdm-key { color: #a02020; font-weight: 600; }' ||
      '.xdm-string { color: #1a56b0; }' ||
      '.xdm-boolean { color: #1a8a3d; }' ||
      '.xdm-number { color: #8a3daa; }' ||
      '.xdm-other, .xdm-text-node, .xdm-comment, .xdm-pi { color: #1a8a9a; }' ||
      '.xdm-attr, .xdm-ns { color: #1a8a3d; }' ||
      '.xdm-bracket, .xdm-comma { color: #888; }' ||
      'pre.xdm-node { display: inline-block; margin: 0; padding: 0.4rem 0.6rem; background: #f4f4f4; border-radius: 4px; vertical-align: top; }' ||
      'ul.xdm-seq-list { list-style: none; margin: 0.25rem 0 0.25rem 1rem; padding: 0; border-left: 2px solid #ddd; padding-left: 0.75rem; }' ||
      'ul.xdm-seq-list > li { margin: 0.15rem 0; }' ||
      '.xdm-noderef-path { font-size: 0.85em; margin-bottom: 0.15rem; }'
    "/>
  </xsl:function>

</xsl:stylesheet>
