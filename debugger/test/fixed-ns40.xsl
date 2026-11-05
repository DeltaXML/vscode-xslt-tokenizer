<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" fixed-namespaces="#standard f=urn:f g=urn:g d=urn:d">
  <xsl:include href="fixed-ns-lib.xsl"/>
  <xsl:function name="f:twice" as="xs:integer"><xsl:param name="x" as="xs:integer"/><xsl:sequence select="$x * 2"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="m" select="map:merge((map:entry('a', 1), map:entry('b', 2)))"/>
    <xsl:variable name="v" select="
      f:twice(
        map:size($m)) + g:three()
      + xs:integer(math:pi())"/>
    <out v="{$v}" d="{d:name()}"/>
  </xsl:template>
</xsl:stylesheet>
