<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
   <xsl:output method="text"/>
   <xsl:template name="xsl:initial-template">
      <xsl:variable name="doc"><orders><order id="1"><item>a</item></order></orders></xsl:variable>
      <xsl:variable name="m" select="map{'langs': ['xslt', map{'name': 'Ada'}]}"/>
      <xsl:text>done</xsl:text>
   </xsl:template>
</xsl:stylesheet>
