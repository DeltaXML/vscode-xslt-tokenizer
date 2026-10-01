<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:template match="/">
    <r><xsl:sequence select="/@id"/><xsl:apply-templates select="doc/a" mode="m"/></r>
  </xsl:template>
  <xsl:template match="a" mode="m">1</xsl:template>
  <xsl:template match="doc/a" mode="m">2</xsl:template>
</xsl:stylesheet>
