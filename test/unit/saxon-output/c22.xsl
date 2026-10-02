<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:function name="f:f" as="xs:string">
    <xsl:param name="p" as="xs:integer"/>
    <xsl:sequence select="string($p)"/>
  </xsl:function>
  <xsl:template match="/"><r><xsl:sequence select="f:f(doc/b)"/></r></xsl:template>
</xsl:stylesheet>
