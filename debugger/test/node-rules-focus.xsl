<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <r>
      <xsl:for-each select="orders/order">
        <xsl:value-of select="@id"/>
      </xsl:for-each>
      <xsl:for-each-group select="//line" group-by="@product, 'all'">
        <xsl:for-each select="current-group()">
          <xsl:value-of select="@product"/>
        </xsl:for-each>
      </xsl:for-each-group>
      <xsl:iterate select="//line/@product">
        <xsl:value-of select="."/>
      </xsl:iterate>
      <xsl:for-each select="(//order)[1], (//order)[1]">
        <xsl:apply-templates select="."/>
      </xsl:for-each>
    </r>
  </xsl:template>
  <xsl:template match="order">o</xsl:template>
</xsl:stylesheet>
