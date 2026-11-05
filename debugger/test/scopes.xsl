<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <xsl:param name="p" select="'param'"/>
    <xsl:variable name="x" select="'outer'"/>
    <xsl:if test="true()">
      <xsl:variable name="in-if" select="'if'"/>
      <if><xsl:value-of select="$in-if"/></if>
    </xsl:if>
    <xsl:for-each select="items/item">
      <before n="{@n}"/>
      <xsl:variable name="later" select="'later-' || @n"/>
      <xsl:variable name="x" select="'inner-' || @n"/>
      <inner x="{$x}" later="{$later}"/>
    </xsl:for-each>
    <after x="{$x}" p="{$p}"/>
    <xsl:variable name="tens" select="
      for $x in (1, 2)
      return
        $x * 10"/>
    <tens><xsl:value-of select="$tens"/></tens>
  </xsl:template>
</xsl:stylesheet>
