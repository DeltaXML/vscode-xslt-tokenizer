<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:template match="/">
    <r>
      <xsl:for-each select="doc/b">
        <xsl:sequence select="xs:integer(.)"/>
      </xsl:for-each>
    </r>
  </xsl:template>
</xsl:stylesheet>
