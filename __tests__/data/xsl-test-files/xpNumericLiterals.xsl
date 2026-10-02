<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="3.0">

  <?test-attribute select?>
  <xsl:variable name="num1" select="1"/>
  <xsl:variable name="num2" select="100"/>
  <xsl:variable name="num3" select="10.0"/>
  <xsl:variable name="num4" select="10.02"/>
  <xsl:variable name="num5-error" select="10.0.2"/>
  <xsl:variable name="num6" select=".2"/>
  <xsl:variable name="num7" select="-1"/>
  <xsl:variable name="num8" select="- 1"/>
  <xsl:variable name="num9" select="-100"/>
  <xsl:variable name="num10" select="-100.1"/>
  <xsl:variable name="num11-error" select="-100.2.4"/>
  <xsl:variable name="num12" select="5E7"/>
  <xsl:variable name="num13" select="5e-72"/>
  <xsl:variable name="num14" select="5e+72"/>
  <xsl:variable name="num15-error" select="5e77.5"/>
  <xsl:variable name="num16-error" select="5e7e8"/>
  <xsl:variable name="num17-error" select="5..5"/>
  <xsl:variable name="num18-error" select="5e.5"/>
  <xsl:variable name="num19-error" select="5e"/>
  <xsl:variable name="num20-error" select="5e."/>
  <xsl:variable name="num21" select="5."/>
  <xsl:variable name="num22" select="5e-5"/>
  
</xsl:stylesheet>