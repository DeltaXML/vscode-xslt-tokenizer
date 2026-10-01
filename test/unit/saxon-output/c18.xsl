<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:template match="/">
    <xsl:assert test="count(//a) = 5">Expected five a elements</xsl:assert>
    <r/>
  </xsl:template>
</xsl:stylesheet>
