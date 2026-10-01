<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:template match="/">
    <r><xsl:sequence select="@x/a"/><xsl:apply-templates select="doc/a"/></r>
  </xsl:template>
  <xsl:template match="a[1]">1</xsl:template>
  <xsl:template match="a[. = 1]">2</xsl:template>
  <xsl:variable name="unused" select="1 div 0"/>
</xsl:stylesheet>
