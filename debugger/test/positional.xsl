<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <!-- (5, 6) is a constant: Saxon 13.1 fails at run time where $pos is evaluated in the stylesheet itself -->
  <xsl:template name="xsl:initial-template">
    <out><xsl:value-of select="
      for $i at $pos in (5, 6)
      return
        $i * $pos"/></out>
    <xsl:variable name="after" select="1"/>
    <xsl:sequence select="$after"/>
  </xsl:template>
</xsl:stylesheet>
