<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <!-- included by output-map.xsl -->
  <xsl:template name="from-lib">
    <xsl:variable name="lib-built">
      <lib-variable/>
    </xsl:variable>
    <from-lib>
      <xsl:copy-of select="$lib-built"/>
    </from-lib>
  </xsl:template>
</xsl:stylesheet>
