<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:twice"><xsl:param name="x"/><xsl:sequence select="$x * 2"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="doc"><r><a n="1"/><a n="2"/><a n="3"/></r></xsl:variable>
    <xsl:variable name="map" select="
      $doc/r/a
      ! (@n * 10)"/>
    <xsl:variable name="path" select="
      $doc/r
      /a
      /@n"/>
    <xsl:variable name="call" select="
      $doc/r/a
      ! f:twice(@n)"/>
    <xsl:variable name="filter" select="
      $doc/r/a
      [number(@n) gt 1]"/>
    <xsl:variable name="end" select="1"/>
    <out map="{$map}" path="{$path}" call="{$call}" filter="{count($filter)}"/>
  </xsl:template>
</xsl:stylesheet>
