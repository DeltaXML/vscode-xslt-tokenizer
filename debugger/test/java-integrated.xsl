<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:d="urn:demo" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <xsl:variable name="names" select="items/item/@n ! string()"/>
    <xsl:variable name="shouted" select="
      for $n in $names
      return
        d:shout('item ' || $n)"/>
    <out><xsl:value-of select="$shouted" separator=", "/></out>
  </xsl:template>
</xsl:stylesheet>
