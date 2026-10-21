<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="#all">
  <xsl:template match="/">
    <out>
      <xsl:iterate select="
        items/item
          [@n ne '0']">
        <xsl:param name="total" as="xs:integer" select="0"/>
        <xsl:on-completion select="
          'total: '
            || $total"/>
        <item n="{@n}" running="{$total + xs:integer(@n)}"/>
        <xsl:next-iteration>
          <xsl:with-param name="total" select="
            $total
              + xs:integer(@n)"/>
        </xsl:next-iteration>
      </xsl:iterate>
      <xsl:variable name="use-sum" select="count(items/item) gt 2"/>
      <xsl:evaluate xpath="
        if ($use-sum)
        then 'sum(items/item/@n) * $factor'
        else 'count(items/item)'" context-item="." with-params="map { QName('', 'factor'): 10 }"/>
    </out>
  </xsl:template>
</xsl:stylesheet>
