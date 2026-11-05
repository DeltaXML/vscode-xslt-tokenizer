<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:square" as="xs:integer">
    <xsl:param name="x" as="xs:integer"/>
    <xsl:sequence select="$x * $x"/>
  </xsl:function>
  <xsl:function name="f:total" as="xs:integer">
    <xsl:param name="values"/>
    <xsl:sequence select="f:total($values, 0)"/>
  </xsl:function>
  <xsl:function name="f:total" as="xs:integer">
    <xsl:param name="values"/>
    <xsl:param name="extra" as="xs:integer"/>
    <xsl:sequence select="xs:integer(sum($values)) + $extra"/>
  </xsl:function>
</xsl:stylesheet>
