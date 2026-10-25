<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="zero" select="0"/>
    <out><xsl:value-of select="1 idiv $zero"/></out>
  </xsl:template>
</xsl:stylesheet>
