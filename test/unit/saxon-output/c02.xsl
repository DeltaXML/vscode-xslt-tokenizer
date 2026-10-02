<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:function name="f:f" as="xs:integer">
    <xsl:param name="p"/>
    <xsl:sequence select="$p"/>
  </xsl:function>
  <xsl:template match="/"><r><xsl:sequence select="f:f(string(/doc/b))"/></r></xsl:template>
</xsl:stylesheet>
