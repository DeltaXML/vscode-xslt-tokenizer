<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:template match="/">
    <r><xsl:call-template name="t"/></r>
  </xsl:template>
  <xsl:template name="t" as="element()">
    <xsl:text>hello</xsl:text>
  </xsl:template>
</xsl:stylesheet>
