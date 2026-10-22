<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:t"><xsl:param name="x"/><xsl:message select="'t ' || $x"/><xsl:sequence select="$x"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="a" as="array(*)">
      <xsl:array>
        <xsl:array-member select="
          f:t(1), f:t(2)"/>
        <xsl:sequence select="
          f:t(3)"/>
      </xsl:array>
    </xsl:variable>
    <xsl:variable name="r" as="map(*)">
      <xsl:record name="
        f:t('Ada')" langs="
        (f:t('xslt'), 'xpath')"/>
    </xsl:variable>
    <out size="{count($a?*)}" name="{$r?name}" langs="{$r?langs}"/>
  </xsl:template>
</xsl:stylesheet>
