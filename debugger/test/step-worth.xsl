<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:twice"><xsl:param name="x"/><xsl:sequence select="$x * 2"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="n" select="2"/>
    <xsl:variable name="ors" select="
      $n eq 1 or
      $n eq 3 or
      $n eq 2"/>
    <xsl:variable name="literals" select="
      if ($n eq 2)
      then 'two'
      else 'other'"/>
    <xsl:variable name="branches" select="
      if ($n eq 2)
      then string($n)
      else string($n + 1)"/>
    <xsl:variable name="let" select="
      let $m := $n + 1
      return $m * $m"/>
    <xsl:variable name="call" select="
      $n +
      f:twice($n)"/>
    <xsl:variable name="end" select="1"/>
    <out ors="{$ors}" literals="{$literals}" branches="{$branches}" let="{$let}" call="{$call}"/>
  </xsl:template>
</xsl:stylesheet>
