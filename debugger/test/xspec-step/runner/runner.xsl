<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:t="urn:t" xmlns:x="urn:x">
  <xsl:import href="../tested.xsl"/>
  <xsl:template name="main">
    <xsl:variable name="x:result" as="item()*">
      <xsl:variable name="x:param1" select="(1, 2, 3)"/>
      <xsl:variable name="x:param2" select="10"/>
      <xsl:sequence select="t:total($x:param1, $x:param2)"/>
    </xsl:variable>
    <xsl:variable name="x:count" select="count($x:result)"/>
    <xsl:call-template name="x:expect1">
      <xsl:with-param name="x:result" select="$x:result"/>
    </xsl:call-template>
  </xsl:template>
  <xsl:template name="x:expect1">
    <xsl:param name="x:result"/>
    <xsl:variable name="x:successful" select="$x:result = 16"/>
    <xsl:sequence select="$x:successful"/>
  </xsl:template>
</xsl:stylesheet>
