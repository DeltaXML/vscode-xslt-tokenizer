<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:mode on-no-match="shallow-skip"/>
  <xsl:template match="order">
    <o><xsl:apply-templates select="@*, node()"/></o>
  </xsl:template>
  <xsl:template match="line" priority="2">
    <xsl:next-match/>
    <xsl:apply-templates select="@product" mode="attr"/>
    <xsl:apply-templates select="doc('node-rules-products.xml')//product"/>
  </xsl:template>
  <xsl:template match="line">
    <l><xsl:apply-templates/></l>
  </xsl:template>
  <xsl:template match="@product" mode="attr"><xsl:value-of select="."/></xsl:template>
  <xsl:template match="text()[normalize-space()]"><xsl:value-of select="."/></xsl:template>
  <xsl:template match="product">P<xsl:variable name="temp"><t/></xsl:variable><xsl:apply-templates select="$temp/t"/><xsl:variable name="parentless" as="element()"><u/></xsl:variable><xsl:apply-templates select="$parentless"/></xsl:template>
  <xsl:template match="t">T</xsl:template>
</xsl:stylesheet>
