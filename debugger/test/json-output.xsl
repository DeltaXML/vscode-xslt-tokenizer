<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <!-- the principal result is JSON: Saxon gives the serializer its xsl:output properties as defaults -->
  <xsl:output method="json"/>
  <xsl:template match="/">
    <xsl:variable name="count" select="count(items/item)"/>
    <xsl:map>
      <xsl:map-entry key="'count'" select="$count"/>
      <xsl:map-entry key="'values'" select="array { items/item/string() }"/>
    </xsl:map>
  </xsl:template>
</xsl:stylesheet>
