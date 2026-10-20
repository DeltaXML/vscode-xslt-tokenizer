<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                version="3.0">

  <xsl:output method="xml" indent="yes"/>

  <xsl:param name="discount" as="xs:decimal" select="0.1"/>
  <xsl:variable name="currency" as="xs:string" select="'GBP'"/>

  <xsl:template match="/orders">
    <totals currency="{$currency}">
      <xsl:apply-templates select="order"/>
    </totals>
  </xsl:template>

  <xsl:template match="order">
    <xsl:variable name="customer" as="xs:string" select="@customer"/>
    <xsl:variable name="line-totals" as="xs:decimal*" select="
      for $line in line
      return
        xs:integer($line/@qty) * xs:decimal($line/@price) * (1 - $discount)"/>
    <order id="{@id}" customer="{$customer}" total="{sum($line-totals)}"/>
  </xsl:template>

</xsl:stylesheet>
