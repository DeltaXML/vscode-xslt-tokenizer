<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="#all">
  <xsl:param name="factor" select="10"/>
  <xsl:template match="/">
    <out><xsl:apply-templates select="items/item"/></out>
  </xsl:template>
  <xsl:template match="item">
    <xsl:variable name="n" select="xs:integer(@n)"/>
    <xsl:variable name="scaled" select="
      for $i in 1 to $n
      return
        $i * $factor"/>
    <x><xsl:value-of select="$scaled"/></x>
  </xsl:template>
</xsl:stylesheet>
