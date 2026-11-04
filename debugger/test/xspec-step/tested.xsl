<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:t="urn:t">
  <xsl:function name="t:total">
    <xsl:param name="items"/>
    <xsl:param name="extra"/>
    <xsl:variable name="sum" select="sum($items)"/>
    <xsl:sequence select="$sum + $extra"/>
  </xsl:function>
</xsl:stylesheet>
