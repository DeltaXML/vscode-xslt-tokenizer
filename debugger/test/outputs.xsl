<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="no"/>
  <xsl:template match="/">
    <report>
      <xsl:variable name="tmp">
        <t>temporary</t>
      </xsl:variable>
      <xsl:for-each select="items/item">
        <row n="{@n}">text</row>
      </xsl:for-each>
      <xsl:result-document href="side.json" method="json">
        <xsl:sequence select="map { 'count': count(items/item), 'temp': string($tmp) }"/>
      </xsl:result-document>
      <end/>
    </report>
  </xsl:template>
</xsl:stylesheet>
