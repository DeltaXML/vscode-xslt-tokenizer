<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <xsl:variable name="total" as="xs:integer" select="sum(items/item ! f:double(.))"/>
    <out>
      <xsl:value-of select="$total"/>
      <xsl:value-of select="$total + 1"/>
    </out>
  </xsl:template>
  <xsl:function name="f:double" as="xs:integer">
    <xsl:param name="item"/>
    <xsl:sequence select="2 * xs:integer($item/@n)"/>
  </xsl:function>
</xsl:stylesheet>
