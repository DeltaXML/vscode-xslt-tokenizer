<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <xsl:variable name="totals" select="
      for $item in items/item
      return
        f:twice($item/@n)"/>
    <out><xsl:value-of select="$totals"/></out>
  </xsl:template>
  <xsl:function name="f:twice">
    <xsl:param name="x"/>
    <xsl:sequence select="$x * 2"/>
  </xsl:function>
</xsl:stylesheet>
