<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" exclude-result-prefixes="#all">
  <xsl:mode name="copy" on-no-match="shallow-copy"/><xsl:mode name="drop" on-no-match="deep-skip"/>
  <xsl:template match="/">
    <out>
      <xsl:apply-templates select="items/item"/>
      <xsl:apply-templates select="items" mode="copy"/><xsl:apply-templates select="items/item" mode="drop"/>
    </out>
  </xsl:template>
  <xsl:template match="item[@n = 1]" mode="#default drop">
    <one/>
  </xsl:template>
</xsl:stylesheet>
