<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="reason" select="'no orders'"/>
    <xsl:message terminate="yes" select="'Stopping: ' || $reason"/>
  </xsl:template>
</xsl:stylesheet>
