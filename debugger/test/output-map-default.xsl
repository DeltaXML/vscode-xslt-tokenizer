<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <!-- no xsl:output: Saxon decides the output method from the first element -->
  <xsl:template match="/">
    <result>
      <xsl:value-of select="count(items/item)"/>
    </result>
  </xsl:template>
</xsl:stylesheet>
