<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:param name="greeting" select="'hello'"/>
  <xsl:variable name="config" select="map{'a': 1, 'b': [1, 2]}"/>
  <xsl:template match="/">
    <out greeting="{$greeting}">
      <xsl:apply-templates select="items/item"/>
    </out>
  </xsl:template>
  <xsl:template match="item">
    <xsl:variable name="doubled" select="@n * 2"/>
    <xsl:message select="'item ' || @n"/>
    <result n="{f:square($doubled)}"/>
  </xsl:template>
  <xsl:function name="f:square">
    <xsl:param name="x"/>
    <xsl:sequence select="$x * $x"/>
  </xsl:function>
</xsl:stylesheet>
