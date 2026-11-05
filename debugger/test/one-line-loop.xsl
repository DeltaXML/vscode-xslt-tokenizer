<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <out>
      <xsl:for-each select="items/item"><y n="{@n}"/><xsl:value-of select="@n"/></xsl:for-each>
      <end/>
    </out>
  </xsl:template>
</xsl:stylesheet>
