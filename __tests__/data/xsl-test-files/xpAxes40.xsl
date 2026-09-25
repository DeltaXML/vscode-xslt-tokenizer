<?xml version="1.0" encoding="UTF-8"?>
<!-- XPath 4.0 axes following-or-self, following-sibling-or-self, preceding-or-self and preceding-sibling-or-self are errors in XPath 3.1 (keep test expressions in sync with xpAxes31.xsl) -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="4.0">

  <?test-attribute select?>
  <xsl:variable name="axis40a" select="following-or-self::*"/>
  <xsl:variable name="axis40b" select="following-sibling-or-self::a"/>
  <xsl:variable name="axis40c" select="preceding-or-self::node()"/>
  <xsl:variable name="axis40d" select="preceding-sibling-or-self::a[1]"/>
  <xsl:variable name="axis40e" select="a/following-sibling-or-self::b/preceding-sibling-or-self::*"/>
  <xsl:variable name="axis40f" select="(a, b)/following-or-self::text()"/>
  <xsl:variable name="axis40g" select="count(preceding-sibling-or-self::*)"/>
  <xsl:variable name="axis31a" select="following-sibling::a"/>
  <xsl:variable name="axis31b" select="preceding::node()"/>
  <xsl:variable name="axisError1" select="following-or-selfie::a"/>
  <xsl:variable name="axisError2" select="preceding-sibling-or-self:a"/>
</xsl:stylesheet>
