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
       Reference-preserving serialization: a distinct, opt-in mode from
       xdm-serializer.xsl/xdm-parser.xsl, producing a different format
       (xdm:context, not a bare xdm:sequence) that documents from parse
       either format do not read.

       A node whose root() is a document-node() is persisted by reference
       into a pooled copy of its whole document, rather than as an inline
       copy - preserving node identity (the same node referenced twice
       comes back as the same node) and full axis navigation (ancestor::,
       following-sibling::, etc. all work on the reconstructed node, since
       it's a real position within a genuinely reconstructed document, not
       a synthetic fragment). A node whose root() is NOT a document-node()
       (a one-off constructed fragment, with no document worth pooling) is
       embedded inline exactly as xdm-serializer.xsl already does.

       A reference is a plain positional path from the pooled document's
       own children down to the node (see zxd:node-path-steps) - not a
       marker attribute + xsl:key lookup. This means the pool is a
       byte-for-byte copy-of the original document, with nothing added to
       it: no xdm:key or any other annotation ever appears in a resolved
       node, since nothing was ever written into the tree to find it.

       Not self-sufficient - relies on xdm-types.xsl and
       xdm-serializer-common.xsl being imported alongside it (see
       xdm-persistence.xsl, the master that does this). Deliberately not
       imported here: xdm-serializer.xsl also imports
       xdm-serializer-common.xsl, and sibling xsl:import declarations in
       the same stylesheet get different (not equal) import precedence -
       importing xdm-types.xsl/xdm-serializer-common.xsl here too would
       create a diamond, and worse, zxd:build-item-seq/build-payload/
       build-map/build-array below share their names with
       xdm-serializer.xsl's own (different) versions of the same
       functions - whichever module ends up with higher import precedence
       would silently shadow the other's, so those four are named with a
       "-refs" suffix here specifically to stay safe to import alongside
       xdm-serializer.xsl regardless of import order.
  -->

  <!-- Pass 1: every node-valued item anywhere in $value whose root() is a
       document-node() - i.e. every reference that needs to be resolved
       against a pooled document rather than embedded inline. The same
       node instance appears once per occurrence it's found at (not
       deduplicated here); zxd:distinct-pool-docs below only needs to
       dedupe by *document*, not by individual referenced node, since the
       whole document is pooled as-is regardless of how many of its nodes
       are actually referenced. Map keys are never node()s (xs:anyAtomicType
       only), so only values need visiting. -->
  <xsl:function name="zxd:collect-doc-refs" as="node()*">
    <xsl:param name="value" as="item()*"/>
    <xsl:for-each select="$value">
      <xsl:sequence select="zxd:collect-doc-refs-from-item(.)"/>
    </xsl:for-each>
  </xsl:function>

  <xsl:function name="zxd:collect-doc-refs-from-item" as="node()*">
    <xsl:param name="item" as="item()"/>
    <xsl:choose>
      <xsl:when test="$item instance of map(*)">
        <xsl:variable name="m" as="map(*)" select="$item"/>
        <xsl:sequence select="for $k in map:keys($m) return zxd:collect-doc-refs($m($k))"/>
      </xsl:when>
      <xsl:when test="$item instance of array(*)">
        <xsl:variable name="a" as="array(*)" select="$item"/>
        <xsl:sequence select="for $i in 1 to array:size($a) return zxd:collect-doc-refs($a($i))"/>
      </xsl:when>
      <xsl:when test="$item instance of node()">
        <xsl:if test="root($item) instance of document-node()">
          <xsl:sequence select="$item"/>
        </xsl:if>
      </xsl:when>
      <xsl:otherwise/> <!-- atomic value: nothing to collect -->
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:eqname-of" as="xs:string">
    <xsl:param name="qname" as="xs:QName"/>
    <xsl:sequence select="'Q{' || namespace-uri-from-QName($qname) || '}' || local-name-from-QName($qname)"/>
  </xsl:function>

  <!-- The positional path from the pooled document's own node() children
       down to $node, as a sequence of step codes (outermost first):
         a plain integer - the 1-based ordinal position of a step among
                            ALL node() children of its parent (works
                            identically whether that parent is the
                            document node itself, at the outermost step,
                            or an element at any deeper step)
         '@Q{uri}local'   - an attribute, addressed by EQName (immune to
                            which prefix, if any, the source document
                            used) - only ever the last step
         '{prefix}uri'    - a namespace node (prefix is '' for the
                            default namespace) - only ever the last step
       $node itself being a document-node() (referenced directly, not a
       node within one) is the one case with zero steps - resolved by
       reconstructing a document node from the whole pool entry. -->
  <xsl:function name="zxd:node-path-steps" as="xs:string*">
    <xsl:param name="node" as="node()"/>
    <xsl:choose>
      <xsl:when test="$node instance of document-node()">
        <xsl:sequence select="()"/>
      </xsl:when>
      <xsl:when test="$node instance of attribute()">
        <xsl:sequence select="(zxd:node-path-steps($node/parent::*), '@' || zxd:eqname-of(node-name($node)))"/>
      </xsl:when>
      <xsl:when test="$node instance of namespace-node()">
        <xsl:sequence select="(zxd:node-path-steps($node/parent::*), '{' || name($node) || '}' || string($node))"/>
      </xsl:when>
      <xsl:otherwise> <!-- element, text, comment or processing-instruction -->
        <xsl:variable name="ord" as="xs:string" select="string(count($node/preceding-sibling::node()) + 1)"/>
        <xsl:variable name="parent" as="element()?" select="$node/parent::*"/>
        <xsl:sequence select="if (exists($parent)) then (zxd:node-path-steps($parent), $ord) else $ord"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- $doc's own URI, but only if it's a real one (e.g. read via doc()) -
       the empty sequence for a document with no URI, or an empty-string
       one (Saxon can return either for a constructed document, depending
       on how it was built). Used both by zxd:doc-id below and by
       zxd:build-documents-pool to decide whether a pool entry should
       carry an xml:base attribute. -->
  <xsl:function name="zxd:real-doc-uri" as="xs:string?">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:variable name="uri" as="xs:string?" select="document-uri($doc)"/>
    <xsl:sequence select="if (exists($uri) and string-length($uri) gt 0) then $uri else ()"/>
  </xsl:function>

  <!-- Identifies a pooled document itself: its real URI when it has one,
       otherwise a generated id stable for the lifetime of this
       serialize() call. -->
  <xsl:function name="zxd:doc-id" as="xs:string">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:sequence select="
      let $uri := zxd:real-doc-uri($doc)
      return if (exists($uri)) then $uri else generate-id($doc)"/>
  </xsl:function>

  <!-- The <xdm:node-ref> marker that replaces an inline copy of $node in
       the xdm:sequence part of the output: which pool entry to resolve
       against, plus the positional path within it (zxd:node-path-steps),
       one <xdm:step> per path segment, in order. -->
  <xsl:function name="zxd:build-node-ref" as="element(xdm:node-ref)">
    <xsl:param name="node" as="node()"/>
    <xdm:node-ref doc="{zxd:doc-id(root($node))}">
      <xsl:for-each select="zxd:node-path-steps($node)">
        <xdm:step pos="{.}"/>
      </xsl:for-each>
    </xdm:node-ref>
  </xsl:function>

  <!-- The distinct (by identity) documents referenced anywhere in $refs -
       one pool entry per document, however many nodes within it are
       actually referenced. -->
  <xsl:function name="zxd:distinct-pool-docs" as="document-node()*">
    <xsl:param name="refs" as="node()*"/>
    <xsl:variable name="roots" as="document-node()*" select="for $r in $refs return root($r)"/>
    <xsl:sequence select="$roots | $roots"/>
  </xsl:function>

  <!-- The whole xdm:documents pool: one xdm:pool-doc per distinct
       referenced document (id = zxd:doc-id, the document's own URI when
       it has one), each holding a plain, unannotated copy of that
       document's own node() children - nothing is added to the tree, so
       a node resolved from it is indistinguishable from the original.

       When the document has a real URI, xml:base carries it too (in
       addition to, not instead of, the id attribute - id is a purely
       private lookup key, safe to be an opaque generate-id() token, and
       must stay that way even when a real URI isn't available; xml:base
       is the standards-defined way to say "everything under here has
       this base URI", restoring correct base-uri() for a resolved node,
       which would otherwise default to wherever this stylesheet's own
       xsl:document construction happened rather than the original
       source's location). Only ever on xdm:pool-doc itself, never copied
       onto the actual content beneath it - resolved nodes see it only
       through base-uri()'s normal inheritance, never as a literal
       attribute of their own. -->
  <xsl:function name="zxd:build-documents-pool" as="element(xdm:documents)">
    <xsl:param name="refs" as="node()*"/>
    <xdm:documents>
      <xsl:for-each select="zxd:distinct-pool-docs($refs)">
        <xsl:variable name="uri" as="xs:string?" select="zxd:real-doc-uri(.)"/>
        <xdm:pool-doc id="{zxd:doc-id(.)}">
          <xsl:if test="exists($uri)">
            <xsl:attribute name="xml:base" select="$uri"/>
          </xsl:if>
          <xsl:copy-of select="./node()"/>
        </xdm:pool-doc>
      </xsl:for-each>
    </xdm:documents>
  </xsl:function>

  <!-- The value-tree builder: structurally the same map(*)/array(*)/
       atomic dispatch as xdm-serializer.xsl's zxd:build-item-seq/
       zxd:build-payload/zxd:build-map/zxd:build-array (duplicated rather
       than shared, since the one thing that must differ - what a node
       turns into - can't be swapped in without either changing that
       already-shipped format or threading a function parameter through
       proven code for a mode most callers won't use); only the node
       branch itself is new: a reference for anything document-rooted,
       zxd:build-node (shared) for everything else. Named with a "-refs"
       suffix (unlike the shared helpers above) because xdm-serializer.xsl
       declares its own, different functions with these same base names -
       see the header comment on why that matters when both modules are
       imported together. -->
  <xsl:function name="zxd:build-item-seq-refs" as="element(xdm:item)*">
    <xsl:param name="items" as="item()*"/>
    <xsl:for-each select="$items">
      <xdm:item>
        <xsl:sequence select="zxd:build-payload-refs(.)"/>
      </xdm:item>
    </xsl:for-each>
  </xsl:function>

  <xsl:function name="zxd:build-payload-refs" as="element()">
    <xsl:param name="item" as="item()"/>
    <xsl:variable name="nodeKind" as="xs:string?" select="zxd:node-kind($item)"/>
    <xsl:choose>
      <xsl:when test="exists($nodeKind) and root($item) instance of document-node()">
        <xsl:sequence select="zxd:build-node-ref($item)"/>
      </xsl:when>
      <xsl:when test="exists($nodeKind)">
        <xsl:sequence select="zxd:build-node($item, $nodeKind)"/>
      </xsl:when>
      <xsl:when test="$item instance of map(*)">
        <xsl:sequence select="zxd:build-map-refs($item)"/>
      </xsl:when>
      <xsl:when test="$item instance of array(*)">
        <xsl:sequence select="zxd:build-array-refs($item)"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:sequence select="zxd:build-atomic($item)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <xsl:function name="zxd:build-map-refs" as="element(xdm:map)">
    <xsl:param name="m" as="map(*)"/>
    <xdm:map>
      <xsl:for-each select="map:keys($m)">
        <xsl:variable name="k" as="xs:anyAtomicType" select="."/>
        <xsl:variable name="keyType" as="xs:string" select="zxd:type-name($k)"/>
        <xdm:entry key="{zxd:atomic-lexical($k)}" key-type="{$keyType}">
          <xsl:if test="$keyType eq 'xs:QName' and string-length(namespace-uri-from-QName($k)) gt 0">
            <xsl:attribute name="key-uri" select="namespace-uri-from-QName($k)"/>
          </xsl:if>
          <xsl:sequence select="zxd:build-item-seq-refs($m($k))"/>
        </xdm:entry>
      </xsl:for-each>
    </xdm:map>
  </xsl:function>

  <xsl:function name="zxd:build-array-refs" as="element(xdm:array)">
    <xsl:param name="a" as="array(*)"/>
    <xdm:array>
      <xsl:for-each select="1 to array:size($a)">
        <xdm:member>
          <xsl:sequence select="zxd:build-item-seq-refs($a(.))"/>
        </xdm:member>
      </xsl:for-each>
    </xdm:array>
  </xsl:function>

  <!-- Entry point. xdm:context (not a bare xdm:sequence, unlike
       xdm-serializer.xsl's format) wraps both the value tree and the
       document pool it references into. -->
  <xsl:function name="xdm:to-document-with-refs" as="document-node()">
    <xsl:param name="value" as="item()*"/>
    <xsl:variable name="refs" as="node()*" select="zxd:collect-doc-refs($value)"/>
    <xsl:document>
      <xdm:context xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xdm:sequence>
          <xsl:sequence select="zxd:build-item-seq-refs($value)"/>
        </xdm:sequence>
        <xsl:sequence select="zxd:build-documents-pool($refs)"/>
      </xdm:context>
    </xsl:document>
  </xsl:function>

</xsl:stylesheet>
