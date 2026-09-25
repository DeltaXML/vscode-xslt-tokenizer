<?xml version="1.0" encoding="UTF-8"?>
<!-- XPath 4.0 mapping arrow operator '=!>' - the function on the right is applied to each item on the left individually -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="4.0">

  <?test-attribute select?>
  <xsl:variable name="mappingArrow1" select="(-2 to 2) =!> abs()"/>
  <xsl:variable name="mappingArrow2" select="(-2 to 2)=!>abs()"/>
  <xsl:variable name="mappingArrow3" select="'The cat sat' => tokenize() =!> concat('.') =!> upper-case() => string-join(' ')"/>
  <xsl:variable name="mappingArrow4" select="('a', 'b') =!> string-length() -> sum(.)"/>
  <xsl:variable name="mappingArrow5" select="(1, 2) =!> (function($a) { $a * 2 })()"/>
  <xsl:variable name="mappingArrow6" select="(1.5, 2.5) =!> round(1) = (2, 3)"/>
  <xsl:variable name="mappingArrow7" select="('=!>', '=! >') =!> string-length()"/>
  <xsl:variable name="mappingArrow8" select="(1, 2) =!> fn:abs()"/>
  <!-- expect errors: -->
  <xsl:variable name="mappingArrowError1" select="(1, 2) =!> 'abs'"/>
  <xsl:variable name="mappingArrowError2" select="(1, 2) =!> 3"/>
  <xsl:variable name="mappingArrowError3" select="(1, 2) =!> abs"/>
  <xsl:variable name="mappingArrowError4" select="(1, 2) =!> round(1, 2, 3)"/>
</xsl:stylesheet>
