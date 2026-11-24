<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output indent="no"/>
  <xsl:strip-space elements="*"/>
  <xsl:template match="section">
    <xsl:variable name="unused"><xsl:apply-templates select="section" mode="m"/></xsl:variable>
    <xsl:if test="exists($unused/m)"/>
    <div><xsl:apply-templates/></div>
    <xsl:apply-templates select="." mode="m"/>
  </xsl:template>
  <xsl:template match="section" mode="m"><m/></xsl:template>
  <xsl:template match="p"><para><xsl:value-of select="."/></para></xsl:template>
</xsl:stylesheet>
