<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                exclude-result-prefixes="xsl xdm"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       The master module: the one file to import for either serialization
       mode. None of the modules below are self-sufficient on their own
       (see each one's own header comment) - this is the single place
       that assembles the whole dependency graph, with each module
       imported exactly once, so there's no diamond-import warning and no
       risk of the two modes' same-named internal helpers shadowing one
       another via import precedence (see xdm-serializer-refs.xsl's and
       xdm-parser-refs.xsl's header comments for why that matters).

       Provides both:
         xdm:to-document / xdm:from-document                     - the default,
           deep-equal-only mode (xdm-serializer.xsl / xdm-parser.xsl).
         xdm:to-document-with-refs / xdm:from-document-with-refs  - the opt-in,
           reference-preserving mode (xdm-serializer-refs.xsl /
           xdm-parser-refs.xsl), a distinct format from the default mode
           that also preserves node identity and axis navigation across
           references into the same source document.

       Plus xdm:from-any-document/xdm:is-refs-format below, which is why this
       needs to be more than an import-only aggregator: a reader handed
       an arbitrary persisted document (e.g. a generic viewer) shouldn't
       need out-of-band knowledge of which mode wrote it, but detecting
       that requires both formats to be in scope at once - something
       neither xdm-parser.xsl nor xdm-parser-refs.xsl can do on their
       own, since they're deliberately kept unaware of each other. A
       writer never needs the equivalent: it always knows which mode it
       chose, so there's no xdm:serialize-any.
  -->

  <xsl:import href="xdm-types.xsl"/>
  <xsl:import href="xdm-serializer-common.xsl"/>
  <xsl:import href="xdm-parser-common.xsl"/>
  <xsl:import href="xdm-serializer.xsl"/>
  <xsl:import href="xdm-parser.xsl"/>
  <xsl:import href="xdm-serializer-refs.xsl"/>
  <xsl:import href="xdm-parser-refs.xsl"/>

  <!-- True if $doc is the reference-preserving format (xdm-serializer-refs.xsl's
       xdm:context root), false if it's the default format (xdm-serializer.xsl's
       xdm:sequence root) or anything else unrecognized - exposed separately
       from xdm:from-any-document (rather than folded invisibly into it) so a caller
       that needs to branch its own logic on which format a document is,
       such as a viewer choosing how to render it, doesn't need to re-derive
       this check itself. -->
  <xsl:function name="xdm:is-refs-format" as="xs:boolean">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:sequence select="exists($doc/xdm:context)"/>
  </xsl:function>

  <!-- Parses a document written by either xdm:to-document or
       xdm:to-document-with-refs, without the caller needing to know in
       advance which one produced it. -->
  <xsl:function name="xdm:from-any-document" as="item()*">
    <xsl:param name="doc" as="document-node()"/>
    <xsl:choose>
      <xsl:when test="xdm:is-refs-format($doc)">
        <xsl:sequence select="xdm:from-document-with-refs($doc)"/>
      </xsl:when>
      <xsl:when test="exists($doc/xdm:sequence)">
        <xsl:sequence select="xdm:from-document($doc)"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:message terminate="yes" select="
          'xdm:from-any-document: not a recognized xdm-persistence document ' ||
          '(expected xdm:sequence or xdm:context as the root element)'"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>

</xsl:stylesheet>
