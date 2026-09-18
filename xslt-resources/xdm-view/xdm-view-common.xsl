<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                xmlns:zxd="http://deltaxignia.com/ns/xdm-persistence/internal"
                exclude-result-prefixes="xsl zxd"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       Small helpers shared by xdm-view-text.xsl and xdm-view-html.xsl.
  -->

  <!-- A real element/document node embedded in the xdm: tree inherits
       xmlns:xdm/xmlns:xs from its ancestors (that's just how XML namespace
       scoping works), even though it never uses either. Serializing it in
       isolation for display would otherwise carry that noise along, so it
       is stripped down to only the namespaces its own names actually use.

       Recursion here is a named template (xsl:call-template), not
       xsl:apply-templates/a mode - a mode is a global namespace shared
       across the whole compiled stylesheet, including every module a
       caller imports this into, so a caller declaring their own
       mode="#all" template can silently intercept ours if their match
       pattern happens to structurally fit content we construct
       internally (confirmed: this caused genuine infinite recursion when
       a caller's own match="/*" mode="#all" template intercepted the
       synthetic document node built for a whole-document reference,
       since that node's root element genuinely does match /*). A named
       template is looked up by exact QName, never by pattern/priority
       resolution, so it can't be intercepted this way - the only
       collision risk left is a caller declaring a template with this
       exact namespaced name, which they'd have to do deliberately. -->
  <xsl:template name="zxd:strip-ns-copy">
    <xsl:param name="node" as="node()"/>
    <xsl:choose>
      <xsl:when test="$node instance of document-node()">
        <xsl:document>
          <xsl:for-each select="$node/node()">
            <xsl:call-template name="zxd:strip-ns-copy">
              <xsl:with-param name="node" select="."/>
            </xsl:call-template>
          </xsl:for-each>
        </xsl:document>
      </xsl:when>
      <xsl:when test="$node instance of element()">
        <xsl:for-each select="$node">
          <xsl:copy copy-namespaces="no">
            <xsl:for-each select="@*, node()">
              <xsl:call-template name="zxd:strip-ns-copy">
                <xsl:with-param name="node" select="."/>
              </xsl:call-template>
            </xsl:for-each>
          </xsl:copy>
        </xsl:for-each>
      </xsl:when>
      <xsl:otherwise> <!-- attribute, text, comment, processing-instruction, namespace: none of these carry namespace declarations of their own -->
        <xsl:copy-of select="$node"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:function name="zxd:strip-unused-namespaces" as="node()*">
    <xsl:param name="node" as="node()*"/>
    <xsl:for-each select="$node">
      <xsl:call-template name="zxd:strip-ns-copy">
        <xsl:with-param name="node" select="."/>
      </xsl:call-template>
    </xsl:for-each>
  </xsl:function>

  <!-- Whether every item in a sequence (a map entry's or array member's
       value, or the top-level value) is a plain atomic value. A sequence
       that's all-atomic is short enough to lay out compactly on one line;
       one holding even a single node, map or array reads better with each
       item on its own line - nodes and attributes in particular tend to
       be too verbose to cram inline. -->
  <xsl:function name="zxd:all-atomic" as="xs:boolean">
    <xsl:param name="items" as="element(xdm:item)*"/>
    <xsl:sequence select="every $i in $items satisfies $i/*[1]/self::xdm:atomic"/>
  </xsl:function>

  <!-- The label for one step in a display-friendly location path: the
       step's own prefix-qualified name as it actually exists in the
       resolved source document (element/attribute names via name(), not
       the doc-independent EQName encoding the reference itself is
       stored as - a resolved node's own name() already is what was
       originally there, no reformatting needed), or text()/comment()/
       processing-instruction(target) for the non-element kinds. A
       disambiguating [N] predicate is added only when another sibling
       of the same kind exists (same element name; same node kind for
       text/comment; same target for a processing-instruction) - the
       common case of an only child of its kind stays as plain as just
       its name, matching xdm-viewer's usual avoid-noise style. -->
  <xsl:function name="zxd:step-label" as="xs:string">
    <xsl:param name="node" as="node()"/>
    <xsl:param name="label" as="xs:string"/>
    <xsl:param name="isLike" as="function(node()) as xs:boolean"/>
    <xsl:variable name="hasOther" as="xs:boolean" select="
      exists($node/preceding-sibling::node()[$isLike(.)]) or
      exists($node/following-sibling::node()[$isLike(.)])"/>
    <xsl:sequence select="
      if (not($hasOther)) then $label
      else $label || '[' || (count($node/preceding-sibling::node()[$isLike(.)]) + 1) || ']'"/>
  </xsl:function>

  <xsl:function name="zxd:step-label-for-node" as="xs:string">
    <xsl:param name="node" as="node()"/>
    <xsl:choose>
      <xsl:when test="$node instance of attribute()">
        <xsl:sequence select="'@' || name($node)"/>
      </xsl:when>
      <xsl:when test="$node instance of namespace-node()">
        <!-- Namespace nodes are unique by prefix within their scope, so
             no two on the same element can ever collide - no
             disambiguating predicate is possible or needed here. -->
        <xsl:sequence select="
          'namespace::' || (if (string-length(name($node)) gt 0) then name($node) else '*default*')"/>
      </xsl:when>
      <xsl:when test="$node instance of text()">
        <xsl:sequence select="
          zxd:step-label($node, 'text()', function($n as node()) as xs:boolean { $n instance of text() })"/>
      </xsl:when>
      <xsl:when test="$node instance of comment()">
        <xsl:sequence select="
          zxd:step-label($node, 'comment()', function($n as node()) as xs:boolean { $n instance of comment() })"/>
      </xsl:when>
      <xsl:when test="$node instance of processing-instruction()">
        <xsl:variable name="target" as="xs:string" select="name($node)"/>
        <xsl:sequence select="
          zxd:step-label($node, 'processing-instruction(' || $target || ')',
            function($n as node()) as xs:boolean { $n instance of processing-instruction() and name($n) eq $target })"/>
      </xsl:when>
      <xsl:otherwise> <!-- element -->
        <xsl:variable name="nm" as="xs:QName" select="node-name($node)"/>
        <xsl:sequence select="
          zxd:step-label($node, name($node),
            function($n as node()) as xs:boolean { $n instance of element() and node-name($n) eq $nm })"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- A concise, namespace-noise-free location string for any node -
       independent of the reference-preserving/document-pool machinery
       zxd:render-node-ref-path-text needs, since it walks
       ancestor-or-self:: directly rather than resolving an
       xdm:node-ref. Built from the same per-step zxd:step-label-for-node
       labels (name()-based, so no full namespace URIs), just without the
       '#N' pool-document prefix, which only makes sense once a node has
       been through the identity-tracking machinery. Handy standalone -
       e.g. as one of xdm:debug's labeled values - to pin down which node
       a value came from without dumping the node itself. -->
  <xsl:function name="xdm:path" as="xs:string">
    <xsl:param name="node" as="node()"/>
    <xsl:sequence select="
      if ($node instance of document-node())
      then '(whole document)'
      else string-join(
        for $n in $node/ancestor-or-self::node()
        return zxd:step-label-for-node($n), '/')"/>
  </xsl:function>

  <!-- The one-line, uncolored location text shown above a resolved
       <xdm:node-ref>'s own rendering: '#N' identifies which pool
       document it resolves against (the Nth distinct document in
       xdm:documents, in the order they appear there - not the document's
       own id/URI, which is often too long to show inline), followed by
       a simplified, non-positional-by-default location within it
       (zxd:step-label-for-node per step). This doesn't explicitly assert
       any relationship between references - it just shows the raw
       addressing, since two references sharing the same text are
       provably the same node (or, for a shared prefix, share that
       ancestor), and the reader is left to make that connection. -->
  <xsl:function name="zxd:render-node-ref-path-text" as="xs:string">
    <xsl:param name="ref" as="element(xdm:node-ref)"/>
    <xsl:variable name="poolDoc" as="element(xdm:pool-doc)" select="
      (root($ref)/xdm:context/xdm:documents/xdm:pool-doc[@id = $ref/@doc])[1]"/>
    <xsl:variable name="docOrdinal" as="xs:integer" select="count($poolDoc/preceding-sibling::xdm:pool-doc) + 1"/>
    <xsl:variable name="path" as="node()+" select="zxd:resolve-node-ref-path($ref)"/>
    <xsl:variable name="location" as="xs:string" select="
      if ($path[1] instance of document-node())
      then '(whole document)'
      else string-join(for $n in $path return zxd:step-label-for-node($n), '/')"/>
    <xsl:sequence select="'#' || $docOrdinal || ' ' || $location"/>
  </xsl:function>

</xsl:stylesheet>
