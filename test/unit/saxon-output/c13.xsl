<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:template match="/">
    <xsl:variable name="s" select="string(doc/b)"/>
    <r><xsl:sequence select="$s/a"/></r>
  </xsl:template>
</xsl:stylesheet>
