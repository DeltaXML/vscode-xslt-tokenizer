<?xml version="1.0" encoding="UTF-8"?>
<!-- XPath 4.0 item types: choice, enumeration, record and named item types, and fn(...) function types - errors in XPath 3.1 (keep test expressions in sync with xpItemTypesSel40.xsl) -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:ct="com.example.test"
                version="3.0">

  <?test-attribute select?>
  <xsl:variable name="choiceSel1" select="'2020-01-01' instance of (xs:date | xs:string)"/>
  <xsl:variable name="choiceSel2" select="'2020-01-01' cast as (xs:date | xs:time)"/>
  <xsl:variable name="choiceSel3" select="'2020-01-01' castable as (xs:date | xs:time)?"/>
  <xsl:variable name="choiceSel4" select="'a' instance of (ct:complex | xs:string)+"/>
  <xsl:variable name="choiceSel5" select="'a' treat as (map(*) | xs:string)"/>
  <xsl:variable name="enumSel1" select="'red' instance of enum('red', 'green')"/>
  <xsl:variable name="enumSel2" select="'red' cast as enum('red', 'green')"/>
  <xsl:variable name="recordSel1" select="map { 'r': 1.0, 'i': 2.0 } instance of record(r as xs:double, i as xs:double)"/>
  <xsl:variable name="recordSel2" select="map { 'a': 1 } treat as record('a', b? as xs:string)"/>
  <xsl:variable name="fnParamSel1" select="function($a as (xs:string | xs:integer)) as record(n as xs:integer) { map { 'n': $a } }"/>
  <xsl:variable name="fnTypeSel1" select="abs#1 instance of fn(xs:numeric?) as xs:numeric?"/>
  <xsl:variable name="namedSel1" select="map { 'r': 1.0, 'i': 2.0 } instance of ct:complex"/>
  <xsl:variable name="plainSel1" select="5 instance of xs:integer+"/>
  <xsl:variable name="pathUnion1" select="(a | b)"/>
  <xsl:variable name="pathUnion2" select="(a | b)[1]"/>
  <xsl:variable name="pathUnion3" select="a/(b | c)"/>
  <xsl:variable name="oldUnionSel1" select="'a' instance of union(xs:date, xs:string)"/>
  <xsl:variable name="recordSel3" select="map {} instance of record()"/>
  <xsl:variable name="recordSel4" select="map { 'a b': 1 } instance of record('a b', 'c'?)"/>
  <xsl:variable name="choiceSelErr1" select="'a' cast as (xs:date | xs:time)*"/>
  <xsl:variable name="oldTupleSel1" select="map {} instance of tuple(a)"/>
</xsl:stylesheet>
