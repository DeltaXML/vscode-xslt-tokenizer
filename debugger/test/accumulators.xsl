<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="#all">
  <xsl:mode use-accumulators="#all"/>
  <xsl:accumulator name="running-total" as="xs:integer" initial-value="0">
    <xsl:accumulator-rule match="item" select="
      $value
        + xs:integer(@n)"/>
  </xsl:accumulator>
  <xsl:accumulator name="count" as="xs:integer" initial-value="0">
    <xsl:accumulator-rule match="item" phase="end">
      <xsl:sequence select="$value + 1"/>
    </xsl:accumulator-rule>
  </xsl:accumulator>
  <xsl:template match="/">
    <out><xsl:apply-templates select="items/item"/></out>
  </xsl:template>
  <xsl:template match="item">
    <item n="{@n}" total="{accumulator-before('running-total')}" count="{accumulator-after('count')}"/>
  </xsl:template>
</xsl:stylesheet>
