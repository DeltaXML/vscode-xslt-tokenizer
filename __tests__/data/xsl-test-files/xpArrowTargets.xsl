<?xml version="1.0" encoding="UTF-8"?>
<!-- XPath 4.0 arrow targets: a dynamic call on an inline function, named function reference, map or array constructor -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="4.0">

  <?test-attribute select?>
  <xsl:variable name="arrowTarget1" select="2 => function($x) { $x + 1 }()"/>
  <xsl:variable name="arrowTarget2" select="(1, 2) =!> function($x) { $x + 1 }()"/>
  <xsl:variable name="arrowTarget3" select="2 => function($x, $y) { $x + $y }(3)"/>
  <xsl:variable name="arrowTarget4" select="2 => function($x) { abs($x) }()"/>
  <xsl:variable name="arrowTarget5" select="-2 => abs#1()"/>
  <xsl:variable name="arrowTarget6" select="1 => map { 1: 'one', 2: 'two' }()"/>
  <xsl:variable name="arrowTarget7" select="(1, 2) =!> array { 'x', 'y' }()"/>
  <xsl:variable name="arrowTarget8" select="2 => [ 'x', 'y' ]()"/>
  <xsl:variable name="arrowTarget9" select="2 => (function($x) { $x * 2 })()"/>
  <xsl:variable name="arrowTarget10" select="'abc' => function($s) { substring($s, 2) }()"/>
  <!-- expect errors: -->
  <xsl:variable name="arrowTargetError1" select="2 => function($x) { substring($x) }()"/>
  <xsl:variable name="arrowTargetError2" select="2 => 'abc'"/>
</xsl:stylesheet>
