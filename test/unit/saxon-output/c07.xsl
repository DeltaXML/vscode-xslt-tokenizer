<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:param name="zero" select="0"/>
  <xsl:template match="/">
    <r><xsl:sequence select="1 idiv $zero"/></r>
  </xsl:template>
</xsl:stylesheet>
