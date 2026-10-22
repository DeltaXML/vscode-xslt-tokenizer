<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:twice"><xsl:param name="x"/><xsl:message select="'twice ' || $x"/><xsl:sequence select="$x * 2"/></xsl:function>
  <xsl:function name="f:add"><xsl:param name="x"/><xsl:param name="y"/><xsl:sequence select="$x + $y"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="n" select="3"/>
    <xsl:variable name="one" select="
      $n
      => f:twice()"/>
    <xsl:variable name="chain" select="
      $n
      => f:twice()
      => f:add(100)"/>
    <xsl:variable name="builtin" select="
      (1, 2, 3)
      => string-join('-')"/>
    <xsl:variable name="end" select="1"/>
    <out one="{$one}" chain="{$chain}" builtin="{$builtin}"/>
  </xsl:template>
</xsl:stylesheet>
