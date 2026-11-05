<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="#all">
  <xsl:template match="/">
    <out>
      <xsl:for-each select="items/item">
        <xsl:choose>
          <xsl:when test="
            xs:integer(@n)
              eq 1">
            <one/>
          </xsl:when>
          <xsl:when test="
            xs:integer(@n)
              eq 2">
            <two/>
          </xsl:when>
          <xsl:otherwise>
            <other/>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:for-each>
      <xsl:variable name="totals" as="map(*)">
        <xsl:map>
          <xsl:for-each select="items/item">
            <xsl:map-entry key="
              'item-'
                || @n" select="
              xs:integer(@n)
                * 10"/>
          </xsl:for-each>
        </xsl:map>
      </xsl:variable>
      <totals><xsl:value-of select="sort(map:keys($totals)) ! ($totals(.))" xmlns:map="http://www.w3.org/2005/xpath-functions/map"/></totals>
      <xsl:call-template name="show">
        <xsl:with-param name="v" select="
          count(items/item)
            * 2"/>
      </xsl:call-template>
    </out>
  </xsl:template>
  <xsl:template name="show">
    <xsl:param name="v"/>
    <show v="{$v}"/>
  </xsl:template>
</xsl:stylesheet>
