<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
   <xsl:output method="text"/>
   <xsl:template name="xsl:initial-template">
      <xsl:variable name="a" select="'A'"/>
      <xsl:text expand-text="yes">
x {$a}
y {$a}
      </xsl:text>
   </xsl:template>
</xsl:stylesheet>
