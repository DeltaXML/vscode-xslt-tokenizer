<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:import href="function-breakpoints-lib.xsl"/>
  <xsl:template match="/">
    <out>
      <xsl:for-each select="items/item">
        <xsl:call-template name="cell">
          <xsl:with-param name="n" select="xs:integer(@n)"/>
        </xsl:call-template>
      </xsl:for-each>
      <total><xsl:sequence select="f:total(items/item/@n), f:total(items/item/@n, 10)"/></total>
    </out>
  </xsl:template>
  <xsl:template name="cell">
    <xsl:param name="n"/>
    <cell><xsl:value-of select="f:square($n)"/></cell>
  </xsl:template>
</xsl:stylesheet>
