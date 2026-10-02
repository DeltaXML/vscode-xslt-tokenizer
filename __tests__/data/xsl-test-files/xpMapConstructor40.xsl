<?xml version="1.0" encoding="UTF-8"?>
<!-- map constructors without the 'map' keyword: valid in XPath 4.0, errors in XPath 3.1 - 4.0 tests (keep test expressions in sync with xpMapConstructor31.xsl) -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="4.0">

  <?test-attribute select?>
  <xsl:variable name="mapCons1" select="{ 'a': 1, 'b': 2 }"/>
  <xsl:variable name="mapCons2" select="{}"/>
  <xsl:variable name="mapCons3" select="{ 1: 'one' }?1"/>
  <xsl:variable name="mapCons4" select="let $m := { 'a': 1 } return $m?a"/>
  <xsl:variable name="mapCons5" select="({ 'a': 1 }, { 'b': 2 })"/>
  <xsl:variable name="mapCons6" select="(1, 2) -&gt; { 'value': . }"/>
  <xsl:variable name="mapCons7" select="(1, 2) ! { 'n': . }"/>
  <xsl:variable name="mapCons8" select="{ 'a': { 'b': 1 } }?a?b"/>
  <xsl:variable name="mapCons9" select="if (true()) then { 'a': 1 } else {}"/>
  <xsl:variable name="mapCons10" select="{ 'a': 1 } =&gt; exists()"/>
  <xsl:variable name="mapCons11" select="function($a) as map(*) { { 'a': $a } }"/>
  <xsl:variable name="mapCons12" select="[{ 'a': 1 }, { 'b': 2 }]"/>
  <xsl:variable name="mapCons13" select="{ 'a': 1 } instance of map(*)"/>
  <xsl:variable name="mapMerge1" select="{ map { 'a': 1 }, map { 'b': 2 } }"/>
  <xsl:variable name="mapMerge2" select="map { map { 'a': 1 }, map { 'b': 2 } }"/>
  <xsl:variable name="mapMerge3" select="map { 'a': 1, map { 'b': 2 } }"/>
  <xsl:variable name="notMap1" select="map { 'a': 1 }"/>
  <xsl:variable name="notMap2" select="function($a) as xs:integer* { $a }"/>
  <xsl:variable name="notMap3" select="array { 1, 2 }"/>
  <xsl:variable name="notMap4" select="for-each((1, 2), function($a) { $a + 1 })"/>
  <xsl:variable name="mapConsError1" select="{ 'a': 1, }"/>
  <xsl:variable name="mapConsError2" select="{ 'a': 1 : 2 }"/>
</xsl:stylesheet>
