<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" exclude-result-prefixes="#all">
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="v" select="
      (1, 2, 3)
        -> sum(.)
        -> (if (. gt 5) {
              . * 100
            })
        =!> string()"/>
    <out><xsl:value-of select="$v"/></out>
  </xsl:template>
</xsl:stylesheet>
