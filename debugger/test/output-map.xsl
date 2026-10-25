<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <!-- where each part of the XML output comes from: the instruction that wrote it -->
  <xsl:include href="output-map-lib.xsl"/>
  <xsl:output method="xml" indent="no"/>
  <xsl:variable name="built">
    <built-in-variable kind="temporary"/>
  </xsl:variable>
  <xsl:template match="/">
    <report count="{count(items/item)}">
      <xsl:element name="made">
        <xsl:value-of select="'by value-of'"/>
      </xsl:element>
      <literal>first literal line
second literal line</literal>
      <xsl:sequence select="items/item[2]"/>
      <xsl:sequence select="$built"/>
      <xsl:call-template name="from-lib"/>
      <xsl:variable name="text-only"><xsl:value-of select="'text only'"/></xsl:variable>
      <only-text><xsl:sequence select="$text-only"/></only-text>
      <xsl:variable name="wrapped">
        <wrapped><xsl:value-of select="'wrapped text'"/></wrapped>
      </xsl:variable>
      <xsl:sequence select="$wrapped"/>
    </report>
  </xsl:template>
</xsl:stylesheet>
