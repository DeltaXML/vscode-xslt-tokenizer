<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
   <xsl:output method="text"/>
   <xsl:template name="xsl:initial-template">
      <xsl:variable name="items" select="1 to 3"/>
      <xsl:for-each select="$items">
         <xsl:value-of select=". * 10"/>
         <xsl:text>,</xsl:text>
      </xsl:for-each>
      <xsl:iterate select="$items">
         <xsl:param name="total" select="0"/>
         <xsl:next-iteration>
            <xsl:with-param name="total" select="$total + ."/>
         </xsl:next-iteration>
      </xsl:iterate>
      <xsl:for-each-group select="$items" group-by=". mod 2">
         <xsl:value-of select="current-grouping-key()"/>
      </xsl:for-each-group>
      <xsl:analyze-string select="'a1b2'" regex="\d">
         <xsl:matching-substring>
            <xsl:value-of select="."/>
         </xsl:matching-substring>
      </xsl:analyze-string>
      <xsl:text>done</xsl:text>
   </xsl:template>
</xsl:stylesheet>
