<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:s="urn:example:shipping"
                exclude-result-prefixes="#all"
                version="3.0">

  <xsl:output method="xml" indent="yes"/>

  <xsl:variable name="carriers" select="map { 'standard': 'Royal Mail', 'express': 'DHL' }"/>

  <xsl:template match="/">
    <xsl:variable name="shipments" select="s:shipments/s:shipment"/>
    <xsl:variable name="customers" select="shipments/shipment/customer"/>
    <xsl:variable name="skus" select="$shipments/s:items/s:item/@sku"/>
    <xsl:variable name="shipped" select="$shipments[@status = 'Shipped']"/>
    <xsl:variable name="express" select="$carriers?Express"/>
    <report shipments="{count($shipments)}" shipped="{count($shipped)}" carrier="{$express}">
      <xsl:for-each select="$customers">
        <customer name="{.}"/>
      </xsl:for-each>
    </report>
  </xsl:template>

</xsl:stylesheet>
