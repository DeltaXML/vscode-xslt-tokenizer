<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <!-- included by output-map.xsl -->
  <xsl:template name="from-lib">
    <xsl:variable name="lib-variable">
      <lib-variable/>
    </xsl:variable>
    <from-lib kind="literal">
      <xsl:attribute name="made-by" select="'xsl:attribute'"/>
      <xsl:copy-of select="$lib-variable"/>
      <xsl:apply-templates select="/items/item[3]" mode="copy"/>
    </from-lib>
  </xsl:template>
  <!-- a node copied by the built-in template rule -->
  <xsl:mode name="copy" on-no-match="shallow-copy"/>
</xsl:stylesheet>
