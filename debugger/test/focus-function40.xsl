<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" xmlns:xs="http://www.w3.org/2001/XMLSchema" exclude-result-prefixes="#all">
  <xsl:function name="f:twice"><xsl:param name="x"/><xsl:message select="'twice ' || $x"/><xsl:sequence select="$x * 2"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="focus" select="
      filter((1, 5, 9),
        fn { f:twice(.) gt 4 })"/>
    <xsl:variable name="end" select="1"/>
    <out focus="{$focus}"/>
  </xsl:template>
</xsl:stylesheet>
