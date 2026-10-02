<?xml version="1.0" encoding="UTF-8"?>
<!-- simple map operator '!' - the right-hand path expression, including predicates, lookups and dynamic calls, has the context item -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">

  <?test-attribute select?>
  <xsl:variable name="simpleMap1" select="(1, 2) ! (function($a) { $a + 1 })(.)"/>
  <xsl:variable name="simpleMap2" select="(1, 2) ! string(.)"/>
  <xsl:variable name="simpleMap3" select="('a', 'b') ! upper-case(.) ! string-length(.)"/>
  <xsl:variable name="simpleMap4" select="(1, 2) ! .[. gt 1]"/>
  <xsl:variable name="simpleMap5" select="(1, 2) ! (. + 1)"/>
  <xsl:variable name="simpleMap6" select="let $f := abs#1 return (1, 2) ! $f(.)"/>
  <xsl:variable name="simpleMap7" select="(1, 2) ! [., .]"/>
  <xsl:variable name="simpleMap8" select="(1, 2) ! map { 'a': . }?a"/>
  <xsl:variable name="simpleMap9" select="(1, 2) ! concat(., 'a') => string-length()"/>
  <xsl:variable name="simpleMap10" select="(1, 2) ! string(.) || 'a'"/>
  <xsl:variable name="simpleMap11" select="(1, 2) ! (function($a, $b) { $a + $b })(., .)[1]"/>
  <!-- expect missing context item errors: -->
  <xsl:variable name="simpleMapError1" select="(1, 2) ! . + ."/>
  <xsl:variable name="simpleMapError2" select="(1, 2) ! ., ."/>
  <xsl:variable name="simpleMapError3" select="(1, 2) ! string(.) => concat(.)"/>
  <xsl:variable name="simpleMapError4" select="for $a in (1, 2) ! . return ."/>
  <xsl:variable name="simpleMapError5" select="(1, 2) ! string(.) || string(.)"/>
  <xsl:variable name="simpleMapError6" select="(1, 2) ! current()"/>
</xsl:stylesheet>
