<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <out>
      <xsl:apply-templates select="items/item"/>
    </out>
  </xsl:template>
  <xsl:template match="item">
    <xsl:variable name="total" select="
      f:twice(
        @n
      )"/>
    <xsl:choose>
      <xsl:when test="@n = 1"><one/></xsl:when>
      <xsl:otherwise><other total="{$total}"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>
  <xsl:function name="f:twice">
    <xsl:param name="x"/>
    <xsl:sequence select="$x * 2"/>
  </xsl:function>
</xsl:stylesheet>
