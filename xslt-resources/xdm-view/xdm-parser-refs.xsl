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
       Reads back the xdm:context tree produced by xdm-serializer-refs.xsl.
       A distinct, opt-in mode from xdm-parser.xsl - does not read that
       format's plain xdm:sequence documents, and xdm-parser.xsl does not
       read this one's.

       Node identity is preserved for repeated references (xdm:from-document(a) is
       xdm:from-document(b) holds when a and b referenced the same original node),
       since every reference resolves against the one already-parsed pool
       document rather than being copied. A reference is resolved by
       walking a plain positional path (see xdm-serializer-refs.xsl's
       zxd:node-path-steps) down an untouched, unannotated copy of the
       original document - nothing was ever written into the pool to find
       a node, so a resolved node is indistinguishable from the original
       (no xdm:key or other marker attribute ever appears in it).

       xdm:from-document-with-refs builds one document-node() per pool entry up
       front (zxd:build-whole-docs-map), once per call, and every
       resolution within that call navigates from those same nodes rather
       than constructing its own - so two references to a document-node()
       itself (not just to nodes within one) also come back identical, and
       root() of any resolved node is a clean reconstruction of just its
       own source document, not the whole persisted file. This can't be a
       stylesheet-level global: xdm:from-document-with-refs may be called on
       different persisted documents at different points in one
       transformation, and a single global computed once would tie the
       cache to whichever $doc triggered it first.

       zxd:resolve-node-ref/1 (no $wholeDocs map) is kept as a separate,
       standalone entry point for a caller - such as xdm-viewer, resolving
       one <xdm:node-ref> at a time outside any parse-with-refs call - that
       has no such map to pass in and doesn't need cross-reference
       identity for its use case; it still constructs its own document
       node per call, same as before this was added.

       Not self-sufficient - relies on xdm-types.xsl and
       xdm-parser-common.xsl being imported alongside it (see
       xdm-persistence.xsl, the master that does this). Deliberately not
       imported here: xdm-parser.xsl also imports xdm-parser-common.xsl,
       and sibling xsl:import declarations in the same stylesheet get
       different (not equal) import precedence - importing xdm-types.xsl/
       xdm-parser-common.xsl here too would create a diamond, and worse,
       zxd:parse-item-seq/parse-item/parse-atomic/parse-map/parse-key/
       parse-array below share their names with xdm-parser.xsl's own
       (different) versions of the same functions - whichever module ends
       up with higher import precedence would silently shadow the
       other's, so those are named with a "-refs" suffix here
       specifically to stay safe to import alongside xdm-parser.xsl
       regardless of import order.
  -->

  <xsl:function name="xdm:from-document-with-refs" as="item()*">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:variable name="wholeDocs" as="map(*)" select="zxd:build-whole-docs-map($doc)"/>
    <xsl:sequence select="zxd:parse-item-seq-refs($doc/xdm:context/xdm:sequence/xdm:item, $wholeDocs)"/>
  </xsl:function>

  <!-- One document-node() per pool entry, keyed by @id, built exactly
       once per xdm:from-document-with-refs call and threaded through the whole
       resolution chain below - see the header comment. -->
  <xsl:function name="zxd:build-whole-docs-map" as="map(*)">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:map>
      <xsl:for-each select="$doc/xdm:context/xdm:documents/xdm:pool-doc">
        <xsl:map-entry key="string(@id)" select="zxd:build-whole-doc(.)"/>
      </xsl:for-each>
    </xsl:map>
  </xsl:function>

  <xsl:function name="zxd:build-whole-doc" as="document-node()">
    <xsl:param name="poolDoc" as="element(xdm:pool-doc)"/>
    <xsl:document>
      <xsl:sequence select="$poolDoc/node()"/>
    </xsl:document>
  </xsl:function>

  <!-- Named with a "-refs" suffix (unlike the shared helpers imported
       from xdm-parser-common.xsl) because xdm-parser.xsl declares its
       own, different functions with these same base names - see the
       header comment on why that matters when both modules are imported
       together. -->
  <xsl:function name="zxd:parse-item-seq-refs" as="item()*">
    <xsl:param name="items" as="element(xdm:item)*"/>
    <xsl:param name="wholeDocs" as="map(*)"/>
    <xsl:for-each select="$items">
      <xsl:sequence select="zxd:parse-item-refs(., $wholeDocs)"/>
    </xsl:for-each>
  </xsl:function>

  <xsl:function name="zxd:parse-item-refs" as="item()*">
    <xsl:param name="item" as="element(xdm:item)"/>
    <xsl:param name="wholeDocs" as="map(*)"/>
    <xsl:variable name="payload" as="element()" select="$item/*[1]"/>
    <xsl:choose>
      <xsl:when test="$payload/self::xdm:node-ref">
        <xsl:sequence select="zxd:resolve-node-ref($payload, $wholeDocs)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:atomic">
        <xsl:sequence select="zxd:parse-atomic-refs($payload)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:map">
        <xsl:sequence select="zxd:parse-map-refs($payload, $wholeDocs)"/>
      </xsl:when>
      <xsl:when test="$payload/self::xdm:array">
        <xsl:sequence select="zxd:parse-array-refs($payload, $wholeDocs)"/>
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

  <xsl:function name="zxd:parse-atomic-refs" as="xs:anyAtomicType">
    <xsl:param name="atomicEl" as="element(xdm:atomic)"/>
    <xsl:variable name="type" as="xs:string" select="zxd:resolve-type-name($atomicEl/@type)"/>
    <xsl:sequence select="
      if ($type eq 'xs:QName') then zxd:cast-qname($atomicEl/@uri, string($atomicEl))
      else zxd:cast-atomic($type, string($atomicEl))"/>
  </xsl:function>

  <xsl:function name="zxd:parse-map-refs" as="map(*)">
    <xsl:param name="mapEl" as="element(xdm:map)"/>
    <xsl:param name="wholeDocs" as="map(*)"/>
    <xsl:sequence select="
      map:merge(
        for $entry in $mapEl/xdm:entry
        return map:entry(zxd:parse-key-refs($entry), zxd:parse-item-seq-refs($entry/xdm:item, $wholeDocs)))"/>
  </xsl:function>

  <xsl:function name="zxd:parse-key-refs" as="xs:anyAtomicType">
    <xsl:param name="entry" as="element(xdm:entry)"/>
    <xsl:variable name="keyType" as="xs:string" select="zxd:resolve-type-name($entry/@key-type)"/>
    <xsl:sequence select="
      if ($keyType eq 'xs:QName') then zxd:cast-qname($entry/@key-uri, string($entry/@key))
      else zxd:cast-atomic($keyType, string($entry/@key))"/>
  </xsl:function>

  <xsl:function name="zxd:parse-array-refs" as="array(*)">
    <xsl:param name="arrayEl" as="element(xdm:array)"/>
    <xsl:param name="wholeDocs" as="map(*)"/>
    <xsl:sequence select="
      fold-left($arrayEl/xdm:member, array{},
        function($acc, $m) { array:append($acc, zxd:parse-item-seq-refs($m/xdm:item, $wholeDocs)) })"/>
  </xsl:function>

  <!-- Resolves one <xdm:node-ref doc="..."><xdm:step pos="..."/>...</xdm:node-ref>
       marker back to the actual node it addresses, per
       xdm-serializer-refs.xsl's zxd:node-path-steps scheme: find the pool
       entry for @doc, then walk its <xdm:step> children in order,
       descending one level per step.

       Standalone form: builds its own document node for this one call
       (see the header comment) - for a caller with no $wholeDocs map to
       pass in and no need for cross-reference identity, e.g. xdm-viewer
       resolving one <xdm:node-ref> at a time. -->
  <xsl:function name="zxd:resolve-node-ref" as="node()">
    <xsl:param name="ref" as="element(xdm:node-ref)"/>
    <xsl:variable name="poolDoc" as="element(xdm:pool-doc)" select="zxd:pool-doc-by-id(string($ref/@doc), root($ref))"/>
    <xsl:variable name="steps" as="xs:string*" select="$ref/xdm:step/string(@pos)"/>
    <xsl:sequence select="zxd:navigate-from-doc($poolDoc, $steps)"/>
  </xsl:function>

  <!-- The form xdm:from-document-with-refs actually uses: $wholeDocs is the map
       built once by zxd:build-whole-docs-map, so every resolution within
       one xdm:from-document-with-refs call navigates from the same document
       nodes rather than each constructing its own. -->
  <xsl:function name="zxd:resolve-node-ref" as="node()">
    <xsl:param name="ref" as="element(xdm:node-ref)"/>
    <xsl:param name="wholeDocs" as="map(*)"/>
    <xsl:variable name="wholeDoc" as="document-node()" select="$wholeDocs(string($ref/@doc))"/>
    <xsl:variable name="steps" as="xs:string*" select="$ref/xdm:step/string(@pos)"/>
    <xsl:sequence select="zxd:navigate-from-whole-doc($wholeDoc, $steps)"/>
  </xsl:function>

  <!-- Zero steps (a direct document-node() reference) needs no navigation
       at all - $wholeDoc already *is* the resolved node, the same one
       every other reference to this pool entry gets back too. -->
  <xsl:function name="zxd:navigate-from-whole-doc" as="node()">
    <xsl:param name="wholeDoc" as="document-node()"/>
    <xsl:param name="steps" as="xs:string*"/>
    <xsl:choose>
      <xsl:when test="empty($steps)">
        <xsl:sequence select="$wholeDoc"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="first" as="node()" select="($wholeDoc/node())[xs:integer($steps[1])]"/>
        <xsl:sequence select="zxd:navigate-from-node($first, subsequence($steps, 2))"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:pool-doc-by-id" as="element(xdm:pool-doc)">
    <xsl:param name="id" as="xs:string"/>
    <xsl:param name="doc" as="document-node()"/>
    <xsl:sequence select="($doc/xdm:context/xdm:documents/xdm:pool-doc[@id = $id])[1]"/>
  </xsl:function>

  <!-- The outermost step, if any, selects among the pool entry's own
       node() children (xdm:pool-doc/node() corresponds 1:1, in order, to
       the original document's own node() children, since the pool was
       built with a plain xsl:copy-of). Zero steps means the reference was
       to the document-node() itself - reconstructed fresh, see the header
       comment's note on identity for that one case. -->
  <xsl:function name="zxd:navigate-from-doc" as="node()">
    <xsl:param name="poolDoc" as="element(xdm:pool-doc)"/>
    <xsl:param name="steps" as="xs:string*"/>
    <xsl:choose>
      <xsl:when test="empty($steps)">
        <xsl:document>
          <xsl:sequence select="$poolDoc/node()"/>
        </xsl:document>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="first" as="node()" select="($poolDoc/node())[xs:integer($steps[1])]"/>
        <xsl:sequence select="zxd:navigate-from-node($first, subsequence($steps, 2))"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- Every subsequent step descends one level further from $node: an
       ordinal step moves to ($node/node())[pos], an '@'/'{' step (only
       ever the last one) selects an attribute or namespace node of
       $node - which must therefore be the last step, since neither kind
       has children of its own. -->
  <xsl:function name="zxd:navigate-from-node" as="node()">
    <xsl:param name="node" as="node()"/>
    <xsl:param name="steps" as="xs:string*"/>
    <xsl:choose>
      <xsl:when test="empty($steps)">
        <xsl:sequence select="$node"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="step" as="xs:string" select="$steps[1]"/>
        <xsl:variable name="next" as="node()" select="
          if (starts-with($step, '@')) then zxd:find-attribute-by-eqname($node, substring($step, 2))
          else if (starts-with($step, '{')) then zxd:find-namespace-by-marker($node, $step)
          else ($node/node())[xs:integer($step)]"/>
        <xsl:sequence select="zxd:navigate-from-node($next, subsequence($steps, 2))"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- $eqname is the step's code with its leading '@' already stripped,
       e.g. 'Q{http://example.com/foo}attr' or 'Q{}plain'. -->
  <xsl:function name="zxd:find-attribute-by-eqname" as="attribute()">
    <xsl:param name="node" as="node()"/>
    <xsl:param name="eqname" as="xs:string"/>
    <xsl:variable name="uri" as="xs:string" select="substring-before(substring-after($eqname, 'Q{'), '}')"/>
    <xsl:variable name="local" as="xs:string" select="substring-after($eqname, '}')"/>
    <xsl:sequence select="($node/@*[namespace-uri(.) eq $uri and local-name(.) eq $local])[1]"/>
  </xsl:function>

  <!-- $marker is the full step code, e.g. '{foo}http://example.com/foo'. -->
  <xsl:function name="zxd:find-namespace-by-marker" as="namespace-node()">
    <xsl:param name="node" as="node()"/>
    <xsl:param name="marker" as="xs:string"/>
    <xsl:variable name="prefix" as="xs:string" select="substring-before(substring-after($marker, '{'), '}')"/>
    <xsl:sequence select="($node/namespace::*[name() eq $prefix])[1]"/>
  </xsl:function>

  <!-- Like zxd:resolve-node-ref, but returns every node visited along the
       way - one per <xdm:step>, outermost first, the final resolved node
       last - rather than only the target. For a consumer like
       xdm-viewer building a human-readable location (e.g. an element
       chain with disambiguating positions, ending in an attribute or a
       processing-instruction()), each intermediate node's own name/kind
       is needed, not just where the path ends up.

       Deliberately a separate set of functions from
       zxd:resolve-node-ref/zxd:navigate-from-doc/zxd:navigate-from-node
       rather than reusing them: those are on xdm:from-document-with-refs's hot
       path (real value reconstruction) and have no reason to pay for
       accumulating intermediates nothing there needs; this is an
       additive, display-oriented entry point. -->
  <xsl:function name="zxd:resolve-node-ref-path" as="node()+">
    <xsl:param name="ref" as="element(xdm:node-ref)"/>
    <xsl:variable name="poolDoc" as="element(xdm:pool-doc)" select="zxd:pool-doc-by-id(string($ref/@doc), root($ref))"/>
    <xsl:variable name="steps" as="xs:string*" select="$ref/xdm:step/string(@pos)"/>
    <xsl:sequence select="zxd:navigate-from-doc-path($poolDoc, $steps)"/>
  </xsl:function>

  <!-- Zero steps (a direct document-node() reference) has no intermediate
       nodes to report - the single reconstructed document node is both
       the first and last (only) entry. -->
  <xsl:function name="zxd:navigate-from-doc-path" as="node()+">
    <xsl:param name="poolDoc" as="element(xdm:pool-doc)"/>
    <xsl:param name="steps" as="xs:string*"/>
    <xsl:choose>
      <xsl:when test="empty($steps)">
        <xsl:document>
          <xsl:sequence select="$poolDoc/node()"/>
        </xsl:document>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="first" as="node()" select="($poolDoc/node())[xs:integer($steps[1])]"/>
        <xsl:sequence select="zxd:navigate-from-node-path($first, subsequence($steps, 2))"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:navigate-from-node-path" as="node()+">
    <xsl:param name="node" as="node()"/>
    <xsl:param name="steps" as="xs:string*"/>
    <xsl:choose>
      <xsl:when test="empty($steps)">
        <xsl:sequence select="$node"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="step" as="xs:string" select="$steps[1]"/>
        <xsl:variable name="next" as="node()" select="
          if (starts-with($step, '@')) then zxd:find-attribute-by-eqname($node, substring($step, 2))
          else if (starts-with($step, '{')) then zxd:find-namespace-by-marker($node, $step)
          else ($node/node())[xs:integer($step)]"/>
        <xsl:sequence select="($node, zxd:navigate-from-node-path($next, subsequence($steps, 2)))"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

</xsl:stylesheet>
