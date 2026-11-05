<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:add"><xsl:param name="x"/><xsl:param name="y"/><xsl:message select="'add ' || $x || ' ' || $y"/><xsl:sequence select="$x + $y"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="add10" select="f:add(?, 10)"/>
    <xsl:variable name="direct" select="
      $add10(5)"/>
    <xsl:variable name="mapped" select="
      for-each((1, 2),
        f:add(?, 100))"/>
    <xsl:variable name="builtin" select="
      for-each(('a', 'b'),
        concat(?, '!'))"/>
    <xsl:variable name="end" select="1"/>
    <out direct="{$direct}" mapped="{$mapped}" builtin="{$builtin}"/>
  </xsl:template>
</xsl:stylesheet>
