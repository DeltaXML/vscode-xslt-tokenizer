<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:twice"><xsl:param name="x"/><xsl:message select="'twice ' || $x"/><xsl:sequence select="$x * 2"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="pairs" select="
      for $a in (1, 2),
          $b in (10, 20)
      return $a + $b"/>
    <xsl:variable name="calls" select="
      for $x in (1, 2)
      return f:twice($x)"/>
    <xsl:variable name="some" select="
      some $x in (1, 2, 3)
      satisfies $x gt 1"/>
    <xsl:variable name="every" select="
      every $x in (1, 2, 3)
      satisfies $x gt 1"/>
    <xsl:variable name="end" select="1"/>
    <out pairs="{$pairs}" calls="{$calls}" some="{$some}" every="{$every}"/>
  </xsl:template>
</xsl:stylesheet>
