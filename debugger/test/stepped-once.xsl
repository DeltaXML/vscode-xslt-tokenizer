<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:t"><xsl:param name="x"/><xsl:message select="'f:t ' || $x"/><xsl:sequence select="$x * 2"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="v" select="
      f:t(1)"/>
    <out v="{$v}">
      <xsl:value-of select="
        f:t(2),
        f:t(3)"/>
      <xsl:choose>
        <xsl:when test="
          f:t(4) gt 100">big</xsl:when>
        <xsl:otherwise>small</xsl:otherwise>
      </xsl:choose>
      <xsl:call-template name="t">
        <xsl:with-param name="p" select="
          f:t(5)"/>
      </xsl:call-template>
      <xsl:sequence select="
        f:t(6)"/>
      <xsl:sequence select="
        f:t(7),
        f:t(8)"/>
      <xsl:sequence select="
        if (f:t(9) gt 0)
        then f:t(10)
        else 0"/>
    </out>
  </xsl:template>
  <xsl:template name="t"><xsl:param name="p"/><p><xsl:value-of select="$p"/></p></xsl:template>
</xsl:stylesheet>
