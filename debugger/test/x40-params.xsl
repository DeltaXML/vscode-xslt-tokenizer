<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:t"><xsl:param name="x"/><xsl:message select="'t ' || $x"/><xsl:sequence select="$x"/></xsl:function>
  <xsl:function name="f:g">
    <xsl:param name="x"/>
    <xsl:param name="y" required="no" select="10"/>
    <xsl:message select="'g ' || $x || ' ' || $y"/>
    <xsl:sequence select="$x + $y"/>
  </xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="a" select="f:g(1)"/>
    <xsl:variable name="b" select="f:g(1, 2)"/>
    <xsl:variable name="c" select="f:g(y := 5, x := 1)"/>
    <out a="{$a}" b="{$b}" c="{$c}"/>
  </xsl:template>
</xsl:stylesheet>
